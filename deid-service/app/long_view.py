"""Longitudinal patient view via the Anthropic API.

Input is an (already de-identified) patient history as arbitrary JSON. Before
anything leaves the TEE, every ISO date is shifted deterministically so the
earliest date maps to 2000-01-01 — real dates never reach the Anthropic API,
and the model is told to copy dates verbatim rather than compute them. The
output is validated the same way app/llm.py validates scrubs: structural
checks plus a leak check that reports counts, never values.
"""

from __future__ import annotations

import json
import logging
import os
import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta

import anthropic

from app.llm import _extract_json

logger = logging.getLogger("deid.long_view")

EPOCH = date(2000, 1, 1)


class LongViewError(Exception):
    """Any failure of the longitudinal-view path; the job is marked failed."""


@dataclass
class AnthropicConfig:
    model: str = "claude-opus-4-8"
    max_tokens: int = 32000
    enabled: bool = False

    @classmethod
    def from_env(cls) -> "AnthropicConfig":
        return cls(
            model=os.environ.get("ANTHROPIC_MODEL", cls.model),
            max_tokens=int(os.environ.get("ANTHROPIC_MAX_TOKENS", cls.max_tokens)),
            enabled=bool(os.environ.get("ANTHROPIC_API_KEY", "").strip()),
        )


# --------------------------------------------------------------- date shifting

# ISO 8601 date with optional time and zone. Anchored per-string: a candidate
# must be exactly a date/datetime, not merely contain one.
_DATE_RE = re.compile(
    r"^(\d{4}-\d{2}-\d{2})"  # date
    r"(?:[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?))?"  # optional time
    r"(Z|[+-]\d{2}:\d{2})?$"  # optional zone
)


def _parse_date(text: str) -> tuple[date, str, str] | None:
    """Return (date_part, time_part, zone_part) when `text` is a real ISO
    date/datetime; None for date-shaped noise like '2024-99-99'."""
    match = _DATE_RE.match(text)
    if not match:
        return None
    date_part, time_part, zone_part = match.groups()
    try:
        parsed = date.fromisoformat(date_part)
    except ValueError:
        return None
    return parsed, time_part or "", zone_part or ""


def _walk_strings(node):
    """Yield every string leaf in a JSON tree."""
    if isinstance(node, str):
        yield node
    elif isinstance(node, list):
        for item in node:
            yield from _walk_strings(item)
    elif isinstance(node, dict):
        for value in node.values():
            yield from _walk_strings(value)


def _map_strings(node, fn):
    if isinstance(node, str):
        return fn(node)
    if isinstance(node, list):
        return [_map_strings(item, fn) for item in node]
    if isinstance(node, dict):
        return {key: _map_strings(value, fn) for key, value in node.items()}
    return node


def shift_dates(node) -> tuple[object, int, set[str]]:
    """Copy `node` with every ISO date/datetime string shifted by one offset
    so the earliest date maps to 2000-01-01 (intervals preserved; time-of-day
    and zone suffix kept). Returns (shifted, offset_days, original_dates)."""
    dates = []
    originals: set[str] = set()
    for text in _walk_strings(node):
        parsed = _parse_date(text)
        if parsed:
            dates.append(parsed[0])
            originals.add(text)
    if not dates:
        return json.loads(json.dumps(node)), 0, set()

    offset = EPOCH - min(dates)

    def shift(text: str) -> str:
        parsed = _parse_date(text)
        if not parsed:
            return text
        day, time_part, zone_part = parsed
        shifted = (day + offset).isoformat()
        if time_part:
            shifted += "T" + time_part
        return shifted + zone_part

    return _map_strings(node, shift), offset.days, originals


# ------------------------------------------------------------- Anthropic call

