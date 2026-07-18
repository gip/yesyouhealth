import type { ExportResult } from "@/lib/epic";
import {
  getProvider,
  PROVIDER_REGISTRY_VERSION,
  type ProviderId,
} from "@/lib/providers";

export const OAUTH_TRANSACTION_KEY = "yyc_oauth_transaction";
export const OAUTH_TRANSACTION_MAX_AGE_MS = 10 * 60 * 1_000;

export interface OAuthTransaction {
  state: string;
  verifier: string;
  providerId: ProviderId;
  providerRegistryVersion: number;
  redirectUri: string;
  createdAt: number;
  includeAttachments: boolean;
  browserStorage?: BrowserStorageSummary;
}

export interface HealthAttachmentSummary {
  key: string;
  binaryId: string;
  contentType: string;
  size: number;
  sourceDocumentReference?: string;
  title?: string;
}

export interface BrowserStorageSummary {
  persistent: boolean;
  quota?: number;
  usage?: number;
}

export interface HealthExportDocument extends ExportResult {
  schemaVersion: 1;
  exportedAt: string;
  exportedBy: "YesYou Health";
  source: {
    provider: string;
    fhirBase: string;
    patientId: string;
  };
  purpose: string;
  limitations: string[];
  attachments?: HealthAttachmentSummary[];
  browserStorage?: BrowserStorageSummary;
}

export function resolveRedirectUri(configuredRedirectUri: string | null, origin: string): string {
  const value = configuredRedirectUri || new URL("/callback", origin).toString();
  const url = new URL(value);
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new Error("The OAuth callback must use HTTPS outside local development.");
  }
  return url.toString();
}

export function parseOAuthTransaction(
  serialized: string | null,
  now = Date.now(),
): OAuthTransaction | undefined {
  if (!serialized) return undefined;
  try {
    const value: unknown = JSON.parse(serialized);
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const transaction = value as Record<string, unknown>;
    const browserStorage =
      transaction.browserStorage !== null &&
      typeof transaction.browserStorage === "object" &&
      !Array.isArray(transaction.browserStorage)
        ? transaction.browserStorage as Record<string, unknown>
        : undefined;
    if (
      typeof transaction.state !== "string" ||
      typeof transaction.verifier !== "string" ||
      typeof transaction.providerId !== "string" ||
      !getProvider(transaction.providerId)?.enabled ||
      transaction.providerRegistryVersion !== PROVIDER_REGISTRY_VERSION ||
      typeof transaction.redirectUri !== "string" ||
      typeof transaction.createdAt !== "number" ||
      (transaction.includeAttachments !== undefined &&
        typeof transaction.includeAttachments !== "boolean") ||
      (transaction.browserStorage !== undefined &&
        (
          !browserStorage ||
          typeof browserStorage.persistent !== "boolean" ||
          (browserStorage.quota !== undefined && typeof browserStorage.quota !== "number") ||
          (browserStorage.usage !== undefined && typeof browserStorage.usage !== "number")
        )) ||
      now - transaction.createdAt < 0 ||
      now - transaction.createdAt > OAUTH_TRANSACTION_MAX_AGE_MS
    ) {
      return undefined;
    }
    return {
      state: transaction.state,
      verifier: transaction.verifier,
      providerId: transaction.providerId as ProviderId,
      providerRegistryVersion: transaction.providerRegistryVersion,
      redirectUri: transaction.redirectUri,
      createdAt: transaction.createdAt,
      includeAttachments: transaction.includeAttachments === true,
      ...(browserStorage
        ? {
            browserStorage: {
              persistent: browserStorage.persistent as boolean,
              ...(typeof browserStorage.quota === "number"
                ? { quota: browserStorage.quota }
                : {}),
              ...(typeof browserStorage.usage === "number"
                ? { usage: browserStorage.usage }
                : {}),
            },
          }
        : {}),
    };
  } catch {
    return undefined;
  }
}

export function equalOAuthState(expected: string, actual: string): boolean {
  if (expected.length !== actual.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected.charCodeAt(index) ^ actual.charCodeAt(index);
  }
  return difference === 0;
}

export function createExportDocument(input: {
  providerName: string;
  fhirBase: string;
  patientId: string;
  exportedAt: string;
  record: ExportResult;
}): HealthExportDocument {
  return {
    schemaVersion: 1,
    exportedAt: input.exportedAt,
    exportedBy: "YesYou Health",
    source: {
      provider: input.providerName,
      fhirBase: input.fhirBase,
      patientId: input.patientId,
    },
    purpose: "Help the patient understand actions taken and documented as part of their care.",
    ...input.record,
    limitations: [
      "The export contains only data made available by the healthcare organization through the authorized FHIR APIs.",
      "The export may differ from information displayed in MyChart.",
      "Clinical-note files are included only when selected and made available as supported FHIR Binary resources.",
      "Browser storage is passphrase-encrypted and device-local, and may be removed by the user or browser.",
    ],
  };
}
