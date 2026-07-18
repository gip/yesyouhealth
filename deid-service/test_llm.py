"""Tests for the Ollama LLM scrub path (app/llm.py) and its wiring in
app/main.py. No real Ollama server: httpx.MockTransport for the client-level
tests, monkeypatched llm_scrub/STATUS for the endpoint-level ones."""

import asyncio
import json
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from app import llm
from app.llm import LLMConfig, LLMScrubError, _extract_json, _validate_output
from app.main import app

SAMPLE = json.loads((Path(__file__).parent / "sample_bundle.json").read_text())


def _fake_scrubbed():
    """A structurally identical copy of SAMPLE with every identifying value
    replaced, so it passes the leak check in _validate_output."""
    text = json.dumps(SAMPLE)
    for orig, fake in [
        ("Maria Elena Gonzalez", "Sarah Jane Miller"),
        ("Gonzalez", "Miller"),
        ("Maria", "Sarah"),
        ("Elena", "Jane"),
        ("MRN-483920", "QZK-118274"),
        ("1987-04-12", "1985-06-23"),
        ("maria.gonzalez@example.com", "sarah.miller@example.net"),
        ("(415) 555-0132", "(212) 555-0198"),
        ("742 Evergreen Terrace", "123 Oak Avenue"),
        ("San Francisco", "Seattle"),
        ("94117", "98101"),
    ]:
        text = text.replace(orig, fake)
    return json.loads(text)


CONFIG = LLMConfig(host="http://ollama.test", model="qwen3:30b")


def _client(handler) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler), base_url=CONFIG.host)


def _generate_response(scrubbed) -> httpx.Response:
    return httpx.Response(200, json={"response": json.dumps(scrubbed)})


# ------------------------------------------------------------------ llm_scrub


def test_llm_scrub_success():
    scrubbed_sample = _fake_scrubbed()
    requests = []

    def handler(request):
        requests.append(request)
        return _generate_response(scrubbed_sample)

    out = asyncio.run(llm_scrub_with(handler))
    assert out == scrubbed_sample
    body = json.loads(requests[0].content)
    assert body["model"] == "qwen3:30b"
    assert body["think"] is True
    assert "format" not in body  # format+think leaves response empty on 0.9.x
    assert body["options"]["temperature"] == 0


async def llm_scrub_with(handler, resource=SAMPLE, config=CONFIG):
    async with _client(handler) as client:
        return await llm.llm_scrub(resource, config, client=client)


def test_llm_scrub_non_json_output():
    def handler(request):
        return httpx.Response(200, json={"response": "sure! here is the JSON:"})

    with pytest.raises(LLMScrubError, match="not valid JSON"):
        asyncio.run(llm_scrub_with(handler))


def test_llm_scrub_http_error():
    def handler(request):
        return httpx.Response(500, text="boom")

    with pytest.raises(LLMScrubError, match="HTTP 500"):
        asyncio.run(llm_scrub_with(handler))


def test_llm_scrub_connect_error():
    def handler(request):
        raise httpx.ConnectError("refused")

    with pytest.raises(LLMScrubError, match="request failed"):
        asyncio.run(llm_scrub_with(handler))


def test_llm_scrub_rejects_oversized_resource():
    big = {"resourceType": "Bundle", "entry": [{"x": "y" * 40000}]}

    def handler(request):  # must never be reached
        raise AssertionError("request should not be sent")

    with pytest.raises(LLMScrubError, match="too large"):
        asyncio.run(llm_scrub_with(handler, resource=big))


# ------------------------------------------------------- output validation


def test_validate_output_rejects_non_dict():
    with pytest.raises(LLMScrubError):
        _validate_output(SAMPLE, ["not", "a", "dict"])


def test_validate_output_rejects_changed_resource_type():
    with pytest.raises(LLMScrubError):
        _validate_output(SAMPLE, {"resourceType": "Patient"})


def test_validate_output_rejects_dropped_entries():
    truncated = _fake_scrubbed()
    truncated["entry"] = truncated["entry"][:1]
    with pytest.raises(LLMScrubError, match="Bundle entries"):
        _validate_output(SAMPLE, truncated)


def test_validate_output_rejects_leaked_phi():
    # An identical echo of the input leaks every identifying value.
    with pytest.raises(LLMScrubError, match="leaked") as exc_info:
        _validate_output(SAMPLE, json.loads(json.dumps(SAMPLE)))
    # The error must never contain the PHI itself (it reaches logs + /health).
    assert "Gonzalez" not in str(exc_info.value)


def test_validate_output_rejects_partial_leak():
    partial = _fake_scrubbed()
    patient = next(
        e["resource"] for e in partial["entry"] if e["resource"]["resourceType"] == "Patient"
    )
    patient["birthDate"] = "1987-04-12"  # original DOB slipped through
    with pytest.raises(LLMScrubError, match="leaked 1"):
        _validate_output(SAMPLE, partial)


def test_validate_output_accepts_clean_scrub():
    scrubbed = _fake_scrubbed()
    assert _validate_output(SAMPLE, scrubbed) == scrubbed


def test_extract_json():
    assert _extract_json('{"a": 1}') == {"a": 1}
    assert _extract_json("<think>\nhmm...\n</think>\n{\"a\": 1}") == {"a": 1}
    assert _extract_json('```json\n{"a": 1}\n```') == {"a": 1}
    assert _extract_json('Here is the JSON:\n{"a": {"b": 2}}\nDone.') == {"a": {"b": 2}}
    with pytest.raises(ValueError):
        _extract_json("no json here")


