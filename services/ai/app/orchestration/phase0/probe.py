"""Isolated Phase 0 LangGraph durability probe.

This module deliberately contains no business-agent code and is not mounted in
the production FastAPI application.  It proves only the framework behavior we
need before building the product graph:

* a typed graph can pause with ``interrupt()``;
* an async PostgreSQL checkpointer survives a process restart;
* a resume uses the same ``thread_id``; and
* a fake side effect is idempotent and a completed run rejects a second resume.

The probe stores its fake effect in a table named ``phase0_effects``.  Tests
put that table, and LangGraph's checkpoint tables, in a disposable PostgreSQL
schema so the product database is not changed.
"""

from __future__ import annotations

from contextlib import AsyncExitStack, asynccontextmanager
from typing import Any, Literal, TypedDict

from fastapi import FastAPI, HTTPException
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, interrupt
from psycopg import AsyncConnection
from pydantic import BaseModel, Field


class Phase0State(TypedDict, total=False):
    """Small, serializable state used by the fake graph."""

    thread_id: str
    effect_key: str
    effect_count: int
    decision: Literal["approve", "reject"]
    result: Literal["approved", "rejected"]
    completed: bool


class StartRequest(BaseModel):
    thread_id: str = Field(min_length=1, max_length=128)
    effect_key: str = Field(min_length=1, max_length=256)


class ResumeRequest(BaseModel):
    thread_id: str = Field(min_length=1, max_length=128)
    decision: Literal["approve", "reject"]


class Phase0ThreadLock:
    """Cross-process per-thread mutex backed by PostgreSQL advisory locks."""

    def __init__(self, database_url: str) -> None:
        self._database_url = database_url

    @asynccontextmanager
    async def acquire(self, thread_id: str):
        connection = await AsyncConnection.connect(self._database_url, autocommit=True)
        try:
            await connection.execute(
                "SELECT pg_advisory_lock(hashtextextended(%s, 0))",
                (f"marketmind-phase0:{thread_id}",),
            )
            yield
        finally:
            await connection.close()


class Phase0MockToolProvider:
    """Deterministic tool-calling provider used by the isolated graph only."""

    async def choose_effect_tool(self, effect_key: str) -> dict[str, Any]:
        return {
            "name": "record_phase0_effect",
            "arguments": {"effect_key": effect_key},
        }


class Phase0EffectStore:
    """Persistent idempotency-keyed fake side effect for the probe only."""

    def __init__(self, database_url: str) -> None:
        self._database_url = database_url

    async def setup(self) -> None:
        async with await AsyncConnection.connect(
            self._database_url, autocommit=True
        ) as connection:
            await connection.execute(
                """
                CREATE TABLE IF NOT EXISTS phase0_effects (
                    effect_key TEXT PRIMARY KEY,
                    effect_count INTEGER NOT NULL DEFAULT 1,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
                """
            )

    async def record_once(self, effect_key: str) -> int:
        """Record the fake effect once and return its durable count."""

        async with await AsyncConnection.connect(
            self._database_url, autocommit=True
        ) as connection:
            await connection.execute(
                """
                INSERT INTO phase0_effects (effect_key)
                VALUES (%s)
                ON CONFLICT (effect_key) DO NOTHING
                """,
                (effect_key,),
            )
            cursor = await connection.execute(
                """
                SELECT effect_count
                FROM phase0_effects
                WHERE effect_key = %s
                """,
                (effect_key,),
            )
            row = await cursor.fetchone()
            if row is None:  # pragma: no cover - defensive database invariant
                raise RuntimeError("phase 0 side effect row was not persisted")
            return int(row[0])

    async def get_count(self, effect_key: str) -> int:
        async with await AsyncConnection.connect(
            self._database_url, autocommit=True
        ) as connection:
            cursor = await connection.execute(
                """
                SELECT effect_count
                FROM phase0_effects
                WHERE effect_key = %s
                """,
                (effect_key,),
            )
            row = await cursor.fetchone()
            return 0 if row is None else int(row[0])


