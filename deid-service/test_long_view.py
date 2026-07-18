"""Tests for app/long_view.py: date shifting (pure) and the Anthropic call
(fake client injected via the `client=` parameter — no network, no
monkeypatching of the SDK)."""

import asyncio
import json
from types import SimpleNamespace

import anthropic
import httpx
import pytest

from app.long_view import (
    AnthropicConfig,
    LongViewError,
    build_long_view,
    shift_dates,
)

CONFIG = AnthropicConfig(enabled=True)

HISTORY = {
    "diagnoses": [{"code": "E11", "date": "2019-03-04"}],
    "labs": [
        {"test": "HbA1c", "value": 8.1, "effective": "2019-06-10T09:30:00Z"},
        {"test": "HbA1c", "value": 7.2, "effective": "2020-06-10T09:30:00+02:00"},
    ],
    "notes": ["version 1.2.3", "2024-99-99 is not a date"],
}


# ---------------------------------------------------------------- shift_dates


def test_shift_earliest_maps_to_epoch_and_intervals_preserved():
    shifted, offset_days, originals = shift_dates(HISTORY)
    assert shifted["diagnoses"][0]["date"] == "2000-01-01"
    # 2019-03-04 -> 2000-01-01 is an offset of -7002 days
    assert offset_days == -7002
    assert shifted["labs"][0]["effective"] == "2000-04-08T09:30:00Z"  # +98 days
    assert shifted["labs"][1]["effective"] == "2001-04-09T09:30:00+02:00"  # +1 year
    assert originals == {
        "2019-03-04",
        "2019-06-10T09:30:00Z",
        "2020-06-10T09:30:00+02:00",
    }


def test_shift_leaves_non_dates_alone():
    shifted, _, _ = shift_dates(HISTORY)
    assert shifted["notes"] == ["version 1.2.3", "2024-99-99 is not a date"]


def test_shift_no_dates_is_identity():
    data = {"a": ["x", 1, None], "b": {"c": True}}
    shifted, offset_days, originals = shift_dates(data)
    assert shifted == data
    assert offset_days == 0 and originals == set()


def test_shift_does_not_mutate_input():
    original = json.loads(json.dumps(HISTORY))
    shift_dates(HISTORY)
    assert HISTORY == original


# ------------------------------------------------------------ build_long_view


def _view_for(shifted_history):
    return {
        "patient_summary": "Type 2 diabetes managed over one year.",
        "timeline": [
            {
                "date": "2000-01-01",
                "category": "diagnosis",
                "title": "Type 2 diabetes",
                "detail": "Initial diagnosis (E11).",
            },
            {
                "date": "2000-04-08",
                "category": "lab",
                "title": "HbA1c 8.1",
                "detail": "Elevated at diagnosis follow-up.",
            },
        ],
        "narrative_markdown": "## Longitudinal view\nDiagnosed 2000-01-01...",
    }


class FakeStream:
    def __init__(self, message=None, error=None):
        self._message = message
        self._error = error

    async def __aenter__(self):
        if self._error:
            raise self._error
        return self

    async def __aexit__(self, *exc):
        return False

    async def get_final_message(self):
        return self._message


class FakeClient:
    """Mimics anthropic.AsyncAnthropic().messages.stream(...)"""

    def __init__(self, response_text=None, error=None):
        self.requests = []
        outer = self

        class Messages:
            def stream(self, **kwargs):
                outer.requests.append(kwargs)
                if error:
                    return FakeStream(error=error)
                message = SimpleNamespace(
                    content=[SimpleNamespace(type="text", text=response_text)]
                )
                return FakeStream(message=message)

        self.messages = Messages()


def _run(client, history=HISTORY, config=CONFIG):
    return asyncio.run(build_long_view(history, config, client=client))


def test_build_long_view_happy_path():
    view = _view_for(None)
    client = FakeClient(response_text=json.dumps(view))
    result, meta = _run(client)
    assert result["patient_summary"].startswith("Type 2 diabetes")
    assert result["timeline"][0]["date"] == "2000-01-01"
    assert meta == {"model": "claude-opus-4-8"}
    assert "offset_days" not in meta  # hidden unless RETURN_MAP

    request = client.requests[0]
    assert request["model"] == "claude-opus-4-8"
    assert request["thinking"] == {"type": "adaptive"}
    assert "temperature" not in request
    sent = request["messages"][0]["content"]
    assert "2000-01-01" in sent  # shifted dates go to the API...
    assert "2019-03-04" not in sent  # ...original dates never do


def test_build_long_view_exposes_offset_with_return_map(monkeypatch):
    monkeypatch.setenv("RETURN_MAP", "true")
    client = FakeClient(response_text=json.dumps(_view_for(None)))
    _, meta = _run(client)
    assert meta["offset_days"] == -7002


def test_build_long_view_missing_keys():
    client = FakeClient(response_text=json.dumps({"patient_summary": "x"}))
    with pytest.raises(LongViewError, match="missing keys"):
        _run(client)


def test_build_long_view_non_json_output():
    client = FakeClient(response_text="I could not process this record.")
    with pytest.raises(LongViewError, match="not valid JSON"):
        _run(client)


def test_build_long_view_rejects_leaked_original_date():
    view = _view_for(None)
    view["narrative_markdown"] += "\nOriginally diagnosed on 2019-03-04."
    client = FakeClient(response_text=json.dumps(view))
    with pytest.raises(LongViewError, match="leaked 1") as exc_info:
        _run(client)
    assert "2019-03-04" not in str(exc_info.value)  # counts only, never values


def test_build_long_view_unknown_category_coerced_to_other():
    view = _view_for(None)
    view["timeline"][0]["category"] = "surprise"
    client = FakeClient(response_text=json.dumps(view))
    result, _ = _run(client)
    assert result["timeline"][0]["category"] == "other"


def _http_error(status):
    request = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
    response = httpx.Response(status, request=request)
    if status == 429:
        return anthropic.RateLimitError("rate limited", response=response, body=None)
    return anthropic.APIStatusError("error", response=response, body=None)


def test_build_long_view_maps_rate_limit():
    client = FakeClient(error=_http_error(429))
    with pytest.raises(LongViewError, match="rate limited"):
        _run(client)


def test_build_long_view_maps_api_status_error():
    client = FakeClient(error=_http_error(500))
    with pytest.raises(LongViewError, match="HTTP 500"):
        _run(client)


def test_build_long_view_maps_connection_error():
    request = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
    client = FakeClient(error=anthropic.APIConnectionError(request=request))
    with pytest.raises(LongViewError, match="connection failed"):
        _run(client)


def test_config_from_env(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_MODEL", raising=False)
    config = AnthropicConfig.from_env()
    assert config.enabled is False
    assert config.model == "claude-opus-4-8"

    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setenv("ANTHROPIC_MODEL", "claude-sonnet-5")
    config = AnthropicConfig.from_env()
    assert config.enabled is True
    assert config.model == "claude-sonnet-5"
