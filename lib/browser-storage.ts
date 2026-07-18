import type {
  BrowserStorageSummary,
  HealthAttachmentSummary,
  HealthExportDocument,
} from "@/lib/browser-flow";
import {
  decryptBytes,
  decryptJson,
  encryptBytes,
  encryptJson,
  isEncryptedPayload,
  isEncryptionMetadata,
  unlockBrowserEncryption,
  type BrowserEncryptionContext,
  type EncryptedPayload,
  type EncryptionMetadata,
} from "@/lib/browser-encryption";
import type { BinaryAttachment, JsonObject } from "@/lib/epic";
import type {
  DeidRecordResult,
  LongitudinalStudy,
  StudyComment,
  StudyRecord,
} from "@/lib/study";

const DATABASE_NAME = "yesyou-health";
const DATABASE_VERSION = 4;
// Versions below this stored health data in plaintext and are wiped on upgrade.
const FIRST_ENCRYPTED_VERSION = 3;
const LEGACY_EXPORT_STORE = "exports";
const IMPORT_STORE = "imports";
const RESOURCE_STORE = "resources";
const ATTACHMENT_STORE = "attachments";
const STUDY_STORE = "studies";
const CURRENT_IMPORT_KEY = "current";
const IMPORT_INDEX = "by-import";
const ENCRYPTED_FORMAT = "encrypted-v1";
const KEY_CHECK_VALUE = "yesyou-health-storage-key-v1";

interface StoredEncryptedImport {
  format: typeof ENCRYPTED_FORMAT;
  importId: string;
  encryption: EncryptionMetadata;
  keyCheck: EncryptedPayload;
  document: EncryptedPayload;
  complete: boolean;
}

interface StoredEncryptedResource {
  importId: string;
  sequence: string;
  payload: EncryptedPayload;
}

interface StoredEncryptedAttachment {
  importId: string;
  sequence: string;
  metadata: EncryptedPayload;
  payload: EncryptedPayload;
}

interface StoredEncryptedStudy {
  format: typeof ENCRYPTED_FORMAT;
  importId: string;
  payload: EncryptedPayload;
}

interface EncryptedResourceContent {
  group: string;
  resource: JsonObject;
}

interface EncryptedAttachmentMetadata extends HealthAttachmentSummary {}

export interface StoredHealthAttachment extends HealthAttachmentSummary {
  importId: string;
  blob: Blob;
}

export type HealthStorageState = "empty" | "locked" | "unlocked";

let activeEncryption:
  | { importId: string; context: BrowserEncryptionContext }
  | undefined;

function createStores(database: IDBDatabase): void {
  database.createObjectStore(LEGACY_EXPORT_STORE);
  database.createObjectStore(IMPORT_STORE);

  const resources = database.createObjectStore(RESOURCE_STORE, {
    keyPath: ["importId", "sequence"],
  });
  resources.createIndex(IMPORT_INDEX, "importId");

  const attachments = database.createObjectStore(ATTACHMENT_STORE, {
    keyPath: ["importId", "sequence"],
  });
  attachments.createIndex(IMPORT_INDEX, "importId");

  database.createObjectStore(STUDY_STORE);
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("Local browser storage is not available."));
      return;
    }

    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = (event) => {
      const database = request.result;

      // Versions 1 and 2 stored health data in plaintext. Delete those stores
      // during the security upgrade so plaintext can never be opened or retained.
      // Encrypted-era upgrades (v3 -> v4 added the studies store) must NOT wipe.
      if (event.oldVersion > 0 && event.oldVersion < FIRST_ENCRYPTED_VERSION) {
        for (const storeName of [
          LEGACY_EXPORT_STORE,
          IMPORT_STORE,
          RESOURCE_STORE,
          ATTACHMENT_STORE,
          STUDY_STORE,
        ]) {
          if (database.objectStoreNames.contains(storeName)) {
            database.deleteObjectStore(storeName);
          }
        }
      }

      if (!database.objectStoreNames.contains(IMPORT_STORE)) createStores(database);
      else if (!database.objectStoreNames.contains(STUDY_STORE)) {
        database.createObjectStore(STUDY_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(
      request.error ?? new Error("Could not open encrypted local browser storage."),
    );
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(
      request.error ?? new Error("An encrypted browser storage request failed."),
    );
  });
}

