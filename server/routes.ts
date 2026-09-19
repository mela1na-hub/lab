import fs from "node:fs";
import path from "node:path";
import type { Express, Request, Response, NextFunction } from "express";
import express from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { ROOT, MIN_PASSWORD, publicOrigin, isProd } from "./env.js";
import { query } from "./db.js";
import {
  COOKIE,
  cookieOptions,
  clearCookieOptions,
  createSession,
  destroySession,
  destroyRoleSessions,
  requireAuth,
  setWorkerOnSession,
  type AuthUser,
} from "./auth.js";
import {
  decryptSecret,
  encryptSecret,
  galleryId,
  hashPassword,
  randomId,
  sha256,
  verifyPassword,
  workerId,
} from "./crypto.js";
import {
  announcementsPublic,
  chatsPublic,
  contactPublic,
  findWorker,
  galleryItems,
  isRestDay,
  mediaPublic,
  overrideList,
  parseCoord,
  publicState,
  publicWorkers,
  setSetting,
  setting,
  staffPublic,
  todayYmd,
  workerBrief,
  writeStaffFileDirector,
  writeStaffFileWorkers,
  youtubeId,
} from "./lib.js";
import { fetchTelegramUpdates, resolveChatId, telegram } from "./telegram.js";

const loginSchema = z.object({
  username: z.string().trim().min(1).max(80),
  password: z.string().min(1).max(200),
});

function fail(res: Response, status: number, error: string) {
  res.status(status).json({ ok: false, error });
}

function clientIp(req: Request) {
  const xf = req.headers["x-forwarded-for"];
  if (typeof xf === "string" && xf) return xf.split(",")[0].trim();
  return req.ip || "unknown";
}

async function botToken() {
  const envTok = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (envTok) return envTok;
  const enc = await setting("bot_token_enc");
  return enc ? decryptSecret(enc) : "";
}

async function ingestTelegramChats(token: string) {
  const startOffset = Number(await setting("telegram_offset")) || 0;
  const { offset, chats } = await fetchTelegramUpdates(token, startOffset);
  for (const row of chats) {
    await query(
      `INSERT INTO telegram_chats (chat_id, name, username, at)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (chat_id) DO UPDATE SET name = EXCLUDED.name, username = EXCLUDED.username, at = EXCLUDED.at`,
      [row.id, row.name, row.username, row.at]
    );
  }
  await setSetting("telegram_offset", String(offset));
  return chatsPublic();
}

async function resolveWorkerTelegram(raw: string) {
  const v = raw.trim();
  if (!v) return "";
  if (/^-?\d+$/.test(v)) return v;
  const user = v.replace(/^@/, "").toLowerCase();
  const { rows } = await query<{ chat_id: string }>(
    `SELECT chat_id FROM telegram_chats WHERE LOWER(username) = $1 LIMIT 1`,
    [user]
  );
  if (rows[0]?.chat_id) return rows[0].chat_id;
  const tok = await botToken();
  if (!tok) return v;
  try {
    return await resolveChatId(tok, v);
  } catch {
    return v;
  }
}

async function recordAttempt(ip: string, username: string, success: boolean) {
  await query(
    `INSERT INTO login_attempts (ip, username, success) VALUES ($1,$2,$3)`,
    [ip, username, success]
  );
}

async function tooManyAttempts(ip: string, username: string) {
  const { rows } = await query<{ n: string }>(
    `SELECT count(*)::text AS n FROM login_attempts
     WHERE success = false AND created_at > now() - interval '15 minutes'
       AND (ip = $1 OR username = $2)`,
    [ip, username]
  );
  return Number(rows[0].n) >= 8;
}

const loginLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: "Ko‘p urinish. 15 daqiqadan so‘ng qayta urinib ko‘ring." },
});

async function getUserByUsername(username: string) {
  const { rows } = await query<{
    id: string;
    username: string;
    password_hash: string;
    role: AuthUser["role"];
    label: string;
    worker_id: string | null;
    failed_attempts: number;
    locked_until: Date | null;
  }>(`SELECT * FROM users WHERE username = $1`, [username]);
  return rows[0] || null;
}