# ---------------------------------------------------------------- startup


def test_startup_pulls_missing_model_and_becomes_ready(monkeypatch):
    monkeypatch.setattr(llm, "STATUS", llm.LLMStatus())
    calls = []

    def handler(request):
        calls.append(request.url.path)
        if request.url.path == "/api/tags":
            return httpx.Response(200, json={"models": [{"name": "other:1b"}]})
        if request.url.path == "/api/pull":
            lines = [json.dumps({"status": "pulling"}), json.dumps({"status": "success"})]
            return httpx.Response(200, text="\n".join(lines))
        if request.url.path == "/api/generate":
            return httpx.Response(200, json={"response": "ok"})
        raise AssertionError(f"unexpected path {request.url.path}")

    async def run():
        async with _client(handler) as client:
            await llm.startup(CONFIG, client=client)

    asyncio.run(run())
    assert calls == ["/api/tags", "/api/pull", "/api/generate"]
    assert llm.STATUS.state == "ready"
    assert llm.STATUS.error is None


def test_startup_skips_pull_when_model_present(monkeypatch):
    monkeypatch.setattr(llm, "STATUS", llm.LLMStatus())
    calls = []

    def handler(request):
        calls.append(request.url.path)
        if request.url.path == "/api/tags":
            return httpx.Response(200, json={"models": [{"name": "qwen3:30b"}]})
        return httpx.Response(200, json={"response": "ok"})

    async def run():
        async with _client(handler) as client:
            await llm.startup(CONFIG, client=client)

    asyncio.run(run())
    assert "/api/pull" not in calls
    assert llm.STATUS.state == "ready"


def test_startup_degrades_gracefully_on_connect_failure(monkeypatch):
    monkeypatch.setattr(llm, "STATUS", llm.LLMStatus())

    def handler(request):
        raise httpx.ConnectError("refused")

    async def run():
        async with _client(handler) as client:
            await llm.startup(CONFIG, client=client)  # must not raise

    asyncio.run(run())
    assert llm.STATUS.state == "unavailable"
    assert llm.STATUS.error


def test_startup_disabled(monkeypatch):
    monkeypatch.setattr(llm, "STATUS", llm.LLMStatus())
    asyncio.run(llm.startup(LLMConfig(enabled=False)))
    assert llm.STATUS.state == "disabled"


# ----------------------------------------------------------- HTTP wiring


def test_scrub_uses_llm_when_ready(monkeypatch):
    scrubbed_sample = json.loads(json.dumps(SAMPLE))
    monkeypatch.setattr(llm.STATUS, "state", "ready")

    async def fake_scrub(resource, config, client=None):
        return scrubbed_sample

    monkeypatch.setattr(llm, "llm_scrub", fake_scrub)
    resp = TestClient(app).post("/scrub", json=SAMPLE)
    assert resp.status_code == 200
    assert resp.headers["X-Deid-Engine"] == "llm"
    assert resp.json() == scrubbed_sample


def test_scrub_falls_back_to_rules_on_llm_failure(monkeypatch):
    monkeypatch.setattr(llm.STATUS, "state", "ready")

    async def fake_scrub(resource, config, client=None):
        raise LLMScrubError("model output changed resourceType")

    monkeypatch.setattr(llm, "llm_scrub", fake_scrub)
    resp = TestClient(app).post("/scrub", json=SAMPLE)
    assert resp.status_code == 200
    assert resp.headers["X-Deid-Engine"] == "rules"
    assert resp.json()["resourceType"] == "Bundle"


def test_scrub_uses_rules_when_llm_not_ready(monkeypatch):
    monkeypatch.setattr(llm.STATUS, "state", "unavailable")
    resp = TestClient(app).post("/scrub", json=SAMPLE)
    assert resp.status_code == 200
    assert resp.headers["X-Deid-Engine"] == "rules"
    assert resp.json()["resourceType"] == "Bundle"


def test_return_map_rules_mode(monkeypatch):
    monkeypatch.setenv("RETURN_MAP", "true")
    monkeypatch.setenv("DEID_ENGINE", "rules")
    resp = TestClient(app).post("/scrub", json=SAMPLE)
    body = resp.json()
    assert resp.headers["X-Deid-Engine"] == "rules"
    assert isinstance(body["map"], dict) and body["map"]
    assert body["resource"]["resourceType"] == "Bundle"


def test_return_map_is_null_in_llm_mode(monkeypatch):
    monkeypatch.setenv("RETURN_MAP", "true")
    monkeypatch.setattr(llm.STATUS, "state", "ready")

    async def fake_scrub(resource, config, client=None):
        return json.loads(json.dumps(SAMPLE))

    monkeypatch.setattr(llm, "llm_scrub", fake_scrub)
    resp = TestClient(app).post("/scrub", json=SAMPLE)
    body = resp.json()
    assert resp.headers["X-Deid-Engine"] == "llm"
    assert body["map"] is None


def test_health_reports_llm_status(monkeypatch):
    monkeypatch.setattr(llm.STATUS, "state", "warming")
    body = TestClient(app).get("/health").json()
    assert body["status"] == "ok"
    assert body["llm"]["state"] == "warming"
    assert body["llm"]["enabled"] is True