function transactionComplete(transaction: IDBTransaction, message: string): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error(message));
    transaction.onabort = () => reject(transaction.error ?? new Error(message));
  });
}

function storageError(error: unknown, fallback: string): Error {
  if (error instanceof DOMException && error.name === "QuotaExceededError") {
    return new Error(
      "This browser does not have enough local storage for the encrypted record. " +
      "Remove an older import, exclude clinical-note files, or free device storage and try again.",
    );
  }
  return error instanceof Error ? error : new Error(fallback);
}

function importAad(importId: string, field: "document" | "key-check"): string {
  return `yesyou-health:${importId}:import:${field}`;
}

function resourceAad(importId: string, sequence: string): string {
  return `yesyou-health:${importId}:resource:${sequence}`;
}

function attachmentAad(
  importId: string,
  sequence: string,
  field: "metadata" | "payload",
): string {
  return `yesyou-health:${importId}:attachment:${sequence}:${field}`;
}

function studyAad(importId: string): string {
  return `yesyou-health:${importId}:study`;
}

function isStoredEncryptedImport(value: unknown): value is StoredEncryptedImport {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const stored = value as Record<string, unknown>;
  return (
    stored.format === ENCRYPTED_FORMAT &&
    typeof stored.importId === "string" &&
    typeof stored.complete === "boolean" &&
    isEncryptionMetadata(stored.encryption) &&
    isEncryptedPayload(stored.keyCheck) &&
    isEncryptedPayload(stored.document)
  );
}

async function currentImportId(database: IDBDatabase): Promise<string | undefined> {
  const transaction = database.transaction(IMPORT_STORE, "readonly");
  const value = await requestResult(transaction.objectStore(IMPORT_STORE).get(CURRENT_IMPORT_KEY));
  return typeof value === "string" ? value : undefined;
}

async function storedImport(
  database: IDBDatabase,
  importId: string,
): Promise<StoredEncryptedImport | undefined> {
  const transaction = database.transaction(IMPORT_STORE, "readonly");
  const value: unknown = await requestResult(
    transaction.objectStore(IMPORT_STORE).get(importId),
  );
  if (value === undefined) return undefined;
  if (!isStoredEncryptedImport(value)) {
    throw new Error(
      "Unencrypted or unsupported local health data was found and cannot be opened. Remove it and import again.",
    );
  }
  return value;
}

function activeContext(importId: string): BrowserEncryptionContext {
  if (activeEncryption?.importId !== importId) {
    throw new Error("This health record is locked. Enter its storage passphrase to open it.");
  }
  return activeEncryption.context;
}

async function deleteImportData(database: IDBDatabase, importId: string): Promise<void> {
  const transaction = database.transaction(
    [IMPORT_STORE, RESOURCE_STORE, ATTACHMENT_STORE, STUDY_STORE],
    "readwrite",
  );
  transaction.objectStore(IMPORT_STORE).delete(importId);
  transaction.objectStore(STUDY_STORE).delete(importId);

  for (const storeName of [RESOURCE_STORE, ATTACHMENT_STORE]) {
    const index = transaction.objectStore(storeName).index(IMPORT_INDEX);
    const request = index.openKeyCursor(IDBKeyRange.only(importId));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      transaction.objectStore(storeName).delete(cursor.primaryKey);
      cursor.continue();
    };
  }
  await transactionComplete(transaction, "Could not remove staged encrypted browser data.");
}

