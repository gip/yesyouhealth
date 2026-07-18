"""Tests for the job queue (app/jobs.py) and the /jobs HTTP surface in
app/main.py. Queue tests drive JobQueue directly with stub handlers; HTTP
tests run the app under `with TestClient(...)` so lifespan starts the
workers (DEID_ENGINE=rules keeps startup off the network)."""

import asyncio
import json
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.jobs import JobQueue, QueueFullError

SAMPLE = json.loads((Path(__file__).parent / "sample_bundle.json").read_text())


async def _wait_for(queue: JobQueue, job_id: str, timeout: float = 5.0):
    deadline = asyncio.get_event_loop().time() + timeout
    while True:
        job = queue.get(job_id)
        if job is not None and job.status in ("succeeded", "failed"):
            return job
        if asyncio.get_event_loop().time() > deadline:
            raise AssertionError(f"job {job_id} did not finish: {job and job.status}")
        await asyncio.sleep(0.01)


# ------------------------------------------------------------------ JobQueue


def test_job_success_sets_result_and_drops_payload():
    async def run():
        async def handler(payload):
            return {"echo": payload}, {"engine": "stub"}

        queue = JobQueue(handlers={"deid": handler}, concurrency={"deid": 1})
        await queue.start()
        try:
            job = queue.submit("deid", {"a": 1})
            assert job.status == "queued" and job.created_at
            done = await _wait_for(queue, job.id)
            assert done.status == "succeeded"
            assert done.result == {"echo": {"a": 1}}
            assert done.meta == {"engine": "stub"}
            assert done.payload is None
            assert done.started_at and done.finished_at
            public = done.public_dict()
            assert "payload" not in public
        finally:
            await queue.stop()

    asyncio.run(run())


def test_handler_exception_fails_job_and_worker_survives():
    async def run():
        async def handler(payload):
            if payload == "boom":
                raise RuntimeError("handler exploded")
            return "ok", {}

        queue = JobQueue(handlers={"deid": handler}, concurrency={"deid": 1})
        await queue.start()
        try:
            bad = queue.submit("deid", "boom")
            good = queue.submit("deid", "fine")
            bad_done = await _wait_for(queue, bad.id)
            assert bad_done.status == "failed"
            assert "handler exploded" in bad_done.error
            assert bad_done.payload is None
            good_done = await _wait_for(queue, good.id)
            assert good_done.status == "succeeded"
        finally:
            await queue.stop()

    asyncio.run(run())


def test_lane_concurrency_serial_vs_parallel():
    async def run():
        active = {"deid": 0, "long": 0}
        peak = {"deid": 0, "long": 0}

        def make_handler(lane):
            async def handler(payload):
                active[lane] += 1
                peak[lane] = max(peak[lane], active[lane])
                await asyncio.sleep(0.05)
                active[lane] -= 1
                return None, {}

            return handler

        queue = JobQueue(
            handlers={"deid": make_handler("deid"), "long": make_handler("long")},
            concurrency={"deid": 1, "long": 3},
        )
        await queue.start()
        try:
            jobs = [queue.submit("deid", i) for i in range(3)]
            jobs += [queue.submit("long", i) for i in range(3)]
            for job in jobs:
                await _wait_for(queue, job.id)
            assert peak["deid"] == 1  # serial lane
            assert peak["long"] > 1  # parallel lane
        finally:
            await queue.stop()

    asyncio.run(run())


def test_queue_full():
    async def run():
        async def handler(payload):
            return None, {}

        queue = JobQueue(handlers={"deid": handler}, concurrency={"deid": 1}, max_queued=2)
        # Workers never started: submissions stay queued.
        queue.submit("deid", 1)
        queue.submit("deid", 2)
        with pytest.raises(QueueFullError):
            queue.submit("deid", 3)

    asyncio.run(run())


def test_submit_unknown_type():
    queue = JobQueue(handlers={}, concurrency={})
    with pytest.raises(ValueError):
        queue.submit("nope", {})


def test_ttl_cleanup_expires_finished_jobs():
    async def run():
        async def handler(payload):
            return None, {}

        queue = JobQueue(handlers={"deid": handler}, concurrency={"deid": 1}, ttl_seconds=0.0)
        await queue.start()
        try:
            job = queue.submit("deid", {})
            await _wait_for(queue, job.id)
            queue.cleanup_expired()
            assert queue.get(job.id) is None
            assert queue.stats()["stored"] == 0
        finally:
            await queue.stop()

    asyncio.run(run())


def test_stats_counts():
    queue = JobQueue(handlers={"deid": None}, concurrency={"deid": 1})
    queue._handlers = {"deid": None}  # workers not started; jobs stay queued
    queue.submit("deid", 1)
    queue.submit("deid", 2)
    stats = queue.stats()
    assert stats == {"queued": 2, "running": 0, "stored": 2}


# ----------------------------------------------------------- HTTP wiring


@pytest.fixture()
def client(monkeypatch):
    # rules engine only: llm.startup goes straight to "disabled", no network.
    monkeypatch.setenv("DEID_ENGINE", "rules")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    from app.main import app

    with TestClient(app) as test_client:
        yield test_client


def _poll_job(client, job_id, timeout=10.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        resp = client.get(f"/jobs/{job_id}")
        assert resp.status_code == 200
        body = resp.json()
        if body["status"] in ("succeeded", "failed"):
            return body
        time.sleep(0.05)
    raise AssertionError("job did not finish in time")


def test_jobs_deid_end_to_end(client):
    resp = client.post("/jobs", json={"type": "deid", "payload": SAMPLE})
    assert resp.status_code == 202
    body = resp.json()
    assert body["status"] == "queued" and body["type"] == "deid" and body["id"]

    done = _poll_job(client, body["id"])
    assert done["status"] == "succeeded", done["error"]
    assert done["result"]["resourceType"] == "Bundle"
    assert done["meta"]["engine"] == "rules"
    assert done["error"] is None


def test_jobs_rejects_unknown_type(client):
    resp = client.post("/jobs", json={"type": "nope", "payload": {}})
    assert resp.status_code == 400


def test_jobs_rejects_missing_payload(client):
    resp = client.post("/jobs", json={"type": "deid"})
    assert resp.status_code == 400


def test_jobs_long_without_key_is_503(client):
    resp = client.post("/jobs", json={"type": "long", "payload": {}})
    assert resp.status_code == 503


def test_jobs_unknown_id_is_404(client):
    resp = client.get("/jobs/doesnotexist")
    assert resp.status_code == 404


def test_health_reports_jobs_and_anthropic(client):
    body = client.get("/health").json()
    assert body["status"] == "ok"
    assert set(body["jobs"]) == {"queued", "running", "stored"}
    assert body["anthropic"]["configured"] is False
    assert body["anthropic"]["model"]
