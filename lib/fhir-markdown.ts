import type { JsonObject } from "@/lib/epic";

interface TimelineEntry {
  resourceType: string;
  category: string;
  title: string;
  date?: string;
  sortDate?: number;
  referenceKey?: string;
  encounterReferences: string[];
  details: Array<{ label: string; value: string }>;
  contents: Array<{ label: string; value: string }>;
}

interface PatientFacts {
  name: string;
  birthDate: string;
}

export interface FhirMarkdownOptions {
  title?: string;
}

const RESOURCE_CATEGORIES: Record<string, string> = {
  AllergyIntolerance: "Allergy",
  Appointment: "Appointment",
  CarePlan: "Care plan",
  CareTeam: "Care team",
  Condition: "Condition",
  Coverage: "Coverage",
  DeviceUseStatement: "Device",
  DiagnosticReport: "Diagnostic report",
  DocumentReference: "Clinical document",
  Encounter: "Encounter",
  ExplanationOfBenefit: "Prior authorization",
  FamilyMemberHistory: "Family history",
  Goal: "Goal",
  Immunization: "Immunization",
  MedicationDispense: "Medication fill",
  MedicationRequest: "Medication",
  Observation: "Test or observation",
  Procedure: "Procedure",
  QuestionnaireResponse: "Questionnaire",
  ServiceRequest: "Order",
};

const CLINICAL_GROUPS: Record<string, string> = {
  Observation: "Labs and tests",
  DiagnosticReport: "Labs and tests",
  Condition: "Conditions and allergies",
  AllergyIntolerance: "Conditions and allergies",
  FamilyMemberHistory: "Conditions and allergies",
  MedicationRequest: "Medications",
  MedicationDispense: "Medications",
  MedicationAdministration: "Medications",
  MedicationStatement: "Medications",
  Procedure: "Procedures and immunizations",
  Immunization: "Procedures and immunizations",
  ServiceRequest: "Orders",
  DocumentReference: "Clinical documents",
  Goal: "Care plans and goals",
  CarePlan: "Care plans and goals",
  CareTeam: "Care plans and goals",
  Appointment: "Appointments",
  DeviceUseStatement: "Devices",
  Coverage: "Coverage and authorizations",
  ExplanationOfBenefit: "Coverage and authorizations",
  QuestionnaireResponse: "Questionnaires",
};

const CLINICAL_GROUP_ORDER = [
  "Labs and tests",
  "Conditions and allergies",
  "Medications",
  "Orders",
  "Procedures and immunizations",
  "Clinical documents",
  "Care plans and goals",
  "Appointments",
  "Devices",
  "Coverage and authorizations",
  "Questionnaires",
  "Other clinical records",
];

function asObject(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : undefined;
}

function objects(value: unknown): JsonObject[] {
  return Array.isArray(value)
    ? value.map(asObject).filter((item): item is JsonObject => Boolean(item))
    : [];
}

function text(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return undefined;
}

function codeable(value: unknown): string | undefined {
  const object = asObject(value);
  if (!object) return text(value);
  const direct = text(object.text) ?? text(object.display);
  if (direct) return direct;
  for (const coding of objects(object.coding)) {
    const display = text(coding.display) ?? text(coding.code);
    if (display) return display;
  }
  return text(object.code);
}

