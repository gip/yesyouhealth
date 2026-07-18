"use client";

import { useState } from "react";

import { OAUTH_TRANSACTION_KEY, resolveRedirectUri, type OAuthTransaction } from "@/lib/browser-flow";
import { prepareBrowserStorage } from "@/lib/browser-storage";
import {
  buildAuthorizationUrl,
  createOAuthState,
  createPkce,
  discoverSmart,
} from "@/lib/epic";
import {
  getProvider,
  providerClientId,
  providerScope,
  PROVIDER_REGISTRY_VERSION,
  type ProviderId,
  type ProviderProfile,
} from "@/lib/providers";

export function ConnectButton({
  defaultClientId,
  defaultProviderId,
  defaultScope,
  configuredRedirectUri,
  providers,
}: {
  defaultClientId: string;
  defaultProviderId: ProviderId;
  defaultScope: string;
  configuredRedirectUri: string | null;
  providers: ProviderProfile[];
}) {
  const [error, setError] = useState<string>();
  const [connecting, setConnecting] = useState(false);
  const [includeAttachments, setIncludeAttachments] = useState(false);
  const [providerId, setProviderId] = useState<ProviderId>(defaultProviderId);
  const provider = getProvider(providerId);

  async function connect() {
    setConnecting(true);
    setError(undefined);
    try {
      if (!provider || !providers.some((item) => item.id === provider.id)) {
        throw new Error("Select a supported healthcare organization.");
      }
      const clientId = providerClientId(provider, defaultClientId);
      const scope = providerScope(provider, defaultScope);
      if (!clientId) throw new Error("Epic client ID is not configured.");
      const redirectUri = resolveRedirectUri(configuredRedirectUri, window.location.origin);
      const smart = await discoverSmart(provider.fhirBase);
      const state = createOAuthState();
      const { verifier, challenge } = await createPkce();
      const browserStorage = await prepareBrowserStorage();
      const transaction: OAuthTransaction = {
        state,
        verifier,
        providerId,
        providerRegistryVersion: PROVIDER_REGISTRY_VERSION,
        redirectUri,
        createdAt: Date.now(),
        includeAttachments: includeAttachments && provider.capabilities.attachments,
        browserStorage,
      };
      sessionStorage.setItem(OAUTH_TRANSACTION_KEY, JSON.stringify(transaction));
      window.location.assign(
        buildAuthorizationUrl({
          authorizationEndpoint: smart.authorization_endpoint,
          clientId,
          redirectUri,
          scope,
          fhirBase: provider.fhirBase,
          state,
          challenge,
        }),
      );
    } catch (caught) {
      sessionStorage.removeItem(OAUTH_TRANSACTION_KEY);
      setError(caught instanceof Error ? caught.message : "Unable to start authorization.");
      setConnecting(false);
    }
  }

  return (
    <>
      <div className="provider-picker">
        <label htmlFor="provider">
          <strong>Healthcare organization</strong>
          <small>Choose where you receive care.</small>
        </label>
        <select
          id="provider"
          value={providerId}
          onChange={(event) => {
            setProviderId(event.target.value as ProviderId);
            setError(undefined);
          }}
          disabled={connecting}
        >
          {providers.map((item) => (
            <option value={item.id} key={item.id}>{item.name}</option>
          ))}
        </select>
      </div>
      <label className="attachment-option">
        <input
          type="checkbox"
          checked={includeAttachments && provider?.capabilities.attachments === true}
          onChange={(event) => setIncludeAttachments(event.target.checked)}
          disabled={connecting || !provider?.capabilities.attachments}
        />
        <span>
          <strong>Include clinical-note files</strong>
          <small>
            {provider?.capabilities.attachments
              ? "Downloads authorized HTML, RTF, PDF, and image attachments to this browser."
              : "Clinical-note files are not available for this organization."}
          </small>
        </span>
      </label>
      <button className="button primary" type="button" onClick={connect} disabled={connecting}>
        {connecting
          ? `Opening ${provider?.myChartName ?? "MyChart"}…`
          : `Connect ${provider?.myChartName ?? "MyChart"}`}
      </button>
      {provider?.environment === "sandbox" ? (
        <p className="sandbox-note">Sandbox mode · Epic synthetic test patients</p>
      ) : null}
      {error ? <div className="error compact-error" role="alert">{error}</div> : null}
    </>
  );
}