export async function prepareBrowserStorage(): Promise<BrowserStorageSummary> {
  if (typeof navigator === "undefined" || !navigator.storage) {
    return { persistent: false };
  }

  let persistent = false;
  try {
    persistent = await navigator.storage.persisted();
    if (!persistent) persistent = await navigator.storage.persist();
  } catch {
    persistent = false;
  }

  try {
    const estimate = await navigator.storage.estimate();
    return {
      persistent,
      ...(typeof estimate.quota === "number" ? { quota: estimate.quota } : {}),
      ...(typeof estimate.usage === "number" ? { usage: estimate.usage } : {}),
    };
  } catch {
    return { persistent };
  }
}

export async function beginHealthImport(
  document: HealthExportDocument,
  encryption: BrowserEncryptionContext,
  browserStorage?: BrowserStorageSummary,
): Promise<string> {
  const database = await openDatabase();
  const importId = crypto.randomUUID();
  const storedDocument: HealthExportDocument = {
    ...document,
    data: {},
    errors: {},
    priorAuthorizations: [],
    attachments: [],
    ...(browserStorage ? { browserStorage } : {}),
  };

  try {
    const [keyCheck, encryptedDocument] = await Promise.all([
      encryptJson(KEY_CHECK_VALUE, encryption, importAad(importId, "key-check")),
      encryptJson(storedDocument, encryption, importAad(importId, "document")),
    ]);
    const transaction = database.transaction(
      [IMPORT_STORE, LEGACY_EXPORT_STORE],
      "readwrite",
    );
    transaction.objectStore(IMPORT_STORE).put(
      {
        format: ENCRYPTED_FORMAT,
        importId,
        encryption: encryption.metadata,
        keyCheck,
        document: encryptedDocument,
        complete: false,
      } satisfies StoredEncryptedImport,
      importId,
    );
    await transactionComplete(transaction, "Could not prepare encrypted local browser storage.");
    return importId;
  } catch (error) {
    throw storageError(error, "Could not prepare encrypted local browser storage.");
  } finally {
    database.close();
  }
}

export async function storeHealthResourcePage(
  importId: string,
  group: string,
  resources: JsonObject[],
  encryption: BrowserEncryptionContext,
): Promise<void> {
  if (!resources.length) return;
  const database = await openDatabase();
  try {
    const encryptedResources = await Promise.all(resources.map(async (resource) => {
      const sequence = crypto.randomUUID();
      return {
        importId,
        sequence,
        payload: await encryptJson(
          { group, resource } satisfies EncryptedResourceContent,
          encryption,
          resourceAad(importId, sequence),
        ),
      } satisfies StoredEncryptedResource;
    }));
    const transaction = database.transaction(RESOURCE_STORE, "readwrite");
    const store = transaction.objectStore(RESOURCE_STORE);
    for (const resource of encryptedResources) store.put(resource);
    await transactionComplete(transaction, `Could not save encrypted ${group} data.`);
  } catch (error) {
    throw storageError(error, `Could not save encrypted ${group} data.`);
  } finally {
    database.close();
  }
}

export async function storeHealthAttachment(
  importId: string,
  attachment: BinaryAttachment,
  encryption: BrowserEncryptionContext,
): Promise<void> {
  const database = await openDatabase();
  const sequence = crypto.randomUUID();
  const metadata: EncryptedAttachmentMetadata = {
    key: attachment.key,
    binaryId: attachment.binaryId,
    contentType: attachment.contentType,
    size: attachment.blob.size,
    ...(attachment.sourceDocumentReference
      ? { sourceDocumentReference: attachment.sourceDocumentReference }
      : {}),
    ...(attachment.title ? { title: attachment.title } : {}),
  };
  try {
    const [encryptedMetadata, encryptedPayload] = await Promise.all([
      encryptJson(
        metadata,
        encryption,
        attachmentAad(importId, sequence, "metadata"),
      ),
      attachment.blob.arrayBuffer().then((bytes) =>
        encryptBytes(
          bytes,
          encryption,
          attachmentAad(importId, sequence, "payload"),
        )),
    ]);
    const transaction = database.transaction(ATTACHMENT_STORE, "readwrite");
    transaction.objectStore(ATTACHMENT_STORE).put({
      importId,
      sequence,
      metadata: encryptedMetadata,
      payload: encryptedPayload,
    } satisfies StoredEncryptedAttachment);
    await transactionComplete(transaction, "Could not save an encrypted clinical-note attachment.");
  } catch (error) {
    throw storageError(error, "Could not save an encrypted clinical-note attachment.");
  } finally {
    database.close();
  }
}

