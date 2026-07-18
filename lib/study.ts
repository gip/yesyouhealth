// Longitudinal study types shared by the deid-service client, encrypted
// browser storage, and the study review UI.

export type StudyCategory =
  | "diagnosis"
  | "lab"
  | "medication"
  | "prior_auth_denied"
  | "procedure"
  | "self_evaluation"
  | "encounter"
  | "immunization"
  | "other";

export interface StudyTimelineEntry {
  date: string;
  category: StudyCategory;
  title: string;
  detail?: string;
}

export interface LongitudinalStudy {
  patient_summary: string;
  timeline: StudyTimelineEntry[];
  narrative_markdown: string;
}

export interface StudyComment {
  id: string;
  // Index into the study timeline; undefined for a general comment.
  entryIndex?: number;
  text: string;
  createdAt: string;
}

export interface StudyRecord {
  id: string;
  importId: string;
  createdAt: string;
  model?: string;
  study: LongitudinalStudy;
  comments: StudyComment[];
}

export function isLongitudinalStudy(value: unknown): value is LongitudinalStudy {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const study = value as Record<string, unknown>;
  return (
    typeof study.patient_summary === "string" &&
    Array.isArray(study.timeline) &&
    typeof study.narrative_markdown === "string" &&
    study.timeline.every(
      (entry) =>
        entry !== null &&
        typeof entry === "object" &&
        typeof (entry as Record<string, unknown>).date === "string" &&
        typeof (entry as Record<string, unknown>).title === "string",
    )
  );
}

export const STUDY_CATEGORY_LABELS: Record<StudyCategory, string> = {
  diagnosis: "Diagnosis",
  lab: "Lab result",
  medication: "Medication",
  prior_auth_denied: "Prior auth denied",
  procedure: "Procedure",
  self_evaluation: "Self-evaluation",
  encounter: "Encounter",
  immunization: "Immunization",
  other: "Other",
};
