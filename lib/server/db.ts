import pg from "pg";

const globalForDb = globalThis as typeof globalThis & { __yesyouPgPool?: pg.Pool };

function requireDatabaseUrl(): string {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error("DATABASE_URL is not configured.");
  return value;
}

export function getPool(): pg.Pool {
  if (!globalForDb.__yesyouPgPool) {
    globalForDb.__yesyouPgPool = new pg.Pool({
      connectionString: requireDatabaseUrl(),
      max: 10,
    });
  }
  return globalForDb.__yesyouPgPool;
}

export async function query<T extends pg.QueryResultRow>(
  text: string,
  params?: readonly unknown[],
): Promise<pg.QueryResult<T>> {
  return getPool().query<T>(text, params ? [...params] : undefined);
}

export async function withTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