export async function completeHealthImport(
  importId: string,
  errors: Record<string, string>,
  encryption: BrowserEncryptionContext,
): Promise<void> {
  const database = await openDatabase();
  let previousImportId: string | undefined;
  try {
    previousImportId = await currentImportId(database);
    const stored = await storedImport(database, importId);
    if (!stored) throw new Error("The staged encrypted browser import could not be found.");
    const document = await decryptJson<HealthExportDocument>(
      stored.document,
      encryption,
      importAad(importId, "document"),
    );
    const encryptedDocument = await encryptJson(
      { ...document, errors },
      encryption,
      importAad(importId, "document"),
    );

    const transaction = database.transaction(
      [IMPORT_STORE, LEGACY_EXPORT_STORE],
      "readwrite",
    );
    transaction.objectStore(IMPORT_STORE).put(
      { ...stored, complete: true, document: encryptedDocument } satisfies StoredEncryptedImport,
      importId,
    );
    transaction.objectStore(IMPORT_STORE).put(importId, CURRENT_IMPORT_KEY);
    transaction.objectStore(LEGACY_EXPORT_STORE).clear();
    await transactionComplete(transaction, "Could not finish saving the encrypted record.");
    activeEncryption = { importId, context: encryption };
  } catch (error) {
    throw storageError(error, "Could not finish saving the encrypted record.");
  } finally {
    database.close();
  }

  if (previousImportId && previousImportId !== importId) {
    const cleanupDatabase = await openDatabase();
    try {
      await deleteImportData(cleanupDatabase, previousImportId);
    } catch {
      // The new encrypted import is committed. Old-record cleanup is best-effort.
    } finally {
      cleanupDatabase.close();
    }
  }
}

export async function abortHealthImport(importId: string): Promise<void> {
  const database = await openDatabase();
  try {
    await deleteImportData(database, importId);
  } finally {
    database.close();
  }
}

export async function saveHealthExport(
  healthExport: HealthExportDocument,
  encryption: BrowserEncryptionContext,
): Promise<void> {
  const importId = await beginHealthImport(
    healthExport,
    encryption,
    healthExport.browserStorage,
  );
  try {
    for (const [group, value] of Object.entries(healthExport.data)) {
      const resources = Array.isArray(value) ? value : [value];
      await storeHealthResourcePage(
        importId,
        group,
        resources.filter(
          (resource): resource is JsonObject =>
            resource !== null && typeof resource === "object" && !Array.isArray(resource),
        ),
        encryption,
      );
    }
    await storeHealthResourcePage(
      importId,
      "PriorAuthorization",
      healthExport.priorAuthorizations,
      encryption,
    );
    await completeHealthImport(importId, healthExport.errors, encryption);
  } catch (error) {
    await abortHealthImport(importId);
    throw error;
  }
}

export async function getHealthStorageState(): Promise<HealthStorageState> {
  const database = await openDatabase();
  try {
    const importId = await currentImportId(database);
    if (!importId) return "empty";
    const stored = await storedImport(database, importId);
    if (!stored?.complete) return "empty";
    return activeEncryption?.importId === importId ? "unlocked" : "locked";
  } finally {
    database.close();
  }
}

export async function unlockHealthExport(
  passphrase: string,
): Promise<HealthExportDocument> {
  const database = await openDatabase();
  try {
    const importId = await currentImportId(database);
    if (!importId) throw new Error("No encrypted health record is stored in this browser.");
    const stored = await storedImport(database, importId);
    if (!stored?.complete) throw new Error("No complete encrypted health record was found.");

    const context = await unlockBrowserEncryption(passphrase, stored.encryption);
    const keyCheck = await decryptJson<string>(
      stored.keyCheck,
      context,
      importAad(importId, "key-check"),
    );
    if (keyCheck !== KEY_CHECK_VALUE) {
      throw new Error("The passphrase is incorrect or the encrypted local record is damaged.");
    }
    activeEncryption = { importId, context };
  } catch (error) {
    activeEncryption = undefined;
    throw error;
  } finally {
    database.close();
  }

  const healthExport = await loadHealthExport();
  if (!healthExport) throw new Error("No complete encrypted health record was found.");
  return healthExport;
}

