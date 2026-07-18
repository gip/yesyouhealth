import { query } from "@/lib/server/db";

export interface Field {
  id: number;
  slug: string;
  name: string;
}

export async function listFields(): Promise<Field[]> {
  const result = await query<Field>("SELECT id, slug, name FROM fields ORDER BY id");
  return result.rows;
}

export async function fieldsForUser(userId: string): Promise<Field[]> {
  const result = await query<Field>(
    `SELECT f.id, f.slug, f.name
     FROM user_fields uf
     JOIN fields f ON f.id = uf.field_id
     WHERE uf.user_id = $1
     ORDER BY f.id`,
    [userId],
  );
  return result.rows;
}
