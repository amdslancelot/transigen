import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { Pool, type QueryResultRow } from "pg";

// One pool per process, shared across dev hot-reloads (Next.js re-evaluates
// modules). The pool is created lazily on the first query so `next build`
// never opens the database, and migrations from db/migrations/ are applied
// exactly once before the first query resolves — deploys need no separate
// migrate step (scripts/migrate.mjs remains for running them by hand).
//
// On failure the cache is cleared (and the half-open pool closed) so the next
// call retries: Postgres is a separate workload that may not be accepting
// connections yet when the app's first DB request arrives, and a transient
// failure must not poison the handle for the process's lifetime.
const globalForPg = globalThis as unknown as { transigenDb?: Promise<Pool> };

async function runMigrations(pool: Pool): Promise<void> {
  const migrationsDir = path.resolve("./db/migrations");

  await pool.query(`
    create table if not exists schema_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  const applied = new Set(
    (await pool.query<{ name: string }>("select name from schema_migrations")).rows.map(
      (r) => r.name,
    ),
  );
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(path.join(migrationsDir, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("insert into schema_migrations (name) values ($1)", [file]);
      await client.query("commit");
      console.log(`Applied migration ${file}`);
    } catch (err) {
      await client.query("rollback").catch(() => {});
      throw new Error(
        `Migration ${file} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      client.release();
    }
  }
}

export function getPool(): Promise<Pool> {
  if (globalForPg.transigenDb) return globalForPg.transigenDb;

  globalForPg.transigenDb = (async () => {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("Missing DATABASE_URL environment variable.");
    }
    const pool = new Pool({ connectionString, max: 10 });
    try {
      await runMigrations(pool);
      return pool;
    } catch (err) {
      await pool.end().catch(() => {});
      globalForPg.transigenDb = undefined;
      throw err;
    }
  })();

  return globalForPg.transigenDb;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const pool = await getPool();
  const result = await pool.query<T>(text, params);
  return result.rows;
}
