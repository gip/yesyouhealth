"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { signIn } from "next-auth/react";

export function SignInClient({ callbackUrl }: { callbackUrl: string | null }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const destination = callbackUrl ?? "/dashboard";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const result = await signIn("credentials", { email, password, redirect: false });
      if (result?.error) {
        setError("The email or password is incorrect.");
        setBusy(false);
        return;
      }
      window.location.assign(destination);
    } catch {
      setError("Sign-in failed. Try again.");
      setBusy(false);
    }
  }

  return (
    <>
      <form className="auth-form" onSubmit={submit}>
        <label htmlFor="signin-email"><strong>Email</strong></label>
        <input
          id="signin-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          disabled={busy}
          autoFocus
          required
        />
        <label htmlFor="signin-password"><strong>Password</strong></label>
        <input
          id="signin-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={busy}
          required
        />
        {error ? <div className="error compact-error" role="alert">{error}</div> : null}
        <button className="button primary" type="submit" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <div className="auth-divider" aria-hidden="true"><span>or</span></div>
      <button
        className="button secondary google-button"
        type="button"
        disabled={busy}
        onClick={() => {
          void signIn("google", { redirectTo: destination });
        }}
      >
        Continue with Google
      </button>
      <p className="auth-switch">
        New to YesYou Health? <Link href="/signup">Create an account</Link>
      </p>
    </>
  );
}
