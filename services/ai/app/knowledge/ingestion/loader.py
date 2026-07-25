"""Markdown corpus loader, parser, and validator for knowledge ingestion.

This module walks the reviewed Markdown corpus, validates front matter against
the documented taxonomy, computes body checksums, resolves external source
references, and returns structured `ParsedKnowledgeEntry` objects.

All validation errors are collected before any embedding or database calls.
"""

from __future__ import annotations

import asyncio
import hashlib
import re
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Optional

import frontmatter
import httpx

from app.knowledge.ingestion.errors import IngestionError, IngestionErrorCode
from app.knowledge.ingestion.schemas import ParsedKnowledgeEntry
from app.knowledge.ingestion.source_resolution import resolve_source
from app.knowledge.ingestion.taxonomy import (
    CONTROLLED_ARRAY_FIELDS,
    EVIDENCE_TIERS,
    KINDS,
    LOCALES,
    MARKETS,
    REQUIRED_FRONT_MATTER_KEYS,
    REVIEW_STATUSES,
    is_valid_slug,
)


# Files and directories that are not knowledge entries.
_EXCLUDED_PATHS = {
    "_schema",
    "README.md",
    "APPROVAL_RECORD.md",
    "LIVE_READINESS.md",
    "MANIFEST.json",
    "seed-retrieval-queries.json",
}

_ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


@dataclass(frozen=True)
class ValidationIssue:
    """A single validation problem found while loading the corpus."""

    path: str
    code: str
    message: str

    def to_error(self) -> IngestionError:
        return IngestionError(code=self.code, message=f"{self.path}: {self.message}")


def _find_repo_root(start: Path | None = None) -> Path:
    """Find the repository root by looking for package.json and apps/api.

    Defaults to the repo root relative to this file (services/ai/app/knowledge/ingestion).
    """
    if start is None:
        start = Path(__file__).resolve()
        # This file is at services/ai/app/knowledge/ingestion/loader.py.
        # Repo root is 5 parents up.
        candidate = start.parents[5]
        if (candidate / "package.json").exists() and (candidate / "apps" / "api").exists():
            return candidate
    # Fallback: walk up from the current working directory.
    current = Path.cwd().resolve()
    for parent in [current, *current.parents]:
        if (parent / "package.json").exists() and (parent / "apps" / "api").exists():
            return parent
    raise RuntimeError("Could not locate repository root containing package.json and apps/api")


def _normalize_body(body: str) -> str:
    """Normalize Markdown body exactly like the Node validator does.

    - Convert CRLF to LF.
    - Trim trailing whitespace on every line.
    - Collapse trailing blank lines to a single newline.
    """
    text = body.replace("\r\n", "\n")
    text = re.sub(r"[ \t]+$", "", text, flags=re.MULTILINE)
    text = re.sub(r"\n+$", "\n", text)
    return text


def _extract_body_from_raw(raw_text: str) -> str:
    """Extract the Markdown body exactly as it appears after the front matter.

    python-frontmatter strips trailing newlines from `post.content`, but the
    stored checksum was computed by the Node validator on gray-matter's output,
    which preserves them. This extractor returns the raw body bytes as they
    appear in the file, so checksums match.
    """
    if not raw_text.startswith("---"):
        return raw_text
    rest = raw_text[3:]
    # Strict closing delimiter: "---" on its own line followed by a newline.
    match = re.search(r"\r?\n---\r?\n", rest)
    if not match:
        return raw_text
    body_start = 3 + match.end()
    return raw_text[body_start:]


def _compute_checksum(body: str) -> str:
    """Compute SHA-256 checksum of the normalized Markdown body."""
    normalized = _normalize_body(body)
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def _is_iso_date(value: str) -> bool:
    return isinstance(value, str) and bool(_ISO_DATE_RE.match(value))


def _parse_iso_date(value: str) -> datetime:
    """Parse an ISO date string into a timezone-naive datetime."""
    return datetime.strptime(value, "%Y-%m-%d")


def _is_excluded(path: Path, root: Path) -> bool:
    """Return True if a path should be skipped when loading entries."""
    rel_parts = path.relative_to(root).parts
    if any(part in _EXCLUDED_PATHS for part in rel_parts):
        return True
    if path.name in _EXCLUDED_PATHS:
        return True
    return False


def _discover_entry_files(source_dir: Path) -> list[Path]:
    """Return all non-excluded .md files under the source directory."""
    files: list[Path] = []
    for path in sorted(source_dir.rglob("*.md")):
        if _is_excluded(path, source_dir):
            continue
        files.append(path)
    return files