async function encryptedAttachments(
  database: IDBDatabase,
  importId: string,
): Promise<StoredEncryptedAttachment[]> {
  const transaction = database.transaction(ATTACHMENT_STORE, "readonly");
  const values: unknown[] = await requestResult(
    transaction.objectStore(ATTACHMENT_STORE).index(IMPORT_INDEX).getAll(importId),
  );
  if (!values.every((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const item = value as Record<string, unknown>;
    return (
      item.importId === importId &&
      typeof item.sequence === "string" &&
      isEncryptedPayload(item.metadata) &&
      isEncryptedPayload(item.payload)
    );
  })) {
    throw new Error("The encrypted local attachments are damaged or unsupported.");
  }
  return values as StoredEncryptedAttachment[];
}

export async function loadHealthAttachments(
  importId?: string,
): Promise<StoredHealthAttachment[]> {
  const database = await openDatabase();
  try {
    const selectedImportId = importId ?? await currentImportId(database);
    if (!selectedImportId) return [];
    const context = activeContext(selectedImportId);
    const storedAttachments = await encryptedAttachments(database, selectedImportId);
    return await Promise.all(storedAttachments.map(async (attachment) => {
      const metadata = await decryptJson<EncryptedAttachmentMetadata>(
        attachment.metadata,
        context,
        attachmentAad(selectedImportId, attachment.sequence, "metadata"),
      );
      const plaintext = await decryptBytes(
        attachment.payload,
        context,
        attachmentAad(selectedImportId, attachment.sequence, "payload"),
      );
      return {
        ...metadata,
        importId: selectedImportId,
        blob: new Blob([plaintext], { type: metadata.contentType }),
      };
    }));
  } finally {
    database.close();
  }
}

export async function loadHealthAttachment(
  key: string,
  importId?: string,
): Promise<StoredHealthAttachment | undefined> {
  const attachments = await loadHealthAttachments(importId);
  return attachments.find((attachment) => attachment.key === key);
}

export async function loadHealthExport(): Promise<HealthExportDocument | undefined> {
  const database = await openDatabase();
  try {
    const importId = await currentImportId(database);
    if (!importId) return undefined;
    const stored = await storedImport(database, importId);
    if (!stored?.complete) return undefined;
    const context = activeContext(importId);

    const transaction = database.transaction(RESOURCE_STORE, "readonly");
    const storedResources = await requestResult(
      transaction.objectStore(RESOURCE_STORE).index(IMPORT_INDEX).getAll(importId),
    ) as StoredEncryptedResource[];
    if (!storedResources.every((item) =>
      item.importId === importId &&
      typeof item.sequence === "string" &&
      isEncryptedPayload(item.payload))) {
      throw new Error("The encrypted local resources are damaged or unsupported.");
    }

    const [document, decryptedResources, storedAttachments] = await Promise.all([
      decryptJson<HealthExportDocument>(
        stored.document,
        context,
        importAad(importId, "document"),
      ),
      Promise.all(storedResources.map((item) =>
        decryptJson<EncryptedResourceContent>(
          item.payload,
          context,
          resourceAad(importId, item.sequence),
        ))),
      encryptedAttachments(database, importId),
    ]);

    const data: Record<string, unknown> = {};
    let priorAuthorizations: JsonObject[] = [];
    const groups = new Map<string, JsonObject[]>();
    for (const item of decryptedResources) {
      const group = groups.get(item.group) ?? [];
      group.push(item.resource);
      groups.set(item.group, group);
    }
    for (const [group, groupResources] of groups) {
      if (group === "Patient") data.Patient = groupResources[0];
      else if (group === "PriorAuthorization") priorAuthorizations = groupResources;
      else data[group] = groupResources;
    }

    const summaries = await Promise.all(storedAttachments.map((attachment) =>
      decryptJson<EncryptedAttachmentMetadata>(
        attachment.metadata,
        context,
        attachmentAad(importId, attachment.sequence, "metadata"),
      )));
    return {
      ...document,
      data,
      priorAuthorizations,
      attachments: summaries,
    };
  } finally {
    database.close();
  }
}

