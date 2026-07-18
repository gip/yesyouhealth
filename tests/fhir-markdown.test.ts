import assert from "node:assert/strict";
import test from "node:test";

import { fhirToMarkdown } from "../lib/fhir-markdown";

const patient = {
  resourceType: "Patient",
  id: "patient-1",
  name: [{ use: "official", given: ["Alex"], family: "Rivera" }],
  birthDate: "1980-02-03",
  gender: "other",
  meta: { versionId: "4", lastUpdated: "2025-01-01T00:00:00Z" },
};

test("creates a TOC, renders facts once, and orders clinical events newest first", () => {
  const markdown = fhirToMarkdown({
    resourceType: "Bundle",
    type: "collection",
    entry: [
      { resource: patient },
      {
        resource: {
          resourceType: "Condition",
          id: "condition-1",
          subject: { reference: "Patient/patient-1", display: "Alex Rivera" },
          code: { text: "Asthma" },
          clinicalStatus: { text: "active" },
          onsetDateTime: "2020-05-10",
          meta: { versionId: "7" },
        },
      },
      {
        resource: {
          resourceType: "Observation",
          id: "observation-1",
          subject: { reference: "Patient/patient-1" },
          code: { text: "Hemoglobin A1c" },
          valueQuantity: { value: 5.4, unit: "%" },
          effectiveDateTime: "2024-01-12T09:30:00Z",
          status: "final",
        },
      },
    ],
  });

  assert.match(markdown, /## Table of Contents/);
  assert.match(markdown, /- \[Patient facts\]\(#patient-facts\)/);
  assert.match(markdown, /  - \[Labs and tests\]\(#labs-and-tests\)/);
  assert.match(markdown, /## Patient facts\n\n- \*\*Name:\*\* Alex Rivera/);
  assert.equal(markdown.match(/Alex Rivera/g)?.length, 1);
  assert.equal(markdown.match(/1980-02-03/g)?.length, 1);
  assert.ok(markdown.indexOf("Hemoglobin A1c") < markdown.indexOf("Asthma"));
  assert.doesNotMatch(markdown, /patient-1|versionId|lastUpdated|subject/);
});

test("supports grouped exports and removes duplicate resources and fields", () => {
  const duplicateCondition = {
    resourceType: "Condition",
    id: "condition-1",
    code: {
      coding: [
        { system: "http://snomed.info/sct", code: "44054006", display: "Diabetes mellitus" },
      ],
    },
    clinicalStatus: { text: "active" },
    onsetDateTime: "2021-03-01",
  };
  const markdown = fhirToMarkdown({
    data: {
      Patient: patient,
      Condition: [
        duplicateCondition,
        { ...duplicateCondition, meta: { source: "duplicate" } },
      ],
      Observation: [
        {
          resourceType: "Observation",
          code: { text: "Blood pressure" },
          effectiveDateTime: "2025-06-15",
          status: "final",
          component: [
            { code: { text: "Systolic" }, valueQuantity: { value: 120, unit: "mmHg" } },
            { code: { text: "Diastolic" }, valueQuantity: { value: 80, unit: "mmHg" } },
          ],
        },
      ],
    },
    errors: { ignored: "not a resource" },
  });

  assert.equal(markdown.match(/Condition: Diabetes mellitus/g)?.length, 1);
  assert.match(markdown, /\*\*Components:\*\* Systolic: 120 mmHg, Diastolic: 80 mmHg/);
  assert.doesNotMatch(markdown, /snomed|44054006|duplicate/);
});

test("uses an undated section and rejects input without FHIR resources", () => {
  const markdown = fhirToMarkdown({
    Condition: [{
      resourceType: "Condition",
      code: { text: "Migraine" },
    }],
  });
  assert.match(markdown, /### Conditions and allergies/);
  assert.match(markdown, /#### Date of service: Date of service not available/);
  assert.match(markdown, /- \*\*Condition: Migraine\*\*/);
  assert.throws(
    () => fhirToMarkdown({ hello: "world" }),
    /did not contain any FHIR resources/,
  );
});

test("groups encounter-linked records and reports attachment availability", () => {
  const markdown = fhirToMarkdown({
    resourceType: "Bundle",
    entry: [
      { resource: patient },
      {
        resource: {
          resourceType: "Encounter",
          id: "encounter-1",
          status: "finished",
          type: [{ text: "Outpatient" }, { text: "Video Visit" }],
          period: {
            start: "2023-12-22T18:00:00Z",
            end: "2023-12-22T18:30:00Z",
          },
        },
      },
      {
        resource: {
          resourceType: "Condition",
          id: "condition-encounter",
          encounter: { reference: "Encounter/encounter-1" },
          code: { text: "Ulcerative colitis" },
          clinicalStatus: { text: "active" },
          recordedDate: "2023-12-22",
        },
      },
      {
        resource: {
          resourceType: "DocumentReference",
          id: "summary-1",
          date: "2026-07-17T05:46:27Z",
          type: { text: "Encounter Summary" },
          context: { encounter: [{ reference: "Encounter/encounter-1" }] },
          content: [{
            attachment: {
              contentType: "application/xml",
              url: "Binary/missing-summary",
            },
          }],
        },
      },
      {
        resource: {
          resourceType: "DocumentReference",
          id: "rtf-note",
          date: "2023-12-22T18:26:00Z",
          type: { text: "Procedure Notes" },
          context: { encounter: { reference: "Encounter/encounter-1" } },
          content: [{
            attachment: {
              contentType: "text/rtf",
              url: "Binary/rtf-note",
            },
          }],
        },
      },
      {
        resource: {
          resourceType: "Binary",
          id: "rtf-note",
          contentType: "text/rtf",
          data: Buffer.from(
            String.raw`{\rtf1\ansi Procedure completed.\par Follow-up in 2 weeks.}`,
          ).toString("base64"),
        },
      },
      {
        resource: {
          resourceType: "Encounter",
          id: "encounter-2",
          status: "finished",
          type: [{ text: "Office Visit" }],
          period: { start: "2024-01-10T10:00:00Z" },
        },
      },
      {
        resource: {
          resourceType: "DocumentReference",
          id: "summary-2",
          date: "2026-07-17T05:46:27Z",
          type: { text: "Encounter Summary" },
          context: { encounter: [{ reference: "Encounter/encounter-2" }] },
          content: [{
            attachment: {
              contentType: "application/xml",
              url: "Binary/missing-summary-2",
            },
          }],
        },
      },
      {
        resource: {
          resourceType: "DocumentReference",
          id: "instructions-1",
          date: "2023-12-22T18:25:00Z",
          type: { text: "Patient Instructions" },
          context: { encounter: { reference: "Encounter/encounter-1" } },
          content: [{
            attachment: {
              contentType: "text/html",
              data: Buffer.from("<p>Continue the prescribed medication.</p>").toString("base64"),
            },
          }],
        },
      },
    ],
  });

  assert.match(markdown, /### Encounters/);
  assert.match(markdown, /#### December 22, 2023, 6:00 PM — Video Visit/);
  assert.match(markdown, /##### Conditions and allergies/);
  assert.match(markdown, /Condition: Ulcerative colitis/);
  assert.match(markdown, /##### Notes, AVS, and other clinical documents/);
  assert.match(markdown, /Clinical document: Encounter Summary/);
  assert.match(markdown, /\*\*Document date:\*\* July 17, 2026, 5:46 AM/);
  assert.match(markdown, /XML — referenced, but content is not included in the input/);
  assert.match(markdown, /Clinical document: Patient Instructions/);
  assert.match(markdown, /Continue the prescribed medication/);
  assert.match(markdown, /Clinical document: Procedure Notes/);
  assert.match(markdown, /Procedure completed/);
  assert.match(markdown, /Follow-up in 2 weeks/);
  assert.equal(markdown.match(/Clinical document: Encounter Summary/g)?.length, 2);
  assert.doesNotMatch(markdown, /^### Clinical documents$/m);
});
