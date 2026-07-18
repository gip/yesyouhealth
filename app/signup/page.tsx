import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { SignUpClient } from "@/app/signup/signup-client";
import { listFields } from "@/lib/server/fields";

export default async function SignUpPage() {
  const session = await auth();
  if (session?.user) redirect("/dashboard");
  const fields = await listFields();
  return (
    <main className="auth-page">
      <section className="auth-card">
        <p className="eyebrow">Get started</p>
        <h1>Create your account</h1>
        <p className="auth-note">
          Patients import and explore their own records. Doctors share peer-reviewed literature
          with the fields they practice in.
        </p>
        <SignUpClient fields={fields} />
      </section>
    </main>
  );
}
