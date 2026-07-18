import assert from "node:assert/strict";
import test from "node:test";

import "fake-indexeddb/auto";

import type { HealthExportDocument } from "../lib/browser-flow";
import { createBrowserEncryption } from "../lib/browser-encryption";
import {
  beginHealthImport,
  clearHealthExport,
  completeHealthImport,
  getHealthStorageState,
  loadHealthAttachments,
  loadHealthExport,
  lockHealthExport,
  storeHealthAttachment,
  storeHealthResourcePage,
  unlockHealthExport,
} from "../lib/browser-storage";

function idbResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

const document: HealthExportDocument = {
  schemaVersion: 1,
  exportedAt: "2026-07-18T12:00:00.000Z",
  exportedBy: "YesYou Health",
  source: {
    provider: "Private Provider Name",
    fhirBase: "https://example.test/FHIR/R4",
    patientId: "secret-patient-id",
  },
  purpose: "Test encrypted storage.",
  limitations: [],
  data: {
    Patient: {
      resourceType: "Patient",
      id: "secret-patient-id",
      name: [{ text: "Sensitive Patient Name" }],
    },
  },
  errors: {},
  priorAuthorizations: [],
  attachments: [],
};

test("stores only encrypted health content and requires the passphrase after locking", async () => {
  await clearHealthExport();
  const encryption = await createBrowserEncryption("storage test passphrase");
  const importId = await beginHealthImport(document, encryption);
  await storeHealthResourcePage(
    importId,
    "Patient",
    [document.data.Patient as Record<string, unknown>],
    encryption,
  );
  await storeHealthAttachment(
    importId,
    {
      key: "secret-attachment-key",
      binaryId: "secret-binary-id",
      contentType: "text/plain",
      blob: new Blob(["Sensitive attachment text"], { type: "text/plain" }),
    },
    encryption,
  );
  await completeHealthImport(importId, {}, encryption);

  assert.equal(await getHealthStorageState(), "unlocked");
  assert.equal(
    (await loadHealthExport())?.source.patientId,
    "secret-patient-id",
  );

  const database = await idbResult(indexedDB.open("yesyou-health", 3));
  const currentImportId = await idbResult(
    database.transaction("imports").objectStore("imports").get("current"),
  ) as string;
  const storedImport = await idbResult(
    database.transaction("imports").objectStore("imports").get(currentImportId),
  );
  const storedResources = await idbResult(
    database.transaction("resources").objectStore("resources").getAll(),
  );
  const storedAttachments = await idbResult(
    database.transaction("attachments").objectStore("attachments").getAll(),
  );
  database.close();

  const persistedShape = JSON.stringify({
    storedImport,
    storedResources,
    storedAttachments,
  });
  assert.doesNotMatch(persistedShape, /secret-patient-id/);
  assert.doesNotMatch(persistedShape, /Sensitive Patient Name/);
  assert.doesNotMatch(persistedShape, /Private Provider Name/);
  assert.doesNotMatch(persistedShape, /secret-binary-id|Sensitive attachment text/);
  assert.match(persistedShape, /argon2id/);

  lockHealthExport();
  assert.equal(await getHealthStorageState(), "locked");
  await assert.rejects(loadHealthExport(), /locked/);
  await assert.rejects(
    unlockHealthExport("incorrect storage passphrase"),
    /passphrase is incorrect|record is damaged/,
  );

  const unlocked = await unlockHealthExport("storage test passphrase");
  assert.equal(unlocked.source.patientId, "secret-patient-id");
  const [attachment] = await loadHealthAttachments();
  assert.equal(attachment?.binaryId, "secret-binary-id");
  assert.equal(await attachment?.blob.text(), "Sensitive attachment text");
  await clearHealthExport();
});
