"""HTTP surface for the de-identification service.

All transform logic lives in app/scrub.py; this module is just FastAPI glue
plus the optional dstack attestation endpoint.
"""

from __future__ import annotations

import asyncio
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

from app import llm
from app.scrub import ScrubConfig, scrub_resource

logger = logging.getLogger("deid")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Load the model in the background: a cold pull of qwen3:30b is ~18GB and
    # must not block boot. Meanwhile /health reports progress and /scrub
    # serves via the rules engine.
    config = llm.LLMConfig.from_env()
    task = asyncio.create_task(llm.startup(config))
    yield
    task.cancel()


app = FastAPI(title="YesYou Health de-identification service", version="0.1.0", lifespan=lifespan)

# Socket candidates: the first four are what dstack-sdk 0.5.x itself probes;
# /var/run/tappd.sock is the legacy Tappd-era name. Whichever is mounted wins.
_DSTACK_SOCKETS = (
    "/var/run/dstack.sock",
    "/run/dstack.sock",
    "/var/run/dstack/dstack.sock",
    "/run/dstack/dstack.sock",
    "/var/run/tappd.sock",
)


def _env_flag(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in ("1", "true", "yes", "on")


@app.post("/scrub")
async def scrub(request: Request):
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="body must be valid JSON")
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="body must be a FHIR resource or Bundle")

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

    if _env_flag("RETURN_MAP"):
        # De-id is one-way for the training path; the surrogate map is only
        # exposed when explicitly requested. The LLM engine cannot produce a
        # reliable map, so it is null there.
        body = {"resource": scrubbed, "map": mapping}
    else:
        body = scrubbed
    return JSONResponse(body, headers={"X-Deid-Engine": engine})


@app.get("/health")
async def health():
    # Liveness never depends on ollama; the llm block is informational.
    return {"status": "ok", "llm": llm.STATUS.as_dict(llm.LLMConfig.from_env().enabled)}


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