export function mountApi(app: Express) {
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/site-link", (req, res) => {
    res.json({ ok: true, url: publicOrigin(req.get("host") || undefined, req.protocol) });
  });

  app.post("/api/login", loginLimit, async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, "Login yoki parol noto'g'ri.");
    const username = parsed.data.username.trim().toLowerCase();
    const password = parsed.data.password;
    const ip = clientIp(req);
    if (await tooManyAttempts(ip, username)) {
      return fail(res, 429, "Ko‘p urinish. 15 daqiqadan so‘ng qayta urinib ko‘ring.");
    }
    const user = await getUserByUsername(username);
    if (!user) {
      await recordAttempt(ip, username, false);
      return fail(res, 401, "Login yoki parol noto'g'ri.");
    }
    if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
      return fail(res, 423, "Hisob vaqtincha yopilgan. Keyinroq urinib ko‘ring.");
    }
    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) {
      const fails = user.failed_attempts + 1;
      const lock =
        fails >= 8 ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null;
      await query(
        `UPDATE users SET failed_attempts = $2, locked_until = $3, updated_at = now() WHERE id = $1`,
        [user.id, fails, lock]
      );
      await recordAttempt(ip, username, false);
      return fail(res, 401, "Login yoki parol noto'g'ri.");
    }
    await query(
      `UPDATE users SET failed_attempts = 0, locked_until = NULL, updated_at = now() WHERE id = $1`,
      [user.id]
    );
    await recordAttempt(ip, username, true);
    const sid = await createSession(user.id);
    res.cookie(COOKIE, sid, cookieOptions(req));
    res.json({
      ok: true,
      username: user.username,
      role: user.role,
      label: user.label,
      workerId: user.worker_id || "",
    });
  });

  app.post("/api/logout", async (req, res) => {
    const sid = req.cookies?.[COOKIE];
    if (sid) await destroySession(sid);
    res.cookie(COOKIE, "", clearCookieOptions(req));
    res.json({ ok: true });
  });

  app.get("/api/me", requireAuth(), (req, res) => {
    const u = req.user!;
    res.json({
      ok: true,
      username: u.username,
      role: u.role,
      label: u.label,
      workerId: u.workerId,
    });
  });

  app.post("/api/password-change", requireAuth(), async (req, res) => {
    const current = String(req.body?.currentPassword || "");
    const next = String(req.body?.newPassword || "").trim();
    if (next.length < MIN_PASSWORD) return fail(res, 400, `Parol kamida ${MIN_PASSWORD} belgi bo'lsin.`);
    const user = await getUserByUsername(req.user!.username);
    if (!user || !(await verifyPassword(current, user.password_hash))) {
      return fail(res, 403, "Hozirgi parol noto'g'ri.");
    }
    await query(`UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1`, [
      user.id,
      await hashPassword(next),
    ]);
    res.json({ ok: true });
  });

  app.post("/api/password-reset/request", loginLimit, async (req, res) => {
    const username = String(req.body?.username || "").trim().toLowerCase();
    const user = username ? await getUserByUsername(username) : null;
    if (user) {
      const token = randomId(24);
      await query(
        `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
         VALUES ($1, $2, now() + interval '1 hour')`,
        [user.id, sha256(token)]
      );
      if (!isProd) {
        console.log(`Password reset token for ${username} (development only): ${token}`);
      }
    }
    res.json({ ok: true });
  });

  app.post("/api/password-reset/confirm", async (req, res) => {
    const token = String(req.body?.token || "");
    const next = String(req.body?.newPassword || "").trim();
    if (!token || next.length < MIN_PASSWORD) {
      return fail(res, 400, "Token va yangi parol kerak.");
    }
    const { rows } = await query<{ id: string; user_id: string }>(
      `SELECT id, user_id FROM password_reset_tokens
       WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()`,
      [sha256(token)]
    );
    const row = rows[0];
    if (!row) return fail(res, 400, "Token eskirgan yoki noto'g'ri.");
    await query(`UPDATE users SET password_hash = $2, failed_attempts = 0, locked_until = NULL, updated_at = now() WHERE id = $1`, [
      row.user_id,
      await hashPassword(next),
    ]);
    await query(`UPDATE password_reset_tokens SET used_at = now() WHERE id = $1`, [row.id]);
    res.json({ ok: true });
  });

  app.get("/api/state", requireAuth(["admin", "director"]), async (_req, res) => {
    res.json(await publicState());
  });

  app.get("/api/announcements", requireAuth(["director", "worker"]), async (_req, res) => {
    res.json({ ok: true, announcements: await announcementsPublic() });
  });

  app.get("/api/daily/workers", requireAuth(["director", "worker"]), async (_req, res) => {
    const today = todayYmd();
    const restToday = isRestDay(today);
    const { rows: logs } = await query<{ worker_id: string }>(
      `SELECT worker_id FROM daily_logs WHERE date = $1`,
      [today]
    );
    const logged = new Set(logs.map((l) => l.worker_id));
    const { rows: workers } = await query<{ id: string; name: string; lavozim: string }>(
      `SELECT id, name, lavozim FROM workers ORDER BY name`
    );
    const list = workers.map((w) => ({
      id: w.id,
      name: w.name,
      lavozim: w.lavozim,
      todayStatus: restToday ? "rest" : logged.has(w.id) ? "ok" : "miss",
    }));
    res.json({
      ok: true,
      today,
      workerId: _req.user?.workerId || "",
      workers: list,
    });
  });

  app.get("/api/daily/logs", requireAuth(["director", "worker"]), async (req, res) => {
    const auth = req.user!;
    let workerIdQ = String(req.query.workerId || "").trim();
    if (auth.role === "worker") {
      const own = auth.workerId;
      if (!own) return fail(res, 403, "Avval ismingizni tanlang.");
      if (!workerIdQ) workerIdQ = own;
      if (workerIdQ !== own) return fail(res, 403, "Ruxsat yo'q.");
    }
    if (!workerIdQ) return fail(res, 400, "Ishchi tanlanmadi.");
    const worker = await findWorker(workerIdQ);
    if (!worker) return fail(res, 404, "Ishchi topilmadi.");
    const now = new Date();
    let year = now.getFullYear();
    let month = now.getMonth() + 1;
    const yRaw = String(req.query.year || "");
    const mRaw = String(req.query.month || "");
    if (/^[0-9]{4}$/.test(yRaw)) year = Number(yRaw);
    if (/^[0-9]{1,2}$/.test(mRaw)) month = Number(mRaw);
    if (year < 2000 || year > 2100) year = now.getFullYear();
    if (month < 1 || month > 12) month = now.getMonth() + 1;
    const { rows } = await query<{ date: string; text: string }>(
      `SELECT to_char(date,'YYYY-MM-DD') AS date, text FROM daily_logs
       WHERE worker_id = $1 AND date >= make_date($2,$3,1)
         AND date < make_date($2,$3,1) + interval '1 month'
       ORDER BY date`,
      [workerIdQ, year, month]
    );
    res.json({
      ok: true,
      today: todayYmd(),
      year,
      month,
      worker: workerBrief(worker),
      logs: rows,
    });
  });

  app.post("/api/daily/identity", requireAuth(["worker"]), async (req, res) => {
    const auth = req.user!;
    if (auth.username !== "ishchi" && auth.workerId) {
      return res.json({ ok: true, workerId: auth.workerId, label: auth.label });
    }
    const workerIdBody = String(req.body?.workerId || "").trim();
    const name = String(req.body?.name || "").trim();
    const lavozim = String(req.body?.lavozim || "").trim() || "Ishchi";
    let worker = workerIdBody ? await findWorker(workerIdBody) : null;
    if (!worker && name) {
      const found = await query<{ id: string }>(`SELECT id FROM workers WHERE lower(name) = lower($1)`, [name]);
      if (found.rows[0]) worker = await findWorker(found.rows[0].id);
      else {
        const id = workerId();
        await query(
          `INSERT INTO workers (id, name, lavozim) VALUES ($1,$2,$3)`,
          [id, name, lavozim]
        );
        worker = await findWorker(id);
      }
    }
    if (!worker) return fail(res, 400, "Ismingizni yozing yoki ro'yxatdan tanlang.");
    await setWorkerOnSession(auth.id, worker.id, worker.name);
    res.json({ ok: true, workerId: worker.id, label: worker.name });
  });

  app.post("/api/daily/staff", requireAuth(["director"]), async (req, res) => {
    const name = String(req.body?.name || "").trim();
    const lavozim = String(req.body?.lavozim || "").trim() || "Ishchi";
    const id = String(req.body?.id || "").trim();
    if (id) {
      const { rowCount } = await query(
        `UPDATE workers SET name = $2, lavozim = $3, updated_at = now() WHERE id = $1`,
        [id, name, lavozim]
      );
      if (!rowCount) return fail(res, 404, "Ishchi topilmadi.");
      const worker = await findWorker(id);
      return res.json({ ok: true, worker: workerBrief(worker!) });
    }
    if (!name) return fail(res, 400, "Ishchi ismini yozing.");
    const existing = await query<{ id: string }>(`SELECT id FROM workers WHERE lower(name) = lower($1)`, [name]);
    if (existing.rows[0]) {
      const worker = await findWorker(existing.rows[0].id);
      return res.json({ ok: true, worker: workerBrief(worker!) });
    }
    const nid = workerId();
    await query(`INSERT INTO workers (id, name, lavozim) VALUES ($1,$2,$3)`, [nid, name, lavozim]);
    const worker = await findWorker(nid);
    res.json({ ok: true, worker: workerBrief(worker!) });
  });

  app.post("/api/daily/staff/delete", requireAuth(["director"]), async (req, res) => {
    const id = String(req.body?.id || "").trim();
    const { rowCount } = await query(`DELETE FROM workers WHERE id = $1`, [id]);
    if (!rowCount) return fail(res, 404, "Ishchi topilmadi.");
    res.json({ ok: true });
  });

  app.post("/api/daily/logs", requireAuth(["worker"]), async (req, res) => {
    const auth = req.user!;
    let wid = auth.workerId || String(req.body?.workerId || "").trim();
    const worker = await findWorker(wid);
    if (!worker) return fail(res, 400, "Avval ismingizni tanlang.");
    if (auth.workerId && auth.workerId !== worker.id) return fail(res, 403, "Ruxsat yo'q.");
    const dateStr = String(req.body?.date || todayYmd()).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return fail(res, 400, "Sana noto'g'ri.");
    if (isRestDay(dateStr)) return fail(res, 400, "Dam olish kuni.");
    const text = String(req.body?.text || "").trim();
    if (!text) return fail(res, 400, "Bugungi ishni yozing.");
    const id = randomId(8);
    await query(
      `INSERT INTO daily_logs (id, worker_id, date, text, updated_at)
       VALUES ($1,$2,$3,$4, now())
       ON CONFLICT (worker_id, date) DO UPDATE SET text = EXCLUDED.text, updated_at = now()`,
      [id, worker.id, dateStr, text]
    );
    res.json({ ok: true, date: dateStr, text, workerId: worker.id });
  });

  app.post("/api/token", requireAuth(["admin"]), async (req, res) => {
    const token = String(req.body?.token || "").trim();
    if (!token) {
      await setSetting("bot_token_enc", "");
      await setSetting("bot_username", "");
      return res.json({ ok: true, hasToken: false, botUsername: "" });
    }
    if (!/^\d+:[A-Za-z0-9_-]+$/.test(token)) {
      return fail(res, 400, "Token formati noto'g'ri. BotFather'dan olingan to'liq tokenni yozing.");
    }
    const me = await telegram(token, "getMe");
    try {
      await telegram(token, "deleteWebhook");
    } catch {
      /* ignore */
    }
    const uname = String(me.result?.username || me.username || "");
    await setSetting("bot_token_enc", encryptSecret(token));
    await setSetting("bot_username", uname);
    await setSetting("telegram_offset", "0");
    let chats: unknown[] = [];
    try {
      chats = await ingestTelegramChats(token);
    } catch {
      chats = await chatsPublic();
    }
    res.json({ ok: true, hasToken: true, botUsername: uname, chats });
  });

  app.post("/api/workers", requireAuth(["admin"]), async (req, res) => {
    const incoming = Array.isArray(req.body?.workers) ? req.body.workers : [];
    const existing = await query(`SELECT * FROM workers`);
    const oldMap = new Map<string, any>();
    for (const ow of existing.rows) {
      oldMap.set(ow.id, ow);
      oldMap.set(`${String(ow.name).trim().toLowerCase()}|${ow.telegram || ""}`, ow);
    }
    const used = new Set(["director", "admin", "ishchi"]);
    const kept: any[] = [];
    for (const w of incoming) {
      const name = String(w.name || "").trim();
      if (!name) continue;
      const lavozim = String(w.lavozim || "").trim() || "Ishchi";
      const wid = String(w.id || "").trim();
      const old =
        (wid && oldMap.get(wid)) ||
        oldMap.get(`${name.toLowerCase()}|${String(w.telegram || "").trim()}`) ||
        null;
      const telegram = await resolveWorkerTelegram(String(w.telegram || old?.telegram || ""));
      const id = wid || old?.id || workerId();
      let login = String(w.login || old?.login || "").trim().toLowerCase() || null;
      if (login && used.has(login) && login !== old?.login) {
        return fail(res, 400, `Login band: ${login}`);
      }
      if (login) used.add(login);
      let passwordHash = old?.password_hash || null;
      const newPass = String(w.password || "").trim();
      if (newPass) {
        if (newPass.length < MIN_PASSWORD) {
          return fail(res, 400, `Parol kamida ${MIN_PASSWORD} belgi bo'lsin.`);
        }
        passwordHash = await hashPassword(newPass);
      }
      kept.push({
        id,
        name,
        lavozim,
        telegram,
        login,
        password_hash: passwordHash,
        photo: old?.photo || "",
      });
    }
    const keepIds = kept.map((w) => w.id);
    if (keepIds.length) {
      await query(`DELETE FROM workers WHERE NOT (id = ANY($1::text[]))`, [keepIds]);
    } else {
      await query(`DELETE FROM workers`);
    }
    for (const w of kept) {
      await query(
        `INSERT INTO workers (id, name, lavozim, telegram, login, password_hash, photo, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7, now())
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           lavozim = EXCLUDED.lavozim,
           telegram = EXCLUDED.telegram,
           login = EXCLUDED.login,
           password_hash = COALESCE(EXCLUDED.password_hash, workers.password_hash),
           photo = COALESCE(NULLIF(EXCLUDED.photo,''), workers.photo),
           updated_at = now()`,
        [w.id, w.name, w.lavozim, w.telegram, w.login, w.password_hash, w.photo]
      );
      if (w.login && w.password_hash) {
        await query(
          `INSERT INTO users (username, password_hash, role, label, worker_id)
           VALUES ($1,$2,'worker',$3,$4)
           ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash, worker_id = EXCLUDED.worker_id, label = EXCLUDED.label`,
          [w.login, w.password_hash, w.name, w.id]
        );
      }
    }
    res.json({ ok: true, workers: await publicWorkers() });
  });

  app.post("/api/staff", requireAuth(["admin"]), async (req, res) => {
    const name = String(req.body?.name || "").trim();
    const role = String(req.body?.role || "").trim() || "Direktor";
    const bio = String(req.body?.bio || "").trim();
    if (!name) return fail(res, 400, "Direktor ismi kerak.");
    await query(
      `UPDATE director_profile SET name = $1, role = $2, bio = $3, updated_at = now() WHERE id = 1`,
      [name, role, bio]
    );
    writeStaffFileDirector({ name, role, bio });
    res.json({ ok: true, staff: await staffPublic() });
  });

  app.post("/api/staff/workers", requireAuth(["admin"]), async (req, res) => {
    const incoming = Array.isArray(req.body?.workers) ? req.body.workers : [];
    writeStaffFileWorkers(incoming);
    res.json({ ok: true, staff: await staffPublic() });
  });

  app.post("/api/passwords", requireAuth(["admin"]), async (req, res) => {
    const current = String(req.body?.currentPassword || "");
    const newAdmin = String(req.body?.adminPassword || "").trim();
    const newDirector = String(req.body?.directorPassword || "").trim();
    const newWorker = String(req.body?.workerPassword || "").trim();
    const admin = await getUserByUsername("admin");
    if (!admin || !(await verifyPassword(current, admin.password_hash))) {
      return fail(res, 403, "Hozirgi sayt admin paroli noto'g'ri.");
    }
    if (!newAdmin && !newDirector && !newWorker) return fail(res, 400, "Yangi parol yozing.");
    const changed: string[] = [];
    const bump = async (username: string, pass: string, role: "admin" | "director" | "worker") => {
      if (!pass) return;
      if (pass.length < MIN_PASSWORD) throw new Error(`${username} paroli kamida ${MIN_PASSWORD} belgi bo'lsin.`);
      await query(`UPDATE users SET password_hash = $2, updated_at = now() WHERE username = $1`, [
        username,
        await hashPassword(pass),
      ]);
      changed.push(role);
      await destroyRoleSessions(role);
    };
    try {
      await bump("admin", newAdmin, "admin");
      await bump("director", newDirector, "director");
      await bump("ishchi", newWorker, "worker");
    } catch (err) {
      return fail(res, 400, err instanceof Error ? err.message : "Parol xato.");
    }
    res.json({ ok: true, changed });
  });

  app.post("/api/districts", requireAuth(["director", "worker"]), async (req, res) => {
    const incoming = req.body?.districts
      ? req.body.districts
      : req.body?.id
        ? [req.body]
        : [];
    for (const d of incoming) {
      const id = String(d.id || "").trim();
      if (!id) continue;
      await query(
        `INSERT INTO district_overrides (id, data) VALUES ($1, $2::jsonb)
         ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
        [id, JSON.stringify(d)]
      );
    }
    const list = await overrideList();
    res.json({ ok: true, count: list.length, districts: list });
  });

  app.post("/api/districts/delete", requireAuth(["director", "worker"]), async (req, res) => {
    const id = String(req.body?.id || "").trim().toLowerCase();
    if (!id) return fail(res, 400, "Hisobot id kerak.");
    const base = await query(`SELECT id FROM districts WHERE id = $1`, [id]);
    const isBase = Boolean(base.rows[0]);
    const cur = await query<{ data: any }>(`SELECT data FROM district_overrides WHERE id = $1`, [id]);
    const file = cur.rows[0]?.data?.file;
    if (file && String(file).startsWith("files/reports/")) {
      const full = path.join(ROOT, String(file).replace(/\//g, path.sep));
      if (fs.existsSync(full)) fs.unlinkSync(full);
    }
    if (isBase) {
      await query(
        `INSERT INTO district_overrides (id, data) VALUES ($1, $2::jsonb)
         ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
        [id, JSON.stringify({ id, deleted: true })]
      );
    } else {
      await query(`DELETE FROM district_overrides WHERE id = $1`, [id]);
    }
    res.json({ ok: true, districts: await overrideList() });
  });

  app.post(
    "/api/districts/file",
    requireAuth(["director", "worker"]),
    express.raw({ type: "*/*", limit: "20mb" }),
    async (req, res) => {
      const id = String(req.query.id || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "-");
      const filename = String(req.query.filename || "").trim();
      if (!/^[a-z0-9-]+$/.test(id)) return fail(res, 400, "Hisobot id noto'g'ri.");
      let ext = path.extname(filename).toLowerCase();
      const ctype = String(req.headers["content-type"] || "").toLowerCase();
      if (![".pdf", ".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(ext)) {
        if (ctype.includes("pdf")) ext = ".pdf";
        else if (ctype.includes("png")) ext = ".png";
        else if (ctype.includes("jpeg")) ext = ".jpg";
        else if (ctype.includes("webp")) ext = ".webp";
        else if (ctype.includes("gif")) ext = ".gif";
        else return fail(res, 400, "Faqat PDF, PNG, JPG, WEBP yoki GIF.");
      }
      const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || []);
      if (bytes.length < 32) return fail(res, 400, "Fayl juda kichik.");
      const rel = `files/reports/${id}${ext}`;
      const dest = path.join(ROOT, ...rel.split("/"));
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      for (const oldExt of [".pdf", ".png", ".jpg", ".jpeg", ".webp", ".gif"]) {
        const old = path.join(ROOT, "files", "reports", `${id}${oldExt}`);
        if (old !== dest && fs.existsSync(old)) fs.unlinkSync(old);
      }
      fs.writeFileSync(dest, bytes);
      const prev = await query<{ data: any }>(`SELECT data FROM district_overrides WHERE id = $1`, [id]);
      const data = { ...(prev.rows[0]?.data || { id }), id, file: rel, deleted: false };
      await query(
        `INSERT INTO district_overrides (id, data) VALUES ($1, $2::jsonb)
         ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
        [id, JSON.stringify(data)]
      );
      res.json({ ok: true, path: rel, id, districts: await overrideList() });
    }
  );

  app.post("/api/contact", requireAuth(["admin"]), async (req, res) => {
    try {
      const phone = String(req.body?.phone || "").trim();
      const email = String(req.body?.email || "").trim();
      const address = String(req.body?.address || "").trim();
      const title = String(req.body?.title || "").trim() || "Qarshi bo‘linmasi";
      if (!phone || !email || !address) return fail(res, 400, "Telefon, email va manzil kerak.");
      const lat = parseCoord(req.body?.lat, -90, 90, "Kenglik (lat)");
      const lng = parseCoord(req.body?.lng, -180, 180, "Uzunlik (lng)");
      await query(
        `UPDATE contact SET phone=$1, email=$2, address=$3, title=$4, lat=$5, lng=$6, updated_at=now() WHERE id=1`,
        [phone, email, address, title, lat, lng]
      );
      res.json({ ok: true, contact: await contactPublic() });
    } catch (err) {
      fail(res, 400, err instanceof Error ? err.message : "Aloqa xato.");
    }
  });

  app.get("/api/telegram/chats", requireAuth(["admin"]), async (_req, res) => {
    const token = await botToken();
    if (!token) return fail(res, 400, "Avval bot tokenini saqlang.");
    try {
      const chats = await ingestTelegramChats(token);
      res.json({ ok: true, chats });
    } catch (err) {
      fail(res, 400, err instanceof Error ? err.message : "Telegram chatlar olinmadi.");
    }
  });

  app.post("/api/telegram/chats/delete", requireAuth(["admin"]), async (req, res) => {
    const chatId = String(req.body?.chat_id || "").trim();
    if (!chatId) return fail(res, 400, "chat_id kerak.");
    const { rowCount } = await query(`DELETE FROM telegram_chats WHERE chat_id = $1`, [chatId]);
    if (!rowCount) return fail(res, 404, "Chat topilmadi.");
    res.json({ ok: true, chats: await chatsPublic() });
  });

  app.post("/api/telegram/test", requireAuth(["admin"]), async (req, res) => {
    const token = await botToken();
    if (!token) return fail(res, 400, "Avval bot tokenini saqlang.");
    const chatId = await resolveChatId(token, String(req.body?.chat_id || ""));
    const resp = await telegram(token, "sendMessage", "", {
      chat_id: chatId,
      text: "Qashqadaryo Tuproq Lab: test xabar. Bot ishlayapti.",
    });
    res.json({ ok: Boolean(resp.ok), chat_id: chatId });
  });

  app.post("/api/announce", requireAuth(["director"]), async (req, res) => {
    const title = String(req.body?.title || "").trim();
    const message = String(req.body?.message || "").trim();
    const editId = String(req.body?.id || "").trim();
    if (!title || !message) return fail(res, 400, "Sarlavha va xabar kerak.");
    const scope = String(req.body?.scope || "all").trim().toLowerCase();
    const workerIds = Array.isArray(req.body?.workerIds)
      ? req.body.workerIds.map((x: unknown) => String(x || "").trim()).filter(Boolean)
      : [];
    if (scope === "selected" && !workerIds.length) {
      return fail(res, 400, "Tanlangan ishchilarga yuborish uchun kamida bittasini belgilang.");
    }
    if (editId) {
      const { rowCount } = await query(
        `UPDATE announcements SET title = $2, message = $3 WHERE id = $1`,
        [editId, title, message]
      );
      if (!rowCount) return fail(res, 404, "E'lon topilmadi.");
      return res.json({ ok: true, sent: 0, failed: [], announcements: await announcementsPublic() });
    }
    const id = workerId();
    const createdAt = new Date().toISOString().slice(0, 16).replace("T", " ");
    await query(
      `INSERT INTO announcements (id, title, message, created_at) VALUES ($1,$2,$3,$4)`,
      [id, title, message, createdAt]
    );
    const token = await botToken();
    const text = `${title}\n\n${message}`;
    let sent = 0;
    const failed: string[] = [];
    const targets = new Map<string, string>();
    const { rows: workers } = await query<{ id: string; name: string; telegram: string }>(
      `SELECT id, name, telegram FROM workers`
    );
    const selected = scope === "selected" ? new Set(workerIds) : null;
    if (selected) {
      for (const wid of workerIds) {
        if (!workers.some((w) => w.id === wid)) failed.push("Ishchi topilmadi.");
      }
    }
    const loopWorkers = selected
      ? workers.filter((w) => selected.has(w.id))
      : workers.filter((w) => String(w.telegram || "").trim());
    for (const w of loopWorkers) {
      try {
        const raw = String(w.telegram || "").trim();
        if (selected && !raw) {
          failed.push(`${w.name} : Telegram chat_id yo'q. Sozlamalarda yozing yoki botga /start.`);
          continue;
        }
        if (!raw) continue;
        const chatId = token ? await resolveChatId(token, raw) : raw;
        if (chatId) targets.set(String(chatId), w.name);
      } catch {
        if (w.telegram) targets.set(w.telegram, w.name);
        else if (selected) failed.push(`${w.name} : Telegram chat_id yo'q. Sozlamalarda yozing yoki botga /start.`);
      }
    }
    if (!selected) {
      const chats = await query<{ chat_id: string; name: string }>(
        `SELECT chat_id, name FROM telegram_chats`
      );
      for (const c of chats.rows) {
        if (c.chat_id && !targets.has(c.chat_id)) {
          targets.set(c.chat_id, c.name || c.chat_id);
        }
      }
    }
    if (!token) {
      failed.push("Bot token yo'q. Avval Sozlamalarda tokenni saqlang.");
    } else if (!targets.size) {
      failed.push(
        "Telegramga yuborilmadi: hech kim botga /start yozmagan. Xodim botni ochib /start bosing, Sozlamalarda «Chatlarni yangilash»."
      );
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
    res.json({ ok: true, sent, failed, announcements: await announcementsPublic() });
  });

  app.post("/api/announce/delete", requireAuth(["director"]), async (req, res) => {
    const id = String(req.body?.id || "").trim();
    const { rowCount } = await query(`DELETE FROM announcements WHERE id = $1`, [id]);
    if (!rowCount) return fail(res, 404, "E'lon topilmadi.");
    res.json({ ok: true, announcements: await announcementsPublic() });
  });

  app.post("/api/upload", requireAuth(["admin"]), async (req, res) => {
    const slot = String(req.body?.slot || "").trim().toLowerCase();
    if (!["hero", "building", "director"].includes(slot)) {
      return fail(res, 400, "slot hero, building yoki director bo'lishi kerak.");
    }
    const name = String(req.body?.filename || "").trim();
    let ext = path.extname(name).toLowerCase();
    const ctype = String(req.body?.type || "").toLowerCase();
    if (![".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(ext)) {
      if (ctype === "image/png") ext = ".png";
      else if (ctype === "image/jpeg") ext = ".jpg";
      else if (ctype === "image/webp") ext = ".webp";
      else if (ctype === "image/gif") ext = ".gif";
      else return fail(res, 400, "Faqat PNG, JPG, WEBP yoki GIF.");
    }
    let b64 = String(req.body?.data || "").replace(/^data:image\/[^;]+;base64,/, "");
    const bytes = Buffer.from(b64, "base64");
    if (bytes.length < 32 || bytes.length > 8 * 1024 * 1024) {
      return fail(res, 400, "Rasm hajmi noto'g'ri (maks. 8 MB).");
    }
    const rel = `images/uploads/${slot}${ext}`;
    const dest = path.join(ROOT, ...rel.split("/"));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, bytes);
    if (slot === "director") {
      await query(`UPDATE director_profile SET photo = $1, updated_at = now() WHERE id = 1`, [rel]);
      return res.json({ ok: true, path: rel, staff: await staffPublic() });
    }
    const media = await mediaPublic();
    const next = { ...media, [slot]: rel, v: media.v + 1 };
    await query(`UPDATE site_media SET hero=$1, building=$2, v=$3, updated_at=now() WHERE id=1`, [
      next.hero,
      next.building,
      next.v,
    ]);
    res.json({
      ok: true,
      path: rel,
      v: next.v,
      media: { hero: next.hero, building: next.building, v: next.v },
    });
  });

  app.post("/api/gallery", requireAuth(["admin"]), async (req, res) => {
    const title = String(req.body?.title || "").trim();
    const caption = String(req.body?.caption || "").trim();
    const url = String(req.body?.url || "").trim();
    if (!title) return fail(res, 400, "Sarlavha kerak.");
    const yt = youtubeId(url);
    if (!yt) return fail(res, 400, "YouTube havolasi noto'g'ri.");
    const id = galleryId();
    const createdAt = new Date().toISOString().slice(0, 16).replace("T", " ");
    await query(
      `INSERT INTO gallery_items (id, type, title, caption, src, created_at, sort_order)
       VALUES ($1,'youtube',$2,$3,$4,$5,0)`,
      [id, title, caption, yt, createdAt]
    );
    await bumpGalleryV();
    const item = { id, type: "youtube", title, caption, src: yt, createdAt };
    res.json({ ok: true, item, gallery: await galleryItems() });
  });

  app.post(
    "/api/gallery/upload",
    requireAuth(["admin"]),
    express.raw({ type: "*/*", limit: "80mb" }),
    async (req, res) => {
      const kind = String(req.query.kind || "").trim().toLowerCase();
      const title = String(req.query.title || "").trim();
      const caption = String(req.query.caption || "").trim();
      const filename = String(req.query.filename || "").trim();
      if (!["photo", "video"].includes(kind)) return fail(res, 400, "Tur photo yoki video bo'lishi kerak.");
      if (!title) return fail(res, 400, "Sarlavha kerak.");
      let ext = path.extname(filename).toLowerCase();
      const ctype = String(req.headers["content-type"] || "").toLowerCase();
      let folder = "images/gallery";
      let max = 12 * 1024 * 1024;
      if (kind === "photo") {
        if (![".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(ext)) {
          if (ctype.includes("png")) ext = ".png";
          else if (ctype.includes("jpeg")) ext = ".jpg";
          else if (ctype.includes("webp")) ext = ".webp";
          else if (ctype.includes("gif")) ext = ".gif";
          else return fail(res, 400, "Faqat PNG, JPG, WEBP yoki GIF.");
        }
      } else {
        folder = "media/gallery";
        max = 80 * 1024 * 1024;
        if (![".mp4", ".webm"].includes(ext)) {
          if (ctype.includes("mp4")) ext = ".mp4";
          else if (ctype.includes("webm")) ext = ".webm";
          else return fail(res, 400, "Faqat MP4 yoki WEBM video.");
        }
      }
      const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || []);
      if (bytes.length < 32) return fail(res, 400, "Fayl juda kichik.");
      if (bytes.length > max) return fail(res, 400, "Fayl juda katta.");
      const id = galleryId();
      const rel = `${folder}/${id}${ext}`;
      const dest = path.join(ROOT, ...rel.split("/"));
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, bytes);
      const createdAt = new Date().toISOString().slice(0, 16).replace("T", " ");
      await query(
        `INSERT INTO gallery_items (id, type, title, caption, src, created_at, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,0)`,
        [id, kind, title, caption, rel, createdAt]
      );
      await bumpGalleryV();
      const item = { id, type: kind, title, caption, src: rel, createdAt };
      res.json({ ok: true, item, gallery: await galleryItems() });
    }
  );

  app.post("/api/gallery/delete", requireAuth(["admin"]), async (req, res) => {
    const id = String(req.body?.id || "").trim();
    if (!/^g[A-Za-z0-9]+$/.test(id)) return fail(res, 400, "Noto'g'ri id.");
    const { rows } = await query<{ src: string; type: string }>(
      `SELECT src, type FROM gallery_items WHERE id = $1`,
      [id]
    );
    if (!rows[0]) return fail(res, 404, "Topilmadi.");
    if (rows[0].type !== "youtube" && rows[0].src) {
      const full = path.join(ROOT, rows[0].src.replace(/\//g, path.sep));
      if (full.startsWith(ROOT) && fs.existsSync(full)) fs.unlinkSync(full);
    }
    await query(`DELETE FROM gallery_items WHERE id = $1`, [id]);
    await bumpGalleryV();
    res.json({ ok: true, gallery: await galleryItems() });
  });

  app.use("/api", (_req, res) => fail(res, 404, "Not found"));
}

async function bumpGalleryV() {
  const v = Number((await setting("gallery_v")) || "1") + 1;
  await setSetting("gallery_v", String(v));
}

export function apiErrorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  console.error(err);
  res.status(500).json({ ok: false, error: "Server xatosi." });
}
