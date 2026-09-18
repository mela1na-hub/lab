import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { DATABASE_URL, ROOT } from "./env.js";

export const pool = new pg.Pool({
  connectionString: DATABASE_URL,
  max: 10,
  ssl: DATABASE_URL.includes("supabase") || DATABASE_URL.includes("sslmode=require")
    ? { rejectUnauthorized: false }
    : undefined,
});

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = []
) {
  return pool.query<T>(text, params);
}

export async function migrate() {
  const sql = fs.readFileSync(path.join(ROOT, "sql", "001_init.sql"), "utf8");
  const statements = sql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const statement of statements) {
    await pool.query(statement);
  }
  await pool.query(
    `INSERT INTO schema_migrations (id) VALUES ('001_init') ON CONFLICT (id) DO NOTHING`
  );
}
