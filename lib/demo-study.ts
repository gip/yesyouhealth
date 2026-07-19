import type {
  DeidRecordResult,
  LongitudinalStudy,
  StudyCategory,
} from "@/lib/study";

const DEIDENTIFIED_FIXTURE_URL = "/demo/deidentified-john-smith.json";
const LONGITUDINAL_FIXTURE_URL = "/demo/john-smith-longitudinal.json";

interface DemoTimelineEntry {
  date?: unknown;
  category?: unknown;
  title?: unknown;
  details?: unknown;
  interpretation?: unknown;
  status?: unknown;
}

const STUDY_CATEGORIES = new Set<StudyCategory>([
  "diagnosis",
  "lab",
  "medication",
  "prior_auth_denied",
  "prior_auth_approved",
  "procedure",
  "service_request",
  "self_evaluation",
  "encounter",
  "immunization",
  "other",
]);

function category(value: unknown): StudyCategory {
  return typeof value === "string" && STUDY_CATEGORIES.has(value as StudyCategory)
    ? value as StudyCategory
    : "other";
}

function label(key: string): string {
  return key.replaceAll("_", " ").replace(/^\w/, (letter) => letter.toUpperCase());
}

function describe(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(describe).filter(Boolean).join("; ");
  if (value && typeof value === "object") {
    return Object.entries(value)
      .map(([key, item]) => `${label(key)}: ${describe(item)}`)
      .join(" · ");
  }
  return "";
}

export function normalizeDemoLongitudinal(value: unknown): LongitudinalStudy {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The bundled longitudinal demo response is invalid.");
  }
  const source = value as {
    patient_summary?: unknown;
    timeline?: unknown;
    narrative_markdown?: unknown;
  };
  const summary =
    source.patient_summary && typeof source.patient_summary === "object"
      ? (source.patient_summary as { clinical_summary?: unknown }).clinical_summary
      : source.patient_summary;
  if (
    typeof summary !== "string" ||
    !Array.isArray(source.timeline) ||
    typeof source.narrative_markdown !== "string"
  ) {
    throw new Error("The bundled longitudinal demo response is invalid.");
  }

  const timeline = source.timeline.map((rawEntry) => {
    const entry = rawEntry as DemoTimelineEntry;
    if (typeof entry.date !== "string" || typeof entry.title !== "string") {
      throw new Error("The bundled longitudinal demo timeline is invalid.");
    }
    const details = [
      describe(entry.details),
      typeof entry.status === "string" ? `Status: ${entry.status}.` : "",
      typeof entry.interpretation === "string" ? entry.interpretation : "",
    ].filter(Boolean);
    return {
      date: entry.date,
      category: category(entry.category),
      title: entry.title,
      ...(details.length ? { detail: details.join(" ") } : {}),
    };
  });

  return {
    patient_summary: summary,
    timeline,
    narrative_markdown: source.narrative_markdown,
  };
}

async function fixture(url: string): Promise<unknown> {
  const response = await fetch(url, { credentials: "same-origin" });
  if (!response.ok) {
    throw new Error(`Could not load the bundled demo response (${response.status}).`);
  }
  return response.json();
}

export async function loadDemoFixtures(): Promise<{
  deid: DeidRecordResult;
  study: LongitudinalStudy;
}> {
  const [deidentified, longitudinal] = await Promise.all([
    fixture(DEIDENTIFIED_FIXTURE_URL),
    fixture(LONGITUDINAL_FIXTURE_URL),
  ]);
  return {
    deid: { resource: deidentified, engine: "demo" },
    study: normalizeDemoLongitudinal(longitudinal),
  };
}
