import https from "node:https";
import { decryptSecret } from "./crypto.js";
import { setting } from "./lib.js";

export async function botToken() {
  const envTok = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (envTok) return envTok;
  const enc = await setting("bot_token_enc");
  return enc ? decryptSecret(enc) : "";
}

/** Telegram API description (inglizcha) → foydalanuvchi uchun o‘zbekcha matn. */
export function telegramErrorUz(raw: string | undefined | null): string {
  const src = String(raw || "").trim();
  if (!src) return "Telegram xatosi.";
  const s = src.toLowerCase();

  if (s.includes("chat not found") || s.includes("peer_id_invalid")) {
    return "Chat topilmadi. Chat_id noto‘g‘ri yoki odam botga /start yozmagan.";
  }
  if (s.includes("chat_id is empty")) {
    return "Chat_id bo‘sh. Telegram manzilini to‘ldiring.";
  }
  if (s.includes("bot was blocked by the user")) {
    return "Foydalanuvchi botni bloklagan.";
  }
  if (s.includes("user is deactivated")) {
    return "Foydalanuvchi akkaunti o‘chirilgan.";
  }
  if (s.includes("bot can't initiate conversation") || s.includes("can't initiate conversation")) {
    return "Bot suhbat boshlay olmaydi. Avval odam botga /start yozishi kerak.";
  }
  if (s.includes("bot was kicked") || s.includes("bot is not a member")) {
    return "Bot guruhdan chiqarilgan yoki a’zo emas.";
  }
  if (s.includes("have no rights to send") || s.includes("not enough rights")) {
    return "Botda xabar yuborish huquqi yo‘q.";
  }
  if (s.includes("message text is empty")) {
    return "Xabar matni bo‘sh.";
  }
  if (s.includes("message is too long")) {
    return "Xabar juda uzun. Qisqaroq yozing.";
  }
  if (s.includes("can't parse entities") || s.includes("can't find end of the entity")) {
    return "Xabar formatida xato (HTML/Markdown). Matnni soddalashtiring.";
  }
  if (s.includes("too many requests") || s.includes("retry after")) {
    const m = src.match(/retry after (\d+)/i);
    return m
      ? `Juda ko‘p so‘rov. ${m[1]} soniyadan so‘ng qayta urinib ko‘ring.`
      : "Juda ko‘p so‘rov. Birozdan so‘ng qayta urinib ko‘ring.";
  }
  if (s.includes("unauthorized") || s.includes("token is invalid")) {
    return "Bot tokeni noto‘g‘ri yoki bekor qilingan. Sozlamalarda yangilang.";
  }
  if (s.includes("conflict") && s.includes("getupdates")) {
    return "Bot boshqa joyda ham ishlayapti (getUpdates conflict). Boshqa server/skriptni to‘xtating.";
  }
  if (s.includes("group chat was upgraded")) {
    return "Guruh super-guruhga o‘zgargan. Yangi chat_id kerak.";
  }
  if (s.includes("wrong file identifier") || s.includes("failed to get http url content")) {
    return "Fayl yoki rasm manzili noto‘g‘ri.";
  }
  if (s.includes("message to delete not found") || s.includes("message to edit not found")) {
    return "Xabar topilmadi (o‘chirilgan yoki eskirgan).";
  }
  if (s.includes("reply message not found")) {
    return "Javob beriladigan xabar topilmadi.";
  }
  if (s.startsWith("bad request:") || s.startsWith("forbidden:") || s.startsWith("not found:")) {
    const rest = src.replace(/^(Bad Request|Forbidden|Not Found)\s*:\s*/i, "").trim();
    return rest ? `Telegram rad etdi: ${rest}` : "Telegram so‘rovni rad etdi.";
  }
  if (/^[a-z].*[a-z]$/i.test(src) && /[A-Za-z]{4,}/.test(src) && !/[а-яёўқғҳ]/i.test(src)) {
    return `Telegram xatosi: ${src}`;
  }
  return src;
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
    throw new Error(telegramErrorUz(data?.description));
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