SYSTEM_PROMPT = """\
You are a clinical data analyst building a longitudinal view of a single \
patient from their (already de-identified) health record JSON.

Cover, where present in the data: diagnoses/conditions, laboratory results, \
medication orders and dispenses, refused or denied prior authorizations, \
procedures and screening tests (e.g. colonoscopy), self-evaluations and \
questionnaire responses, immunizations, and notable encounters.

Dates in the input are already anonymized (translated so the earliest event \
falls on 2000-01-01). Copy every date EXACTLY as it appears in the input — \
never compute, adjust, or invent dates. Do not invent clinical facts; only \
report what the data supports.

Output ONLY a JSON object (no markdown fences, no commentary) with exactly \
these keys:
- "patient_summary": one-paragraph overview of the patient's clinical course
- "timeline": array of events sorted ascending by date, each \
{"date": "YYYY-MM-DD", "category": one of "diagnosis" | "lab" | \
"medication" | "prior_auth_denied" | "procedure" | "self_evaluation" | \
"encounter" | "immunization" | "other", "title": short label, \
"detail": 1-3 sentence explanation}
- "narrative_markdown": a markdown narrative of the longitudinal course, \
organized chronologically with headings
"""

_REQUIRED_KEYS = ("patient_summary", "timeline", "narrative_markdown")
_CATEGORIES = {
    "diagnosis",
    "lab",
    "medication",
    "prior_auth_denied",
    "procedure",
    "self_evaluation",
    "encounter",
    "immunization",
    "other",
}


def _validate_view(view: object, original_dates: set[str]) -> dict:
    if not isinstance(view, dict):
        raise LongViewError("model output is not a JSON object")
    missing = [key for key in _REQUIRED_KEYS if key not in view]
    if missing:
        raise LongViewError(f"model output missing keys: {', '.join(missing)}")
    timeline = view["timeline"]
    if not isinstance(timeline, list) or not all(
        isinstance(e, dict) and e.get("date") and e.get("title") for e in timeline
    ):
        raise LongViewError("model output timeline is malformed")
    for entry in timeline:
        if entry.get("category") not in _CATEGORIES:
            entry["category"] = "other"
    # Leak check: no pre-shift date may appear anywhere in the output.
    # Count only — never put the dates themselves in the error (logs/health).
    serialized = json.dumps(view, ensure_ascii=False)
    leaked = sum(1 for value in original_dates if value in serialized)
    if leaked:
        raise LongViewError(f"model output leaked {leaked} original date(s)")
    return view


async def build_long_view(
    history,
    config: AnthropicConfig,
    client: "anthropic.AsyncAnthropic | None" = None,
) -> tuple[dict, dict]:
    """Build the longitudinal view; raises LongViewError on any failure."""
    shifted, offset_days, original_dates = shift_dates(history)
    # A date that is also a legitimate post-shift value (e.g. the input already
    # contained 2000-01-01) must not trip the leak check.
    shifted_dates = {t for t in _walk_strings(shifted) if _parse_date(t)}
    original_dates -= shifted_dates
    if client is None:
        client = anthropic.AsyncAnthropic()  # reads ANTHROPIC_API_KEY

    try:
        async with client.messages.stream(
            model=config.model,
            max_tokens=config.max_tokens,
            thinking={"type": "adaptive"},
            system=SYSTEM_PROMPT,
            messages=[
                {
                    "role": "user",
                    "content": "Patient history JSON:\n"
                    + json.dumps(shifted, ensure_ascii=False),
                }
            ],
        ) as stream:
            message = await stream.get_final_message()
    except anthropic.RateLimitError as exc:
        raise LongViewError("anthropic rate limited; retry later") from exc
    except anthropic.APIConnectionError as exc:
        raise LongViewError(f"anthropic connection failed: {exc}") from exc
    except anthropic.APIStatusError as exc:
        raise LongViewError(f"anthropic returned HTTP {exc.status_code}") from exc

    text = "".join(block.text for block in message.content if block.type == "text")
    try:
        view = _extract_json(text)
    except ValueError as exc:
        raise LongViewError(f"model output is not valid JSON: {exc}") from exc
    view = _validate_view(view, original_dates)

    meta = {"model": config.model}
    if os.environ.get("RETURN_MAP", "").strip().lower() in ("1", "true", "yes", "on"):
        # offset_days re-identifies every date; expose it only on request,
        # mirroring the surrogate-map policy in /scrub.
        meta["offset_days"] = offset_days
    return view, meta
