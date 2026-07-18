import type pg from "pg";

import { query, withTransaction } from "@/lib/server/db";
import type { UserRole } from "@/lib/server/validation";

export interface UserRow {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  password_hash: string | null;
  role: UserRole | null;
}

const USER_COLUMNS = "id, email, name, image, password_hash, role";

const UNIQUE_VIOLATION = "23505";

export class DuplicateEmailError extends Error {
  constructor() {
    super("An account with this email already exists.");
    this.name = "DuplicateEmailError";
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === UNIQUE_VIOLATION
  );
}

export async function findUserByEmail(email: string): Promise<UserRow | null> {
  const result = await query<UserRow>(
    `SELECT ${USER_COLUMNS} FROM users WHERE lower(email) = lower($1)`,
    [email],
  );
  return result.rows[0] ?? null;
}

export async function findUserById(id: string): Promise<UserRow | null> {
  const result = await query<UserRow>(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [id]);
  return result.rows[0] ?? null;
}

async function insertUserFields(
  client: pg.PoolClient,
  userId: string,
  fieldIds: readonly number[],
): Promise<void> {
  for (const fieldId of fieldIds) {
    await client.query("INSERT INTO user_fields (user_id, field_id) VALUES ($1, $2)", [
      userId,
      fieldId,
    ]);
  }
}

export async function createCredentialsUser(input: {
  email: string;
  name: string | null;
  passwordHash: string;
  role: UserRole;
  fieldIds: readonly number[];
}): Promise<UserRow> {
  try {
    return await withTransaction(async (client) => {
      const inserted = await client.query<UserRow>(
        `INSERT INTO users (email, name, password_hash, role)
         VALUES ($1, $2, $3, $4)
         RETURNING ${USER_COLUMNS}`,
        [input.email, input.name, input.passwordHash, input.role],
      );
      const user = inserted.rows[0];
      if (!user) throw new Error("User insert returned no row.");
      await insertUserFields(client, user.id, input.fieldIds);
      return user;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new DuplicateEmailError();
    throw error;
  }
}

export async function findUserByAccount(
  provider: string,
  providerAccountId: string,
): Promise<UserRow | null> {
  const result = await query<UserRow>(
    `SELECT ${USER_COLUMNS.split(", ").map((column) => `u.${column}`).join(", ")}
     FROM accounts a
     JOIN users u ON u.id = a.user_id
     WHERE a.provider = $1 AND a.provider_account_id = $2`,
    [provider, providerAccountId],
  );
  return result.rows[0] ?? null;
}

export async function linkAccount(
  userId: string,
  provider: string,
  providerAccountId: string,
): Promise<void> {
  await query(
    `INSERT INTO accounts (user_id, provider, provider_account_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (provider, provider_account_id) DO NOTHING`,
    [userId, provider, providerAccountId],
  );
}

export async function createOAuthUser(input: {
  email: string;
  name: string | null;
  image: string | null;
  provider: string;
  providerAccountId: string;
}): Promise<UserRow> {
  try {
    return await withTransaction(async (client) => {
      const inserted = await client.query<UserRow>(
        `INSERT INTO users (email, name, image)
         VALUES ($1, $2, $3)
         RETURNING ${USER_COLUMNS}`,
        [input.email, input.name, input.image],
      );
      const user = inserted.rows[0];
      if (!user) throw new Error("User insert returned no row.");
      await client.query(
        "INSERT INTO accounts (user_id, provider, provider_account_id) VALUES ($1, $2, $3)",
        [user.id, input.provider, input.providerAccountId],
      );
      return user;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new DuplicateEmailError();
    throw error;
  }
}

export async function setRoleAndFields(
  userId: string,
  role: UserRole,
  fieldIds: readonly number[],
): Promise<boolean> {
  return withTransaction(async (client) => {
    const updated = await client.query(
      "UPDATE users SET role = $2, updated_at = now() WHERE id = $1 AND role IS NULL",
      [userId, role],
    );
    if (updated.rowCount !== 1) return false;
    await client.query("DELETE FROM user_fields WHERE user_id = $1", [userId]);
    await insertUserFields(client, userId, fieldIds);
    return true;
  });
}

export async function replaceUserFields(
  userId: string,
  fieldIds: readonly number[],
): Promise<void> {
  await withTransaction(async (client) => {
    await client.query("DELETE FROM user_fields WHERE user_id = $1", [userId]);
    await insertUserFields(client, userId, fieldIds);
  });
}
