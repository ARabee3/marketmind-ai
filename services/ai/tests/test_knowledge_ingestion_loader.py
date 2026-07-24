import pytest
from pathlib import Path
from uuid import uuid4

from app.knowledge.ingestion.errors import IngestionErrorCode
from app.knowledge.ingestion.loader import (
    _compute_checksum,
    _find_repo_root,
    _normalize_body,
    _validate_front_matter,
    load_and_validate_corpus,
)
from app.knowledge.ingestion.source_resolution import (
    INTERNAL_REF,
    resolve_source,
)
from app.knowledge.ingestion.taxonomy import CHANNELS, EVIDENCE_TIERS, KINDS, is_valid_slug


class TestNormalizeBody:
    def test_crlf_to_lf(self):
        # Matches Node gray-matter behavior: trailing newline is preserved only
        # if it existed in the input.
        assert _normalize_body("line1\r\nline2") == "line1\nline2"

    def test_trims_trailing_whitespace_per_line(self):
        assert _normalize_body("line1   \nline2\t\n") == "line1\nline2\n"

    def test_collapses_trailing_blank_lines(self):
        assert _normalize_body("body\n\n\n") == "body\n"

    def test_empty_body(self):
        assert _normalize_body("") == ""


class TestChecksum:
    def test_deterministic(self):
        body = "Hello world\n"
        assert _compute_checksum(body) == _compute_checksum(body)

    def test_sensitive_to_content(self):
        assert _compute_checksum("Hello\n") != _compute_checksum("World\n")

    def test_normalizes_before_hash(self):
        assert _compute_checksum("Hello   \n") == _compute_checksum("Hello\n")

    def test_matches_real_corpus_checksum(self):
        from pathlib import Path

        import frontmatter

        from app.knowledge.ingestion.loader import _extract_body_from_raw

        p = Path("../../Docs/marketing-knowledge/channels/channel-facebook.md")
        raw = p.read_text(encoding="utf-8")
        post = frontmatter.loads(raw)
        body = _extract_body_from_raw(raw)
        assert _compute_checksum(body) == post.metadata["checksum"]


class TestFindRepoRoot:
    def test_finds_root_from_loader_file(self):
        root = _find_repo_root()
        assert (root / "package.json").exists()
        assert (root / "apps" / "api").exists()
        assert (root / "Docs" / "marketing-knowledge").exists()


class TestTaxonomy:
    def test_channels_match_canonical_slugs(self):
        assert "google_business_profile" in CHANNELS
        assert "google_maps" not in CHANNELS

    def test_evidence_tiers(self):
        assert EVIDENCE_TIERS == {"verified_benchmark", "reviewed_guidance", "contextual_note"}

    def test_kind_enum_has_expected_values(self):
        assert "framework" in KINDS
        assert "channel_playbook" in KINDS
        assert "benchmark_report" in KINDS

    def test_is_valid_slug(self):
        assert is_valid_slug("channel-facebook")
        assert is_valid_slug("my-entry-2")
        assert not is_valid_slug("Channel-Facebook")
        assert not is_valid_slug("")
        assert not is_valid_slug("-invalid")
        assert not is_valid_slug("2-invalid")


class TestValidateFrontMatter:
    def test_missing_required_key(self):
        data = {"slug": "test", "version": 1}
        errors = []
        _validate_front_matter(Path("test.md"), "test.md", data, "body", errors)
        assert any(e.code == IngestionErrorCode.MISSING_REQUIRED_FIELD for e in errors)

    def test_invalid_kind(self):
        data = self._valid_data()
        data["kind"] = "invalid_kind"
        errors = []
        _validate_front_matter(Path("test.md"), "test.md", data, "body", errors)
        assert any("kind" in e.message for e in errors)

    def test_slug_mismatch(self):
        data = self._valid_data()
        data["slug"] = "wrong-slug"
        errors = []
        _validate_front_matter(Path("test.md"), "test.md", data, "body", errors)
        assert any(e.code == IngestionErrorCode.INVALID_METADATA for e in errors)

    def test_invalid_date_range(self):
        data = self._valid_data()
        data["effective_at"] = "2026-12-31"
        data["expires_at"] = "2026-01-01"
        errors = []
        _validate_front_matter(Path("test.md"), "test.md", data, "body", errors)
        assert any(e.code == IngestionErrorCode.INVALID_DATE_RANGE for e in errors)

    def test_seasonal_requires_expires_at(self):
        data = self._valid_data()
        data["seasons"] = ["ramadan"]
        data["expires_at"] = None
        errors = []
        _validate_front_matter(Path("test.md"), "test.md", data, "body", errors)
        assert any("seasonal" in e.message for e in errors)

    def test_approved_requires_reviewer(self):
        data = self._valid_data()
        data["review_status"] = "approved"
        data["reviewer"] = None
        errors = []
        _validate_front_matter(Path("test.md"), "test.md", data, "body", errors)
        assert any("reviewer" in e.message for e in errors)

    def test_checksum_mismatch(self):
        data = self._valid_data()
        data["checksum"] = "bad-checksum"
        errors = []
        _validate_front_matter(Path("test.md"), "test.md", data, "body", errors)
        assert any(e.code == IngestionErrorCode.CHECKSUM_MISMATCH for e in errors)

    def _valid_data(self):
        return {
            "slug": "test",
            "version": 1,
            "kind": "framework",
            "title": "Test",
            "summary": "Summary",
            "locale": "mixed",
            "markets": ["egypt"],
            "industries": ["general"],
            "business_models": [],
            "objectives": ["awareness"],
            "funnel_stages": ["awareness"],
            "channels": [],
            "seasons": [],
            "budget_modes": ["organic_only"],
            "evidence_tier": "reviewed_guidance",
            "review_status": "draft",
            "source_references": ["internal:reviewed-marketing-methodology"],
            "effective_at": "2026-01-01",
            "expires_at": None,
            "author": "tester",
            "reviewer": None,
            "reviewed_at": None,
            "checksum": _compute_checksum("body"),
        }


class TestLoadCorpus:
    @pytest.mark.asyncio
    async def test_loads_real_corpus_non_strict(self):
        entries, errors = await load_and_validate_corpus(strict_sources=False)
        # The real corpus has 32 entries as of the latest MANIFEST.
        assert len(entries) == 32
        assert all(isinstance(e.source_references, list) for e in entries)
        # None should fail validation.
        assert not errors

    @pytest.mark.asyncio
    @pytest.mark.network
    async def test_respects_strict_sources(self):
        # strict_sources=True will attempt network calls; we just verify the
        # function accepts the flag and returns results without crashing.
        entries, errors = await load_and_validate_corpus(strict_sources=True)
        assert len(entries) == 32
        # Errors depend on network; assert the shape is valid.
        assert all(e.code in {
            IngestionErrorCode.SOURCE_RESOLUTION_FAILED,
            IngestionErrorCode.SOURCE_RESOLUTION_TIMEOUT,
        } for e in errors)


class TestSourceResolution:
    @pytest.mark.asyncio
    async def test_internal_ref_passes(self):
        result = await resolve_source(INTERNAL_REF)
        assert result.ok
        assert result.skipped

    @pytest.mark.asyncio
    async def test_unresolvable_url_fails(self):
        # Use a URL that is very unlikely to resolve.
        result = await resolve_source("http://localhost:59999/nonexistent")
        assert not result.ok
        assert result.error

    @pytest.mark.asyncio
    async def test_retryable_failure_eventually_fails(self):
        result = await resolve_source(
            "http://localhost:59999/nonexistent",
            max_attempts=2,
            retry_delay_ms=10,
        )
        assert not result.ok
