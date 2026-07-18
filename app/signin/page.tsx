import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { SignInClient } from "@/app/signin/signin-client";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const session = await auth();
  if (session?.user) redirect("/dashboard");
  const { callbackUrl } = await searchParams;
  return (
    <main className="auth-page">
      <section className="auth-card">
        <p className="eyebrow">Welcome back</p>
        <h1>Sign in</h1>
        <SignInClient callbackUrl={callbackUrl ?? null} />
      </section>
    </main>
  );
}
