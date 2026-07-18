"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { FieldPicker, type FieldOption } from "@/app/field-picker";

export function PatientFieldsCard({
  allFields,
  myFields,
}: {
  allFields: FieldOption[];
  myFields: FieldOption[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [fieldIds, setFieldIds] = useState<number[]>(myFields.map((field) => field.id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    if (fieldIds.length === 0) {
      setError("Choose at least one field.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/me/fields", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fieldIds }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "Saving failed. Try again.");
        return;
      }
      setEditing(false);
      router.refresh();
    } catch {
      setError("Saving failed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="dashboard-card" aria-label="Your fields">
      <h2>Your fields</h2>
      {editing ? (
        <form className="auth-form" onSubmit={save}>
          <FieldPicker
            fields={allFields}
            selected={fieldIds}
            onChange={setFieldIds}
            disabled={busy}
            legend="Fields you care about"
          />
          {error ? <div className="error compact-error" role="alert">{error}</div> : null}
          <div className="dashboard-actions">
            <button className="button primary" type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save fields"}
            </button>
            <button
              className="text-button"
              type="button"
              disabled={busy}
              onClick={() => {
                setFieldIds(myFields.map((field) => field.id));
                setEditing(false);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <>
          <ul className="chip-list">
            {myFields.map((field) => (
              <li key={field.id}>
                <Link href={`/literature?field=${field.slug}`}>{field.name}</Link>
              </li>
            ))}
          </ul>
          <div className="dashboard-actions">
            <button className="text-button" type="button" onClick={() => setEditing(true)}>
              Edit fields
            </button>
            <Link className="text-button" href="/literature">Browse all literature</Link>
          </div>
        </>
      )}
    </section>
  );
}
