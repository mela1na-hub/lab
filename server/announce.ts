import { query } from "./db.js";
import { announcementsPublic, setSetting, setting } from "./lib.js";
import { botToken, resolveChatId, telegram } from "./telegram.js";
import { workerId } from "./crypto.js";

export async function announceChatIds() {
  const raw = await setting("announce_chat_ids");
  return new Set(raw.split(/[\s,]+/).filter(Boolean));
}

export async function setAnnounceChat(chatId: string, enabled: boolean) {
  const ids = await announceChatIds();
  if (enabled) ids.add(chatId);
  else ids.delete(chatId);
  await setSetting("announce_chat_ids", [...ids].join(","));
}

export function parseAnnounceText(raw: string) {
  let text = String(raw || "").trim();
  if (!text) return null;
  if (/^\/elon(@\w+)?(\s|$)/i.test(text)) {
    text = text.replace(/^\/elon(@\w+)?\s*/i, "").trim();
  }
  if (!text) return null;
  const nl = text.indexOf("\n");
  if (nl > 0) {
    const title = text.slice(0, nl).trim();
    const message = text.slice(nl + 1).trim();
    return { title: title || "E'lon", message: message || title };
  }
  return { title: "E'lon", message: text };
}

export async function broadcastAnnouncement(opts: {
  title: string;
  message: string;
  excludeChatId?: string;
}) {
  const title = String(opts.title || "").trim() || "E'lon";
  const message = String(opts.message || "").trim();
  if (!message) throw new Error("E'lon matni bo'sh.");
  const id = workerId();
  const createdAt = new Date().toISOString().slice(0, 16).replace("T", " ");
  await query(
    `INSERT INTO announcements (id, title, message, created_at) VALUES ($1,$2,$3,$4)`,
    [id, title, message, createdAt]
  );

  const token = await botToken();
  const text = title === "E'lon" ? message : `${title}\n\n${message}`;
  let sent = 0;
  const failed: string[] = [];
  const targets = new Map<string, string>();
  const { rows: workers } = await query<{ name: string; telegram: string }>(
    `SELECT name, telegram FROM workers`
  );
  for (const w of workers) {
    const raw = String(w.telegram || "").trim();
    if (!raw) continue;
    try {
      const chatId = token ? await resolveChatId(token, raw) : raw;
      if (chatId) targets.set(String(chatId), w.name);
    } catch {
      targets.set(raw, w.name);
    }
  }
  const chats = await query<{ chat_id: string; name: string }>(
    `SELECT chat_id, name FROM telegram_chats`
  );
  for (const c of chats.rows) {
    if (c.chat_id && !targets.has(c.chat_id)) {
      targets.set(c.chat_id, c.name || c.chat_id);
    }
  }
  if (opts.excludeChatId) targets.delete(opts.excludeChatId);

  if (!token) {
    failed.push("Bot token yo'q.");
  } else if (!targets.size) {
    failed.push("Qabul qiluvchi yo'q. Avval botga /start yozishsin.");
  } else {
    for (const [chatId, label] of targets) {
      try {
        const resp = await telegram(token, "sendMessage", "", { chat_id: chatId, text });
        if (resp.ok || resp.result?.message_id) sent += 1;
        else failed.push(`${label} : Telegram rad etdi`);
      } catch (err) {
        failed.push(`${label} : ${err instanceof Error ? err.message : "xato"}`);
      }
    }
  }

  return {
    id,
    sent,
    failed,
    announcements: await announcementsPublic(),
  };
}
