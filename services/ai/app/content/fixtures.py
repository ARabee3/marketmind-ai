"""Content-specific fictional fixtures for deterministic tests."""

from __future__ import annotations

import json
from pathlib import Path

from content_contracts import ContentItemVersion


EXAMPLES_DIR = Path(__file__).parents[4] / "packages" / "contracts" / "examples"


def load_default_content_item_fixture() -> ContentItemVersion:
    """Load a fictional item only as a provider fallback template."""
    data = json.loads(
        (EXAMPLES_DIR / "content-pack-week-1-ar.example.json").read_text(
            encoding="utf-8"
        )
    )
    return ContentItemVersion.model_validate(data["item_version"])
