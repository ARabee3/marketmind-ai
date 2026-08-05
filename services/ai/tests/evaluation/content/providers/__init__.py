"""Fake Content provider modes that match the #108 provider interface (Phase 5)."""

from tests.evaluation.content.providers.fake_provider import (
    FakeContentProvider,
    build_generation_prompt,
    build_revision_prompt,
)

__all__ = [
    "FakeContentProvider",
    "build_generation_prompt",
    "build_revision_prompt",
]
