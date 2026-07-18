// Browser-side pipeline: imported record -> deid job -> long job -> encrypted
// study. Everything runs in the browser against the deid-service directly;
// the web app's server never sees health data.

import type { HealthExportDocument } from "@/lib/browser-flow";
import { loadHealthExport, storeStudy } from "@/lib/browser-storage";
import {
  submitJob,
  waitForJob,
  DeidServiceError,
  type DeidJobStatus,
} from "@/lib/deid-client";
import { isLongitudinalStudy, type StudyRecord } from "@/lib/study";
import type { JsonObject } from "@/lib/epic";

export type StudyStage = "deidentifying" | "summarizing" | "saving";

// Emitted on every status poll (every few seconds) so the UI can show that
// the background job is queued or actively running.
export interface StudyProgressUpdate {
  stage: StudyStage;
  jobStatus?: DeidJobStatus;
}

function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// The deid-service scrubs FHIR resources/Bundles, so pack the imported groups
// into one collection Bundle.
export function exportToBundle(healthExport: HealthExportDocument): JsonObject {
  const resources: JsonObject[] = [];
  for (const value of Object.values(healthExport.data)) {
    for (const resource of Array.isArray(value) ? value : [value]) {
      if (isJsonObject(resource)) resources.push(resource);
    }
  }
  for (const resource of healthExport.priorAuthorizations) {
    if (isJsonObject(resource)) resources.push(resource);
  }
  return {
    resourceType: "Bundle",
    type: "collection",
    entry: resources.map((resource) => ({ resource })),
  };
}

async function runJob(
  type: "deid" | "long",
  payload: unknown,
  onStatus?: (status: DeidJobStatus) => void,
): Promise<{ result: unknown; meta: Record<string, unknown> }> {
  const { id } = await submitJob(type, payload);
  const job = await waitForJob(id, onStatus ? { onStatus } : {});
  return { result: job.result, meta: job.meta ?? {} };
}

export async function generateStudy(options?: {
  onProgress?: (update: StudyProgressUpdate) => void;
}): Promise<StudyRecord> {
  const healthExport = await loadHealthExport();
  if (!healthExport) {
    throw new Error("No imported health record was found. Import your record first.");
  }
  const bundle = exportToBundle(healthExport);
  if (!Array.isArray(bundle.entry) || bundle.entry.length === 0) {
    throw new Error("The imported record contains no resources to analyze.");
  }

  options?.onProgress?.({ stage: "deidentifying" });
  const deid = await runJob("deid", bundle, (jobStatus) =>
    options?.onProgress?.({ stage: "deidentifying", jobStatus }));
  // With RETURN_MAP enabled the service wraps the result; unwrap either shape.
  const deidResult = deid.result;
  const scrubbed =
    isJsonObject(deidResult) && "resource" in deidResult && "map" in deidResult
      ? deidResult.resource
      : deidResult;
  const engine = typeof deid.meta.engine === "string" ? deid.meta.engine : undefined;

  options?.onProgress?.({ stage: "summarizing" });
  const long = await runJob("long", scrubbed, (jobStatus) =>
    options?.onProgress?.({ stage: "summarizing", jobStatus }));
  if (!isLongitudinalStudy(long.result)) {
    throw new DeidServiceError("The service returned an invalid longitudinal study.");
  }

  options?.onProgress?.({ stage: "saving" });
  const model = typeof long.meta.model === "string" ? long.meta.model : undefined;
  return storeStudy(long.result, {
    ...(model ? { model } : {}),
    deid: { resource: scrubbed, ...(engine ? { engine } : {}) },
  });
}
