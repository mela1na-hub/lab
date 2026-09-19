import { query } from "./db.js";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./env.js";

export function todayYmd() {
  return new Date().toISOString().slice(0, 10);
}

export function isRestDay(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = dt.getUTCDay();
  return day === 0 || day === 6;
}

export function workerBrief(w: { id: string; name: string; lavozim: string }) {
  return { id: w.id, name: w.name, lavozim: w.lavozim };
}

export function youtubeId(url: string) {
  const u = url.trim();
  const m = u.match(/(?:youtu\.be\/|v=|embed\/|shorts\/)([A-Za-z0-9_-]{6,20})/);
  if (m) return m[1];
  if (/^[A-Za-z0-9_-]{6,20}$/.test(u)) return u;
  return null;
}

export function parseCoord(raw: unknown, min: number, max: number, label: string) {
  const s = String(raw ?? "").trim().replace(",", ".");
  const n = Number(s);
  if (!Number.isFinite(n)) throw new Error(`${label} noto'g'ri.`);
  if (n < min || n > max) throw new Error(`${label} oralig'i noto'g'ri.`);
  return String(n);
}

export async function setting(key: string) {
  const { rows } = await query<{ value: string }>(
    `SELECT value FROM app_settings WHERE key = $1`,
    [key]
  );
  return rows[0]?.value || "";
}

export async function setSetting(key: string, value: string) {
  await query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, value]
  );
}

export async function publicWorkers() {
  const { rows } = await query<{
    id: string;
    name: string;
    lavozim: string;
    telegram: string;
    login: string | null;
    password_hash: string | null;
  }>(`SELECT id, name, lavozim, telegram, login, password_hash FROM workers ORDER BY name`);
  return rows.map((w) => ({
    id: w.id,
    name: w.name,
    lavozim: w.lavozim,
    telegram: w.telegram,
    login: w.login || "",
    hasPassword: Boolean(w.password_hash),
  }));
}

export async function staffPublic() {
  const file = readStaffFile();
  const fileDir =
    file.director && typeof file.director === "object"
      ? (file.director as { name?: string; role?: string; bio?: string; photo?: string })
      : {};
  return {
    director: {
      name: String(fileDir.name || "").trim(),
      role: String(fileDir.role || "Direktor").trim() || "Direktor",
      bio: String(fileDir.bio || "").trim(),
      photo: String(fileDir.photo || "").trim(),
    },
    workers: readStaffFileWorkers(),
  };
}

type StaffFileWorker = { id?: string; name?: string; lavozim?: string; photo?: string };

function staffFilePath() {
  return path.join(ROOT, "data", "staff.json");
}

function readStaffFile(): { director?: unknown; workers?: StaffFileWorker[] } {
  try {
    return JSON.parse(fs.readFileSync(staffFilePath(), "utf8"));
  } catch {
    return { workers: [] };
  }
}

export function readStaffFileWorkers() {
  const file = readStaffFile();
  return (Array.isArray(file.workers) ? file.workers : [])
    .map((w) => ({
      id: String(w.id || "").trim(),
      name: String(w.name || "").trim(),
      lavozim: String(w.lavozim || "").trim(),
      photo: String(w.photo || ""),
    }))
    .filter((w) => w.name);
}

