"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { FieldPicker, type FieldOption } from "@/app/field-picker";
import type { LiteratureRow } from "@/lib/server/literature";

export function DoctorClient({
  allFields,
  myFields,
  submissions,
}: {
  allFields: FieldOption[];
  myFields: FieldOption[];
  submissions: LiteratureRow[];
}) {
  const router = useRouter();

  const [editingFields, setEditingFields] = useState(false);
  const [fieldIds, setFieldIds] = useState<number[]>(myFields.map((field) => field.id));
  const [fieldsBusy, setFieldsBusy] = useState(false);
  const [fieldsError, setFieldsError] = useState<string>();

  const [title, setTitle] = useState("");
  const [authors, setAuthors] = useState("");
  const [journal, setJournal] = useState("");
  const [year, setYear] = useState("");
  const [doi, setDoi] = useState("");
  const [pubmedUrl, setPubmedUrl] = useState("");
  const [fieldId, setFieldId] = useState<number | "">(myFields[0]?.id ?? "");
  const [litBusy, setLitBusy] = useState(false);
  const [litError, setLitError] = useState<string>();
  const [litNotice, setLitNotice] = useState<string>();

  async function saveFields(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFieldsError(undefined);
    if (fieldIds.length === 0) {
      setFieldsError("Choose at least one field.");
      return;
    }
    setFieldsBusy(true);
    try {
      const response = await fetch("/api/me/fields", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fieldIds }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setFieldsError(body?.error ?? "Saving failed. Try again.");
        return;
      }
      setEditingFields(false);
      router.refresh();
    } catch {
      setFieldsError("Saving failed. Try again.");
    } finally {
      setFieldsBusy(false);
    }
  }

  async function addLiterature(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLitError(undefined);
    setLitNotice(undefined);
    if (fieldId === "") {
      setLitError("Choose one of your fields for this article.");
      return;
    }
    setLitBusy(true);
    try {
      const response = await fetch("/api/literature", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fieldId, title, authors, journal, year, doi, pubmedUrl }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setLitError(body?.error ?? "Adding the article failed. Try again.");
        return;
      }
      setTitle("");
      setAuthors("");
      setJournal("");
      setYear("");
      setDoi("");
      setPubmedUrl("");
      setLitNotice("Article added.");
      router.refresh();
    } catch {
      setLitError("Adding the article failed. Try again.");
    } finally {
      setLitBusy(false);
    }
  }

  return (
    <div className="dashboard-grid">
      <section className="dashboard-card" aria-label="Your fields">
        <h2>Your fields</h2>
        {editingFields ? (
          <form className="auth-form" onSubmit={saveFields}>
            <FieldPicker
              fields={allFields}
              selected={fieldIds}
              onChange={setFieldIds}
              disabled={fieldsBusy}
              legend="Fields you practice in"
            />
            {fieldsError ? <div className="error compact-error" role="alert">{fieldsError}</div> : null}
            <div className="dashboard-actions">
              <button className="button primary" type="submit" disabled={fieldsBusy}>
                {fieldsBusy ? "Saving…" : "Save fields"}
              </button>
              <button
                className="text-button"
                type="button"
                disabled={fieldsBusy}
                onClick={() => {
                  setFieldIds(myFields.map((field) => field.id));
                  setEditingFields(false);
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
                <li key={field.id}>{field.name}</li>
              ))}
            </ul>
            <button className="text-button" type="button" onClick={() => setEditingFields(true)}>
              Edit fields
            </button>
          </>
        )}
      </section>

      <section className="dashboard-card" aria-label="Add literature">
        <h2>Add peer-reviewed literature</h2>
        {myFields.length === 0 ? (
          <p className="auth-note">Choose at least one field before adding literature.</p>
        ) : (
          <form className="auth-form" onSubmit={addLiterature}>
            <label htmlFor="lit-field"><strong>Field</strong></label>
            <select
              id="lit-field"
              value={fieldId}
              onChange={(event) => setFieldId(Number(event.target.value))}
              disabled={litBusy}
              required
            >
              {myFields.map((field) => (
                <option key={field.id} value={field.id}>{field.name}</option>
              ))}
            </select>
            <label htmlFor="lit-title"><strong>Title</strong></label>
            <input
              id="lit-title"
              type="text"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              disabled={litBusy}
              maxLength={500}
              required
            />
            <label htmlFor="lit-authors"><strong>Authors</strong></label>
            <input
              id="lit-authors"
              type="text"
              value={authors}
              onChange={(event) => setAuthors(event.target.value)}
              disabled={litBusy}
              maxLength={1000}
              placeholder="Doe J, Roe R"
              required
            />
            <label htmlFor="lit-journal"><strong>Journal</strong></label>
            <input
              id="lit-journal"
              type="text"
              value={journal}
              onChange={(event) => setJournal(event.target.value)}
              disabled={litBusy}
              maxLength={300}
              required
            />
            <label htmlFor="lit-year"><strong>Year</strong></label>
            <input
              id="lit-year"
              type="number"
              min={1800}
              max={2100}
              value={year}
              onChange={(event) => setYear(event.target.value)}
              disabled={litBusy}
              required
            />
            <label htmlFor="lit-doi">
              <strong>DOI</strong>
              <small>For example 10.1056/NEJMoa2110345. Provide a DOI or a PubMed link.</small>
            </label>
            <input
              id="lit-doi"
              type="text"
              value={doi}
              onChange={(event) => setDoi(event.target.value)}
              disabled={litBusy}
              maxLength={300}
            />
            <label htmlFor="lit-pubmed"><strong>PubMed link</strong></label>
            <input
              id="lit-pubmed"
              type="url"
              value={pubmedUrl}
              onChange={(event) => setPubmedUrl(event.target.value)}
              disabled={litBusy}
              maxLength={500}
              placeholder="https://pubmed.ncbi.nlm.nih.gov/…"
            />
            {litError ? <div className="error compact-error" role="alert">{litError}</div> : null}
            {litNotice ? <p className="notice" role="status">{litNotice}</p> : null}
            <button className="button primary" type="submit" disabled={litBusy}>
              {litBusy ? "Adding…" : "Add article"}
            </button>
          </form>
        )}
      </section>

      <section className="dashboard-card dashboard-card-wide" aria-label="Your submissions">
        <h2>Your submissions</h2>
        {submissions.length === 0 ? (
          <p className="auth-note">Articles you add will appear here.</p>
        ) : (
          <ul className="literature-list">
            {submissions.map((entry) => (
              <li key={entry.id}>
                <p className="literature-field">{entry.field_name}</p>
                <h3>{entry.title}</h3>
                <p className="literature-meta">
                  {entry.authors} · {entry.journal} · {entry.year}
                </p>
                <p className="literature-links">
                  {entry.doi ? (
                    <a href={`https://doi.org/${entry.doi}`} target="_blank" rel="noreferrer noopener">
                      DOI: {entry.doi}
                    </a>
                  ) : null}
                  {entry.pubmed_url ? (
                    <a href={entry.pubmed_url} target="_blank" rel="noreferrer noopener">PubMed</a>
                  ) : null}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