function reference(value: unknown, resourceIndex: Map<string, JsonObject>): string | undefined {
  const object = asObject(value);
  if (!object) return text(value);
  const display = text(object.display);
  if (display) return display;
  const referenceValue = text(object.reference);
  if (!referenceValue) return undefined;
  const referenced = resourceIndex.get(referenceValue.replace(/^https?:\/\/[^/]+\//, ""));
  return referenced ? resourceTitle(referenced, resourceIndex) : undefined;
}

function normalizedReference(value: unknown): string | undefined {
  const raw = text(asObject(value)?.reference) ?? text(value);
  if (!raw) return undefined;
  const match = /(?:^|\/)([A-Z][A-Za-z]+\/[^/?#]+)(?:[/?#]|$)/.exec(raw);
  return match?.[1];
}

function encounterReferences(resource: JsonObject): string[] {
  const candidates: JsonObject[] = [];
  for (const value of [resource.encounter, asObject(resource.context)?.encounter]) {
    if (Array.isArray(value)) candidates.push(...objects(value));
    else {
      const candidate = asObject(value);
      if (candidate) candidates.push(candidate);
    }
  }
  const references = candidates
    .map(normalizedReference)
    .filter((item): item is string => Boolean(item?.startsWith("Encounter/")));
  return [...new Set(references)];
}

function quantity(value: unknown): string | undefined {
  const object = asObject(value);
  if (!object) return undefined;
  const amount = text(object.value);
  const unit = text(object.unit) ?? text(object.code);
  return amount ? `${amount}${unit ? ` ${unit}` : ""}` : undefined;
}

function range(value: unknown): string | undefined {
  const object = asObject(value);
  if (!object) return undefined;
  const direct = text(object.text);
  if (direct) return direct;
  const low = quantity(object.low);
  const high = quantity(object.high);
  if (low && high) return `${low}–${high}`;
  if (low) return `at least ${low}`;
  if (high) return `up to ${high}`;
  return undefined;
}

function period(value: unknown): string | undefined {
  const object = asObject(value);
  if (!object) return undefined;
  const start = displayDate(text(object.start));
  const end = displayDate(text(object.end));
  if (start && end) return `${start} – ${end}`;
  return start ?? end;
}

function join(
  value: unknown,
  formatter: (item: unknown) => string | undefined = codeable,
): string | undefined {
  const items = Array.isArray(value) ? value : [value];
  const seen = new Set<string>();
  const formatted: string[] = [];
  for (const item of items) {
    const result = formatter(item);
    if (!result) continue;
    const key = result.toLocaleLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      formatted.push(result);
    }
  }
  return formatted.length ? formatted.join(", ") : undefined;
}

function humanName(value: unknown): string | undefined {
  const names = Array.isArray(value) ? value : [value];
  const name = names
    .map(asObject)
    .filter((item): item is JsonObject => Boolean(item))
    .find((item) => text(item.use) === "official")
    ?? names.map(asObject).find((item): item is JsonObject => Boolean(item));
  if (!name) return undefined;
  const direct = text(name.text);
  if (direct) return direct;
  const given = Array.isArray(name.given)
    ? name.given.map(text).filter((item): item is string => Boolean(item)).join(" ")
    : "";
  return [given, text(name.family)].filter(Boolean).join(" ") || undefined;
}

function collectResources(value: unknown, resources: JsonObject[], seen: Set<unknown>): void {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) collectResources(item, resources, seen);
    return;
  }

  const object = value as JsonObject;
  const resourceType = text(object.resourceType);
  if (resourceType === "Bundle") {
    for (const entry of objects(object.entry)) collectResources(entry.resource, resources, seen);
    return;
  }
  if (resourceType) {
    resources.push(object);
    return;
  }

  // Supports YesYou exports ({ data: { Condition: [...] }}) as well as
  // JSON objects whose top-level keys group resources by FHIR type.
  for (const [key, child] of Object.entries(object)) {
    if (key === "errors" || key === "attachments") continue;
    collectResources(child, resources, seen);
  }
}

function richness(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  if (Array.isArray(value)) return value.reduce((total, item) => total + richness(item), 0);
  if (typeof value === "object") {
    return Object.entries(value as JsonObject)
      .filter(([key]) => key !== "meta" && key !== "text")
      .reduce((total, [, child]) => total + richness(child), 0);
  }
  return 1;
}

function deduplicateResources(resources: JsonObject[]): JsonObject[] {
  const keyed = new Map<string, JsonObject>();
  const unkeyed: JsonObject[] = [];

  for (const resource of resources) {
    const resourceType = text(resource.resourceType);
    if (!resourceType) continue;
    const id = text(resource.id);
    if (!id) {
      unkeyed.push(resource);
      continue;
    }
    const key = `${resourceType}/${id}`;
    const existing = keyed.get(key);
    if (!existing || richness(resource) > richness(existing)) keyed.set(key, resource);
  }

  return [...keyed.values(), ...unkeyed];
}

function resourceIndex(resources: JsonObject[]): Map<string, JsonObject> {
  const index = new Map<string, JsonObject>();
  for (const resource of resources) {
    const type = text(resource.resourceType);
    const id = text(resource.id);
    if (type && id) index.set(`${type}/${id}`, resource);
  }
  return index;
}

function patientFacts(resources: JsonObject[]): PatientFacts {
  const patient = resources.find((resource) => resource.resourceType === "Patient");
  return {
    name: humanName(patient?.name) ?? "Not available",
    birthDate: text(patient?.birthDate) ?? "Not available",
  };
}

function resourceTitle(resource: JsonObject, index: Map<string, JsonObject>): string {
  switch (resource.resourceType) {
    case "Medication":
      return codeable(resource.code) ?? "Medication";
    case "MedicationRequest":
    case "MedicationDispense":
    case "MedicationAdministration":
    case "MedicationStatement":
      return codeable(resource.medicationCodeableConcept)
        ?? reference(resource.medicationReference, index)
        ?? "Medication";
    case "Immunization":
      return codeable(resource.vaccineCode) ?? "Immunization";
    case "Goal":
      return codeable(resource.description) ?? "Goal";
    case "CarePlan":
      return text(resource.title) ?? codeable(resource.category) ?? "Care plan";
    case "DocumentReference":
      return text(resource.description) ?? codeable(resource.type) ?? "Clinical document";
    case "Appointment":
      return codeable(resource.appointmentType)
        ?? join(resource.serviceType)
        ?? "Appointment";
    case "Encounter": {
      const types = (Array.isArray(resource.type) ? resource.type : [resource.type])
        .map(codeable)
        .filter((item): item is string => Boolean(item));
      return types.find((item) => /\b(video|telehealth)\b/i.test(item))
        ?? types.find((item) => /\b(visit|consult|admission|emergency)\b/i.test(item))
        ?? types[0]
        ?? codeable(resource.class)
        ?? "Encounter";
    }
    case "ServiceRequest":
      return codeable(resource.code) ?? "Order";
    case "DiagnosticReport":
      return codeable(resource.code) ?? "Diagnostic report";
    case "AllergyIntolerance":
      return codeable(resource.code) ?? "Allergy or intolerance";
    case "FamilyMemberHistory":
      return codeable(objects(resource.condition)[0]?.code)
        ?? codeable(resource.relationship)
        ?? "Family history";
    default:
      return codeable(resource.code)
        ?? codeable(resource.type)
        ?? codeable(resource.category)
        ?? String(resource.resourceType ?? "Clinical event");
  }
}

function eventDate(resource: JsonObject): string | undefined {
  const first = (...values: unknown[]): string | undefined => {
    for (const value of values) {
      const result = text(value);
      if (result) return result;
    }
    return undefined;
  };
  const periodStart = (value: unknown): unknown => asObject(value)?.start;

  switch (resource.resourceType) {
    case "AllergyIntolerance":
      return first(resource.recordedDate, resource.onsetDateTime, periodStart(resource.onsetPeriod));
    case "Appointment":
      return first(resource.start, resource.created);
    case "CarePlan":
    case "CareTeam":
    case "Coverage":
      return first(periodStart(resource.period), resource.created);
    case "Condition":
      return first(
        resource.onsetDateTime,
        periodStart(resource.onsetPeriod),
        resource.onsetString,
        resource.recordedDate,
      );
    case "DeviceUseStatement":
      return first(resource.timingDateTime, periodStart(resource.timingPeriod), resource.recordedOn);
    case "DiagnosticReport":
      return first(resource.effectiveDateTime, periodStart(resource.effectivePeriod), resource.issued);
    case "DocumentReference":
      return first(resource.date, periodStart(asObject(resource.context)?.period));
    case "Encounter":
      return first(periodStart(resource.period));
    case "ExplanationOfBenefit":
      return first(resource.created);
    case "FamilyMemberHistory":
      return first(resource.date);
    case "Goal":
      return first(resource.startDate, resource.statusDate);
    case "Immunization":
      return first(resource.occurrenceDateTime, resource.occurrenceString, resource.recorded);
    case "MedicationAdministration":
      return first(resource.effectiveDateTime, periodStart(resource.effectivePeriod));
    case "MedicationDispense":
      return first(resource.whenHandedOver, resource.whenPrepared);
    case "MedicationRequest":
      return first(resource.authoredOn);
    case "MedicationStatement":
      return first(resource.dateAsserted, resource.effectiveDateTime, periodStart(resource.effectivePeriod));
    case "Observation":
      return first(
        resource.effectiveDateTime,
        periodStart(resource.effectivePeriod),
        resource.issued,
      );
    case "Procedure":
      return first(resource.performedDateTime, periodStart(resource.performedPeriod));
    case "QuestionnaireResponse":
      return first(resource.authored);
    case "ServiceRequest":
      return first(resource.occurrenceDateTime, periodStart(resource.occurrencePeriod), resource.authoredOn);
    default:
      return first(
        resource.date,
        resource.authoredOn,
        resource.created,
        resource.issued,
        periodStart(resource.period),
      );
  }
}

function valueOf(resource: JsonObject): string | undefined {
  return quantity(resource.valueQuantity)
    ?? codeable(resource.valueCodeableConcept)
    ?? text(resource.valueString)
    ?? text(resource.valueInteger)
    ?? text(resource.valueDecimal)
    ?? text(resource.valueBoolean)
    ?? range(resource.valueRange)
    ?? (asObject(resource.valueRatio)
      ? [
          quantity(asObject(resource.valueRatio)?.numerator),
          quantity(asObject(resource.valueRatio)?.denominator),
        ].filter(Boolean).join(" / ")
      : undefined);
}

function attachmentLabel(contentType: string | undefined): string {
  if (!contentType) return "file";
  const labels: Record<string, string> = {
    "application/pdf": "PDF",
    "application/rtf": "RTF",
    "application/xml": "XML",
    "application/xhtml+xml": "HTML",
    "text/html": "HTML",
    "text/plain": "plain text",
    "text/rtf": "RTF",
  };
  return labels[contentType] ?? contentType;
}

function cleanMarkup(value: string): string {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<(?:br|\/p|\/div|\/li|\/tr|\/h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function rtfToText(value: string): string {
  const destinationWords = new Set([
    "colortbl",
    "datastore",
    "filetbl",
    "fonttbl",
    "footer",
    "footerf",
    "footerl",
    "footerr",
    "generator",
    "header",
    "headerf",
    "headerl",
    "headerr",
    "info",
    "listtable",
    "listoverridetable",
    "object",
    "pict",
    "stylesheet",
    "themedata",
    "xmlnstbl",
  ]);
  const controlCharacters: Record<string, string> = {
    bullet: "•",
    cell: "\t",
    emdash: "—",
    emspace: " ",
    endash: "–",
    enspace: " ",
    line: "\n",
    page: "\n",
    par: "\n",
    qmspace: " ",
    tab: "\t",
  };
  const states: Array<{ skip: boolean; unicodeFallbackLength: number }> = [{
    skip: false,
    unicodeFallbackLength: 1,
  }];
  const output: string[] = [];
  let fallbackCharacters = 0;

  for (let index = 0; index < value.length;) {
    const state = states.at(-1)!;
    const character = value[index]!;
    if (character === "{") {
      states.push({ ...state });
      index += 1;
      continue;
    }
    if (character === "}") {
      if (states.length > 1) states.pop();
      index += 1;
      continue;
    }
    if (character !== "\\") {
      index += 1;
      if (character === "\r" || character === "\n" || state.skip) continue;
      if (fallbackCharacters > 0) {
        fallbackCharacters -= 1;
        continue;
      }
      output.push(character);
      continue;
    }

    index += 1;
    const escaped = value[index];
    if (!escaped) break;
    if (escaped === "\\" || escaped === "{" || escaped === "}") {
      index += 1;
      if (!state.skip) {
        if (fallbackCharacters > 0) fallbackCharacters -= 1;
        else output.push(escaped);
      }
      continue;
    }
    if (escaped === "'") {
      const hex = value.slice(index + 1, index + 3);
      index += 3;
      if (!state.skip && /^[0-9a-f]{2}$/i.test(hex)) {
        if (fallbackCharacters > 0) fallbackCharacters -= 1;
        else {
          output.push(new TextDecoder("windows-1252").decode(
            Uint8Array.of(Number.parseInt(hex, 16)),
          ));
        }
      }
      continue;
    }
    if (escaped === "*") {
      state.skip = true;
      index += 1;
      continue;
    }
    if (!/[A-Za-z]/.test(escaped)) {
      index += 1;
      continue;
    }

    const wordStart = index;
    while (index < value.length && /[A-Za-z]/.test(value[index]!)) index += 1;
    const word = value.slice(wordStart, index);
    let sign = 1;
    if (value[index] === "-") {
      sign = -1;
      index += 1;
    }
    const numberStart = index;
    while (index < value.length && /\d/.test(value[index]!)) index += 1;
    const parameter = numberStart < index
      ? sign * Number(value.slice(numberStart, index))
      : undefined;
    if (value[index] === " ") index += 1;

    if (destinationWords.has(word)) {
      state.skip = true;
      continue;
    }
    if (word === "uc" && parameter !== undefined) {
      state.unicodeFallbackLength = Math.max(0, parameter);
      continue;
    }
    if (word === "u" && parameter !== undefined) {
      if (!state.skip) {
        const codePoint = parameter < 0 ? parameter + 65_536 : parameter;
        output.push(String.fromCodePoint(codePoint));
        fallbackCharacters = state.unicodeFallbackLength;
      }
      continue;
    }
    if (word === "bin" && parameter !== undefined) {
      index += Math.max(0, parameter);
      continue;
    }
    const replacement = controlCharacters[word];
    if (!state.skip && replacement) output.push(replacement);
  }

  return output
    .join("")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodedAttachment(
  data: string | undefined,
  contentType: string | undefined,
): string | undefined {
  if (!data || !contentType) return undefined;
  if (![
    "application/rtf",
    "application/xhtml+xml",
    "application/xml",
    "text/html",
    "text/plain",
    "text/rtf",
    "text/xml",
  ].includes(contentType)) {
    return undefined;
  }
  try {
    const decoded = Buffer.from(data, "base64").toString("utf8");
    if (contentType === "text/plain") return decoded.trim();
    if (contentType === "text/rtf" || contentType === "application/rtf") {
      return rtfToText(decoded);
    }
    return cleanMarkup(decoded);
  } catch {
    return undefined;
  }
}

function documentAttachmentInfo(
  resource: JsonObject,
  index: Map<string, JsonObject>,
): {
  summary?: string;
  contents: Array<{ label: string; value: string }>;
} {
  const summaries: string[] = [];
  const contents: Array<{ label: string; value: string }> = [];

  for (const item of objects(resource.content)) {
    const attachment = asObject(item.attachment);
    if (!attachment) continue;
    const contentType = text(attachment.contentType);
    const title = text(attachment.title);
    const url = text(attachment.url);
    const binary = url ? index.get(normalizedReference(url) ?? "") : undefined;
    const embeddedData = text(attachment.data) ?? text(binary?.data);
    const decoded = decodedAttachment(embeddedData, contentType ?? text(binary?.contentType));
    const label = attachmentLabel(contentType ?? text(binary?.contentType));
    summaries.push(
      `${title ? `${title} (${label})` : label} — ${
        embeddedData ? "embedded in the input" : "referenced, but content is not included in the input"
      }`,
    );
    if (decoded) {
      contents.push({
        label: title ?? `${label} attachment`,
        value: decoded,
      });
    }
  }

  return {
    ...(summaries.length ? { summary: [...new Set(summaries)].join("; ") } : {}),
    contents,
  };
}

function add(
  details: TimelineEntry["details"],
  label: string,
  value: string | undefined,
): void {
  if (!value) return;
  const normalized = value.trim();
  if (!normalized) return;
  const duplicate = details.some(
    (detail) => detail.label === label && detail.value.toLocaleLowerCase() === normalized.toLocaleLowerCase(),
  );
  if (!duplicate) details.push({ label, value: normalized });
}

function timelineDetails(
  resource: JsonObject,
  index: Map<string, JsonObject>,
): TimelineEntry["details"] {
  const details: TimelineEntry["details"] = [];
  const ref = (value: unknown): string | undefined => reference(value, index);
  const notes = (value: unknown): string | undefined =>
    join(value, (item) => text(asObject(item)?.text));

  switch (resource.resourceType) {
    case "AllergyIntolerance": {
      add(details, "Clinical status", codeable(resource.clinicalStatus));
      add(details, "Verification", codeable(resource.verificationStatus));
      add(details, "Criticality", text(resource.criticality));
      const reactions = objects(resource.reaction).flatMap((reaction) => reaction.manifestation ?? []);
      add(details, "Reactions", join(reactions));
      break;
    }
    case "Appointment":
      add(details, "Status", text(resource.status));
      add(details, "Service", join(resource.serviceType));
      add(details, "Reason", join(resource.reasonCode));
      add(details, "Participants", join(resource.participant, (item) => ref(asObject(item)?.actor)));
      break;
    case "CarePlan":
      add(details, "Status", text(resource.status));
      add(details, "Intent", text(resource.intent));
      add(details, "Period", period(resource.period));
      add(details, "Description", text(resource.description));
      add(details, "Activities", join(resource.activity, (item) => {
        const activity = asObject(item);
        const activityDetail = asObject(activity?.detail);
        return codeable(activityDetail?.code)
          ?? text(activityDetail?.description)
          ?? ref(activity?.reference);
      }));
      break;
    case "CareTeam":
      add(details, "Status", text(resource.status));
      add(details, "Members", join(resource.participant, (item) => {
        const participant = asObject(item);
        const member = ref(participant?.member);
        const role = join(participant?.role);
        return [member, role].filter(Boolean).join(" — ") || undefined;
      }));
      break;
    case "Condition":
      add(details, "Clinical status", codeable(resource.clinicalStatus));
      add(details, "Verification", codeable(resource.verificationStatus));
      add(details, "Severity", codeable(resource.severity));
      add(details, "Body site", join(resource.bodySite));
      add(details, "Resolved", displayDate(
        text(resource.abatementDateTime) ?? text(asObject(resource.abatementPeriod)?.end),
      ));
      break;
    case "Coverage":
      add(details, "Status", text(resource.status));
      add(details, "Type", codeable(resource.type));
      add(details, "Period", period(resource.period));
      add(details, "Payor", join(resource.payor, ref));
      break;
    case "DeviceUseStatement":
      add(details, "Status", text(resource.status));
      add(details, "Device", ref(resource.device));
      add(details, "Reason", join(resource.reasonCode));
      break;
    case "DiagnosticReport":
      add(details, "Status", text(resource.status));
      add(details, "Category", join(resource.category));
      add(details, "Conclusion", text(resource.conclusion));
      add(details, "Conclusion codes", join(resource.conclusionCode));
      break;
    case "DocumentReference":
      add(details, "Status", text(resource.status));
      add(details, "Type", codeable(resource.type));
      add(details, "Category", join(resource.category));
      add(details, "Author", join(resource.author, ref));
      add(details, "Attachments", documentAttachmentInfo(resource, index).summary);
      break;
    case "Encounter":
      add(details, "Status", text(resource.status));
      add(details, "Type", join(resource.type));
      add(details, "Class", codeable(resource.class));
      add(details, "End", displayDate(text(asObject(resource.period)?.end)));
      add(details, "Reason", join(resource.reasonCode));
      add(details, "Location", join(resource.location, (item) => ref(asObject(item)?.location)));
      break;
    case "ExplanationOfBenefit":
      add(details, "Status", text(resource.status));
      add(details, "Use", text(resource.use));
      add(details, "Outcome", text(resource.outcome));
      add(details, "Insurer", ref(resource.insurer));
      break;
    case "FamilyMemberHistory":
      add(details, "Status", text(resource.status));
      add(details, "Relationship", codeable(resource.relationship));
      add(details, "Conditions", join(resource.condition, (item) => codeable(asObject(item)?.code)));
      break;
    case "Goal":
      add(details, "Status", text(resource.lifecycleStatus));
      add(details, "Achievement", codeable(resource.achievementStatus));
      add(details, "Target", join(resource.target, (item) => {
        const target = asObject(item);
        const measure = codeable(target?.measure);
        const targetValue = quantity(target?.detailQuantity)
          ?? codeable(target?.detailCodeableConcept)
          ?? range(target?.detailRange)
          ?? text(target?.detailString)
          ?? text(target?.detailInteger);
        return [measure, targetValue].filter(Boolean).join(": ") || undefined;
      }));
      break;
    case "Immunization":
      add(details, "Status", text(resource.status));
      add(details, "Dose", quantity(resource.doseQuantity));
      add(details, "Site", codeable(resource.site));
      add(details, "Route", codeable(resource.route));
      add(details, "Lot number", text(resource.lotNumber));
      break;
    case "MedicationAdministration":
      add(details, "Status", text(resource.status));
      add(details, "Dosage", text(asObject(resource.dosage)?.text));
      add(details, "Dose", quantity(asObject(resource.dosage)?.dose));
      add(details, "Reason", join(resource.reasonCode));
      break;
    case "MedicationDispense":
      add(details, "Status", text(resource.status));
      add(details, "Quantity", quantity(resource.quantity));
      add(details, "Days supplied", quantity(resource.daysSupply));
      add(details, "Dosage", join(resource.dosageInstruction, (item) => text(asObject(item)?.text)));
      break;
    case "MedicationRequest":
      add(details, "Status", text(resource.status));
      add(details, "Intent", text(resource.intent));
      add(details, "Dosage", join(resource.dosageInstruction, (item) => text(asObject(item)?.text)));
      add(details, "Reason", join(resource.reasonCode));
      break;
    case "MedicationStatement":
      add(details, "Status", text(resource.status));
      add(details, "Dosage", join(resource.dosage, (item) => text(asObject(item)?.text)));
      add(details, "Reason", join(resource.reasonCode));
      break;
    case "Observation":
      add(details, "Status", text(resource.status));
      add(details, "Value", valueOf(resource));
      add(details, "Category", join(resource.category));
      add(details, "Interpretation", join(resource.interpretation));
      add(details, "Components", join(resource.component, (item) => {
        const component = asObject(item);
        if (!component) return undefined;
        const componentValue = valueOf(component);
        return [codeable(component.code), componentValue].filter(Boolean).join(": ") || undefined;
      }));
      add(details, "Reference range", join(resource.referenceRange, range));
      add(details, "Notes", notes(resource.note));
      break;
    case "Procedure":
      add(details, "Status", text(resource.status));
      add(details, "Reason", join(resource.reasonCode));
      add(details, "Body site", join(resource.bodySite));
      add(details, "Outcome", codeable(resource.outcome));
      break;
    case "QuestionnaireResponse":
      add(details, "Status", text(resource.status));
      add(details, "Answers", join(resource.item, (item) => {
        const question = asObject(item);
        const answers = objects(question?.answer).map((answer) =>
          text(answer.valueString)
          ?? text(answer.valueBoolean)
          ?? text(answer.valueInteger)
          ?? codeable(answer.valueCoding)
          ?? quantity(answer.valueQuantity)
        ).filter(Boolean);
        return [text(question?.text), answers.join(", ")].filter(Boolean).join(": ") || undefined;
      }));
      break;
    case "ServiceRequest":
      add(details, "Status", text(resource.status));
      add(details, "Intent", text(resource.intent));
      add(details, "Reason", join(resource.reasonCode));
      add(details, "Requester", ref(resource.requester));
      break;
    default:
      add(details, "Status", text(resource.status));
      add(details, "Category", join(resource.category));
      add(details, "Value", valueOf(resource));
  }
  return details;
}

function timelineContents(
  resource: JsonObject,
  index: Map<string, JsonObject>,
): Array<{ label: string; value: string }> {
  if (resource.resourceType !== "DocumentReference") return [];
  return documentAttachmentInfo(resource, index).contents;
}

function parseDate(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function displayDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?(?:T(\d{2}):(\d{2}))?/.exec(value);
  if (!match) return value;
  const year = match[1];
  const month = match[2];
  const day = match[3];
  if (!month) return year;
  const monthName = new Intl.DateTimeFormat("en-US", {
    month: "long",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(2000, Number(month) - 1, 1)));
  if (!day) return `${monthName} ${year}`;
  const date = `${monthName} ${Number(day)}, ${year}`;
  if (!match[4] || !match[5]) return date;
  const hours = Number(match[4]);
  const minutes = match[5];
  const clockHours = hours % 12 || 12;
  return `${date}, ${clockHours}:${minutes} ${hours >= 12 ? "PM" : "AM"}`;
}

function sanitize(value: string, facts: PatientFacts): string {
  let result = value;
  for (const fact of [facts.name, facts.birthDate]) {
    if (fact === "Not available") continue;
    result = result.replaceAll(fact, fact === facts.name ? "the patient" : "date of birth");
  }
  return result;
}

function semanticKey(entry: TimelineEntry): string {
  return JSON.stringify({
    resourceType: entry.resourceType,
    title: entry.title.toLocaleLowerCase(),
    date: entry.date ?? "",
    details: entry.details
      .map((detail) => [detail.label, detail.value.toLocaleLowerCase()])
      .sort(([left], [right]) => String(left).localeCompare(String(right))),
    contents: entry.contents.map((content) => [
      content.label,
      content.value.toLocaleLowerCase(),
    ]),
  });
}

function timelineEntries(
  resources: JsonObject[],
  facts: PatientFacts,
): TimelineEntry[] {
  const index = resourceIndex(resources);
  const entries: TimelineEntry[] = [];
  const semanticDuplicates = new Set<string>();

  for (const resource of resources) {
    const resourceType = text(resource.resourceType);
    if (
      !resourceType
      || resourceType === "Patient"
      || resourceType === "Medication"
      || resourceType === "Binary"
      || resourceType === "OperationOutcome"
    ) continue;
    const category = RESOURCE_CATEGORIES[resourceType] ?? resourceType.replace(/([a-z])([A-Z])/g, "$1 $2");
    const rawDate = eventDate(resource);
    const entry: TimelineEntry = {
      resourceType,
      category,
      title: sanitize(resourceTitle(resource, index), facts),
      encounterReferences: encounterReferences(resource),
      details: timelineDetails(resource, index).map((detail) => ({
        label: detail.label,
        value: sanitize(detail.value, facts),
      })),
      contents: timelineContents(resource, index).map((content) => ({
        label: content.label,
        value: sanitize(content.value, facts),
      })),
    };
    const resourceId = text(resource.id);
    if (resourceId) entry.referenceKey = `${resourceType}/${resourceId}`;
    if (rawDate) entry.date = rawDate;
    const sortDate = parseDate(rawDate);
    if (sortDate !== undefined) entry.sortDate = sortDate;
    // Resource IDs are authoritative identities. Semantic deduplication is only
    // for id-less resources; otherwise similar notes or encounter summaries
    // belonging to different encounters would be incorrectly collapsed.
    const key = entry.referenceKey ? `resource:${entry.referenceKey}` : semanticKey(entry);
    if (!semanticDuplicates.has(key)) {
      semanticDuplicates.add(key);
      entries.push(entry);
    }
  }

  return entries.sort((left, right) => {
    if (left.sortDate !== undefined && right.sortDate !== undefined) {
      return right.sortDate - left.sortDate;
    }
    if (left.sortDate !== undefined) return -1;
    if (right.sortDate !== undefined) return 1;
    return left.category.localeCompare(right.category) || left.title.localeCompare(right.title);
  });
}

function escapeInline(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("*", "\\*")
    .replaceAll("_", "\\_")
    .replaceAll("`", "\\`")
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replace(/\r?\n+/g, " ");
}

function dateGroupKey(entry: TimelineEntry): string {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(entry.date ?? "");
  return match?.[1] ?? "Undated";
}

function markdownAnchor(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/[^a-z0-9 -]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

function clinicalGroup(entry: TimelineEntry): string {
  return CLINICAL_GROUPS[entry.resourceType] ?? "Other clinical records";
}

function relatedGroupLabel(group: string): string {
  return group === "Clinical documents"
    ? "Notes, AVS, and other clinical documents"
    : group;
}

function groupEntriesByDate(entries: TimelineEntry[]): Array<[string, TimelineEntry[]]> {
  const groups = new Map<string, TimelineEntry[]>();
  for (const entry of entries) {
    const key = dateGroupKey(entry);
    const group = groups.get(key) ?? [];
    group.push(entry);
    groups.set(key, group);
  }
  return [...groups.entries()];
}

function renderContent(
  lines: string[],
  content: { label: string; value: string },
  indent: string,
): void {
  lines.push(`${indent}- **${escapeInline(content.label)}:**`);
  for (const line of content.value.split(/\r?\n/)) {
    lines.push(`${indent}  > ${line.trim() ? escapeInline(line) : ""}`);
  }
}

function renderCompactEntry(
  lines: string[],
  entry: TimelineEntry,
  options: { relatedToDate?: string } = {},
): void {
  lines.push(`- **${escapeInline(entry.category)}: ${escapeInline(entry.title)}**`);
  if (entry.date && options.relatedToDate && entry.date !== options.relatedToDate) {
    const label = entry.resourceType === "DocumentReference" ? "Document date" : "Record date";
    lines.push(`  - **${label}:** ${escapeInline(displayDate(entry.date) ?? entry.date)}`);
  }
  for (const detail of entry.details) {
    lines.push(`  - **${escapeInline(detail.label)}:** ${escapeInline(detail.value)}`);
  }
  for (const content of entry.contents) renderContent(lines, content, "  ");
  if (!entry.details.length && !entry.contents.length) {
    lines.push("  - _No additional clinically relevant details._");
  }
}

function sortClinicalGroups(groups: Iterable<string>): string[] {
  return [...groups].sort((left, right) => {
    const leftIndex = CLINICAL_GROUP_ORDER.indexOf(left);
    const rightIndex = CLINICAL_GROUP_ORDER.indexOf(right);
    return (leftIndex < 0 ? Number.MAX_SAFE_INTEGER : leftIndex)
      - (rightIndex < 0 ? Number.MAX_SAFE_INTEGER : rightIndex)
      || left.localeCompare(right);
  });
}

export function fhirToMarkdown(
  input: unknown,
  options: FhirMarkdownOptions = {},
): string {
  const collected: JsonObject[] = [];
  collectResources(input, collected, new Set());
  const resources = deduplicateResources(collected);
  if (!resources.length) {
    throw new Error("The input did not contain any FHIR resources.");
  }

  const facts = patientFacts(resources);
  const entries = timelineEntries(resources, facts);
  const encounters = entries.filter((entry) => entry.resourceType === "Encounter");
  const encounterByReference = new Map(
    encounters
      .filter((entry): entry is TimelineEntry & { referenceKey: string } => Boolean(entry.referenceKey))
      .map((entry) => [entry.referenceKey, entry]),
  );
  const relatedByEncounter = new Map<string, TimelineEntry[]>();
  const standalone: TimelineEntry[] = [];

  for (const entry of entries) {
    if (entry.resourceType === "Encounter") continue;
    const encounterReference = entry.encounterReferences.find((candidate) =>
      encounterByReference.has(candidate)
    );
    if (!encounterReference) {
      standalone.push(entry);
      continue;
    }
    const related = relatedByEncounter.get(encounterReference) ?? [];
    related.push(entry);
    relatedByEncounter.set(encounterReference, related);
  }

  const standaloneGroups = new Map<string, TimelineEntry[]>();
  for (const entry of standalone) {
    const groupName = clinicalGroup(entry);
    const group = standaloneGroups.get(groupName) ?? [];
    group.push(entry);
    standaloneGroups.set(groupName, group);
  }
  const orderedStandaloneGroups = sortClinicalGroups(standaloneGroups.keys());

  const lines: string[] = [
    `# ${escapeInline(options.title ?? "Health Record Summary")}`,
    "",
    "## Table of Contents",
    "",
    "- [Patient facts](#patient-facts)",
    "- [Longitudinal record](#longitudinal-record)",
    ...(encounters.length ? ["  - [Encounters](#encounters)"] : []),
    ...orderedStandaloneGroups.map((group) =>
      `  - [${group}](#${markdownAnchor(group)})`
    ),
    "",
    "## Patient facts",
    "",
    `- **Name:** ${escapeInline(facts.name)}`,
    `- **Date of birth:** ${escapeInline(facts.birthDate)}`,
    "",
    "## Longitudinal record",
    "",
  ];

  if (!entries.length) {
    lines.push("_No longitudinal clinical events were found._", "");
    return lines.join("\n");
  }

  if (encounters.length) {
    lines.push("### Encounters", "");
    for (const encounter of encounters) {
      const date = displayDate(encounter.date) ?? "Date of service not available";
      lines.push(`#### ${escapeInline(date)} — ${escapeInline(encounter.title)}`, "");
      for (const detail of encounter.details) {
        lines.push(`- **${escapeInline(detail.label)}:** ${escapeInline(detail.value)}`);
      }
      if (!encounter.details.length) {
        lines.push("_No additional encounter details._");
      }

      const related = encounter.referenceKey
        ? relatedByEncounter.get(encounter.referenceKey) ?? []
        : [];
      if (related.length) {
        const groups = new Map<string, TimelineEntry[]>();
        for (const entry of related) {
          const groupName = clinicalGroup(entry);
          const group = groups.get(groupName) ?? [];
          group.push(entry);
          groups.set(groupName, group);
        }
        for (const groupName of sortClinicalGroups(groups.keys())) {
          lines.push("", `##### ${relatedGroupLabel(groupName)}`, "");
          for (const entry of groups.get(groupName) ?? []) {
            renderCompactEntry(lines, entry, { ...(encounter.date ? { relatedToDate: encounter.date } : {}) });
          }
        }
      } else {
        lines.push("", "_No related clinical records were found in the input._");
      }
      lines.push("");
    }
  }

  for (const groupName of orderedStandaloneGroups) {
    lines.push(`### ${groupName}`, "");
    const group = standaloneGroups.get(groupName) ?? [];
    for (const [dateKey, dateEntries] of groupEntriesByDate(group)) {
      const serviceDate = dateKey === "Undated"
        ? "Date of service not available"
        : displayDate(dateKey) ?? dateKey;
      lines.push(`#### Date of service: ${escapeInline(serviceDate)}`, "");
      for (const entry of dateEntries) {
        renderCompactEntry(lines, entry);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}
