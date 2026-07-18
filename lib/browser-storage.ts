import type {
  BrowserStorageSummary,
  HealthAttachmentSummary,
  HealthExportDocument,
} from "@/lib/browser-flow";
import type { BinaryAttachment, JsonObject } from "@/lib/epic";

const DATABASE_NAME = "yesyou-health";
const DATABASE_VERSION = 2;
const LEGACY_EXPORT_STORE = "exports";
const IMPORT_STORE = "imports";
const RESOURCE_STORE = "resources";
const ATTACHMENT_STORE = "attachments";
const CURRENT_IMPORT_KEY = "current";
const IMPORT_INDEX = "by-import";

interface StoredImport {
  importId: string;
  document: HealthExportDocument;
  complete: boolean;
}

interface StoredResource {
  importId: string;
  group: string;
  identity: string;
  resource: JsonObject;
}

export interface StoredHealthAttachment extends HealthAttachmentSummary {
  importId: string;
  blob: Blob;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("Local browser storage is not available."));
      return;
    }

    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(LEGACY_EXPORT_STORE)) {
        database.createObjectStore(LEGACY_EXPORT_STORE);
      }
      if (!database.objectStoreNames.contains(IMPORT_STORE)) {
        database.createObjectStore(IMPORT_STORE);
      }
      if (!database.objectStoreNames.contains(RESOURCE_STORE)) {
        const resources = database.createObjectStore(RESOURCE_STORE, {
          keyPath: ["importId", "group", "identity"],
        });
        resources.createIndex(IMPORT_INDEX, "importId");
      }
      if (!database.objectStoreNames.contains(ATTACHMENT_STORE)) {
        const attachments = database.createObjectStore(ATTACHMENT_STORE, {
          keyPath: ["importId", "key"],
        });
        attachments.createIndex(IMPORT_INDEX, "importId");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open local browser storage."));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("A browser storage request failed."));
  });
}

function transactionComplete(transaction: IDBTransaction, message: string): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error(message));
    transaction.onabort = () => reject(transaction.error ?? new Error(message));
  });
}

function hashText(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}

function resourceIdentity(resource: JsonObject): string {
  const resourceType =
    typeof resource.resourceType === "string" && resource.resourceType
      ? resource.resourceType
      : "Resource";
  if (typeof resource.id === "string" && resource.id) return `${resourceType}/${resource.id}`;
  return `${resourceType}/anonymous-${hashText(JSON.stringify(resource))}`;
}

function storageError(error: unknown, fallback: string): Error {
  if (error instanceof DOMException && error.name === "QuotaExceededError") {
    return new Error(
      "This browser does not have enough local storage for the imported record. " +
      "Remove an older import, exclude clinical-note files, or free device storage and try again.",
    );
  }
  return error instanceof Error ? error : new Error(fallback);
}

async function currentImportId(database: IDBDatabase): Promise<string | undefined> {
  const transaction = database.transaction(IMPORT_STORE, "readonly");
  const value = await requestResult(transaction.objectStore(IMPORT_STORE).get(CURRENT_IMPORT_KEY));
  return typeof value === "string" ? value : undefined;
}

async function deleteImportData(database: IDBDatabase, importId: string): Promise<void> {
  const transaction = database.transaction(
    [IMPORT_STORE, RESOURCE_STORE, ATTACHMENT_STORE],
    "readwrite",
  );
  transaction.objectStore(IMPORT_STORE).delete(importId);

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
  await transactionComplete(transaction, "Could not remove staged browser data.");
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
    const transaction = database.transaction(
      [IMPORT_STORE, LEGACY_EXPORT_STORE],
      "readwrite",
    );
    transaction.objectStore(IMPORT_STORE).put(
      { importId, document: storedDocument, complete: false } satisfies StoredImport,
      importId,
    );
    await transactionComplete(transaction, "Could not prepare local browser storage.");
    return importId;
  } catch (error) {
    throw storageError(error, "Could not prepare local browser storage.");
  } finally {
    database.close();
  }
}

export async function storeHealthResourcePage(
  importId: string,
  group: string,
  resources: JsonObject[],
): Promise<void> {
  if (!resources.length) return;
  const database = await openDatabase();
  try {
    const transaction = database.transaction(RESOURCE_STORE, "readwrite");
    const store = transaction.objectStore(RESOURCE_STORE);
    for (const resource of resources) {
      store.put({
        importId,
        group,
        identity: resourceIdentity(resource),
        resource,
      } satisfies StoredResource);
    }
    await transactionComplete(transaction, `Could not save imported ${group} data.`);
  } catch (error) {
    throw storageError(error, `Could not save imported ${group} data.`);
  } finally {
    database.close();
  }
}

export async function storeHealthAttachment(
  importId: string,
  attachment: BinaryAttachment,
): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(ATTACHMENT_STORE, "readwrite");
    transaction.objectStore(ATTACHMENT_STORE).put({
      importId,
      key: attachment.key,
      binaryId: attachment.binaryId,
      contentType: attachment.contentType,
      size: attachment.blob.size,
      blob: attachment.blob,
      ...(attachment.sourceDocumentReference
        ? { sourceDocumentReference: attachment.sourceDocumentReference }
        : {}),
      ...(attachment.title ? { title: attachment.title } : {}),
    } satisfies StoredHealthAttachment);
    await transactionComplete(transaction, "Could not save a clinical-note attachment.");
  } catch (error) {
    throw storageError(error, "Could not save a clinical-note attachment.");
  } finally {
    database.close();
  }
}