def _validate_array_of_strings(
    data: dict,
    key: str,
    path: str,
    errors: list[ValidationIssue],
) -> list[str]:
    """Validate that a front-matter key is a list of strings."""
    value = data.get(key)
    if not isinstance(value, list):
        errors.append(
            ValidationIssue(
                path=path,
                code=IngestionErrorCode.INVALID_METADATA,
                message=f"{key} must be an array (use [] if not applicable)",
            )
        )
        return []
    for item in value:
        if not isinstance(item, str):
            errors.append(
                ValidationIssue(
                    path=path,
                    code=IngestionErrorCode.INVALID_METADATA,
                    message=f"{key} value {item!r} must be a string",
                )
            )
    return [str(item) for item in value]


def _validate_controlled_arrays(
    data: dict,
    path: str,
    errors: list[ValidationIssue],
) -> None:
    """Validate controlled-vocabulary array fields."""
    for key, allowed_set, name in CONTROLLED_ARRAY_FIELDS:
        values = _validate_array_of_strings(data, key, path, errors)
        for value in values:
            if value not in allowed_set:
                errors.append(
                    ValidationIssue(
                        path=path,
                        code=IngestionErrorCode.TAXONOMY_VIOLATION,
                        message=f"{key} value '{value}' not in {name} enum",
                    )
                )


def _validate_front_matter(
    file_path: Path,
    rel_path: str,
    data: dict,
    body: str,
    errors: list[ValidationIssue],
) -> None:
    """Validate the parsed front matter of a single entry."""
    # Required keys.
    for key in REQUIRED_FRONT_MATTER_KEYS:
        if key not in data:
            errors.append(
                ValidationIssue(
                    path=rel_path,
                    code=IngestionErrorCode.MISSING_REQUIRED_FIELD,
                    message=f"missing required key '{key}'",
                )
            )

    slug = data.get("slug")
    if not is_valid_slug(slug):
        errors.append(
            ValidationIssue(
                path=rel_path,
                code=IngestionErrorCode.INVALID_METADATA,
                message=f"slug '{slug}' must be a non-empty kebab-case string",
            )
        )
    else:
        expected_slug = file_path.stem
        if slug != expected_slug:
            errors.append(
                ValidationIssue(
                    path=rel_path,
                    code=IngestionErrorCode.INVALID_METADATA,
                    message=f"slug '{slug}' does not match filename '{expected_slug}'",
                )
            )

    version = data.get("version")
    if not isinstance(version, int) or version < 1:
        errors.append(
            ValidationIssue(
                path=rel_path,
                code=IngestionErrorCode.INVALID_METADATA,
                message=f"version must be a positive integer, got {version!r}",
            )
        )

    kind = data.get("kind")
    if kind not in KINDS:
        errors.append(
            ValidationIssue(
                path=rel_path,
                code=IngestionErrorCode.TAXONOMY_VIOLATION,
                message=f"kind '{kind}' not in KIND enum",
            )
        )

    for key in ("title", "summary", "author"):
        value = data.get(key)
        if not isinstance(value, str) or not value.strip():
            errors.append(
                ValidationIssue(
                    path=rel_path,
                    code=IngestionErrorCode.INVALID_METADATA,
                    message=f"{key} must be a non-empty string",
                )
            )

    locale = data.get("locale")
    if locale not in LOCALES:
        errors.append(
            ValidationIssue(
                path=rel_path,
                code=IngestionErrorCode.TAXONOMY_VIOLATION,
                message=f"locale '{locale}' not in LOCALE enum",
            )
        )

    _validate_controlled_arrays(data, rel_path, errors)

    # business_models is free-form recall-only; just require strings.
    _validate_array_of_strings(data, "business_models", rel_path, errors)

    evidence_tier = data.get("evidence_tier")
    if evidence_tier not in EVIDENCE_TIERS:
        errors.append(
            ValidationIssue(
                path=rel_path,
                code=IngestionErrorCode.TAXONOMY_VIOLATION,
                message=f"evidence_tier '{evidence_tier}' not in EVIDENCE_TIER enum",
            )
        )

    review_status = data.get("review_status")
    if review_status not in REVIEW_STATUSES:
        errors.append(
            ValidationIssue(
                path=rel_path,
                code=IngestionErrorCode.TAXONOMY_VIOLATION,
                message=f"review_status '{review_status}' not in REVIEW_STATUS enum",
            )
        )

    # source_references
    source_refs = data.get("source_references")
    if not isinstance(source_refs, list) or len(source_refs) == 0:
        errors.append(
            ValidationIssue(
                path=rel_path,
                code=IngestionErrorCode.INVALID_METADATA,
                message="source_references must be a non-empty array",
            )
        )
    else:
        for ref in source_refs:
            if not isinstance(ref, str) or not ref.strip():
                errors.append(
                    ValidationIssue(
                        path=rel_path,
                        code=IngestionErrorCode.INVALID_METADATA,
                        message=f"source_references entry {ref!r} must be a non-empty string",
                    )
                )

    # effective_at / expires_at
    effective_at = data.get("effective_at")
    if not _is_iso_date(effective_at):
        errors.append(
            ValidationIssue(
                path=rel_path,
                code=IngestionErrorCode.INVALID_METADATA,
                message=f"effective_at '{effective_at}' is not a valid ISO date",
            )
        )

    expires_at = data.get("expires_at")
    if expires_at is not None and not _is_iso_date(expires_at):
        errors.append(
            ValidationIssue(
                path=rel_path,
                code=IngestionErrorCode.INVALID_METADATA,
                message=f"expires_at '{expires_at}' must be null or a valid ISO date",
            )
        )

    if (
        _is_iso_date(effective_at)
        and expires_at is not None
        and _is_iso_date(expires_at)
        and expires_at < effective_at
    ):
        errors.append(
            ValidationIssue(
                path=rel_path,
                code=IngestionErrorCode.INVALID_DATE_RANGE,
                message=f"expires_at ({expires_at}) is before effective_at ({effective_at})",
            )
        )

    # Seasonal entries require a real expiry date.
    seasons = data.get("seasons", [])
    if isinstance(seasons, list) and len(seasons) > 0 and not _is_iso_date(expires_at):
        errors.append(
            ValidationIssue(
                path=rel_path,
                code=IngestionErrorCode.INVALID_DATE_RANGE,
                message="seasonal entries require expires_at to be a valid ISO date",
            )
        )

    # reviewer / reviewed_at consistency
    reviewer = data.get("reviewer")
    reviewed_at = data.get("reviewed_at")
    if review_status == "approved":
        if not isinstance(reviewer, str) or not reviewer.strip():
            errors.append(
                ValidationIssue(
                    path=rel_path,
                    code=IngestionErrorCode.INVALID_METADATA,
                    message="review_status approved but reviewer is null/empty",
                )
            )
        if not _is_iso_date(reviewed_at):
            errors.append(
                ValidationIssue(
                    path=rel_path,
                    code=IngestionErrorCode.INVALID_METADATA,
                    message="review_status approved but reviewed_at is not a valid ISO date",
                )
            )
    else:
        if reviewer is not None:
            errors.append(
                ValidationIssue(
                    path=rel_path,
                    code=IngestionErrorCode.INVALID_METADATA,
                    message=f"review_status '{review_status}' but reviewer is non-null",
                )
            )
        if reviewed_at is not None:
            errors.append(
                ValidationIssue(
                    path=rel_path,
                    code=IngestionErrorCode.INVALID_METADATA,
                    message=f"review_status '{review_status}' but reviewed_at is non-null",
                )
            )

    # checksum field exists and is a string
    checksum = data.get("checksum")
    if not isinstance(checksum, str):
        errors.append(
            ValidationIssue(
                path=rel_path,
                code=IngestionErrorCode.INVALID_METADATA,
                message="checksum must be a string (leave '' and let the validator fill it)",
            )
        )
    else:
        expected_checksum = _compute_checksum(body)
        if checksum and checksum != expected_checksum:
            errors.append(
                ValidationIssue(
                    path=rel_path,
                    code=IngestionErrorCode.CHECKSUM_MISMATCH,
                    message=f"checksum mismatch: expected {expected_checksum}, got {checksum}",
                )
            )


