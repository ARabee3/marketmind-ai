"""Command-line server for the isolated Phase 0 durability probe."""

from __future__ import annotations

import argparse
import os

import uvicorn

from .probe import create_app


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8010)
    args = parser.parse_args()

    database_url = os.environ.get("PHASE0_DATABASE_URL")
    if not database_url:
        raise SystemExit("PHASE0_DATABASE_URL is required for the Phase 0 probe")

    uvicorn.run(
        create_app(database_url),
        host=args.host,
        port=args.port,
        log_level="warning",
    )


if __name__ == "__main__":
    main()
