"""LLM-based de-identification via an Ollama sidecar.

The LLM (qwen3:30b by default) is the primary scrub engine; the rule-based
engine in app/scrub.py remains the fallback whenever this path is unavailable
or fails. All Ollama concerns live here so app/main.py stays HTTP glue.
"""

from __future__ import annotations

import json
import logging
import os
import re
from dataclasses import dataclass

import httpx

logger = logging.getLogger("deid.llm")


class LLMScrubError(Exception):
    """Any LLM-path failure; the caller falls back to the rules engine."""


@dataclass
class LLMConfig:
    host: str = "http://ollama:11434"
    model: str = "qwen3:30b"
    timeout_s: float = 300.0  # thinking mode on CPU takes minutes
    keep_alive: str = "60m"
    num_ctx: int = 16384
    enabled: bool = True

    @classmethod
    def from_env(cls) -> "LLMConfig":
        return cls(
            host=os.environ.get("OLLAMA_HOST", cls.host).rstrip("/"),
            model=os.environ.get("OLLAMA_MODEL", cls.model),
            timeout_s=float(os.environ.get("OLLAMA_TIMEOUT", cls.timeout_s)),
            keep_alive=os.environ.get("OLLAMA_KEEP_ALIVE", cls.keep_alive),
            num_ctx=int(os.environ.get("OLLAMA_NUM_CTX", cls.num_ctx)),
            enabled=os.environ.get("DEID_ENGINE", "llm").strip().lower() != "rules",
        )


@dataclass
class LLMStatus:
    state: str = "starting"  # disabled | starting | pulling | warming | ready | unavailable
    model: str | None = None
    error: str | None = None

    @property
    def ready(self) -> bool:
        return self.state == "ready"

    def as_dict(self, enabled: bool) -> dict:
        return {"enabled": enabled, "state": self.state, "model": self.model, "error": self.error}


STATUS = LLMStatus()

# Prompt-tuned against qwen3:30b: the checklist framing plus thinking mode is
# what gets full recall — with "think": false the model echoed most PHI
# unchanged, and combining "think": true with format:"json" left the response
# field empty on Ollama 0.9.x, so we let it answer free-form and extract the
# JSON ourselves.
SYSTEM_PROMPT = """\
You are a HIPAA Safe Harbor de-identification engine for FHIR R4 JSON.

Task: rewrite the FHIR JSON the user sends, replacing all identifying values \
with realistic fake surrogates. Every item on this checklist must end up \
DIFFERENT from the input — copying any of them through unchanged is a failure:

1. every identifier.value (MRN, SSN, account, license, device) — new random \
value in the same format (letters stay letters, digits stay digits, \
punctuation kept)
2. every birthDate — a different plausible date of birth
3. every person name (given, family, name.text, and any mention inside \
narrative text)
4. every phone/fax number and email address
5. every street address line and city
6. every URL, IP address, biometric reference
7. every other full date/datetime (effectiveDateTime, issued, period, ...) — \
shift ALL by the SAME random offset you choose (keep time-of-day, keep \
intervals between events)

Surrogate rules:
- realistic and same format as the original; never blank, never mask with X, \
never use placeholders like [REDACTED]
- the same original value always gets the same surrogate, so structured \
fields and free-text mentions (note.text, valueString, description, div) \
stay consistent

Do NOT change: resource ids, internal references like "Patient/patient-1", \
resourceType, coding systems/codes, clinical measurements and units. Keep US \
state. Truncate postalCode to its first 3 digits.

The output must have EXACTLY the same JSON structure as the input: same keys, \
same nesting, same array lengths and order — only leaf values on the \
checklist change.

Output ONLY the rewritten JSON — no commentary, no markdown.
"""

_THINK_RE = re.compile(r"^\s*<think>.*?</think>\s*", re.DOTALL)


def _extract_json(text: str) -> object:
    """Pull the JSON object out of a free-form model response: drop any
    inline <think> block, then take the outermost {...} (tolerates markdown
    fences or stray prose around the JSON)."""
    text = _THINK_RE.sub("", text)
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end <= start:
        raise ValueError("no JSON object in model response")
    return json.loads(text[start : end + 1])


# Structured fields whose values are identifying and MUST differ in the
# output; used for the leak check below.
_IDENTIFYING_KEYS = {"birthDate"}
_IDENTIFYING_PARENTS = {"name", "telecom", "identifier", "address"}


def _identifying_values(node, in_identifying: bool = False, out: set | None = None) -> set:
    """Collect identifying leaf strings (names, telecom/identifier values,
    address parts, birthDate) from a FHIR tree. Values shorter than 4 chars
    are skipped to avoid false-positive leak matches."""
    if out is None:
        out = set()
    if isinstance(node, list):
        for item in node:
            _identifying_values(item, in_identifying, out)
    elif isinstance(node, dict):
        for key, value in node.items():
            if key in ("system", "use", "type", "state", "period"):
                continue  # metadata within name/telecom/identifier, not PHI
            if isinstance(value, str):
                if (in_identifying or key in _IDENTIFYING_KEYS) and len(value) >= 4:
                    out.add(value)
            else:
                _identifying_values(value, in_identifying or key in _IDENTIFYING_PARENTS, out)
    return out