def build_phase0_graph(
    checkpointer: AsyncPostgresSaver,
    effect_store: Phase0EffectStore,
    tool_provider: Phase0MockToolProvider | None = None,
):
    """Build the three-node fake graph used by the durability gate."""

    provider = tool_provider or Phase0MockToolProvider()

    async def record_effect(state: Phase0State) -> dict[str, Any]:
        tool_call = await provider.choose_effect_tool(state["effect_key"])
        if tool_call.get("name") != "record_phase0_effect":
            raise RuntimeError("phase 0 mock provider selected an unknown tool")
        arguments = tool_call.get("arguments")
        if not isinstance(arguments, dict) or arguments.get("effect_key") != state[
            "effect_key"
        ]:
            raise RuntimeError("phase 0 mock provider returned invalid arguments")
        count = await effect_store.record_once(arguments["effect_key"])
        return {"effect_count": count}

    def await_owner(state: Phase0State) -> dict[str, Any]:
        decision = interrupt(
            {
                "kind": "phase0_approval",
                "thread_id": state["thread_id"],
                "message": "Approve the fake side effect to finish the probe.",
            }
        )
        return {"decision": decision}

    def finish(state: Phase0State) -> dict[str, Any]:
        decision = state["decision"]
        return {
            "result": "approved" if decision == "approve" else "rejected",
            "completed": True,
        }

    builder = StateGraph(Phase0State)
    builder.add_node("record_effect", record_effect)
    builder.add_node("await_owner", await_owner)
    builder.add_node("finish", finish)
    builder.add_edge(START, "record_effect")
    builder.add_edge("record_effect", "await_owner")
    builder.add_edge("await_owner", "finish")
    builder.add_edge("finish", END)
    return builder.compile(checkpointer=checkpointer)


def create_app(database_url: str) -> FastAPI:
    """Create the standalone probe app for a supplied PostgreSQL URL."""

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        async with AsyncExitStack() as resources:
            checkpointer = await resources.enter_async_context(
                AsyncPostgresSaver.from_conn_string(database_url)
            )
            # The real deployment will run migrations explicitly.  Calling
            # setup here is acceptable only because this app is the disposable
            # Phase 0 probe and must be self-contained for the gate test.
            await checkpointer.setup()
            effect_store = Phase0EffectStore(database_url)
            await effect_store.setup()
            app.state.phase0_graph = build_phase0_graph(checkpointer, effect_store)
            app.state.phase0_effect_store = effect_store
            app.state.phase0_thread_lock = Phase0ThreadLock(database_url)
            yield

    app = FastAPI(title="MarketMind Phase 0 Durability Probe", lifespan=lifespan)

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.post("/start")
    async def start(request: StartRequest) -> dict[str, Any]:
        async with app.state.phase0_thread_lock.acquire(request.thread_id):
            graph = app.state.phase0_graph
            config = {"configurable": {"thread_id": request.thread_id}}
            existing = await graph.aget_state(config)
            if existing is not None and (
                existing.values or existing.next or existing.interrupts
            ):
                raise HTTPException(status_code=409, detail="thread already exists")

            result = await graph.ainvoke(
                {
                    "thread_id": request.thread_id,
                    "effect_key": request.effect_key,
                },
                config,
            )
            interrupts = result.get("__interrupt__", [])
            if not interrupts:  # pragma: no cover - graph invariant
                raise HTTPException(status_code=500, detail="probe did not interrupt")
            return {
                "status": "paused",
                "thread_id": request.thread_id,
                "interrupt_id": interrupts[0].id,
            }

    @app.post("/resume")
    async def resume(request: ResumeRequest) -> dict[str, Any]:
        async with app.state.phase0_thread_lock.acquire(request.thread_id):
            graph = app.state.phase0_graph
            config = {"configurable": {"thread_id": request.thread_id}}
            snapshot = await graph.aget_state(config)
            if snapshot is None or (
                not snapshot.values and not snapshot.next and not snapshot.interrupts
            ):
                raise HTTPException(status_code=404, detail="thread not found")
            if not snapshot.next or not snapshot.interrupts:
                raise HTTPException(
                    status_code=409, detail="thread is already complete"
                )

            result = await graph.ainvoke(Command(resume=request.decision), config)
            if result.get("__interrupt__"):  # pragma: no cover - graph invariant
                raise HTTPException(status_code=500, detail="probe interrupted twice")
            return {
                "status": "completed",
                "thread_id": request.thread_id,
                "result": result.get("result"),
            }

    @app.get("/effects/{effect_key}")
    async def effect_count(effect_key: str) -> dict[str, Any]:
        count = await app.state.phase0_effect_store.get_count(effect_key)
        return {"effect_key": effect_key, "count": count}

    return app
