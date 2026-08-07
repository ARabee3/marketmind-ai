"""Phase 0 gate: pause, restart FastAPI, resume, and avoid duplicate effects."""

from __future__ import annotations

import os
import re
import signal
import socket
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator
from urllib.parse import parse_qsl, quote, urlencode, urlsplit, urlunsplit
from uuid import uuid4

import httpx
import psycopg
import pytest
from psycopg import sql


pytestmark = pytest.mark.integration
SERVICE_ROOT = Path(__file__).parents[2]


def _normalise_database_url(database_url: str) -> str:
    parsed = urlsplit(database_url)
    scheme = parsed.scheme.replace("+asyncpg", "")
    query = [
        (key, value)
        for key, value in parse_qsl(parsed.query, keep_blank_values=True)
        if key not in {"schema", "options"}
    ]
    return urlunsplit(
        (scheme, parsed.netloc, parsed.path, urlencode(query), parsed.fragment)
    )


def _database_url_for_schema(database_url: str, schema: str) -> str:
    parsed = urlsplit(_normalise_database_url(database_url))
    query = parse_qsl(parsed.query, keep_blank_values=True)
    query.append(("options", f"-c search_path={schema}"))
    return urlunsplit(
        (
            parsed.scheme,
            parsed.netloc,
            parsed.path,
            urlencode(query, quote_via=quote),
            parsed.fragment,
        )
    )


@pytest.fixture()
def isolated_database_url() -> Iterator[str]:
    configured_url = os.environ.get("PHASE0_DATABASE_URL")
    if not configured_url:
        pytest.skip("set PHASE0_DATABASE_URL to a disposable local test database")

    base_url = _normalise_database_url(configured_url)
    parsed = urlsplit(base_url)
    database_name = parsed.path.removeprefix("/")
    if parsed.scheme not in {"postgres", "postgresql"}:
        pytest.fail("PHASE0_DATABASE_URL must use postgres:// or postgresql://")
    if parsed.hostname not in {"localhost", "127.0.0.1", "::1"}:
        pytest.fail("Phase 0 may only use a local PostgreSQL database")
    if not re.search(r"(?:^|[-_])(test|ci|e2e)$", database_name, re.IGNORECASE):
        pytest.fail(
            "PHASE0_DATABASE_URL must target a database ending in _test, _ci, or _e2e"
        )
    schema = f"phase0_{uuid4().hex}"
    try:
        with psycopg.connect(base_url, autocommit=True) as connection:
            connection.execute(
                sql.SQL("CREATE SCHEMA {} ").format(sql.Identifier(schema))
            )
    except psycopg.Error as exc:
        pytest.fail(f"Phase 0 PostgreSQL is not available: {exc}")

    try:
        yield _database_url_for_schema(base_url, schema)
    finally:
        with psycopg.connect(base_url, autocommit=True) as connection:
            connection.execute(
                sql.SQL("DROP SCHEMA IF EXISTS {} CASCADE").format(sql.Identifier(schema))
            )


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _wait_for_health(process: subprocess.Popen[str], port: int) -> None:
    deadline = time.monotonic() + 20
    url = f"http://127.0.0.1:{port}/health"
    while time.monotonic() < deadline:
        if process.poll() is not None:
            output = process.stdout.read() if process.stdout else ""
            raise AssertionError(f"probe process exited early:\n{output}")
        try:
            response = httpx.get(url, timeout=0.5)
            if response.status_code == 200:
                return
        except httpx.HTTPError:
            pass
        time.sleep(0.1)
    raise AssertionError("probe process did not become healthy within 20 seconds")


@contextmanager
def running_probe(database_url: str, port: int) -> Iterator[subprocess.Popen[str]]:
    environment = os.environ.copy()
    environment["PHASE0_DATABASE_URL"] = database_url
    environment["PYTHONPATH"] = str(SERVICE_ROOT) + os.pathsep + environment.get(
        "PYTHONPATH", ""
    )
    process = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "app.orchestration.phase0.server",
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
        ],
        cwd=SERVICE_ROOT,
        env=environment,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    try:
        _wait_for_health(process, port)
        yield process
    finally:
        if process.poll() is None:
            process.send_signal(signal.SIGTERM)
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
        if process.stdout:
            process.stdout.read()