def _validate_output(original: dict, scrubbed: object) -> dict:
    if not isinstance(scrubbed, dict):
        raise LLMScrubError("model output is not a JSON object")
    if scrubbed.get("resourceType") != original.get("resourceType"):
        raise LLMScrubError("model output changed resourceType")
    if original.get("resourceType") == "Bundle":
        def _types(bundle: dict) -> list:
            return [
                (e.get("resource") or {}).get("resourceType")
                for e in bundle.get("entry") or []
                if isinstance(e, dict)
            ]

        if _types(scrubbed) != _types(original):
            raise LLMScrubError("model output dropped or reordered Bundle entries")
    # Leak check: no identifying value from the input may survive verbatim.
    # Count only — never put PHI in the error (it reaches logs and /health).
    scrubbed_json = json.dumps(scrubbed, ensure_ascii=False)
    leaked = sum(1 for v in _identifying_values(original) if v in scrubbed_json)
    if leaked:
        raise LLMScrubError(f"model output leaked {leaked} identifying value(s)")
    return scrubbed


async def llm_scrub(
    resource: dict,
    config: LLMConfig,
    client: httpx.AsyncClient | None = None,
) -> dict:
    """Scrub via Ollama; raises LLMScrubError on any failure."""
    payload_json = json.dumps(resource, ensure_ascii=False)
    # Rough 4-chars/token heuristic: input must leave room for the output,
    # so refuse anything past half the context window (rules engine handles it).
    if len(payload_json) / 4 > config.num_ctx / 2:
        raise LLMScrubError("resource too large for model context window")

    body = {
        "model": config.model,
        "system": SYSTEM_PROMPT,
        "prompt": "De-identify this FHIR resource. Return only the de-identified JSON.\n\n"
        + payload_json,
        "stream": False,
        "think": True,
        "keep_alive": config.keep_alive,
        "options": {"temperature": 0, "num_ctx": config.num_ctx},
    }
    try:
        if client is None:
            async with httpx.AsyncClient(base_url=config.host, timeout=config.timeout_s) as own:
                resp = await own.post("/api/generate", json=body)
        else:
            resp = await client.post("/api/generate", json=body)
    except httpx.HTTPError as exc:
        raise LLMScrubError(f"ollama request failed: {exc}") from exc
    if resp.status_code != 200:
        raise LLMScrubError(f"ollama returned HTTP {resp.status_code}: {resp.text[:200]}")

    try:
        scrubbed = _extract_json(resp.json()["response"])
    except (KeyError, ValueError) as exc:
        raise LLMScrubError(f"model output is not valid JSON: {exc}") from exc
    return _validate_output(resource, scrubbed)


# ------------------------------------------------------------------ startup


async def _model_present(client: httpx.AsyncClient, model: str) -> bool:
    resp = await client.get("/api/tags")
    resp.raise_for_status()
    names = {m.get("name", "") for m in resp.json().get("models", [])}
    # Ollama tags are qualified ("qwen3:30b"); an unqualified name matches its
    # ":latest" tag.
    return model in names or f"{model}:latest" in names


async def _pull_model(client: httpx.AsyncClient, model: str) -> None:
    # Streaming NDJSON; the download is ~18GB so no read timeout.
    async with client.stream(
        "POST", "/api/pull", json={"model": model}, timeout=httpx.Timeout(30.0, read=None)
    ) as resp:
        resp.raise_for_status()
        async for line in resp.aiter_lines():
            if not line:
                continue
            event = json.loads(line)
            if event.get("error"):
                raise LLMScrubError(f"model pull failed: {event['error']}")


async def _warm_up(client: httpx.AsyncClient, config: LLMConfig) -> None:
    resp = await client.post(
        "/api/generate",
        json={
            "model": config.model,
            "prompt": "ok",
            "stream": False,
            "think": False,
            "keep_alive": config.keep_alive,
            "options": {"num_predict": 1},
        },
        timeout=httpx.Timeout(30.0, read=None),  # first load reads ~18GB from disk
    )
    if resp.status_code != 200:
        # Keep ollama's body: on OOM it says exactly how much memory is missing.
        raise LLMScrubError(f"warm-up failed: HTTP {resp.status_code}: {resp.text[:300]}")


async def startup(config: LLMConfig, client: httpx.AsyncClient | None = None) -> None:
    """Pull + warm the model. Never raises: on failure the service keeps
    serving via the rules engine and /health reports why (mirrors the
    /attestation degrade pattern)."""
    STATUS.model = config.model
    if not config.enabled:
        STATUS.state = "disabled"
        return
    own = client is None
    if own:
        client = httpx.AsyncClient(base_url=config.host, timeout=30.0)
    try:
        if not await _model_present(client, config.model):
            STATUS.state = "pulling"
            logger.info("pulling model %s", config.model)
            await _pull_model(client, config.model)
        STATUS.state = "warming"
        logger.info("warming model %s", config.model)
        await _warm_up(client, config)
        STATUS.state = "ready"
        STATUS.error = None
        logger.info("model %s ready", config.model)
    except Exception as exc:  # degraded but alive: rules engine keeps serving
        STATUS.state = "unavailable"
        STATUS.error = str(exc)
        logger.warning("LLM engine unavailable, falling back to rules: %s", exc)
    finally:
        if own:
            await client.aclose()
