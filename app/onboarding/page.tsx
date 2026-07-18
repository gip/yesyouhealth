import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { OnboardingClient } from "@/app/onboarding/onboarding-client";
import { listFields } from "@/lib/server/fields";

export default async function OnboardingPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  if (session.user.role !== null) redirect("/dashboard");
  const fields = await listFields();
  return (
    <main className="auth-page">
      <section className="auth-card">
        <p className="eyebrow">One last step</p>
        <h1>Tell us who you are</h1>
        <p className="auth-note">
          Choose your role and up to two fields. Your role cannot be changed later.
        </p>
        <OnboardingClient fields={fields} />
      </section>
    </main>
  );
}
