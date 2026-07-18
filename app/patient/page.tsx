import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { ConnectButton } from "@/app/connect-button";
import { PatientFieldsCard } from "@/app/patient/patient-client";
import { fieldsForUser, listFields } from "@/lib/server/fields";
import { DEFAULT_PROVIDER_ID, selectableProviders } from "@/lib/providers";
import {
  configuredEpicRedirectUri,
  epicScope,
  requireEpicClientId,
} from "@/lib/server-config";

export default async function PatientPage() {
  const session = await auth();
  if (session?.user && session.user.role !== "patient") redirect("/dashboard");

  const patientId = session?.user?.id ?? null;
  const [allFields, myFields] = patientId
    ? await Promise.all([listFields(), fieldsForUser(patientId)])
    : [[], []];
  const providers = selectableProviders(process.env.NODE_ENV === "development");

  return (
    <main className="dashboard">
      <header className="dashboard-header">
        <p className="eyebrow">Patient dashboard</p>
        <h1>Welcome{session?.user?.name ? `, ${session.user.name}` : ""}</h1>
        <p className="auth-note">
          Import your record from MyChart, keep it encrypted on this device, and follow the
          literature for the fields you care about.
        </p>
      </header>
      <div className="dashboard-grid">
        <section className="dashboard-card" aria-label="Your health record">
          <h2>Your health record</h2>
          <p className="auth-note">
            Connect MyChart to import a read-only copy of your record. It is encrypted in your
            browser with a passphrase you choose and never touches our server. No account needed.
          </p>
          <div className="dashboard-actions">
            <ConnectButton
              defaultClientId={requireEpicClientId()}
              defaultProviderId={DEFAULT_PROVIDER_ID}
              defaultScope={epicScope()}
              configuredRedirectUri={configuredEpicRedirectUri()}
              providers={providers}
            />
            <Link className="button secondary" href="/explore">Explore your record</Link>
          </div>
        </section>
        <section className="dashboard-card" aria-label="Longitudinal study">
          <h2>Longitudinal study</h2>
          <p className="auth-note">
            A de-identified, AI-built timeline of your diagnoses, labs, medications, denied prior
            authorizations, and screenings — generated after import and stored encrypted in your
            browser. Review it and add your comments.
          </p>
          <div className="dashboard-actions">
            <Link className="button secondary" href="/study">Open your study</Link>
          </div>
        </section>
        {patientId ? (
          <PatientFieldsCard allFields={allFields} myFields={myFields} />
        ) : (
          <section className="dashboard-card" aria-label="Your fields">
            <h2>Your fields</h2>
            <p className="auth-note">
              Sign in to follow the fields you care about and get matching literature.
            </p>
            <div className="dashboard-actions">
              <Link className="button secondary" href="/signin?callbackUrl=%2Fpatient">Sign in</Link>
              <Link className="text-button" href="/literature">Browse all literature</Link>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