def _to_parsed_entry(file_path: Path, rel_path: str, data: dict, body: str) -> ParsedKnowledgeEntry:
    """Convert validated front matter into a ParsedKnowledgeEntry."""
    return ParsedKnowledgeEntry(
        slug=str(data["slug"]),
        version=int(data["version"]),
        kind=str(data["kind"]),
    title=str(data["title"]).strip(),
    title_ar=str(data["title_ar"]).strip() if data.get("title_ar") else None,
    summary=str(data["summary"]).strip(),
        body=body,
        body_checksum=_compute_checksum(body),
        locale=str(data["locale"]),
        markets=[str(m) for m in data.get("markets", [])],
        industries=[str(m) for m in data.get("industries", [])],
        business_models=[str(m) for m in data.get("business_models", [])],
        objectives=[str(m) for m in data.get("objectives", [])],
        funnel_stages=[str(m) for m in data.get("funnel_stages", [])],
        channels=[str(m) for m in data.get("channels", [])],
        seasons=[str(m) for m in data.get("seasons", [])],
        budget_modes=[str(m) for m in data.get("budget_modes", [])],
        evidence_tier=str(data["evidence_tier"]),
        review_status=str(data["review_status"]),
        source_references=[str(r) for r in data.get("source_references", [])],
        effective_at=_parse_iso_date(str(data["effective_at"])),
        expires_at=_parse_iso_date(str(data["expires_at"])) if data.get("expires_at") else None,
        author=str(data["author"]).strip(),
        reviewer=str(data["reviewer"]).strip() if data.get("reviewer") else None,
        reviewed_at=_parse_iso_date(str(data["reviewed_at"])) if data.get("reviewed_at") else None,
        file_path=rel_path,
    )


