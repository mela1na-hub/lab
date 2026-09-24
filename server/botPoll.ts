import { query } from "./db.js";
import { setSetting, setting } from "./lib.js";
import { announceChatIds, broadcastAnnouncement, parseAnnounceText } from "./announce.js";
import { applyUzbekBotProfile } from "./botLocale.js";
import { botToken, chatFromUpdate, telegram } from "./telegram.js";
import {
  createPanelLoginToken,
  isPanelButtonText,
  panelButtonLabel,
  panelLoginUrl,
  panelReplyKeyboard,
  panelRoleForChat,
  removeReplyKeyboard,
} from "./panelAuth.js";

const ALLOWED = encodeURIComponent('["message","edited_message","my_chat_member","callback_query"]');

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function messageText(update: any) {
  const msg = update?.message;
  if (!msg?.chat?.id || typeof msg.text !== "string") return null;
  return {
    chatId: String(msg.chat.id),
    text: msg.text.trim(),
  };
}

async function upsertChat(update: any) {
  const row = chatFromUpdate(update);
  if (!row) return;
  await query(
    `INSERT INTO telegram_chats (chat_id, name, username, at)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (chat_id) DO UPDATE SET name = EXCLUDED.name, username = EXCLUDED.username, at = EXCLUDED.at`,
    [row.id, row.name, row.username, row.at]
  );
}

async function reply(
  token: string,
  chatId: string,
  text: string,
  extra: Record<string, unknown> = {}
) {
  try {
    await telegram(token, "sendMessage", "", {
      chat_id: chatId,
      text,
      ...extra,
    });
  } catch (err) {
    console.warn("bot reply failed", err);
  }
}

async function sendPanelLink(token: string, chatId: string) {
  const role = await panelRoleForChat(chatId);
  if (!role) {
    await reply(
      token,
      chatId,
      "Sizda boshqaruv paneli ruxsati yo‘q. Sayt → Sozlamalar → Telegram botda shu chatni Admin yoki Direktor deb belgilang."
    );
    return;
  }
  try {
    const loginToken = await createPanelLoginToken(chatId, role);
    const url = panelLoginUrl(loginToken);
    const who = role === "admin" ? "sayt admin" : "direktor";
    await reply(
      token,
      chatId,
      `Boshqaruv paneli (${who}).\nHavola 5 daqiqa amal qiladi, bir marta ochiladi.`,
      {
        reply_markup: {
          inline_keyboard: [[{ text: "Boshqaruv panelini ochish", url }]],
        },
      }
    );
  } catch (err) {
    await reply(token, chatId, err instanceof Error ? err.message : "Havola yaratilmadi.");
  }
}

async function handleMessage(token: string, chatId: string, text: string) {
  const allowed = await announceChatIds();
  const isAdmin = allowed.has(chatId);
  const panelRole = await panelRoleForChat(chatId);
  const cmd = text.split(/\s+/)[0].toLowerCase().replace(/@\w+$/, "");

  if (isPanelButtonText(text) || cmd === "/panel") {
    if (!panelRole) {
      await reply(
        token,
        chatId,
        "Sizda boshqaruv paneli ruxsati yo‘q. Sozlamalarda shu chatni Admin yoki Direktor deb belgilang.",
        { reply_markup: removeReplyKeyboard() }
      );
      return;
    }
    await sendPanelLink(token, chatId);
    return;
  }

  if (cmd === "/start" || cmd === "/help") {
    if (panelRole || isAdmin) {
      const roleNote =
        panelRole === "admin"
          ? "Admin sifatida kirish mumkin."
          : panelRole === "director"
            ? "Direktor sifatida kirish mumkin."
            : "E’lon yuborishingiz mumkin (panel uchun Sozlamalarda Admin/Direktor tanlang).";
      await reply(
        token,
        chatId,
        `Assalomu alaykum.\n\n${roleNote}\n\nE’lon yuborish:\n• botga oddiy xabar yozing\n• yoki: /elon Ertaga soat 9 da yig‘ilish\n\nTezkor kirish: pastagi «${panelButtonLabel()}» tugmasi yoki /panel`,
        panelRole ? { reply_markup: panelReplyKeyboard() } : {}
      );
    } else {
      await reply(
        token,
        chatId,
        "Assalomu alaykum.\n\nBu — Qashqadaryo Tuproq Lab boti.\nIshchi uchun /start yetarli.\n\nAdmin/direktor uchun sayt sozlamalarida shu chatni belgilash kerak.",
        { reply_markup: removeReplyKeyboard() }
      );
    }
    return;
  }

  const wantsElon = cmd === "/elon" || (isAdmin && !text.startsWith("/"));
  if (!wantsElon) return;
  if (!isAdmin) {
    await reply(token, chatId, "Sizda e’lon yuborish ruxsati yo‘q. Sozlamalarda shu chatni yoqing.");
    return;
  }

  const parsed = parseAnnounceText(text);
  if (!parsed) {
    await reply(token, chatId, "E’lon matnini yozing. Masalan:\n/elon Ertaga soat 9 da yig‘ilish.");
    return;
  }

  const result = await broadcastAnnouncement({
    title: parsed.title,
    message: parsed.message,
    excludeChatId: chatId,
  });
  const extra = result.failed.length ? `\nXato: ${result.failed.slice(0, 3).join("; ")}` : "";
  await reply(token, chatId, `E’lon yuborildi: ${result.sent} kishi.${extra}`);
}

export function startBotPoller() {
  void botToken()
    .then((token) => (token ? applyUzbekBotProfile(token) : undefined))
    .catch((err) => console.warn("bot locale", err instanceof Error ? err.message : err));

  let running = false;
  const loop = async () => {
    if (running) return;
    running = true;
    try {
      await telegramPollOnce();
    } catch (err) {
      console.warn("bot poll", err instanceof Error ? err.message : err);
      await sleep(4000);
    } finally {
      running = false;
      setTimeout(() => {
        void loop();
      }, 300);
    }
  };
  void loop();
}

async function telegramPollOnce() {
  const token = await botToken();
  if (!token) {
    await sleep(8000);
    return;
  }
  try {
    await telegram(token, "deleteWebhook");
  } catch {
    /* ignore */
  }
  const startOffset = Number(await setting("telegram_offset")) || 0;
  let queryStr = `timeout=25&limit=100&allowed_updates=${ALLOWED}`;
  if (startOffset > 0) queryStr += `&offset=${startOffset}`;
  const resp = await telegram(token, "getUpdates", queryStr, undefined, 40000);
  const batch = Array.isArray(resp.result) ? resp.result : [];
  let offset = startOffset;
  for (const update of batch) {
    if (typeof update.update_id === "number" && update.update_id + 1 > offset) {
      offset = update.update_id + 1;
    }
    await upsertChat(update);
    const msg = messageText(update);
    if (msg) await handleMessage(token, msg.chatId, msg.text);
  }
  if (offset !== startOffset) await setSetting("telegram_offset", String(offset));
}
