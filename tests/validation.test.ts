import assert from "node:assert/strict";
import test from "node:test";

import {
  parseFieldIds,
  parseLiteratureInput,
  parseOnboardingInput,
  parseSignupInput,
} from "../lib/server/validation";

const FIELD_IDS = [1, 2, 3, 4, 5, 6, 7, 8];

const validSignup = {
  email: "Pat@Example.com",
  password: "a-long-enough-password",
  name: "  Pat Doe  ",
  role: "patient",
  fieldIds: [1, 3],
};

test("accepts a valid signup and normalizes email and name", () => {
  const result = parseSignupInput(validSignup, FIELD_IDS);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.email, "pat@example.com");
  assert.equal(result.value.name, "Pat Doe");
  assert.equal(result.value.role, "patient");
  assert.deepEqual(result.value.fieldIds, [1, 3]);
});

test("rejects signup problems", () => {
  assert.equal(parseSignupInput(null, FIELD_IDS).ok, false);
  assert.equal(parseSignupInput({ ...validSignup, email: "nope" }, FIELD_IDS).ok, false);
  assert.equal(parseSignupInput({ ...validSignup, password: "short" }, FIELD_IDS).ok, false);
  assert.equal(parseSignupInput({ ...validSignup, role: "admin" }, FIELD_IDS).ok, false);
  assert.equal(parseSignupInput({ ...validSignup, fieldIds: [] }, FIELD_IDS).ok, false);
  assert.equal(parseSignupInput({ ...validSignup, fieldIds: [1, 2, 3] }, FIELD_IDS).ok, false);
  assert.equal(parseSignupInput({ ...validSignup, fieldIds: [99] }, FIELD_IDS).ok, false);
});

test("field ids accept numeric strings and drop duplicates", () => {
  const result = parseFieldIds(["2", 2], FIELD_IDS);
  assert.deepEqual(result, { ok: true, value: [2] });
  assert.equal(parseFieldIds("2", FIELD_IDS).ok, false);
  assert.equal(parseFieldIds([1.5], FIELD_IDS).ok, false);
});

test("onboarding requires role and one or two known fields", () => {
  const ok = parseOnboardingInput({ role: "doctor", fieldIds: [2] }, FIELD_IDS);
  assert.deepEqual(ok, { ok: true, value: { role: "doctor", fieldIds: [2] } });
  assert.equal(parseOnboardingInput({ role: "doctor", fieldIds: [] }, FIELD_IDS).ok, false);
  assert.equal(parseOnboardingInput({ fieldIds: [2] }, FIELD_IDS).ok, false);
});

const validLiterature = {
  fieldId: 2,
  title: "Effects of X on Y",
  authors: "Doe J, Roe R",
  journal: "The Journal",
  year: 2021,
  doi: "10.1000/xyz123",
};

test("accepts literature with a DOI only", () => {
  const result = parseLiteratureInput(validLiterature, FIELD_IDS);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.doi, "10.1000/xyz123");
  assert.equal(result.value.pubmedUrl, null);
});

test("accepts literature with a PubMed link only", () => {
  const result = parseLiteratureInput(
    { ...validLiterature, doi: "", pubmedUrl: "https://pubmed.ncbi.nlm.nih.gov/12345678/" },
    FIELD_IDS,
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.doi, null);
  assert.equal(result.value.pubmedUrl, "https://pubmed.ncbi.nlm.nih.gov/12345678/");
});

test("rejects literature problems", () => {
  assert.equal(parseLiteratureInput({ ...validLiterature, doi: "" }, FIELD_IDS).ok, false);
  assert.equal(parseLiteratureInput({ ...validLiterature, doi: "doi:10.1/x" }, FIELD_IDS).ok, false);
  assert.equal(
    parseLiteratureInput({ ...validLiterature, doi: "", pubmedUrl: "https://example.com/paper" }, FIELD_IDS).ok,
    false,
  );
  assert.equal(parseLiteratureInput({ ...validLiterature, year: 1700 }, FIELD_IDS).ok, false);
  assert.equal(parseLiteratureInput({ ...validLiterature, title: "" }, FIELD_IDS).ok, false);
  assert.equal(parseLiteratureInput({ ...validLiterature, fieldId: 99 }, FIELD_IDS).ok, false);
});

test("literature accepts string year from form input", () => {
  const result = parseLiteratureInput({ ...validLiterature, year: "2021" }, FIELD_IDS);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.year, 2021);
});