export async function completeHealthImport(
  importId: string,
  errors: Record<string, string>,
): Promise<void> {
  const database = await openDatabase();
  let previousImportId: string | undefined;
  try {
    previousImportId = await currentImportId(database);
    const readTransaction = database.transaction(IMPORT_STORE, "readonly");
    const stored = await requestResult(
      readTransaction.objectStore(IMPORT_STORE).get(importId),
    ) as StoredImport | undefined;
    if (!stored) throw new Error("The staged browser import could not be found.");

    const transaction = database.transaction(
      [IMPORT_STORE, LEGACY_EXPORT_STORE],
      "readwrite",
    );
    transaction.objectStore(IMPORT_STORE).put(
      {
        ...stored,
        complete: true,
        document: { ...stored.document, errors },
      } satisfies StoredImport,
      importId,
    );
    transaction.objectStore(IMPORT_STORE).put(importId, CURRENT_IMPORT_KEY);
    transaction.objectStore(LEGACY_EXPORT_STORE).delete(CURRENT_IMPORT_KEY);
    await transactionComplete(transaction, "Could not finish saving the imported record.");
  } catch (error) {
    throw storageError(error, "Could not finish saving the imported record.");
  } finally {
    database.close();
  }

  if (previousImportId && previousImportId !== importId) {
    const cleanupDatabase = await openDatabase();
    try {
      await deleteImportData(cleanupDatabase, previousImportId);
    } catch {
      // The new import is already committed. Cleanup is best-effort and must not invalidate it.
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

export async function saveHealthExport(healthExport: HealthExportDocument): Promise<void> {
  const importId = await beginHealthImport(healthExport, healthExport.browserStorage);
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
      );
    }
    await storeHealthResourcePage(
      importId,
      "PriorAuthorization",
      healthExport.priorAuthorizations,
    );
    await completeHealthImport(importId, healthExport.errors);
  } catch (error) {
    await abortHealthImport(importId);
    throw error;
  }
}

export async function loadHealthAttachments(
  importId?: string,
): Promise<StoredHealthAttachment[]> {
  const database = await openDatabase();
  try {
    const selectedImportId = importId ?? await currentImportId(database);
    if (!selectedImportId) return [];
    const transaction = database.transaction(ATTACHMENT_STORE, "readonly");
    return await requestResult(
      transaction.objectStore(ATTACHMENT_STORE).index(IMPORT_INDEX).getAll(selectedImportId),
    ) as StoredHealthAttachment[];
  } finally {
    database.close();
  }
}

export async function loadHealthAttachment(
  key: string,
  importId?: string,
): Promise<StoredHealthAttachment | undefined> {
  const database = await openDatabase();
  try {
    const selectedImportId = importId ?? await currentImportId(database);
    if (!selectedImportId) return undefined;
    const transaction = database.transaction(ATTACHMENT_STORE, "readonly");
    return await requestResult(
      transaction.objectStore(ATTACHMENT_STORE).get([selectedImportId, key]),
    ) as StoredHealthAttachment | undefined;
  } finally {
    database.close();
  }
}

export async function loadHealthExport(): Promise<HealthExportDocument | undefined> {
  const database = await openDatabase();
  try {
    const importId = await currentImportId(database);
    if (!importId) {
      const transaction = database.transaction(LEGACY_EXPORT_STORE, "readonly");
      return await requestResult(
        transaction.objectStore(LEGACY_EXPORT_STORE).get(CURRENT_IMPORT_KEY),
      ) as HealthExportDocument | undefined;
    }

    const transaction = database.transaction(
      [IMPORT_STORE, RESOURCE_STORE, ATTACHMENT_STORE],
      "readonly",
    );
    const imports = transaction.objectStore(IMPORT_STORE);
    const resources = transaction.objectStore(RESOURCE_STORE).index(IMPORT_INDEX);
    const attachments = transaction.objectStore(ATTACHMENT_STORE).index(IMPORT_INDEX);
    const [stored, storedResources, storedAttachments] = await Promise.all([
      requestResult(imports.get(importId)) as Promise<StoredImport | undefined>,
      requestResult(resources.getAll(importId)) as Promise<StoredResource[]>,
      requestResult(attachments.getAll(importId)) as Promise<StoredHealthAttachment[]>,
    ]);
    if (!stored?.complete) return undefined;

    const data: Record<string, unknown> = {};
    let priorAuthorizations: JsonObject[] = [];
    const groups = new Map<string, JsonObject[]>();
    for (const item of storedResources) {
      const group = groups.get(item.group) ?? [];
      group.push(item.resource);
      groups.set(item.group, group);
    }
    for (const [group, groupResources] of groups) {
      if (group === "Patient") data.Patient = groupResources[0];
      else if (group === "PriorAuthorization") priorAuthorizations = groupResources;
      else data[group] = groupResources;
    }

    const summaries: HealthAttachmentSummary[] = storedAttachments.map((attachment) => ({
      key: attachment.key,
      binaryId: attachment.binaryId,
      contentType: attachment.contentType,
      size: attachment.size,
      ...(attachment.sourceDocumentReference
        ? { sourceDocumentReference: attachment.sourceDocumentReference }
        : {}),
      ...(attachment.title ? { title: attachment.title } : {}),
    }));
    return {
      ...stored.document,
      data,
      priorAuthorizations,
      attachments: summaries,
    };
  } finally {
    database.close();
  }
}

export async function clearHealthExport(): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(
      [LEGACY_EXPORT_STORE, IMPORT_STORE, RESOURCE_STORE, ATTACHMENT_STORE],
      "readwrite",
    );
    transaction.objectStore(LEGACY_EXPORT_STORE).clear();
    transaction.objectStore(IMPORT_STORE).clear();
    transaction.objectStore(RESOURCE_STORE).clear();
    transaction.objectStore(ATTACHMENT_STORE).clear();
    await transactionComplete(transaction, "Could not remove the imported record.");
  } finally {
    database.close();
  }
}