async def _resolve_sources_for_entries(
    entries: list[ParsedKnowledgeEntry],
    strict: bool,
    path_to_issues: dict[str, list[ValidationIssue]],
) -> dict[str, list[ValidationIssue]]:
    """Resolve source_references for all entries and append failures.

    Resolves all URLs in parallel with a concurrency limit.
    If `strict` is False, unresolved sources are reported as warnings but not
    treated as fatal errors.
    """
    updated = {path: list(issues) for path, issues in path_to_issues.items()}
    sem = asyncio.Semaphore(10)  # ponytail: cap concurrent HTTP requests

    async def _resolve_one(client: httpx.AsyncClient, entry: ParsedKnowledgeEntry, url: str) -> None:
        async with sem:
            result = await resolve_source(url, client=client)
            if not result.ok and strict:
                updated[entry.file_path].append(
                    ValidationIssue(
                        path=entry.file_path,
                        code=IngestionErrorCode.SOURCE_RESOLUTION_FAILED,
                        message=f"source_reference could not be resolved: {url!r} ({result.error or 'unknown error'})",
                    )
                )

    async with httpx.AsyncClient() as client:
        tasks = [
            _resolve_one(client, entry, url)
            for entry in entries
            for url in entry.source_references
        ]
        await asyncio.gather(*tasks)
    return updated


async def load_marketing_knowledge_entries(
    source_dir: str | Path | None = None,
    *,
    strict_sources: bool = True,
    repo_root: Path | None = None,
) -> tuple[list[ParsedKnowledgeEntry], list[ValidationIssue]]:
    """Load, validate, and optionally resolve all marketing knowledge entries.

    Returns a tuple of (valid_entries, validation_issues). If any validation
    issues exist, no database/embedding calls should be attempted.
    """
    root = repo_root or _find_repo_root()
    if source_dir is None:
        source_dir = "Docs/marketing-knowledge"
    source_path = Path(source_dir)
    if not source_path.is_absolute():
        source_path = root / source_path

    if not source_path.exists():
        raise RuntimeError(f"Knowledge source directory not found: {source_path}")

    files = _discover_entry_files(source_path)
    issues_by_path: dict[str, list[ValidationIssue]] = {}
    parsed_entries: list[ParsedKnowledgeEntry] = []
    seen_slugs: dict[str, str] = {}

    for file_path in files:
        rel_path = str(file_path.relative_to(root)).replace("\\", "/")
        issues_by_path[rel_path] = []
        try:
            raw_text = file_path.read_text(encoding="utf-8")
            # Strip a leading UTF-8 BOM so files written by Windows tools still
            # parse correctly.
            if raw_text.startswith("\ufeff"):
                raw_text = raw_text[1:]
            post = frontmatter.loads(raw_text)
        except Exception as exc:
            issues_by_path[rel_path].append(
                ValidationIssue(
                    path=rel_path,
                    code=IngestionErrorCode.INVALID_FRONT_MATTER,
                    message=f"failed to parse front matter: {exc}",
                )
            )
            continue

        data = post.metadata
        body = _extract_body_from_raw(raw_text)

        _validate_front_matter(file_path, rel_path, data, body, issues_by_path[rel_path])

        if not issues_by_path[rel_path]:
            entry = _to_parsed_entry(file_path, rel_path, data, body)
            # Duplicate slug detection.
            if entry.slug in seen_slugs:
                issues_by_path[rel_path].append(
                    ValidationIssue(
                        path=rel_path,
                        code=IngestionErrorCode.DUPLICATE_SLUG,
                        message=f"duplicate slug '{entry.slug}' (already used by {seen_slugs[entry.slug]})",
                    )
                )
            else:
                seen_slugs[entry.slug] = rel_path
                parsed_entries.append(entry)

    # Source resolution only for valid entries when strict mode is enabled.
    if strict_sources:
        issues_by_path = await _resolve_sources_for_entries(
            parsed_entries, strict_sources, issues_by_path
        )

    all_issues = [
        issue for issues in issues_by_path.values() for issue in issues
    ]
    return parsed_entries, all_issues


async def load_and_validate_corpus(
    source_dir: str | Path | None = None,
    *,
    strict_sources: bool = True,
    repo_root: Path | None = None,
) -> tuple[list[ParsedKnowledgeEntry], list[IngestionError]]:
    """Convenience wrapper that returns IngestionError objects for reporting."""
    entries, issues = await load_marketing_knowledge_entries(
        source_dir=source_dir,
        strict_sources=strict_sources,
        repo_root=repo_root,
    )
    errors = [issue.to_error() for issue in issues]
    return entries, errors