def test_phase0_resume_survives_fastapi_process_restart(
    isolated_database_url: str,
) -> None:
    """The go/no-go test for durable interrupt/resume and idempotent effects."""

    thread_id = f"phase0-thread-{uuid4().hex}"
    effect_key = f"phase0-effect-{uuid4().hex}"
    first_port = _free_port()
    second_port = _free_port()

    with running_probe(isolated_database_url, first_port) as first_process:
        first = httpx.post(
            f"http://127.0.0.1:{first_port}/start",
            json={"thread_id": thread_id, "effect_key": effect_key},
            timeout=5,
        )
        assert first.status_code == 200, first.text
        first_payload = first.json()
        assert first_payload["status"] == "paused"
        assert first_payload["thread_id"] == thread_id
        assert first_payload["interrupt_id"]
        first_pid = first_process.pid

        effect = httpx.get(
            f"http://127.0.0.1:{first_port}/effects/{effect_key}", timeout=5
        )
        assert effect.status_code == 200, effect.text
        assert effect.json() == {"effect_key": effect_key, "count": 1}

    with running_probe(isolated_database_url, second_port) as second_process:
        assert second_process.pid != first_pid
        resumed = httpx.post(
            f"http://127.0.0.1:{second_port}/resume",
            json={"thread_id": thread_id, "decision": "approve"},
            timeout=5,
        )
        assert resumed.status_code == 200, resumed.text
        assert resumed.json() == {
            "status": "completed",
            "thread_id": thread_id,
            "result": "approved",
        }

        duplicate = httpx.post(
            f"http://127.0.0.1:{second_port}/resume",
            json={"thread_id": thread_id, "decision": "approve"},
            timeout=5,
        )
        assert duplicate.status_code == 409, duplicate.text

        effect = httpx.get(
            f"http://127.0.0.1:{second_port}/effects/{effect_key}", timeout=5
        )
        assert effect.status_code == 200, effect.text
        assert effect.json() == {"effect_key": effect_key, "count": 1}


def test_phase0_serializes_concurrent_start_and_resume_requests(
    isolated_database_url: str,
) -> None:
    """One thread can have only one owner of a start or resume operation."""

    port = _free_port()
    with running_probe(isolated_database_url, port):
        paused_thread = f"phase0-concurrent-resume-{uuid4().hex}"
        paused_effect = f"phase0-effect-{uuid4().hex}"
        started = httpx.post(
            f"http://127.0.0.1:{port}/start",
            json={"thread_id": paused_thread, "effect_key": paused_effect},
            timeout=5,
        )
        assert started.status_code == 200, started.text

        def resume_once(_: int) -> int:
            return httpx.post(
                f"http://127.0.0.1:{port}/resume",
                json={"thread_id": paused_thread, "decision": "approve"},
                timeout=10,
            ).status_code

        with ThreadPoolExecutor(max_workers=8) as pool:
            resume_statuses = list(pool.map(resume_once, range(8)))
        assert resume_statuses.count(200) == 1
        assert resume_statuses.count(409) == 7

        started_thread = f"phase0-concurrent-start-{uuid4().hex}"
        effect_keys = [f"phase0-effect-{uuid4().hex}" for _ in range(8)]

        def start_once(effect_key: str) -> int:
            return httpx.post(
                f"http://127.0.0.1:{port}/start",
                json={"thread_id": started_thread, "effect_key": effect_key},
                timeout=10,
            ).status_code

        with ThreadPoolExecutor(max_workers=8) as pool:
            start_statuses = list(pool.map(start_once, effect_keys))
        assert start_statuses.count(200) == 1
        assert start_statuses.count(409) == 7

        with psycopg.connect(isolated_database_url) as connection:
            effect_rows = connection.execute(
                "SELECT COUNT(*) FROM phase0_effects"
            ).fetchone()
        assert effect_rows == (2,)
