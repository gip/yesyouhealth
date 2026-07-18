// Browser client for the deid-service job API.
//
// The patient's browser talks to the de-identification service (running in an
// attested Phala CVM) directly — health data never passes through the web
// app's server. Jobs are asynchronous: submit, then poll until they finish.

export type DeidJobType = "deid" | "long";
export type DeidJobStatus = "queued" | "running" | "succeeded" | "failed";

export interface DeidJob {
  id: string;
  type: DeidJobType;
  status: DeidJobStatus;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  result: unknown;
  error: string | null;
  meta: Record<string, unknown>;
}

export class DeidServiceError extends Error {}

function serviceUrl(): string {
  const url = process.env.NEXT_PUBLIC_DEID_SERVICE_URL;
  if (!url) {
    throw new DeidServiceError(
      "The de-identification service is not configured (NEXT_PUBLIC_DEID_SERVICE_URL).",
    );
  }
  return url.replace(/\/+$/, "");
}

async function requestJson(path: string, init?: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${serviceUrl()}${path}`, {
      ...init,
      credentials: "omit",
    });
  } catch {
    throw new DeidServiceError("Could not reach the de-identification service.");
  }
  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const body: unknown = await response.json();
      if (body && typeof body === "object" && typeof (body as { detail?: unknown }).detail === "string") {
        detail = (body as { detail: string }).detail;
      }
    } catch {
      // keep the status-based message
    }
    throw new DeidServiceError(`The de-identification service rejected the request: ${detail}`);
  }
  return response.json();
}

export async function submitJob(type: DeidJobType, payload: unknown): Promise<{ id: string }> {
  const body = await requestJson("/jobs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type, payload }),
  });
  const job = body as { id?: unknown };
  if (typeof job.id !== "string") {
    throw new DeidServiceError("The de-identification service returned an invalid job.");
  }
  return { id: job.id };
}

export async function getJob(id: string): Promise<DeidJob> {
  return (await requestJson(`/jobs/${encodeURIComponent(id)}`)) as DeidJob;
}

export async function waitForJob(
  id: string,
  options?: {
    intervalMs?: number;
    timeoutMs?: number;
    onStatus?: (status: DeidJobStatus) => void;
  },
): Promise<DeidJob> {
  const intervalMs = options?.intervalMs ?? 3_000;
  // LLM de-identification runs in thinking mode on CPU and can take minutes.
  const timeoutMs = options?.timeoutMs ?? 20 * 60_000;
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const job = await getJob(id);
    options?.onStatus?.(job.status);
    if (job.status === "succeeded") return job;
    if (job.status === "failed") {
      throw new DeidServiceError(job.error ?? "The background job failed.");
    }
    if (Date.now() > deadline) {
      throw new DeidServiceError("The background job did not finish in time.");
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
