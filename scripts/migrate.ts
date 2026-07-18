import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import pg from "pg";

const MIGRATIONS_DIR = fileURLToPath(new URL("../migrations", import.meta.url));

export function pendingMigrations(applied: readonly string[], available: readonly string[]): string[] {
  const appliedSet = new Set(applied);
  return [...available].sort().filter((filename) => !appliedSet.has(filename));
}

export async function runMigrations(
  databaseUrl: string,
  log: (message: string) => void = console.log,
): Promise<void> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`,
    );

    const appliedRows = await client.query<{ filename: string }>(
      "SELECT filename FROM schema_migrations",
    );
    const available = (await readdir(MIGRATIONS_DIR)).filter((name) => name.endsWith(".sql"));
    const pending = pendingMigrations(appliedRows.rows.map((row) => row.filename), available);

    if (pending.length === 0) {
      log("No pending migrations.");
      return;
    }

    for (const filename of pending) {
      const sql = await readFile(path.join(MIGRATIONS_DIR, filename), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [filename]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${filename} failed.`, { cause: error });
      }
      log(`Applied ${filename}`);
    }
  } finally {
    await client.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is not configured.");
    process.exitCode = 1;
  } else {
    runMigrations(databaseUrl).catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
  }
}