function isStoredEncryptedStudy(value: unknown): value is StoredEncryptedStudy {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const stored = value as Record<string, unknown>;
  return (
    stored.format === ENCRYPTED_FORMAT &&
    typeof stored.importId === "string" &&
    isEncryptedPayload(stored.payload)
  );
}

async function putStudyRecord(record: StudyRecord): Promise<void> {
  const database = await openDatabase();
  try {
    const context = activeContext(record.importId);
    const payload = await encryptJson(record, context, studyAad(record.importId));
    const transaction = database.transaction(STUDY_STORE, "readwrite");
    transaction.objectStore(STUDY_STORE).put(
      {
        format: ENCRYPTED_FORMAT,
        importId: record.importId,
        payload,
      } satisfies StoredEncryptedStudy,
      record.importId,
    );
    await transactionComplete(transaction, "Could not save the encrypted longitudinal study.");
  } catch (error) {
    throw storageError(error, "Could not save the encrypted longitudinal study.");
  } finally {
    database.close();
  }
}

export async function storeStudy(
  study: LongitudinalStudy,
  extras?: { model?: string; deid?: DeidRecordResult },
): Promise<StudyRecord> {
  const database = await openDatabase();
  let importId: string | undefined;
  try {
    importId = await currentImportId(database);
  } finally {
    database.close();
  }
  if (!importId) throw new Error("No imported health record to attach the study to.");

  const record: StudyRecord = {
    id: crypto.randomUUID(),
    importId,
    createdAt: new Date().toISOString(),
    ...(extras?.model ? { model: extras.model } : {}),
    ...(extras?.deid ? { deid: extras.deid } : {}),
    study,
    comments: [],
  };
  await putStudyRecord(record);
  return record;
}

export async function loadCurrentStudy(): Promise<StudyRecord | undefined> {
  const database = await openDatabase();
  try {
    const importId = await currentImportId(database);
    if (!importId) return undefined;
    const context = activeContext(importId);
    const transaction = database.transaction(STUDY_STORE, "readonly");
    const value: unknown = await requestResult(
      transaction.objectStore(STUDY_STORE).get(importId),
    );
    if (value === undefined) return undefined;
    if (!isStoredEncryptedStudy(value)) {
      throw new Error("The encrypted local study is damaged or unsupported.");
    }
    return await decryptJson<StudyRecord>(value.payload, context, studyAad(importId));
  } finally {
    database.close();
  }
}

export async function updateStudyComments(comments: StudyComment[]): Promise<StudyRecord> {
  const record = await loadCurrentStudy();
  if (!record) throw new Error("No longitudinal study is stored for this record.");
  const updated: StudyRecord = { ...record, comments };
  await putStudyRecord(updated);
  return updated;
}

export function lockHealthExport(): void {
  activeEncryption = undefined;
}

export async function clearHealthExport(): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(
      [LEGACY_EXPORT_STORE, IMPORT_STORE, RESOURCE_STORE, ATTACHMENT_STORE, STUDY_STORE],
      "readwrite",
    );
    transaction.objectStore(LEGACY_EXPORT_STORE).clear();
    transaction.objectStore(IMPORT_STORE).clear();
    transaction.objectStore(RESOURCE_STORE).clear();
    transaction.objectStore(ATTACHMENT_STORE).clear();
    transaction.objectStore(STUDY_STORE).clear();
    await transactionComplete(transaction, "Could not remove the encrypted imported record.");
    activeEncryption = undefined;
  } finally {
    database.close();
  }
}
