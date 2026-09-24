import { query } from "./db.js";

export function todayYmd() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
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
  const dir = await query<{ name: string; role: string; bio: string; photo: string }>(
    `SELECT name, role, bio, photo FROM director_profile WHERE id = 1`
  );
  const director = dir.rows[0] || {
    name: "Bo‘linma direktori",
    role: "Direktor",
    bio: "",
    photo: "",
  };
  return { director, workers: [] };
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
  return rows[0] || { hero: "images/bo-linma.png", building: "images/bo-linma.png", v: 1 };
}

export async function galleryItems() {
  const { rows } = await query<{
    id: string;
    type: string;
    title: string;
    caption: string;
    src: string;
    poster: string;
    created_at: string;
  }>(`SELECT id, type, title, caption, src, COALESCE(poster, '') AS poster, created_at FROM gallery_items ORDER BY sort_order ASC, created_at DESC`);
  return rows.map((it) => ({
    id: it.id,
    type: it.type,
    title: it.title,
    caption: it.caption,
    src: it.src,
    poster: it.poster || "",
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
  const raw = await setting("announce_chat_ids");
  const allowed = new Set(raw.split(/[\s,]+/).filter(Boolean));
  let roles: Record<string, string> = {};
  try {
    roles = JSON.parse((await setting("panel_chat_roles")) || "{}") as Record<string, string>;
  } catch {
    roles = {};
  }
  const { rows } = await query<{ chat_id: string; name: string; username: string; at: string }>(
    `SELECT chat_id, name, username, at FROM telegram_chats ORDER BY name`
  );
  return rows.map((c) => {
    const panelRole =
      roles[c.chat_id] === "admin" || roles[c.chat_id] === "director" ? roles[c.chat_id] : "";
    return {
      id: c.chat_id,
      name: c.name,
      username: c.username,
      at: c.at,
      canAnnounce: allowed.has(c.chat_id),
      panelRole,
    };
  });
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
