import pytest

from app.knowledge.ingestion.chunker import MarkdownChunker
from app.knowledge.ingestion.normalizer import normalize_text
from app.knowledge.ingestion.tokenizer import count_tokens


class TestNormalizer:
    def test_crlf_to_lf(self):
        assert normalize_text("a\r\nb") == "a\nb"

    def test_collapses_multiple_spaces(self):
        assert normalize_text("hello    world") == "hello world"

    def test_preserves_arabic_text(self):
        text = "مرحبا بالعالم"
        assert normalize_text(text) == text

    def test_preserves_arabic_punctuation(self):
        text = "مرحبا۔ كيف حالك؟"
        assert normalize_text(text) == text

    def test_trims_leading_trailing_whitespace(self):
        assert normalize_text("  hello  ") == "hello"

    def test_collapses_blank_lines(self):
        assert normalize_text("a\n\n\n\nb") == "a\n\nb"


class TestTokenizer:
    def test_counts_english_tokens(self):
        assert count_tokens("hello world") > 0

    def test_counts_arabic_tokens(self):
        assert count_tokens("مرحبا بالعالم") > 0

    def test_empty_text_zero_tokens(self):
        assert count_tokens("") == 0


class TestChunker:
    def _chunk(self, body: str):
        chunker = MarkdownChunker(min_tokens=10, max_tokens=50, overlap_tokens=5)
        return chunker.chunk(
            entry_slug="test-entry",
            entry_version=1,
            entry_title="Test Entry",
            body=body,
        )

    def test_simple_english_paragraphs(self):
        body = "\n\n".join(
            f"This is paragraph number {i}. It has a few sentences to make tokens."
            for i in range(10)
        )
        chunks = self._chunk(body)
        assert len(chunks) >= 1
        for chunk in chunks:
            assert chunk.token_count <= 50
            assert "Test Entry" in chunk.text

    def test_arabic_chunking(self):
        body = "# المقدمة\n\nهذا نص عربي. يجب أن يحافظ المعنى.\n\n# القسم الثاني\n\nهذا قسم آخر."
        chunks = self._chunk(body)
        assert len(chunks) >= 1
        for chunk in chunks:
            assert "المقدمة" in chunk.text or "القسم الثاني" in chunk.text

    def test_mixed_arabic_english(self):
        body = "# Section\n\nThis is English. هذا نص عربي. More English here."
        chunks = self._chunk(body)
        assert chunks
        assert any("English" in c.text and "عربي" in c.text for c in chunks)

    def test_table_kept_together_when_small(self):
        body = "# Table section\n\n| Col A | Col B |\n|-------|-------|\n| One   | Two   |\n| Three | Four  |"
        chunks = self._chunk(body)
        table_chunk = next((c for c in chunks if "|" in c.text), None)
        assert table_chunk is not None
        # Table should not be split if it fits. Normalizer collapses spaces.
        assert "| Col A |" in table_chunk.text
        assert "| One |" in table_chunk.text
        assert "| Three |" in table_chunk.text

    def test_citation_kept_with_paragraph(self):
        body = (
            "# Section\n\nThis is a factual claim supported by a source.\n\n"
            "[1] https://example.com/real-source"
        )
        chunks = self._chunk(body)
        citation_chunk = next((c for c in chunks if "[1]" in c.text), None)
        assert citation_chunk is not None
        assert "factual claim" in citation_chunk.text

    def test_heading_boundaries_preserved(self):
        body = "# First\n\nParagraph A.\n\n# Second\n\nParagraph B."
        chunks = self._chunk(body)
        for chunk in chunks:
            assert ("# First" in chunk.text) != ("# Second" in chunk.text) or len(chunks) == 1

    def test_stable_chunk_ids(self):
        body = "# Section\n\nParagraph one. Paragraph two. Paragraph three."
        chunks1 = self._chunk(body)
        chunks2 = self._chunk(body)
        assert len(chunks1) == len(chunks2)
        for c1, c2 in zip(chunks1, chunks2):
            assert c1.chunk_id == c2.chunk_id
            assert c1.checksum == c2.checksum

    def test_chunk_checksum_matches_text(self):
        import hashlib

        chunker = MarkdownChunker(min_tokens=10, max_tokens=50, overlap_tokens=5)
        chunks = chunker.chunk("test", 1, "Title", "Some body text here.")
        assert len(chunks) == 1
        expected = hashlib.sha256(chunks[0].text.encode("utf-8")).hexdigest()
        assert chunks[0].checksum == expected

    def test_real_corpus_entry_chunks(self):
        from pathlib import Path

        import frontmatter

        from app.knowledge.ingestion.loader import _extract_body_from_raw

        p = Path("../../Docs/marketing-knowledge/channels/channel-facebook.md")
        raw = p.read_text(encoding="utf-8")
        post = frontmatter.loads(raw)
        body = _extract_body_from_raw(raw)

        chunker = MarkdownChunker(min_tokens=300, max_tokens=500, overlap_tokens=50)
        chunks = chunker.chunk(
            entry_slug=post.metadata["slug"],
            entry_version=post.metadata["version"],
            entry_title=post.metadata["title"],
            body=body,
        )
        assert len(chunks) >= 1
        for chunk in chunks:
            assert 0 < chunk.token_count <= 500
        # Ids should be stable.
        chunks2 = chunker.chunk(
            entry_slug=post.metadata["slug"],
            entry_version=post.metadata["version"],
            entry_title=post.metadata["title"],
            body=body,
        )
        for c1, c2 in zip(chunks, chunks2):
            assert c1.chunk_id == c2.chunk_id
