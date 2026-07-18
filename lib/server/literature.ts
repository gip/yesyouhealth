import { query } from "@/lib/server/db";
import type { LiteratureInput } from "@/lib/server/validation";

export interface LiteratureRow {
  id: string;
  field_id: number;
  field_slug: string;
  field_name: string;
  doctor_id: string;
  doctor_name: string | null;
  title: string;
  authors: string;
  journal: string;
  year: number;
  doi: string | null;
  pubmed_url: string | null;
  created_at: string;
}

const LITERATURE_SELECT = `
  SELECT l.id, l.field_id, f.slug AS field_slug, f.name AS field_name,
         l.doctor_id, u.name AS doctor_name,
         l.title, l.authors, l.journal, l.year, l.doi, l.pubmed_url,
         l.created_at::text AS created_at
  FROM literature l
  JOIN fields f ON f.id = l.field_id
  JOIN users u ON u.id = l.doctor_id`;

/**
 * Inserts only when the doctor has selected the target field; returns null
 * otherwise so the caller can respond 403.
 */
export async function addLiterature(
  doctorId: string,
  input: LiteratureInput,
): Promise<string | null> {
  const result = await query<{ id: string }>(
    `INSERT INTO literature (doctor_id, field_id, title, authors, journal, year, doi, pubmed_url)
     SELECT $1, $2, $3, $4, $5, $6, $7, $8
     WHERE EXISTS (SELECT 1 FROM user_fields WHERE user_id = $1 AND field_id = $2)
     RETURNING id`,
    [
      doctorId,
      input.fieldId,
      input.title,
      input.authors,
      input.journal,
      input.year,
      input.doi,
      input.pubmedUrl,
    ],
  );
  return result.rows[0]?.id ?? null;
}

export async function listLiterature(filter: {
  fieldSlug?: string;
  doctorId?: string;
} = {}): Promise<LiteratureRow[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filter.fieldSlug !== undefined) {
    params.push(filter.fieldSlug);
    conditions.push(`f.slug = $${params.length}`);
  }
  if (filter.doctorId !== undefined) {
    params.push(filter.doctorId);
    conditions.push(`l.doctor_id = $${params.length}`);
  }
  const where = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
  const result = await query<LiteratureRow>(
    `${LITERATURE_SELECT}${where} ORDER BY l.created_at DESC, l.id`,
    params,
  );
  return result.rows;
}
