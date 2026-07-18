import Link from "next/link";

import { listFields } from "@/lib/server/fields";
import { listLiterature } from "@/lib/server/literature";

export const metadata = { title: "Literature · YesYou Health" };

export default async function LiteraturePage({
  searchParams,
}: {
  searchParams: Promise<{ field?: string }>;
}) {
  const { field } = await searchParams;
  const fields = await listFields();
  const activeField = fields.find((entry) => entry.slug === field);
  const literature = await listLiterature(activeField ? { fieldSlug: activeField.slug } : {});

  return (
    <main className="dashboard">
      <header className="dashboard-header">
        <p className="eyebrow">Peer-reviewed literature</p>
        <h1>{activeField ? activeField.name : "All fields"}</h1>
        <p className="auth-note">
          Articles curated by doctors practicing in each field. Links go to the original
          publication; nothing here replaces advice from your care team.
        </p>
      </header>

      <nav className="literature-filter" aria-label="Filter by field">
        <Link className={activeField ? undefined : "active"} href="/literature">All</Link>
        {fields.map((entry) => (
          <Link
            key={entry.id}
            className={activeField?.id === entry.id ? "active" : undefined}
            href={`/literature?field=${entry.slug}`}
          >
            {entry.name}
          </Link>
        ))}
      </nav>

      {literature.length === 0 ? (
        <p className="auth-note">No articles yet{activeField ? ` in ${activeField.name}` : ""}.</p>
      ) : (
        <ul className="literature-list">
          {literature.map((entry) => (
            <li key={entry.id}>
              <p className="literature-field">{entry.field_name}</p>
              <h3>{entry.title}</h3>
              <p className="literature-meta">
                {entry.authors} · {entry.journal} · {entry.year}
                {entry.doctor_name ? ` · added by ${entry.doctor_name}` : ""}
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
    </main>
  );
}
