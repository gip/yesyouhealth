"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { signIn } from "next-auth/react";

import { FieldPicker, type FieldOption } from "@/app/field-picker";

const MIN_PASSWORD_LENGTH = 12;

export function SignUpClient({ fields }: { fields: FieldOption[] }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"patient" | "doctor">("patient");
  const [fieldIds, setFieldIds] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    if (fieldIds.length === 0) {
      setError("Choose at least one field.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, email, password, role, fieldIds }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "Signup failed. Try again.");
        setBusy(false);
        return;
      }
      const result = await signIn("credentials", { email, password, redirect: false });
      if (result?.error) {
        window.location.assign("/signin");
        return;
      }
      window.location.assign("/dashboard");
    } catch {
      setError("Signup failed. Try again.");
      setBusy(false);
    }
  }

  return (
    <>
      <form className="auth-form" onSubmit={submit}>
        <fieldset className="role-picker" disabled={busy}>
          <legend><strong>I am a…</strong></legend>
          <div className="role-picker-options">
            <label className={role === "patient" ? "selected" : undefined}>
              <input
                type="radio"
                name="role"
                value="patient"
                checked={role === "patient"}
                onChange={() => setRole("patient")}
              />
              <span>
                <strong>Patient</strong>
                <small>Import and explore my health record.</small>
              </span>
            </label>
            <label className={role === "doctor" ? "selected" : undefined}>
              <input
                type="radio"
                name="role"
                value="doctor"
                checked={role === "doctor"}
                onChange={() => setRole("doctor")}
              />
              <span>
                <strong>Doctor</strong>
                <small>Curate peer-reviewed literature for my fields.</small>
              </span>
            </label>
          </div>
        </fieldset>

        <FieldPicker
          fields={fields}
          selected={fieldIds}
          onChange={setFieldIds}
          disabled={busy}
          legend={role === "doctor" ? "Fields you practice in" : "Fields you care about"}
        />

        <label htmlFor="signup-name"><strong>Name</strong></label>
        <input
          id="signup-name"
          type="text"
          autoComplete="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          disabled={busy}
        />
        <label htmlFor="signup-email"><strong>Email</strong></label>
        <input
          id="signup-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          disabled={busy}
          required
        />
        <label htmlFor="signup-password">
          <strong>Password</strong>
          <small>Use {MIN_PASSWORD_LENGTH} or more characters.</small>
        </label>
        <input
          id="signup-password"
          type="password"
          minLength={MIN_PASSWORD_LENGTH}
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={busy}
          required
        />
        {error ? <div className="error compact-error" role="alert">{error}</div> : null}
        <button className="button primary" type="submit" disabled={busy}>
          {busy ? "Creating account…" : "Create account"}
        </button>
      </form>
      <div className="auth-divider" aria-hidden="true"><span>or</span></div>
      <button
        className="button secondary google-button"
        type="button"
        disabled={busy}
        onClick={() => {
          void signIn("google", { redirectTo: "/dashboard" });
        }}
      >
        Continue with Google
      </button>
      <p className="auth-switch">
        Already have an account? <Link href="/signin">Sign in</Link>
      </p>
    </>
  );
}
