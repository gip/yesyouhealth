"use client";

import { useState, type FormEvent } from "react";

import { FieldPicker, type FieldOption } from "@/app/field-picker";

export function OnboardingClient({ fields }: { fields: FieldOption[] }) {
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
      const response = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role, fieldIds }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "Saving failed. Try again.");
        setBusy(false);
        return;
      }
      window.location.assign("/dashboard");
    } catch {
      setError("Saving failed. Try again.");
      setBusy(false);
    }
  }

  return (
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

      {error ? <div className="error compact-error" role="alert">{error}</div> : null}
      <button className="button primary" type="submit" disabled={busy}>
        {busy ? "Saving…" : "Continue"}
      </button>
    </form>
  );
}
