import https from "node:https";
import { decryptSecret } from "./crypto.js";
import { setting } from "./lib.js";

export async function botToken() {
  const envTok = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (envTok) return envTok;
  const enc = await setting("bot_token_enc");
  return enc ? decryptSecret(enc) : "";
}

function telegramHttp(url: URL, body?: unknown, timeoutMs = 25000): Promise<{ status: number; data: any }> {
  const payload = body ? JSON.stringify(body) : undefined;
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: url.hostname,
        path: `${url.pathname}${url.search}`,
        method: payload ? "POST" : "GET",
        family: 4,
        timeout: timeoutMs,
        headers: payload
          ? {
              "Content-Type": "application/json",
              "Content-Length": Buffer.byteLength(payload),
            }
          : undefined,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          try {
            resolve({ status: res.statusCode || 0, data: raw ? JSON.parse(raw) : {} });
          } catch {
            reject(new Error("Telegram javobi o'qilmadi."));
          }
        });
      }
    );
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Telegramga ulanish vaqti tugadi."));
    });
    req.on("error", (err) => {
      reject(new Error(err.message || "Telegramga ulanib bo'lmadi."));
    });
    if (payload) req.write(payload);
    req.end();
  });
}

export async function telegram(
  token: string,
  method: string,
  query = "",
  body?: unknown,
  timeoutMs = 25000
) {
  const url = new URL(`https://api.telegram.org/bot${token}/${method}`);
  if (query) {
    for (const part of query.split("&")) {
      const [k, v] = part.split("=");
      if (k) url.searchParams.set(k, decodeURIComponent(v || ""));
    }
  }
  const { status, data } = await telegramHttp(url, body, timeoutMs);
  if (status >= 400 || data?.ok === false) {
    throw new Error(data?.description || "Telegram xatosi");
  }
  return data as { ok?: boolean; description?: string; result?: any };
}

export async function resolveChatId(token: string, raw: string) {
  const v = raw.trim();
  if (!v) throw new Error("Bo'sh Telegram manzili");
  if (/^-?\d+$/.test(v)) return v;
  const user = v.replace(/^@/, "");
  const resp = await telegram(token, "getChat", `chat_id=${encodeURIComponent("@" + user)}`);
  const id = resp.result?.id;
  if (!id) throw new Error(`@${user} uchun chat_id topilmadi. Ishchi botga /start yozishi kerak.`);
  return String(id);
}

export type TelegramChatRow = {
  id: string;
  name: string;
  username: string;
  at: string;
};

export function chatFromUpdate(u: any): TelegramChatRow | null {
  const msg = u?.message || u?.edited_message || u?.channel_post;
  let chat = msg?.chat;
  let at = String(msg?.date || "");
  if (!chat && u?.my_chat_member?.chat) {
    chat = u.my_chat_member.chat;
    at = String(u.my_chat_member.date || "");
  }
  if (!chat && u?.callback_query?.message?.chat) {
    chat = u.callback_query.message.chat;
    at = String(u.callback_query.message.date || "");
  }
  if (!chat?.id) return null;
  let name = `${chat.first_name || ""} ${chat.last_name || ""}`.trim();
  if (!name) name = chat.title || String(chat.id);
  return {
    id: String(chat.id),
    name,
    username: String(chat.username || ""),
    at,
  };
}

export async function fetchTelegramUpdates(token: string, startOffset = 0) {
  try {
    await telegram(token, "deleteWebhook");
  } catch {
    /* ignore */
  }
  const allowed = encodeURIComponent('["message","edited_message","my_chat_member","callback_query"]');
  let offset = startOffset;
  const chats: TelegramChatRow[] = [];
  let retried = false;
  for (let page = 0; page < 15; page++) {
    let queryStr = `timeout=0&limit=100&allowed_updates=${allowed}`;
    if (offset > 0) queryStr += `&offset=${offset}`;
    const resp = await telegram(token, "getUpdates", queryStr);
    const raw = resp.result;
    const batch = Array.isArray(raw) ? raw : raw ? [raw] : [];
    if (!batch.length) {
      if (!retried && offset > 0) {
        retried = true;
        offset = 0;
        continue;
      }
      break;
    }
    for (const u of batch) {
      if (typeof u.update_id === "number" && u.update_id + 1 > offset) {
        offset = u.update_id + 1;
      }
      const row = chatFromUpdate(u);
      if (row) chats.push(row);
    }
    if (batch.length < 100) break;
  }
  return { offset, chats };
}
