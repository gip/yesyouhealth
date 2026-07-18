import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "@/lib/server/password";

export type UserRole = "patient" | "doctor";

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

export interface SignupInput {
  email: string;
  password: string;
  name: string | null;
  role: UserRole;
  fieldIds: number[];
}

export interface OnboardingInput {
  role: UserRole;
  fieldIds: number[];
}

export interface LiteratureInput {
  fieldId: number;
  title: string;
  authors: string;
  journal: string;
  year: number;
  doi: string | null;
  pubmedUrl: string | null;
}

export const MAX_FIELDS_PER_USER = 2;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DOI_PATTERN = /^10\.\d{4,9}\/\S+$/;
const PUBMED_URL_PATTERN = /^https:\/\/(pubmed\.ncbi\.nlm\.nih\.gov|www\.ncbi\.nlm\.nih\.gov)\//;

function fail<T>(error: string): ParseResult<T> {
  return { ok: false, error };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseTrimmedString(value: unknown, label: string, maxLength: number): ParseResult<string> {
  if (typeof value !== "string") return fail(`${label} is required.`);
  const trimmed = value.trim();
  if (trimmed.length === 0) return fail(`${label} is required.`);
  if (trimmed.length > maxLength) return fail(`${label} must be ${maxLength} characters or fewer.`);
  return { ok: true, value: trimmed };
}

export function parseRole(value: unknown): ParseResult<UserRole> {
  if (value === "patient" || value === "doctor") return { ok: true, value };
  return fail("Choose either the patient or doctor role.");
}

export function parseEmail(value: unknown): ParseResult<string> {
  const parsed = parseTrimmedString(value, "Email", 320);
  if (!parsed.ok) return parsed;
  const email = parsed.value.toLowerCase();
  if (!EMAIL_PATTERN.test(email)) return fail("Enter a valid email address.");
  return { ok: true, value: email };
}

export function parseFieldIds(
  value: unknown,
  knownFieldIds: readonly number[],
): ParseResult<number[]> {
  if (!Array.isArray(value)) return fail("Choose at least one field.");
  const ids: number[] = [];
  for (const entry of value) {
    const id = typeof entry === "string" ? Number(entry) : entry;
    if (typeof id !== "number" || !Number.isInteger(id)) return fail("Field selection is invalid.");
    if (!knownFieldIds.includes(id)) return fail("Field selection is invalid.");
    if (!ids.includes(id)) ids.push(id);
  }
  if (ids.length === 0) return fail("Choose at least one field.");
  if (ids.length > MAX_FIELDS_PER_USER) {
    return fail(`Choose at most ${MAX_FIELDS_PER_USER} fields.`);
  }
  return { ok: true, value: ids };
}

export function parseSignupInput(
  value: unknown,
  knownFieldIds: readonly number[],
): ParseResult<SignupInput> {
  const record = asRecord(value);
  if (!record) return fail("The signup request is invalid.");

  const email = parseEmail(record.email);
  if (!email.ok) return email;

  if (typeof record.password !== "string") return fail("Password is required.");
  if (record.password.length < MIN_PASSWORD_LENGTH) {
    return fail(`Use a password with at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  if (record.password.length > MAX_PASSWORD_LENGTH) {
    return fail(`Use a password with no more than ${MAX_PASSWORD_LENGTH.toLocaleString()} characters.`);
  }

  let name: string | null = null;
  if (record.name !== undefined && record.name !== null && record.name !== "") {
    const parsedName = parseTrimmedString(record.name, "Name", 200);
    if (!parsedName.ok) return parsedName;
    name = parsedName.value;
  }

  const role = parseRole(record.role);
  if (!role.ok) return role;

  const fieldIds = parseFieldIds(record.fieldIds, knownFieldIds);
  if (!fieldIds.ok) return fieldIds;

  return {
    ok: true,
    value: { email: email.value, password: record.password, name, role: role.value, fieldIds: fieldIds.value },
  };
}

export function parseOnboardingInput(
  value: unknown,
  knownFieldIds: readonly number[],
): ParseResult<OnboardingInput> {
  const record = asRecord(value);
  if (!record) return fail("The onboarding request is invalid.");

  const role = parseRole(record.role);
  if (!role.ok) return role;

  const fieldIds = parseFieldIds(record.fieldIds, knownFieldIds);
  if (!fieldIds.ok) return fieldIds;

  return { ok: true, value: { role: role.value, fieldIds: fieldIds.value } };
}

export function parseLiteratureInput(
  value: unknown,
  knownFieldIds: readonly number[],
): ParseResult<LiteratureInput> {
  const record = asRecord(value);
  if (!record) return fail("The literature request is invalid.");

  const fieldIds = parseFieldIds([record.fieldId], knownFieldIds);
  if (!fieldIds.ok) return fail("Choose one of your fields for this article.");
  const fieldId = fieldIds.value[0];
  if (fieldId === undefined) return fail("Choose one of your fields for this article.");

  const title = parseTrimmedString(record.title, "Title", 500);
  if (!title.ok) return title;
  const authors = parseTrimmedString(record.authors, "Authors", 1_000);
  if (!authors.ok) return authors;
  const journal = parseTrimmedString(record.journal, "Journal", 300);
  if (!journal.ok) return journal;

  const year = typeof record.year === "string" ? Number(record.year) : record.year;
  if (typeof year !== "number" || !Number.isInteger(year) || year < 1800 || year > 2100) {
    return fail("Enter a publication year between 1800 and 2100.");
  }

  let doi: string | null = null;
  if (record.doi !== undefined && record.doi !== null && record.doi !== "") {
    const parsedDoi = parseTrimmedString(record.doi, "DOI", 300);
    if (!parsedDoi.ok) return parsedDoi;
    if (!DOI_PATTERN.test(parsedDoi.value)) {
      return fail('Enter a DOI such as "10.1000/xyz123".');
    }
    doi = parsedDoi.value;
  }

  let pubmedUrl: string | null = null;
  if (record.pubmedUrl !== undefined && record.pubmedUrl !== null && record.pubmedUrl !== "") {
    const parsedUrl = parseTrimmedString(record.pubmedUrl, "PubMed URL", 500);
    if (!parsedUrl.ok) return parsedUrl;
    if (!PUBMED_URL_PATTERN.test(parsedUrl.value)) {
      return fail("Enter a link that starts with https://pubmed.ncbi.nlm.nih.gov/.");
    }
    pubmedUrl = parsedUrl.value;
  }

  if (!doi && !pubmedUrl) return fail("Provide a DOI or a PubMed link.");

  return {
    ok: true,
    value: {
      fieldId,
      title: title.value,
      authors: authors.value,
      journal: journal.value,
      year,
      doi,
      pubmedUrl,
    },
  };
}
