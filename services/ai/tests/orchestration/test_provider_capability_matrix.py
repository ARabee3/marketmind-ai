"""Opt-in provider tool-calling checks for the Phase 0 compatibility gate.

These tests never run as part of the normal suite.  Set
``PHASE0_PROVIDER_MATRIX=1`` only when the team intentionally wants to make
one small live request per configured provider.  Missing credentials are
reported as skips rather than silently replaced with a fake agent.
"""

from __future__ import annotations

import json
import os
from typing import Any

import pytest


pytestmark = pytest.mark.network

TOOL_NAME = "phase0_probe"
TOOL_DESCRIPTION = "Return the supplied probe value."
TOOL_PARAMETERS: dict[str, Any] = {
    "type": "object",
    "properties": {"value": {"type": "string"}},
    "required": ["value"],
    "additionalProperties": False,
}
PROMPT = (
    "Call the phase0_probe tool exactly once with value 'ok'. "
    "Do not answer with ordinary text."
)


def _enabled() -> bool:
    return os.environ.get("PHASE0_PROVIDER_MATRIX") == "1"


def _openai_tool() -> dict[str, Any]:
    return {
        "type": "function",
        "function": {
            "name": TOOL_NAME,
            "description": TOOL_DESCRIPTION,
            "parameters": TOOL_PARAMETERS,
        },
    }


def _assert_openai_tool_call(response: Any) -> None:
    choices = getattr(response, "choices", None) or []
    assert choices, "provider returned no choices"
    message = getattr(choices[0], "message", None)
    tool_calls = getattr(message, "tool_calls", None) or []
    assert len(tool_calls) == 1, "provider must return exactly one tool call"
    assert getattr(tool_calls[0].function, "name", None) == TOOL_NAME
    arguments = json.loads(tool_calls[0].function.arguments)
    assert arguments == {"value": "ok"}


def _assert_gemini_tool_call(function_calls: list[Any]) -> None:
    assert len(function_calls) == 1, "provider must return exactly one function call"
    call = function_calls[0]
    assert getattr(call, "name", None) == TOOL_NAME
    assert dict(getattr(call, "args", {}) or {}) == {"value": "ok"}


@pytest.mark.skipif(not _enabled(), reason="set PHASE0_PROVIDER_MATRIX=1 to opt in")
def test_openai_tool_calling() -> None:
    from openai import OpenAI

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        pytest.skip("OPENAI_API_KEY is not configured")
    model = os.environ.get("PHASE0_OPENAI_MODEL") or os.environ.get(
        "OPENAI_MODEL", "gpt-4o-mini"
    )
    response = OpenAI(api_key=api_key).chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": PROMPT}],
        tools=[_openai_tool()],
        tool_choice={"type": "function", "function": {"name": TOOL_NAME}},
        temperature=0,
        max_tokens=64,
    )
    _assert_openai_tool_call(response)


@pytest.mark.skipif(not _enabled(), reason="set PHASE0_PROVIDER_MATRIX=1 to opt in")
def test_openrouter_tool_calling() -> None:
    from openai import OpenAI

    api_key = os.environ.get("OPEN_ROUTER_API_KEY")
    if not api_key:
        pytest.skip("OPEN_ROUTER_API_KEY is not configured")
    model = os.environ.get("PHASE0_OPENROUTER_MODEL") or os.environ.get(
        "OPEN_ROUTER_MODEL", "openai/gpt-4o-mini"
    )
    response = OpenAI(
        api_key=api_key,
        base_url="https://openrouter.ai/api/v1",
    ).chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": PROMPT}],
        tools=[_openai_tool()],
        tool_choice={"type": "function", "function": {"name": TOOL_NAME}},
        temperature=0,
        max_tokens=64,
    )
    _assert_openai_tool_call(response)


@pytest.mark.skipif(not _enabled(), reason="set PHASE0_PROVIDER_MATRIX=1 to opt in")
def test_gemini_tool_calling() -> None:
    from google import genai
    from google.genai import types

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        pytest.skip("GEMINI_API_KEY is not configured")
    model = os.environ.get("PHASE0_GEMINI_MODEL") or os.environ.get(
        "GEMINI_MODEL", "gemini-2.5-flash"
    )
    declaration = types.FunctionDeclaration(
        name=TOOL_NAME,
        description=TOOL_DESCRIPTION,
        parametersJsonSchema=TOOL_PARAMETERS,
    )
    # Keep the client alive through the request and the SDK's retry handling.
    # Constructing it inline can let google-genai close its httpx client while
    # a retry is still in flight, masking the real provider response.
    with genai.Client(api_key=api_key) as client:
        response = client.models.generate_content(
            model=model,
            contents=PROMPT,
            config=types.GenerateContentConfig(
                temperature=0,
                maxOutputTokens=64,
                tools=[types.Tool(functionDeclarations=[declaration])],
                toolConfig=types.ToolConfig(
                    functionCallingConfig=types.FunctionCallingConfig(
                        mode=types.FunctionCallingConfigMode.ANY,
                        allowedFunctionNames=[TOOL_NAME],
                    )
                ),
            ),
        )
    function_calls = getattr(response, "function_calls", None) or []
    if not function_calls:
        candidates = getattr(response, "candidates", None) or []
        parts = (
            getattr(getattr(candidates[0], "content", None), "parts", [])
            if candidates
            else []
        )
        function_calls = [getattr(part, "function_call", None) for part in parts]
        function_calls = [call for call in function_calls if call is not None]
    _assert_gemini_tool_call(function_calls)
