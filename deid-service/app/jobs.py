"""In-memory background job queue.

Generic queue/store with per-type worker lanes; domain handlers are injected
from app/main.py so this module stays free of scrub/LLM concerns. Jobs live
in a plain dict on a single event loop (no locking needed) and are lost on
restart — clients retry by resubmitting.
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable

logger = logging.getLogger("deid.jobs")

JOB_TYPES = ("deid", "long")

# Handler contract: async (payload) -> (result, meta)
Handler = Callable[[Any], Awaitable[tuple[Any, dict]]]


class QueueFullError(Exception):
    """Too many queued jobs for this job type."""


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class Job:
    id: str
    type: str
    payload: Any  # nulled when the job finishes so PHI does not linger
    status: str = "queued"  # queued | running | succeeded | failed
    created_at: str = field(default_factory=_now_iso)
    started_at: str | None = None
    finished_at: str | None = None
    finished_monotonic: float | None = None  # for TTL cleanup
    result: Any = None
    error: str | None = None
    meta: dict = field(default_factory=dict)

    def public_dict(self) -> dict:
        return {
            "id": self.id,
            "type": self.type,
            "status": self.status,
            "created_at": self.created_at,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "result": self.result,
            "error": self.error,
            "meta": self.meta,
        }


class JobQueue:
    """Per-type worker lanes over an in-memory job store.

    Each job type gets its own asyncio.Queue and worker pool so a slow lane
    (deid on CPU ollama) cannot starve a fast one (long via Anthropic).
    """

    def __init__(
        self,
        handlers: dict[str, Handler],
        concurrency: dict[str, int],
        max_queued: int = 100,
        ttl_seconds: float = 3600.0,
    ) -> None:
        self._handlers = handlers
        self._concurrency = concurrency
        self._max_queued = max_queued
        self._ttl_seconds = ttl_seconds
        self._jobs: dict[str, Job] = {}
        self._queues: dict[str, asyncio.Queue[str]] = {t: asyncio.Queue() for t in handlers}
        self._tasks: list[asyncio.Task] = []

    # ------------------------------------------------------------- public API

    def submit(self, job_type: str, payload: Any) -> Job:
        if job_type not in self._handlers:
            raise ValueError(f"unknown job type: {job_type}")
        queued = sum(1 for j in self._jobs.values() if j.type == job_type and j.status == "queued")
        if queued >= self._max_queued:
            raise QueueFullError(f"too many queued {job_type} jobs")
        job = Job(id=uuid.uuid4().hex, type=job_type, payload=payload)
        self._jobs[job.id] = job
        self._queues[job_type].put_nowait(job.id)
        return job

    def get(self, job_id: str) -> Job | None:
        return self._jobs.get(job_id)

    def stats(self) -> dict:
        counts = {"queued": 0, "running": 0, "stored": len(self._jobs)}
        for job in self._jobs.values():
            if job.status in ("queued", "running"):
                counts[job.status] += 1
        return counts

    async def start(self) -> None:
        for job_type, handler in self._handlers.items():
            for i in range(max(1, self._concurrency.get(job_type, 1))):
                self._tasks.append(
                    asyncio.create_task(
                        self._worker(job_type, handler), name=f"job-worker-{job_type}-{i}"
                    )
                )
        self._tasks.append(asyncio.create_task(self._cleanup_loop(), name="job-cleanup"))

    async def stop(self) -> None:
        for task in self._tasks:
            task.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)
        self._tasks.clear()

    # -------------------------------------------------------------- internals

    async def _worker(self, job_type: str, handler: Handler) -> None:
        queue = self._queues[job_type]
        while True:
            job_id = await queue.get()
            job = self._jobs.get(job_id)
            if job is None:  # expired while queued
                continue
            job.status = "running"
            job.started_at = _now_iso()
            try:
                job.result, job.meta = await handler(job.payload)
                job.status = "succeeded"
            except asyncio.CancelledError:
                job.status = "failed"
                job.error = "service shutting down"
                raise
            except Exception as exc:  # a bad job must never kill the worker
                job.status = "failed"
                job.error = str(exc)
                logger.warning("%s job %s failed: %s", job_type, job.id, exc)
            finally:
                job.payload = None  # drop PHI as soon as the job is done
                job.finished_at = _now_iso()
                job.finished_monotonic = time.monotonic()

    async def _cleanup_loop(self) -> None:
        while True:
            await asyncio.sleep(60)
            self.cleanup_expired()

    def cleanup_expired(self) -> None:
        cutoff = time.monotonic() - self._ttl_seconds
        expired = [
            job_id
            for job_id, job in self._jobs.items()
            if job.finished_monotonic is not None and job.finished_monotonic < cutoff
        ]
        for job_id in expired:
            del self._jobs[job_id]
        if expired:
            logger.info("expired %d finished job(s)", len(expired))
