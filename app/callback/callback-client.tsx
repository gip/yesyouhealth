"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { StoragePassphraseForm } from "@/app/storage-passphrase-form";
import {
  createExportDocument,
  equalOAuthState,
  OAUTH_TRANSACTION_KEY,
  parseOAuthTransaction,
  type OAuthTransaction,
} from "@/lib/browser-flow";
import { createBrowserEncryption } from "@/lib/browser-encryption";
import {
  abortHealthImport,
  beginHealthImport,
  completeHealthImport,
  prepareBrowserStorage,
  storeHealthAttachment,
  storeHealthResourcePage,
} from "@/lib/browser-storage";
import {
  discoverSmart,
  exchangeAuthorizationCode,
  exportPatientRecord,
  type ImportProgress,
} from "@/lib/epic";
import {
  getProvider,
  providerClientId,
  type ProviderProfile,
} from "@/lib/providers";
import { generateStudy } from "@/lib/study-pipeline";

type ExportStatus =
  | "validating"
  | "passphrase"
  | "authorizing"
  | "retrieving"
  | "preparing"
  | "deidentifying"
  | "summarizing"
  | "complete"
  | "error";

const STATUS_COPY: Record<
  | "validating"
  | "authorizing"
  | "retrieving"
  | "preparing"
  | "deidentifying"
  | "summarizing"
  | "complete",
  { heading: string; detail: string }
> = {
  validating: {
    heading: "Checking your secure connection…",
    detail: "Validating the response from your healthcare organization.",
  },
  authorizing: {
    heading: "Completing your secure connection…",
    detail: "Exchanging the one-time authorization code directly with your healthcare organization.",
  },
  retrieving: {
    heading: "Retrieving your record…",
    detail: "Your browser is downloading the health information you authorized.",
  },
  preparing: {
    heading: "Preparing your private record…",
    detail: "Your browser is organizing the imported data and saving it locally for exploration.",
  },
  deidentifying: {
    heading: "De-identifying your record…",
    detail:
      "The confidential service is removing names, dates of birth, and other identifying details. This can take several minutes.",
  },
  summarizing: {
    heading: "Building your longitudinal study…",
    detail: "AI is assembling a timeline of diagnoses, labs, medications, and more from the de-identified record.",
  },
  complete: {
    heading: "Opening your record…",
    detail: "Your imported data is ready to explore in this browser.",
  },
};

