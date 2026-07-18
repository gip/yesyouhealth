"""HTTP surface for the de-identification service.

All transform logic lives in app/scrub.py, app/llm.py and app/long_view.py;
this module is just FastAPI glue (plus the optional dstack attestation
endpoint and the background job queue wiring).
"""

from __future__ import annotations

import asyncio
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app import llm, long_view
from app.jobs import JOB_TYPES, JobQueue, QueueFullError
from app.scrub import ScrubConfig, scrub_resource

logger = logging.getLogger("deid")


def _env_flag(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in ("1", "true", "yes", "on")


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


# ------------------------------------------------------------------ handlers


async def _scrub_with_fallback(payload: dict) -> tuple[dict, dict | None, str]:
    """LLM-then-rules scrub. Returns (scrubbed, surrogate_map, engine)."""
    llm_config = llm.LLMConfig.from_env()
    scrubbed = mapping = None
    engine = "rules"
    if llm_config.enabled and llm.STATUS.ready:
        try:
            scrubbed = await llm.llm_scrub(payload, llm_config)
            engine = "llm"
        except llm.LLMScrubError as exc:
            logger.warning("LLM scrub failed, falling back to rules: %s", exc)
    if scrubbed is None:
        config = ScrubConfig(
            age_strategy=os.environ.get("AGE_STRATEGY", "fixed_30"),
            scrub_freetext=_env_flag("SCRUB_FREETEXT"),
        )
        scrubbed, mapping = scrub_resource(payload, config)
    return scrubbed, mapping, engine


async def _run_deid_job(payload) -> tuple[object, dict]:
    if not isinstance(payload, dict):
        raise ValueError("payload must be a FHIR resource or Bundle")
    scrubbed, mapping, engine = await _scrub_with_fallback(payload)
    result = {"resource": scrubbed, "map": mapping} if _env_flag("RETURN_MAP") else scrubbed
    return result, {"engine": engine}


async def _run_long_job(payload) -> tuple[object, dict]:
    return await long_view.build_long_view(payload, long_view.AnthropicConfig.from_env())


# ------------------------------------------------------------------ app setup


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Load the model in the background: a cold pull of qwen3:30b is ~18GB and
    # must not block boot. Meanwhile /health reports progress and /scrub
    # serves via the rules engine.
    config = llm.LLMConfig.from_env()
    task = asyncio.create_task(llm.startup(config))
    app.state.jobs = JobQueue(
        handlers={"deid": _run_deid_job, "long": _run_long_job},
        concurrency={
            "deid": _env_int("DEID_JOB_CONCURRENCY", 1),  # CPU ollama is serial
            "long": _env_int("LONG_JOB_CONCURRENCY", 3),  # Anthropic is I/O-bound
        },
        max_queued=_env_int("JOB_MAX_QUEUE", 100),
        ttl_seconds=float(_env_int("JOB_TTL_SECONDS", 3600)),
    )
    await app.state.jobs.start()
    yield
    await app.state.jobs.stop()
    task.cancel()


app = FastAPI(title="YesYou Health de-identification service", version="0.1.0", lifespan=lifespan)

# The patient's browser calls this service directly (records never pass
# through the web app's server), so cross-origin must be allowed. Lock
# CORS_ALLOW_ORIGINS to the app origin in production.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        origin.strip()
        for origin in os.environ.get("CORS_ALLOW_ORIGINS", "*").split(",")
        if origin.strip()
    ],
    allow_methods=["GET", "POST"],
    allow_headers=["content-type"],
)

# Socket candidates: the first four are what dstack-sdk 0.5.x itself probes;
# /var/run/tappd.sock is the legacy Tappd-era name. Whichever is mounted wins.
_DSTACK_SOCKETS = (
    "/var/run/dstack.sock",
    "/run/dstack.sock",
    "/var/run/dstack/dstack.sock",
    "/run/dstack/dstack.sock",
    "/var/run/tappd.sock",
)


@app.post("/scrub")
async def scrub(request: Request):
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="body must be valid JSON")
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="body must be a FHIR resource or Bundle")

    scrubbed, mapping, engine = await _scrub_with_fallback(payload)

    if _env_flag("RETURN_MAP"):
        # De-id is one-way for the training path; the surrogate map is only
        # exposed when explicitly requested. The LLM engine cannot produce a
        # reliable map, so it is null there.
        body = {"resource": scrubbed, "map": mapping}
    else:
        body = scrubbed
    return JSONResponse(body, headers={"X-Deid-Engine": engine})


@app.post("/jobs", status_code=202)
async def submit_job(request: Request):
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="body must be valid JSON")
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="body must be a JSON object")
    job_type = body.get("type")
    if job_type not in JOB_TYPES:
        raise HTTPException(status_code=400, detail=f"type must be one of {list(JOB_TYPES)}")
    if "payload" not in body:
        raise HTTPException(status_code=400, detail="payload is required")
    if job_type == "long" and not long_view.AnthropicConfig.from_env().enabled:
        # Fail at submit, not inside the worker, so the client sees why.
        raise HTTPException(
            status_code=503, detail="long jobs unavailable: ANTHROPIC_API_KEY not configured"
        )
    try:
        job = request.app.state.jobs.submit(job_type, body["payload"])
    except QueueFullError:
        raise HTTPException(status_code=429, detail="job queue is full; retry later")
    return {"id": job.id, "type": job.type, "status": job.status, "created_at": job.created_at}


@app.get("/jobs/{job_id}")
async def get_job(job_id: str, request: Request):
    job = request.app.state.jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="unknown or expired job")
    return job.public_dict()


@app.get("/health")
async def health():
    # Liveness never depends on ollama or anthropic; both blocks are
    # informational (configured-ness only — never an API call).
    anthropic_config = long_view.AnthropicConfig.from_env()
    jobs = getattr(app.state, "jobs", None)
    return {
        "status": "ok",
        "llm": llm.STATUS.as_dict(llm.LLMConfig.from_env().enabled),
        "jobs": jobs.stats() if jobs else None,
        "anthropic": {"configured": anthropic_config.enabled, "model": anthropic_config.model},
    }


@app.get("/attestation")
async def attestation():
    socket_path = next((p for p in _DSTACK_SOCKETS if Path(p).exists()), None)
    if socket_path is None:
        return {"tee": False}
    try:
        from dstack_sdk import DstackClient

        client = DstackClient(socket_path)
        quote = client.get_quote("yesyou-deid-service")
        return {
            "tee": True,
            "quote": quote.quote,
            "event_log": quote.event_log,
            "report_data": quote.report_data,
        }
    except Exception as exc:  # degraded but alive: report why, keep serving
        return {"tee": False, "error": str(exc)}
