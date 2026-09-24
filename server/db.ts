import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { ROOT, SQLITE_PATH } from "./env.js";

fs.mkdirSync(path.dirname(SQLITE_PATH), { recursive: true });

const db = new Database(SQLITE_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

export function sqlNow(offsetMs = 0) {
  return new Date(Date.now() + offsetMs).toISOString();
}

function convertSql(sql: string, params: unknown[] = []) {
  let text = sql
    .replace(/\bnow\(\)\s*\+\s*interval\s+'1 hour'/gi, `'${sqlNow(60 * 60 * 1000)}'`)
    .replace(/\bnow\(\)\s*-\s*interval\s+'15 minutes'/gi, `'${sqlNow(-15 * 60 * 1000)}'`)
    .replace(/\bnow\(\)/gi, `'${sqlNow()}'`)
    .replace(/::jsonb/gi, "")
    .replace(/::timestamptz/gi, "")
    .replace(/::text\[\]/gi, "")
    .replace(/::text/gi, "")
    .replace(/\bTRUE\b/g, "1")
    .replace(/\bFALSE\b/g, "0");

  // Postgres $1/$2 may appear out of order (e.g. SET a=$2 WHERE id=$1).
  // Rebuild ? placeholders in appearance order and reorder bound values to match.
  const order: number[] = [];
  text = text.replace(/\$(\d+)/g, (_m, num: string) => {
    order.push(Number(num) - 1);
    return "?";
  });
  const bound =
    order.length === 0
      ? params.slice()
      : order.map((idx) => (idx >= 0 && idx < params.length ? params[idx] : null));
  return { sql: text, params: bound };
}

function bindValue(value: unknown) {
  if (value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value && typeof value === "object" && !Buffer.isBuffer(value) && !Array.isArray(value)) {
    return JSON.stringify(value);
  }
  return value;
}

function parseRow<T extends Record<string, unknown>>(row: T): T {
  if (row && typeof row.data === "string") {
    try {
      (row as { data: unknown }).data = JSON.parse(row.data);
    } catch {
      /* keep string */
    }
  }
  if (row && typeof row.success === "number") {
    (row as { success: unknown }).success = Boolean(row.success);
  }
  return row;
}

export async function query<T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  params: unknown[] = []
) {
  const converted = convertSql(text, params);
  const stmt = db.prepare(converted.sql);
  const bound = converted.params.map(bindValue);
  if (/^\s*(SELECT|WITH)\b/i.test(converted.sql)) {
    const rows = (stmt.all(...bound) as T[]).map((row) => parseRow(row));
    return { rows, rowCount: rows.length };
  }
  const info = stmt.run(...bound);
  return { rows: [] as T[], rowCount: info.changes };
}

export async function migrate() {
  const sql = fs.readFileSync(path.join(ROOT, "sql", "001_init.sql"), "utf8");
  db.exec(sql);
  db.prepare(`INSERT OR IGNORE INTO schema_migrations (id) VALUES (?)`).run("001_init");
  const dailyCols = db.prepare(`PRAGMA table_info(daily_logs)`).all() as { name: string }[];
  if (!dailyCols.some((c) => c.name === "video")) {
    db.exec(`ALTER TABLE daily_logs ADD COLUMN video TEXT NOT NULL DEFAULT ''`);
  }
  const galleryCols = db.prepare(`PRAGMA table_info(gallery_items)`).all() as { name: string }[];
  if (!galleryCols.some((c) => c.name === "poster")) {
    db.exec(`ALTER TABLE gallery_items ADD COLUMN poster TEXT NOT NULL DEFAULT ''`);
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS tg_login_tokens (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      chat_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'director')),
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_tg_login_expires ON tg_login_tokens (expires_at);
  `);
}

export function closeDb() {
  db.close();
}

export const pool = {
  end: async () => {
    closeDb();
  },
};