export function CallbackClient({ defaultClientId }: { defaultClientId: string }) {
  const router = useRouter();
  const started = useRef(false);
  const pendingAuthorization = useRef<{
    code: string;
    transaction: OAuthTransaction;
    provider: ProviderProfile;
    clientId: string;
  } | undefined>(undefined);
  const [status, setStatus] = useState<ExportStatus>("validating");
  const [error, setError] = useState<string>();
  const [progress, setProgress] = useState<ImportProgress>();
  const [jobStatus, setJobStatus] = useState<string>();
  const [creatingKey, setCreatingKey] = useState(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    function validateAuthorization() {
      const callbackUrl = new URL(window.location.href);
      const code = callbackUrl.searchParams.get("code");
      const actualState = callbackUrl.searchParams.get("state");
      const oauthError = callbackUrl.searchParams.get("error");
      const oauthErrorDescription = callbackUrl.searchParams.get("error_description");

      window.history.replaceState(null, "", callbackUrl.pathname);

      try {
        if (oauthError) {
          throw new Error(oauthErrorDescription ? `${oauthError}: ${oauthErrorDescription}` : oauthError);
        }
        if (!defaultClientId) throw new Error("Epic client ID is not configured.");

        const transaction = parseOAuthTransaction(sessionStorage.getItem(OAUTH_TRANSACTION_KEY));
        sessionStorage.removeItem(OAUTH_TRANSACTION_KEY);
        if (!transaction) throw new Error("The authorization request was missing or expired. Please start again.");
        if (!code || !actualState) throw new Error("The authorization response was incomplete.");
        if (!equalOAuthState(transaction.state, actualState)) {
          throw new Error("The authorization state was invalid. Please start again.");
        }

        const provider = getProvider(transaction.providerId);
        if (!provider?.enabled) throw new Error("The healthcare organization was not recognized.");
        const clientId = providerClientId(provider, defaultClientId);
        pendingAuthorization.current = { code, transaction, provider, clientId };
        setStatus("passphrase");
      } catch (caught) {
        sessionStorage.removeItem(OAUTH_TRANSACTION_KEY);
        setError(caught instanceof Error ? caught.message : "The authorization response was invalid.");
        setStatus("error");
      }
    }

    validateAuthorization();
  }, [defaultClientId]);

  async function runExport(passphrase: string) {
    const pending = pendingAuthorization.current;
    if (!pending) {
      setError("The authorization request was missing or expired. Please start again.");
      setStatus("error");
      return;
    }

    let stagedImportId: string | undefined;
    setCreatingKey(true);
    setError(undefined);
    try {
      const encryption = await createBrowserEncryption(passphrase);
      setCreatingKey(false);
      setStatus("authorizing");
      const { code, transaction, provider, clientId } = pending;
      const smart = await discoverSmart(provider.fhirBase);
      const token = await exchangeAuthorizationCode({
        tokenEndpoint: smart.token_endpoint,
        code,
        verifier: transaction.verifier,
        clientId,
        redirectUri: transaction.redirectUri,
      });
      const patientId = token.patient?.replace(/^Patient\//, "");
      if (!patientId) {
        throw new Error("MyChart did not return patient context. Confirm that launch/patient is requested.");
      }

      setStatus("retrieving");
      const exportedAt = new Date().toISOString();
      const browserStorage = transaction.browserStorage ?? await prepareBrowserStorage();
      const healthExport = createExportDocument({
        providerName: provider.name,
        fhirBase: provider.fhirBase,
        patientId,
        exportedAt,
        record: { data: {}, errors: {}, priorAuthorizations: [] },
      });
      stagedImportId = await beginHealthImport(healthExport, encryption, browserStorage);

      const record = await exportPatientRecord({
        fhirBase: provider.fhirBase,
        patientId,
        accessToken: token.access_token,
        collectData: false,
        includeAttachments: transaction.includeAttachments,
        includePriorAuthorizations: provider.capabilities.priorAuthorizations,
        onResources: (group, resources) =>
          storeHealthResourcePage(stagedImportId!, group, resources, encryption),
        onAttachment: (attachment) =>
          storeHealthAttachment(stagedImportId!, attachment, encryption),
        onProgress: setProgress,
      });

      setStatus("preparing");
      await completeHealthImport(stagedImportId, record.errors, encryption);
      stagedImportId = undefined;
      pendingAuthorization.current = undefined;

      // The import is committed; the study pipeline is best-effort. If it
      // fails, land on the explorer — /study offers a retry.
      try {
        setStatus("deidentifying");
        await generateStudy({
          onProgress: (update) => {
            setStatus(update.stage === "deidentifying" ? "deidentifying" : "summarizing");
            setJobStatus(update.jobStatus);
          },
        });
        setStatus("complete");
        router.replace("/study");
      } catch {
        setStatus("complete");
        router.replace("/explore");
      } finally {
        setJobStatus(undefined);
      }
    } catch (caught) {
      if (stagedImportId) {
        try {
          await abortHealthImport(stagedImportId);
        } catch {
          // Preserve the original import error. Incomplete staged data is never made current.
        }
      }
      sessionStorage.removeItem(OAUTH_TRANSACTION_KEY);
      setError(caught instanceof Error ? caught.message : "The health record export failed.");
      setStatus("error");
    } finally {
      setCreatingKey(false);
    }
  }

  const copy =
    status === "error" || status === "passphrase"
      ? undefined
      : STATUS_COPY[status];
  return (
    <main className="callback-page">
      <section className="callback-card" aria-live="polite">
        {status === "complete" ? <div className="success-mark" aria-hidden="true">✓</div> : null}
        {!["complete", "error", "passphrase"].includes(status)
          ? <div className="spinner" aria-hidden="true" />
          : null}
        {status === "error" ? (
          <>
            <p className="eyebrow">Export not completed</p>
            <h1>We couldn&apos;t create your export.</h1>
            <div className="error" role="alert">{error}</div>
          </>
        ) : status === "passphrase" ? (
          <>
            <p className="eyebrow">Encrypted browser storage</p>
            <h1>Protect your health record.</h1>
            <p className="callback-detail">
              Your browser will derive an encryption key with Argon2id and encrypt every
              imported resource and file before writing it to this device.
            </p>
            <StoragePassphraseForm
              mode="create"
              busy={creatingKey}
              error={error}
              onSubmit={runExport}
            />
          </>
        ) : (
          <>
            <p className="eyebrow">Browser-only export</p>
            <h1>{copy?.heading}</h1>
            <p className="callback-detail">{copy?.detail}</p>
            {status === "retrieving" && progress ? (
              <p className="import-progress" aria-live="polite">
                {progress.resourceCount.toLocaleString()} resources
                {progress.attachmentCount
                  ? ` · ${progress.attachmentCount.toLocaleString()} files`
                  : ""}
                {" · "}
                {progress.completedSearches}/{progress.totalSearches} searches
              </p>
            ) : null}
            {status === "deidentifying" || status === "summarizing" ? (
              <p className="import-progress" aria-live="polite">
                {jobStatus === "queued"
                  ? "Job queued — waiting for a worker"
                  : jobStatus === "running"
                    ? "Job running"
                    : "Submitting job"}
                {" · status checked every 3 seconds"}
              </p>
            ) : null}
          </>
        )}
        {(status === "complete" || status === "error") ? (
          <Link className="button secondary" href="/">Return home</Link>
        ) : null}
      </section>
    </main>
  );
}
