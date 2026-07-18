"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import {
  createExportDocument,
  equalOAuthState,
  OAUTH_TRANSACTION_KEY,
  parseOAuthTransaction,
} from "@/lib/browser-flow";
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
import { getProvider, providerClientId } from "@/lib/providers";

type ExportStatus = "authorizing" | "retrieving" | "preparing" | "complete" | "error";

const STATUS_COPY: Record<Exclude<ExportStatus, "error">, { heading: string; detail: string }> = {
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
  complete: {
    heading: "Opening your record…",
    detail: "Your imported data is ready to explore in this browser.",
  },
};

export function CallbackClient({ defaultClientId }: { defaultClientId: string }) {
  const router = useRouter();
  const started = useRef(false);
  const [status, setStatus] = useState<ExportStatus>("authorizing");
  const [error, setError] = useState<string>();
  const [progress, setProgress] = useState<ImportProgress>();

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    async function runExport() {
      let stagedImportId: string | undefined;
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
        stagedImportId = await beginHealthImport(healthExport, browserStorage);

        const record = await exportPatientRecord({
          fhirBase: provider.fhirBase,
          patientId,
          accessToken: token.access_token,
          collectData: false,
          includeAttachments: transaction.includeAttachments,
          includePriorAuthorizations: provider.capabilities.priorAuthorizations,
          onResources: (group, resources) =>
            storeHealthResourcePage(stagedImportId!, group, resources),
          onAttachment: (attachment) =>
            storeHealthAttachment(stagedImportId!, attachment),
          onProgress: setProgress,
        });

        setStatus("preparing");
        await completeHealthImport(stagedImportId, record.errors);
        stagedImportId = undefined;
        setStatus("complete");
        router.replace("/explore");
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
      }
    }

    void runExport();
  }, [defaultClientId, router]);

  const copy = status === "error" ? undefined : STATUS_COPY[status];
  return (
    <main className="callback-page">
      <section className="callback-card" aria-live="polite">
        {status === "complete" ? <div className="success-mark" aria-hidden="true">✓</div> : null}
        {status !== "complete" && status !== "error" ? <div className="spinner" aria-hidden="true" /> : null}
        {status === "error" ? (
          <>
            <p className="eyebrow">Export not completed</p>
            <h1>We couldn&apos;t create your export.</h1>
            <div className="error" role="alert">{error}</div>
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
          </>
        )}
        {(status === "complete" || status === "error") ? (
          <Link className="button secondary" href="/">Return home</Link>
        ) : null}
      </section>
    </main>
  );
}
