import assert from "node:assert/strict";
import test from "node:test";

import {
  FhirError,
  buildAuthorizationUrl,
  createPkce,
  exportPatientRecord,
  normalizeFhirBase,
  safeBinaryUrl,
  safeNextUrl,
  smartConfigurationUrl,
} from "../lib/epic";

test("normalizes UCSF-style FHIR base URLs", () => {
  assert.equal(
    normalizeFhirBase("https://unified-api.ucsf.edu/clinical/apex/api/FHIR/R4"),
    "https://unified-api.ucsf.edu/clinical/apex/api/FHIR/R4/",
  );
});

test("constructs the SMART discovery URL", () => {
  assert.equal(
    smartConfigurationUrl("https://example.test/api/FHIR/R4/"),
    "https://example.test/api/FHIR/R4/.well-known/smart-configuration",
  );
});

test("creates an S256 PKCE pair", async () => {
  const { verifier, challenge } = await createPkce();
  assert.ok(verifier.length >= 43);
  assert.ok(challenge.length >= 43);
  assert.notEqual(verifier, challenge);
});

test("authorization URL contains patient context, state, aud and PKCE", () => {
  const url = new URL(
    buildAuthorizationUrl({
      authorizationEndpoint: "https://example.test/oauth2/authorize",
      clientId: "client",
      redirectUri: "https://yyc.example/callback",
      scope: "openid launch/patient patient/*.rs",
      fhirBase: "https://example.test/api/FHIR/R4/",
      state: "state-value",
      challenge: "challenge-value",
    }),
  );
  assert.equal(url.searchParams.get("state"), "state-value");
  assert.equal(url.searchParams.get("aud"), "https://example.test/api/FHIR/R4/");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.match(url.searchParams.get("scope") ?? "", /launch\/patient/);
});

test("pagination accepts relative links inside the FHIR base", () => {
  assert.equal(
    safeNextUrl(
      "?page=2",
      "https://example.test/api/FHIR/R4/Observation?patient=1",
      "https://example.test/api/FHIR/R4/",
    ),
    "https://example.test/api/FHIR/R4/Observation?page=2",
  );
});

test("pagination rejects cross-origin links", () => {
  assert.throws(
    () =>
      safeNextUrl(
        "https://attacker.test/token",
        "https://example.test/api/FHIR/R4/Observation",
        "https://example.test/api/FHIR/R4/",
      ),
    FhirError,
  );
});

test("Binary attachment URLs must remain inside the configured FHIR base", () => {
  assert.equal(
    safeBinaryUrl("Binary/note-1", "https://example.test/api/FHIR/R4/"),
    "https://example.test/api/FHIR/R4/Binary/note-1",
  );
  assert.throws(
    () => safeBinaryUrl("https://attacker.test/Binary/note-1", "https://example.test/api/FHIR/R4/"),
    FhirError,
  );
  assert.throws(
    () => safeBinaryUrl("Patient/patient-1", "https://example.test/api/FHIR/R4/"),
    FhirError,
  );
});

test("uses Epic's required CarePlan and Observation search categories", async (t) => {
  const originalFetch = globalThis.fetch;
  const requestedUrls: URL[] = [];
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    requestedUrls.push(url);

    if (url.pathname.endsWith("/Patient/patient-1")) {
      return Response.json({ resourceType: "Patient", id: "patient-1" });
    }
    if (url.pathname.endsWith("/ExplanationOfBenefit")) {
      return Response.json(
        {
          resourceType: "OperationOutcome",
          issue: [{ diagnostics: "Client not authorized for ExplanationOfBenefit - Prior Auth." }],
        },
        { status: 400 },
      );
    }

    const category = url.searchParams.get("category");
    const entries =
      url.pathname.endsWith("/Observation") && category
        ? [{
            resource: {
              resourceType: "Observation",
              id: category === "laboratory" ? "laboratory" : "vital-sign",
            },
          }]
        : [];
    return Response.json({ resourceType: "Bundle", type: "searchset", entry: entries });
  };

  const record = await exportPatientRecord({
    fhirBase: "https://example.test/api/FHIR/R4/",
    patientId: "patient-1",
    accessToken: "token",
  });

  const carePlanUrl = requestedUrls.find((url) => url.pathname.endsWith("/CarePlan"));
  assert.equal(carePlanUrl?.searchParams.get("category"), "38717003");

  const observationCategories = requestedUrls
    .filter((url) => url.pathname.endsWith("/Observation"))
    .map((url) => url.searchParams.get("category"))
    .sort();
  assert.deepEqual(observationCategories, ["laboratory", "social-history", "vital-signs"]);

  const observations = record.data.Observation as Record<string, unknown>[];
  assert.deepEqual(
    observations.map((observation) => observation.id).sort(),
    ["laboratory", "vital-sign"],
  );
  assert.ok(requestedUrls.some((url) => url.pathname.endsWith("/MedicationDispense")));
  assert.ok(requestedUrls.some((url) => url.pathname.endsWith("/QuestionnaireResponse")));
  assert.ok(requestedUrls.some((url) => url.pathname.endsWith("/ServiceRequest")));
  assert.match(record.errors.PriorAuthorization ?? "", /Enable that API in the Epic app registration/);
});

test("skips prior authorization searches when the organization disables them", async (t) => {
  const originalFetch = globalThis.fetch;
  const requestedUrls: URL[] = [];
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (input) => {
    requestedUrls.push(new URL(String(input)));
    const url = new URL(String(input));
    if (url.pathname.endsWith("/Patient/patient-1")) {
      return Response.json({ resourceType: "Patient", id: "patient-1" });
    }
    return Response.json({ resourceType: "Bundle", type: "searchset" });
  };

  await exportPatientRecord({
    fhirBase: "https://example.test/api/FHIR/R4/",
    patientId: "patient-1",
    accessToken: "token",
    includePriorAuthorizations: false,
  });

  assert.equal(
    requestedUrls.some((url) => url.pathname.endsWith("/ExplanationOfBenefit")),
    false,
  );
});

test("streams resources and bounded Binary note content without retaining the record", async (t) => {
  const originalFetch = globalThis.fetch;
  const groups: string[] = [];
  const attachments: { id: string; content: string }[] = [];
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/Patient/patient-1")) {
      return Response.json({ resourceType: "Patient", id: "patient-1" });
    }
    if (url.pathname.endsWith("/DocumentReference")) {
      return Response.json({
        resourceType: "Bundle",
        type: "searchset",
        entry: [{
          resource: {
            resourceType: "DocumentReference",
            id: "document-1",
            description: "Visit note",
            content: [{
              attachment: {
                contentType: "text/plain",
                url: "Binary/note-1",
              },
            }],
          },
        }],
      });
    }
    if (url.pathname.endsWith("/Binary/note-1")) {
      return new Response("Private note text", {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
    return Response.json({ resourceType: "Bundle", type: "searchset" });
  };

  const record = await exportPatientRecord({
    fhirBase: "https://example.test/api/FHIR/R4/",
    patientId: "patient-1",
    accessToken: "token",
    collectData: false,
    includeAttachments: true,
    onResources: (group) => {
      groups.push(group);
    },
    onAttachment: async (attachment) => {
      attachments.push({
        id: attachment.binaryId,
        content: await attachment.blob.text(),
      });
    },
  });

  assert.deepEqual(record.data, {});
  assert.ok(groups.includes("Patient"));
  assert.ok(groups.includes("DocumentReference"));
  assert.deepEqual(attachments, [{ id: "note-1", content: "Private note text" }]);
  assert.deepEqual(record.errors, {});
});
