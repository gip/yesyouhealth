import assert from "node:assert/strict";
import test from "node:test";

import type { HealthExportDocument } from "../lib/browser-flow";
import {
  compactIdentifier,
  getResourceGroups,
  patientDisplayName,
  renderedFields,
  resourceTitle,
} from "../lib/explore";

const healthExport: HealthExportDocument = {
  schemaVersion: 1,
  exportedAt: "2026-07-17T00:00:00.000Z",
  exportedBy: "YesYou Health",
  source: {
    provider: "Test Health",
    fhirBase: "https://example.test/FHIR/R4/",
    patientId: "patient-1",
  },
  purpose: "Test",
  data: {
    Patient: {
      resourceType: "Patient",
      id: "patient-1",
      name: [{ given: ["Ada"], family: "Lovelace" }],
      birthDate: "1815-12-10",
    },
    Observation: [
      {
        resourceType: "Observation",
        id: "observation-1",
        status: "final",
        code: { text: "Heart rate" },
        valueQuantity: { value: 72, unit: "beats/minute" },
      },
    ],
    Condition: [
      {
        resourceType: "Condition",
        id: "condition-1",
        code: { coding: [{ display: "Example condition" }] },
      },
    ],
  },
  errors: {},
  priorAuthorizations: [
    {
      resourceType: "ExplanationOfBenefit",
      id: "authorization-1",
      use: "preauthorization",
    },
  ],
  limitations: [],
};

test("groups imported FHIR resources in a patient-friendly order", () => {
  const groups = getResourceGroups(healthExport);
  assert.deepEqual(groups.map((group) => group.key), [
    "Patient",
    "Condition",
    "Observation",
    "PriorAuthorization",
  ]);
  assert.deepEqual(groups.map((group) => group.resources.length), [1, 1, 1, 1]);
});

test("derives the patient name and resource title from FHIR values", () => {
  assert.equal(patientDisplayName(healthExport), "Ada Lovelace");
  const observation = healthExport.data.Observation as Record<string, unknown>[];
  assert.equal(resourceTitle(observation[0]!, "Observation"), "Heart rate");
});

test("compacts long clinical-note identifiers in titles", () => {
  const identifier = "e6Ix2KZKPrt2LcBOuT9Kf75ok7scHIst8laPkVH9AZWw3";
  assert.equal(compactIdentifier(identifier), "e6Ix...ZWw3");
  assert.equal(
    resourceTitle(
      { resourceType: "Binary", id: identifier, title: "Visit note" },
      "Clinical-note file",
    ),
    "e6Ix...ZWw3",
  );
});

test("renders common Observation fields without changing the source resource", () => {
  const observation = (healthExport.data.Observation as Record<string, unknown>[])[0]!;
  assert.deepEqual(renderedFields(observation), [
    { label: "Status", value: "final" },
    { label: "Identifier", value: "observation-1" },
    { label: "Observation", value: "Heart rate" },
    { label: "Value", value: "72 beats/minute" },
  ]);
});

test("exposes stored clinical-note files as Binary resources with their lookup key", () => {
  const groups = getResourceGroups({
    ...healthExport,
    attachments: [{
      key: "note-key",
      binaryId: "note-1",
      contentType: "text/plain",
      size: 17,
      title: "Visit note",
    }],
  });
  const noteGroup = groups.find((group) => group.key === "Binary");

  assert.deepEqual(noteGroup, {
    key: "Binary",
    label: "Clinical-note files",
    resources: [{
      resourceType: "Binary",
      id: "note-1",
      key: "note-key",
      contentType: "text/plain",
      size: 17,
      title: "Visit note",
    }],
  });
});
