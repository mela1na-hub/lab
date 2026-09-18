import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, "..");

dotenv.config({ path: path.join(ROOT, ".env") });

function required(name: string): string {
  const v = process.env[name]?.trim() || "";
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}

export const NODE_ENV = process.env.NODE_ENV || "development";
export const isProd = NODE_ENV === "production";
export const PORT = Number(process.env.PORT || 3000);
export const DATABASE_URL = required("DATABASE_URL");
export const SESSION_SECRET = required("SESSION_SECRET");
export const COOKIE_SECURE =
  process.env.COOKIE_SECURE === "true" || (isProd && process.env.COOKIE_SECURE !== "false");
export const TRUST_PROXY = process.env.TRUST_PROXY === "true" || isProd;
export const PUBLIC_URL = (process.env.PUBLIC_URL || "").replace(/\/$/, "");
export const SESSION_DAYS = 7;
export const MIN_PASSWORD = 8;

export function publicOrigin(reqHost?: string, proto?: string): string {
  if (PUBLIC_URL) return PUBLIC_URL.endsWith("/") ? PUBLIC_URL : `${PUBLIC_URL}/`;
  if (reqHost) return `${proto || "http"}://${reqHost}/`;
  return `http://127.0.0.1:${PORT}/`;
}

export function ensureDirs() {
  for (const rel of [
    "images/uploads",
    "images/gallery",
    "media/gallery",
    "files/reports",
  ]) {
    fs.mkdirSync(path.join(ROOT, rel), { recursive: true });
  }
}
