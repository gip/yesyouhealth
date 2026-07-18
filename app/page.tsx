import Link from "next/link";

import { auth } from "@/auth";
import { ConnectButton } from "@/app/connect-button";
import {
  DEFAULT_PROVIDER_ID,
  selectableProviders,
} from "@/lib/providers";
import {
  configuredEpicRedirectUri,
  epicScope,
  requireEpicClientId,
} from "@/lib/server-config";

export default async function Home() {
  const session = await auth();
  const role = session?.user?.role ?? null;
  const providers = selectableProviders(process.env.NODE_ENV === "development");
  return (
    <main>
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Your care, made understandable</p>
          <h1>See what happened in your care—and keep the record.</h1>
          <p className="lede">
            YesYou Health helps patients understand the actions taken and documented as part of their care.
            Connect MyChart, authorize read-only access, and receive a private export of the health data
            made available by your provider, encrypted on your device with a passphrase you choose.
          </p>
          <div className="actions">
            {role === "patient" ? (
              <ConnectButton
                defaultClientId={requireEpicClientId()}
                defaultProviderId={DEFAULT_PROVIDER_ID}
                defaultScope={epicScope()}
                configuredRedirectUri={configuredEpicRedirectUri()}
                providers={providers}
              />
            ) : role === "doctor" ? (
              <Link className="button primary" href="/doctor">Go to your dashboard</Link>
            ) : (
              <Link className="button primary" href="/signup">Create an account</Link>
            )}
            <Link className="button secondary" href="/terms">Review the terms</Link>
          </div>
          <p className="consent-note">
            By continuing, you agree to the <Link href="/terms">Terms</Link> and acknowledge the <Link href="/privacy">Privacy Notice</Link>.
          </p>
        </div>
        <aside className="record-card" aria-label="How the export works">
          <div className="record-card-top">
            <span className="status-dot" />
            <span>Patient-authorized export</span>
          </div>
          <ol className="steps">
            <li><span>1</span><div><strong>Sign in at MyChart</strong><small>Your password stays with your provider.</small></div></li>
            <li><span>2</span><div><strong>Approve read-only access</strong><small>You decide whether to share.</small></div></li>
            <li><span>3</span><div><strong>Encrypt and explore</strong><small>Create a passphrase before anything is stored.</small></div></li>
          </ol>
        </aside>
      </section>

      <section className="trust-grid" aria-label="Privacy highlights">
        <article><span>01</span><h2>No password collection</h2><p>Authentication happens directly on the healthcare organization&apos;s MyChart website.</p></article>
        <article><span>02</span><h2>Encrypted local storage</h2><p>Your browser encrypts the authorized record with your passphrase before storing it. Health data does not pass through our server.</p></article>
        <article><span>03</span><h2>Not a clinical judgment</h2><p>The export organizes source records; it does not diagnose, prescribe, or replace your care team.</p></article>
      </section>
    </main>
  );
}
