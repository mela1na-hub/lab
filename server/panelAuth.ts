import { query } from "./db.js";
import { setSetting, setting } from "./lib.js";
import { randomId, sha256 } from "./crypto.js";
import { setAnnounceChat } from "./announce.js";
import { PUBLIC_URL, publicOrigin } from "./env.js";

export type PanelRole = "admin" | "director";

const TOKEN_TTL_MS = 5 * 60 * 1000;
const BTN = "Boshqaruv paneli";

export function panelButtonLabel() {
  return BTN;
}

export function isPanelButtonText(text: string) {
  const t = String(text || "").trim().toLowerCase();
  return t === BTN.toLowerCase() || t === "/panel" || t.startsWith("/panel@");
}

export async function panelChatRoles(): Promise<Map<string, PanelRole>> {
  const raw = await setting("panel_chat_roles");
  const map = new Map<string, PanelRole>();
  if (!raw) return map;
  try {
    const obj = JSON.parse(raw) as Record<string, string>;
    for (const [id, role] of Object.entries(obj || {})) {
      if (role === "admin" || role === "director") map.set(String(id), role);
    }
  } catch {
    /* ignore broken json */
  }
  return map;
}

export async function panelRoleForChat(chatId: string): Promise<PanelRole | null> {
  const map = await panelChatRoles();
  return map.get(String(chatId)) || null;
}

/** Belgilangan chat: e’lon + panel kirish (admin yoki direktor). */
export async function setPanelChatRole(chatId: string, role: PanelRole | null) {
  const id = String(chatId || "").trim();
  if (!id) throw new Error("chat_id kerak.");
  const map = await panelChatRoles();
  if (role) map.set(id, role);
  else map.delete(id);
  await setSetting("panel_chat_roles", JSON.stringify(Object.fromEntries(map)));
  await setAnnounceChat(id, Boolean(role));
}

export async function createPanelLoginToken(chatId: string, role: PanelRole) {
  const username = role === "admin" ? "admin" : "director";
  const { rows } = await query<{ id: string }>(`SELECT id FROM users WHERE username = $1`, [username]);
  const user = rows[0];
  if (!user) throw new Error(`${username} akkaunti topilmadi.`);
  const token = randomId(24);
  const expires = new Date(Date.now() + TOKEN_TTL_MS).toISOString();
  await query(
    `INSERT INTO tg_login_tokens (token_hash, user_id, chat_id, role, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [sha256(token), user.id, String(chatId), role, expires]
  );
  return token;
}

export async function consumePanelLoginToken(token: string) {
  const hash = sha256(String(token || "").trim());
  if (!hash || hash.length < 16) return null;
  const { rows } = await query<{
    token_hash: string;
    user_id: string;
    chat_id: string;
    role: string;
    expires_at: string;
    used_at: string | null;
  }>(`SELECT * FROM tg_login_tokens WHERE token_hash = $1`, [hash]);
  const row = rows[0];
  if (!row) return null;
  if (row.used_at) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  const role = await panelRoleForChat(row.chat_id);
  if (!role || role !== row.role) return null;
  await query(`UPDATE tg_login_tokens SET used_at = now() WHERE token_hash = $1`, [hash]);
  return { userId: row.user_id, role: row.role as PanelRole, chatId: row.chat_id };
}

export function panelLoginUrl(token: string, reqHost?: string, proto?: string) {
  const base = (PUBLIC_URL || publicOrigin(reqHost, proto).replace(/\/$/, "")).replace(/\/$/, "");
  return `${base}/api/tg-login?t=${encodeURIComponent(token)}`;
}

export function panelReplyKeyboard() {
  return {
    keyboard: [[{ text: BTN }]],
    resize_keyboard: true,
    is_persistent: true,
  };
}

export function removeReplyKeyboard() {
  return { remove_keyboard: true };
}
