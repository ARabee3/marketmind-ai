"""Markdown-aware semantic chunker for the knowledge ingestion pipeline.

Targets 300-500 tokens per chunk with a small boundary overlap. Respects:
- heading boundaries;
- paragraph boundaries;
- table row groups (splits only at whole-row boundaries);
- citation/reference lines (keeps them with the preceding paragraph);
- numbered rules and bullet groups.

Produces stable chunk IDs and checksums.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from typing import Optional
from uuid import UUID, uuid5

from app.knowledge.ingestion.normalizer import normalize_text
from app.knowledge.ingestion.schemas import KnowledgeChunk
from app.knowledge.ingestion.tokenizer import count_tokens


# Sentence boundary for English . ! ? and Arabic full stop (۔).
_SENTENCE_BOUNDARY_RE = re.compile(r"(?<=[.!?۔])\s+")

# Markdown headings: lines starting with 1-3 # characters.
_HEADING_RE = re.compile(r"^(#{1,3})\s+(.+)$", re.MULTILINE)

# Citation/reference lines: lines starting with a bracketed number or a URL,
# or standalone "Source:" / "Sources:" labels.
_CITATION_LINE_RE = re.compile(
    r"^(\[\d+\]|\[\^?\w+\]|https?://|Source[s]?:)\s*",
    re.IGNORECASE,
)

# Stable namespace for chunk IDs.
_CHUNK_ID_NAMESPACE = UUID("8f4b2c1d-5e3a-4b1c-9d2e-6a7b8c9d0e1f")


@dataclass
class _Block:
    """A semantic block inside a Markdown section."""

    kind: str  # paragraph, table, list, citation, rule
    text: str
    heading_path: str = ""


def _split_sentences(text: str) -> list[str]:
    """Split text into sentences, preserving delimiters.

    Handles English punctuation and the Arabic full stop (۔).
    """
    if not text:
        return []
    delimiters = _SENTENCE_BOUNDARY_RE.findall(text)
    fragments = _SENTENCE_BOUNDARY_RE.split(text)
    if len(fragments) <= 1:
        stripped = fragments[0].strip() if fragments else ""
        return [stripped] if stripped else []
    sentences = []
    for i, fragment in enumerate(fragments[:-1]):
        sentence = fragment.strip()
        if sentence:
            if i < len(delimiters):
                sentence += delimiters[i].strip()
            sentences.append(sentence)
    last = fragments[-1].strip()
    if last:
        sentences.append(last)
    return sentences


def _split_paragraph_at_sentences(
    text: str,
    max_tokens: int,
    tokenizer,
) -> list[str]:
    """Split a paragraph into sentence-sized pieces that fit under max_tokens."""
    sentences = _split_sentences(text)
    pieces: list[str] = []
    current = ""
    current_tokens = 0
    for sentence in sentences:
        sentence_tokens = tokenizer(sentence)
        if sentence_tokens > max_tokens:
            # A single sentence is too long; keep it as-is as a safety valve.
            if current:
                pieces.append(current)
                current = ""
                current_tokens = 0
            pieces.append(sentence)
            continue
        if current_tokens + sentence_tokens > max_tokens and current:
            pieces.append(current)
            current = sentence
            current_tokens = sentence_tokens
        else:
            current = f"{current} {sentence}".strip() if current else sentence
            current_tokens = tokenizer(current)
    if current:
        pieces.append(current)
    return pieces


def _split_table(text: str, max_tokens: int, tokenizer) -> list[str]:
    """Split a Markdown table at row boundaries, keeping the header with each piece."""
    lines = text.splitlines()
    if len(lines) < 3:
        return [text]
    header = lines[0]
    separator = lines[1]
    body_rows = lines[2:]
    header_separator_tokens = tokenizer(header) + tokenizer(separator)
    pieces = []
    current_rows = [header, separator]
    current_tokens = header_separator_tokens
    for row in body_rows:
        row_tokens = tokenizer(row)
        if row_tokens > max_tokens:
            # Oversized single row: keep it alone with header.
            if len(current_rows) > 2:
                pieces.append("\n".join(current_rows))
            pieces.append("\n".join([header, separator, row]))
            current_rows = [header, separator]
            current_tokens = header_separator_tokens
            continue
        if current_tokens + row_tokens > max_tokens and len(current_rows) > 2:
            pieces.append("\n".join(current_rows))
            current_rows = [header, separator, row]
            current_tokens = header_separator_tokens + row_tokens
        else:
            current_rows.append(row)
            current_tokens += row_tokens
    if len(current_rows) > 2:
        pieces.append("\n".join(current_rows))
    return pieces if pieces else [text]


def _is_table_line(line: str) -> bool:
    return "|" in line.strip()


def _is_list_item(line: str) -> bool:
    stripped = line.strip()
    return bool(re.match(r"^(\d+\.|-|\*|\+)\s+", stripped))


def _is_citation_line(line: str) -> bool:
    return bool(_CITATION_LINE_RE.match(line.strip()))


def _classify_block(lines: list[str]) -> str:
    """Classify a block of lines by its dominant kind."""
    if not lines:
        return "paragraph"
    if all(_is_table_line(line) for line in lines):
        return "table"
    if all(_is_citation_line(line) for line in lines):
        return "citation"
    if all(_is_list_item(line) for line in lines):
        return "list"
    if any(_is_list_item(line) for line in lines):
        return "list"
    return "paragraph"


def _extract_blocks(section_text: str, heading_path: str) -> list[_Block]:
    """Split a section into semantic blocks separated by blank lines."""
    lines = section_text.splitlines()
    blocks: list[_Block] = []
    current_lines: list[str] = []
    in_table = False

    def flush() -> None:
        nonlocal current_lines, in_table
        if not current_lines:
            return
        text = "\n".join(current_lines).strip()
        if text:
            kind = _classify_block(current_lines)
            blocks.append(_Block(kind=kind, text=text, heading_path=heading_path))
        current_lines = []
        in_table = False

    for line in lines:
        stripped = line.strip()
        if stripped == "":
            flush()
            continue
        is_table = _is_table_line(line)
        if current_lines and in_table != is_table:
            flush()
        current_lines.append(line)
        in_table = is_table
    flush()
    return blocks


def _split_sections(text: str) -> list[tuple[str, str]]:
    """Split Markdown text into (heading, body) sections."""
    text = text.replace("\r\n", "\n")
    matches = list(_HEADING_RE.finditer(text))
    if not matches:
        return [("", text)]
    sections = []
    first_start = matches[0].start()
    if first_start > 0:
        sections.append(("", text[:first_start].strip()))
    for i, match in enumerate(matches):
        heading = match.group(0).strip()
        body_start = match.end()
        body_end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        body = text[body_start:body_end].strip()
        sections.append((heading, body))
    return sections


def _build_chunk_text(blocks: list[_Block], context_header: str) -> str:
    """Assemble chunk text from blocks, including a context header."""
    parts = [context_header] if context_header else []
    for block in blocks:
        parts.append(block.text)
    return "\n\n".join(parts)


def _overlap_tail(
    blocks: list[_Block],
    overlap_tokens: int,
    tokenizer,
) -> list[_Block]:
    """Return tail sentences from the last non-table block as overlap."""
    if not blocks:
        return []
    # Take overlap only from paragraph/rule/list blocks, never tables.
    source_blocks = [b for b in blocks if b.kind != "table"]
    if not source_blocks:
        return []
    tail_blocks: list[_Block] = []
    tail_tokens = 0
    for block in reversed(source_blocks):
        sentences = _split_sentences(block.text)
        carried: list[str] = []
        for sentence in reversed(sentences):
            sentence_tokens = tokenizer(sentence)
            if tail_tokens + sentence_tokens > overlap_tokens and carried:
                break
            carried.insert(0, sentence)
            tail_tokens += sentence_tokens
        if carried:
            tail_blocks.insert(
                0,
                _Block(
                    kind=block.kind,
                    text=" ".join(carried),
                    heading_path=block.heading_path,
                ),
            )
        if tail_tokens >= overlap_tokens:
            break
    return tail_blocks


class MarkdownChunker:
    """Semantic chunker for Markdown knowledge entries."""

    def __init__(
        self,
        min_tokens: int = 300,
        max_tokens: int = 500,
        overlap_tokens: int = 50,
    ):
        self.min_tokens = min_tokens
        self.max_tokens = max_tokens
        self.overlap_tokens = overlap_tokens

    def _token_count(self, text: str) -> int:
        return count_tokens(text)

    def chunk(
        self,
        entry_slug: str,
        entry_version: int,
        entry_title: str,
        body: str,
    ) -> list[KnowledgeChunk]:
        """Split a Markdown body into stable, semantically coherent chunks."""
        normalized_body = normalize_text(body)
        sections = _split_sections(normalized_body)
        all_blocks: list[_Block] = []
        for heading, section_text in sections:
            heading_path = f"{entry_title} > {heading}" if heading else entry_title
            blocks = _extract_blocks(section_text, heading_path)
            all_blocks.extend(blocks)

        # Expand oversized blocks safely.
        expanded_blocks: list[_Block] = []
        for block in all_blocks:
            block_tokens = self._token_count(block.text)
            if block_tokens <= self.max_tokens:
                expanded_blocks.append(block)
                continue
            if block.kind == "table":
                pieces = _split_table(block.text, self.max_tokens, self._token_count)
            elif block.kind in ("paragraph", "rule", "list"):
                pieces = _split_paragraph_at_sentences(
                    block.text, self.max_tokens, self._token_count
                )
            else:
                pieces = [block.text]
            for piece in pieces:
                expanded_blocks.append(
                    _Block(kind=block.kind, text=piece, heading_path=block.heading_path)
                )

        # Greedy chunk assembly with overlap.
        # We count the actual rendered chunk text (including the context header)
        # so max_tokens is never exceeded.
        chunks: list[KnowledgeChunk] = []
        current_blocks: list[_Block] = []
        pending_overlap: list[_Block] = []

        def _context_header(blocks_for_chunk: list[_Block]) -> str:
            if not blocks_for_chunk:
                return ""
            return blocks_for_chunk[0].heading_path

        def _make_chunk(blocks_for_chunk: list[_Block]) -> KnowledgeChunk:
            chunk_order = len(chunks)
            context_header = _context_header(blocks_for_chunk)
            text = _build_chunk_text(blocks_for_chunk, context_header)
            checksum = hashlib.sha256(text.encode("utf-8")).hexdigest()
            chunk_id = uuid5(
                _CHUNK_ID_NAMESPACE,
                f"{entry_slug}|{entry_version}|{chunk_order}|{checksum}",
            )
            return KnowledgeChunk(
                chunk_order=chunk_order,
                text=text,
                token_count=self._token_count(text),
                checksum=checksum,
                chunk_id=chunk_id,
            )

        def _chunk_tokens(blocks_for_chunk: list[_Block]) -> int:
            return self._token_count(
                _build_chunk_text(blocks_for_chunk, _context_header(blocks_for_chunk))
            )

        def _flush() -> None:
            nonlocal current_blocks, pending_overlap
            if current_blocks:
                chunks.append(_make_chunk(current_blocks))
                pending_overlap = _overlap_tail(
                    current_blocks, self.overlap_tokens, self._token_count
                )
                current_blocks = []

        # Seed first chunk with any overlap from previous (none for first).
        if pending_overlap:
            current_blocks = pending_overlap
            pending_overlap = []

        for block in expanded_blocks:
            candidate_blocks = current_blocks + [block]
            if current_blocks and _chunk_tokens(candidate_blocks) > self.max_tokens:
                _flush()
                if pending_overlap:
                    current_blocks = pending_overlap
                    pending_overlap = []
                candidate_blocks = current_blocks + [block]
            current_blocks = candidate_blocks

        _flush()
        return chunks

    def chunk_entry(
        self,
        entry: "ParsedKnowledgeEntry",  # type: ignore[name-defined]
    ) -> list[KnowledgeChunk]:
        """Convenience wrapper for a ParsedKnowledgeEntry."""
        return self.chunk(
            entry_slug=entry.slug,
            entry_version=entry.version,
            entry_title=entry.title,
            body=entry.body,
        )