export function writeStaffFileWorkers(incoming: StaffFileWorker[]) {
  const file = readStaffFile();
  const workers = (Array.isArray(incoming) ? incoming : [])
    .map((w) => ({
      id: String(w.id || "").trim() || `p${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
      name: String(w.name || "").trim(),
      lavozim: String(w.lavozim || "").trim() || "Ishchi",
      photo: String(w.photo || ""),
    }))
    .filter((w) => w.name);
  fs.mkdirSync(path.dirname(staffFilePath()), { recursive: true });
  fs.writeFileSync(
    staffFilePath(),
    JSON.stringify({ ...file, workers }, null, 2),
    "utf8"
  );
  return workers;
}

export function writeStaffFileDirector(director: {
  name: string;
  role: string;
  bio: string;
  photo?: string;
}) {
  const file = readStaffFile();
  const prev =
    file.director && typeof file.director === "object"
      ? (file.director as { photo?: string })
      : {};
  fs.mkdirSync(path.dirname(staffFilePath()), { recursive: true });
  fs.writeFileSync(
    staffFilePath(),
    JSON.stringify(
      {
        director: {
          name: String(director.name || "").trim(),
          role: String(director.role || "Direktor").trim() || "Direktor",
          bio: String(director.bio || "").trim(),
          photo:
            director.photo !== undefined
              ? String(director.photo || "")
              : String(prev.photo || ""),
        },
        workers: Array.isArray(file.workers) ? file.workers : [],
      },
      null,
      2
    ),
    "utf8"
  );
}

export async function contactPublic() {
  const { rows } = await query(
    `SELECT phone, email, address, title, lat, lng FROM contact WHERE id = 1`
  );
  return (
    rows[0] || {
      phone: "+998 71 246-09-50",
      email: "info@soil.uz",
      address: "Qarshi, Ravoq MFY, Islom Karimov ko‘chasi, 62-uy",
      title: "Qarshi bo‘linmasi",
      lat: "38.892663",
      lng: "65.810101",
    }
  );
}

export async function mediaPublic() {
  const { rows } = await query<{ hero: string; building: string; v: number }>(
    `SELECT hero, building, v FROM site_media WHERE id = 1`
  );
  return rows[0] || { hero: "images/bo-linma.jpg", building: "images/bo-linma.jpg", v: 1 };
}

export async function galleryItems() {
  const { rows } = await query<{
    id: string;
    type: string;
    title: string;
    caption: string;
    src: string;
    created_at: string;
  }>(`SELECT id, type, title, caption, src, created_at FROM gallery_items ORDER BY sort_order ASC, created_at DESC`);
  return rows.map((it) => ({
    id: it.id,
    type: it.type,
    title: it.title,
    caption: it.caption,
    src: it.src,
    createdAt: it.created_at,
  }));
}

export async function announcementsPublic() {
  const { rows } = await query<{ id: string; title: string; message: string; created_at: string }>(
    `SELECT id, title, message, created_at FROM announcements ORDER BY inserted_at DESC LIMIT 50`
  );
  return rows.map((a) => ({
    id: a.id,
    title: a.title,
    message: a.message,
    createdAt: a.created_at,
  }));
}

export async function chatsPublic() {
  const { rows } = await query<{ chat_id: string; name: string; username: string; at: string }>(
    `SELECT chat_id, name, username, at FROM telegram_chats ORDER BY name`
  );
  return rows.map((c) => ({
    id: c.chat_id,
    name: c.name,
    username: c.username,
    at: c.at,
  }));
}

export async function overrideList() {
  const { rows } = await query<{ data: unknown }>(`SELECT data FROM district_overrides`);
  return rows.map((r) => r.data);
}

export async function publicState() {
  const hasToken = Boolean(await setting("bot_token_enc"));
  return {
    ok: true,
    hasToken,
    botUsername: await setting("bot_username"),
    workers: await publicWorkers(),
    announcements: await announcementsPublic(),
    chats: await chatsPublic(),
    districts: await overrideList(),
    media: await mediaPublic(),
    gallery: await galleryItems(),
    contact: await contactPublic(),
    staff: await staffPublic(),
  };
}

export async function syncStaffWorkers() {
  const staff = await staffPublic();
  await query(
    `UPDATE director_profile SET name = name WHERE id = 1`
  );
  return staff;
}

export async function findWorker(id: string) {
  const { rows } = await query<{
    id: string;
    name: string;
    lavozim: string;
    telegram: string;
    login: string | null;
    password_hash: string | null;
    photo: string;
  }>(`SELECT * FROM workers WHERE id = $1`, [id]);
  return rows[0] || null;
}
