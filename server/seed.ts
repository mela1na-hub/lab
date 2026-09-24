import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./env.js";
import { closeDb, query } from "./db.js";
import { hashPassword, workerId } from "./crypto.js";
import { setSetting } from "./lib.js";

const RESERVED = new Set(["admin", "director", "ishchi"]);

function readJson<T>(rel: string, fallback: T): T {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) return fallback;
  return JSON.parse(fs.readFileSync(p, "utf8")) as T;
}

function asIso(value: unknown) {
  if (!value) return new Date().toISOString();
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? String(value) : d.toISOString();
}

function jsonText(value: unknown) {
  if (value == null) return "{}";
  return typeof value === "string" ? value : JSON.stringify(value);
}

export function accountPassword(name: string) {
  return `${name.trim().toLowerCase()}123`;
}

export async function upsertUser(
  username: string,
  role: string,
  label: string,
  workerIdValue: string | null
) {
  const id = username.trim().toLowerCase();
  const hash = await hashPassword(accountPassword(id));
  const { rows } = await query(`SELECT id FROM users WHERE username = $1`, [id]);
  if (rows.length) {
    // Preserve existing worker_id when null is passed (e.g. reserved ishchi on every boot).
    // Clearing identity on restart broke the worker calendar until they re-picked a name.
    await query(
      `UPDATE users SET password_hash = $2, role = $3, label = $4,
        worker_id = COALESCE($5, worker_id),
        failed_attempts = 0, locked_until = NULL, updated_at = now()
       WHERE username = $1`,
      [id, hash, role, label, workerIdValue]
    );
    return;
  }
  await query(
    `INSERT INTO users (id, username, password_hash, role, label, worker_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, id, hash, role, label, workerIdValue]
  );
}

async function importPostgresDump() {
  const dumpPath = path.join(ROOT, "data", "pg-export.json");
  if (!fs.existsSync(dumpPath)) return false;
  const dump = JSON.parse(fs.readFileSync(dumpPath, "utf8")) as Record<string, any[]>;

  const oldToNew = new Map<string, string>();
  for (const w of dump.workers || []) {
    const name = String(w.name || "").trim();
    const id = name || String(w.id || workerId());
    oldToNew.set(String(w.id), id);
    const login = name ? name.toLowerCase() : String(w.login || "").trim().toLowerCase() || null;
    let passwordHash: string | null = null;
    if (login && !RESERVED.has(login)) {
      passwordHash = await hashPassword(accountPassword(login));
    }
    await query(
      `INSERT INTO workers (id, name, lavozim, telegram, login, password_hash, photo, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         lavozim = EXCLUDED.lavozim,
         telegram = EXCLUDED.telegram,
         login = EXCLUDED.login,
         password_hash = EXCLUDED.password_hash,
         photo = COALESCE(NULLIF(EXCLUDED.photo,''), workers.photo)`,
      [
        id,
        name,
        w.lavozim || "Ishchi",
        w.telegram || "",
        login && !RESERVED.has(login) ? login : null,
        passwordHash,
        w.photo || "",
        asIso(w.created_at),
        asIso(w.updated_at),
      ]
    );
    if (login && passwordHash && !RESERVED.has(login)) {
      await upsertUser(login, "worker", name || login, id);
    }
  }

  for (const row of dump.director_profile || []) {
    await query(
      `INSERT INTO director_profile (id, name, role, bio, photo, updated_at)
       VALUES (1, $1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name, role = EXCLUDED.role, bio = EXCLUDED.bio,
         photo = EXCLUDED.photo, updated_at = EXCLUDED.updated_at`,
      [row.name, row.role || "Direktor", row.bio || "", row.photo || "", asIso(row.updated_at)]
    );
  }

  for (const a of dump.announcements || []) {
    await query(
      `INSERT INTO announcements (id, title, message, created_at, inserted_at)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING`,
      [a.id, a.title || "", a.message || "", a.created_at || "", asIso(a.inserted_at)]
    );
  }

  for (const log of dump.daily_logs || []) {
    const workerIdValue = oldToNew.get(String(log.worker_id)) || log.worker_id;
    const exists = await query(`SELECT 1 AS ok FROM workers WHERE id = $1`, [workerIdValue]);
    if (!exists.rows[0]) continue;
    await query(
      `INSERT INTO daily_logs (id, worker_id, date, text, updated_at)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (worker_id, date) DO NOTHING`,
      [
        log.id || workerId(),
        workerIdValue,
        String(log.date || "").slice(0, 10),
        log.text || "",
        asIso(log.updated_at),
      ]
    );
  }

  for (const d of dump.districts || []) {
    await query(
      `INSERT INTO districts (id, data, is_base, updated_at)
       VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING`,
      [d.id, jsonText(d.data), d.is_base ? 1 : 0, asIso(d.updated_at)]
    );
  }

  for (const d of dump.district_overrides || []) {
    await query(
      `INSERT INTO district_overrides (id, data, updated_at)
       VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
      [d.id, jsonText(d.data), asIso(d.updated_at)]
    );
  }

  for (const it of dump.gallery_items || []) {
    await query(
      `INSERT INTO gallery_items (id, type, title, caption, src, created_at, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
      [it.id, it.type, it.title || "", it.caption || "", it.src || "", it.created_at || "", it.sort_order || 0]
    );
  }

  for (const m of dump.site_media || []) {
    await query(
      `INSERT INTO site_media (id, hero, building, v, updated_at)
       VALUES (1, $1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET hero = EXCLUDED.hero, building = EXCLUDED.building, v = EXCLUDED.v`,
      [m.hero, m.building, m.v || 1, asIso(m.updated_at)]
    );
  }

  for (const c of dump.contact || []) {
    await query(
      `INSERT INTO contact (id, phone, email, address, title, lat, lng, updated_at)
       VALUES (1, $1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE SET
         phone = EXCLUDED.phone, email = EXCLUDED.email, address = EXCLUDED.address,
         title = EXCLUDED.title, lat = EXCLUDED.lat, lng = EXCLUDED.lng`,
      [c.phone, c.email, c.address, c.title, c.lat, c.lng, asIso(c.updated_at)]
    );
  }

  for (const s of dump.app_settings || []) {
    if (s.key === "seeded") continue;
    await setSetting(String(s.key), String(s.value ?? ""));
  }

  for (const c of dump.telegram_chats || []) {
    await query(
      `INSERT INTO telegram_chats (chat_id, name, username, at)
       VALUES ($1,$2,$3,$4) ON CONFLICT (chat_id) DO NOTHING`,
      [c.chat_id, c.name || "", c.username || "", c.at || ""]
    );
  }

  return true;
}

async function seedFromJsonFiles() {
  const media = readJson("data/site-media.json", {
    hero: "images/bo-linma.png",
    building: "images/bo-linma.png",
    v: 1,
  });
  await query(
    `INSERT INTO site_media (id, hero, building, v) VALUES (1, $1, $2, $3)
     ON CONFLICT (id) DO NOTHING`,
    [media.hero, media.building, media.v || 1]
  );

  const contact = readJson("data/contact.json", {
    phone: "+998 71 246-09-50",
    email: "info@soil.uz",
    address: "Qarshi, Ravoq MFY, Islom Karimov ko‘chasi, 62-uy",
    title: "Qarshi bo‘linmasi",
    lat: "38.892663",
    lng: "65.810101",
  });
  await query(
    `INSERT INTO contact (id, phone, email, address, title, lat, lng)
     VALUES (1, $1, $2, $3, $4, $5, $6)
     ON CONFLICT (id) DO NOTHING`,
    [contact.phone, contact.email, contact.address, contact.title, contact.lat, contact.lng]
  );

  const staff = readJson("data/staff.json", {
    director: {
      name: "Bo‘linma direktori",
      role: "Direktor",
      bio: "",
      photo: "",
    },
    workers: [] as { name: string; lavozim: string; photo?: string }[],
  });
  await query(
    `INSERT INTO director_profile (id, name, role, bio, photo)
     VALUES (1, $1, $2, $3, $4)
     ON CONFLICT (id) DO NOTHING`,
    [
      staff.director?.name || "Bo‘linma direktori",
      staff.director?.role || "Direktor",
      staff.director?.bio || "",
      staff.director?.photo || "",
    ]
  );

  const gallery = readJson("data/gallery.json", { v: 1, items: [] as any[] });
  const { rows: gcount } = await query<{ n: number }>(`SELECT count(*) AS n FROM gallery_items`);
  if (Number(gcount[0]?.n) === 0) {
    let i = 0;
    for (const it of gallery.items || []) {
      await query(
        `INSERT INTO gallery_items (id, type, title, caption, src, created_at, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
        [it.id, it.type, it.title || "", it.caption || "", it.src || "", it.createdAt || "", i++]
      );
    }
    await setSetting("gallery_v", String(gallery.v || 1));
  }

  const districtsFile = readJson("data/districts.json", {
    institute: {},
    staff: {},
    districts: [] as any[],
  });
  await setSetting(
    "districts_meta",
    JSON.stringify({
      institute: districtsFile.institute || {},
      staff: districtsFile.staff || {},
    })
  );
  const { rows: dcount } = await query<{ n: number }>(`SELECT count(*) AS n FROM districts`);
  if (Number(dcount[0]?.n) === 0) {
    for (const d of districtsFile.districts || []) {
      if (!d?.id) continue;
      await query(
        `INSERT INTO districts (id, data, is_base) VALUES ($1, $2, 1) ON CONFLICT (id) DO NOTHING`,
        [d.id, JSON.stringify(d)]
      );
    }
  }

  const overrides = readJson("data/district-overrides.json", { districts: [] as any[] });
  for (const d of overrides.districts || []) {
    if (!d?.id) continue;
    await query(
      `INSERT INTO district_overrides (id, data) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
      [d.id, JSON.stringify(d)]
    );
  }

  type LegacyAdmin = {
    workers?: {
      id?: string;
      name?: string;
      lavozim?: string;
      telegram?: string;
      login?: string;
      password?: string;
    }[];
    announcements?: { id?: string; title?: string; message?: string; createdAt?: string }[];
    botUsername?: string;
    telegramOffset?: number;
  };
  const admin = readJson<LegacyAdmin>("admin-data.json", {});
  const { rows: wcount } = await query<{ n: number }>(`SELECT count(*) AS n FROM workers`);
  if (Number(wcount[0]?.n) === 0) {
    const fromAdmin = admin.workers || [];
    const fromStaff = staff.workers || [];
    const seen = new Set<string>();
    for (const w of fromAdmin) {
      const name = String(w.name || "").trim();
      const id = name || w.id || workerId();
      if (seen.has(id)) continue;
      seen.add(id);
      const login = (name || w.login || "").trim().toLowerCase() || null;
      const passwordHash =
        login && !RESERVED.has(login) ? await hashPassword(accountPassword(login)) : null;
      await query(
        `INSERT INTO workers (id, name, lavozim, telegram, login, password_hash, photo)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
        [id, name, w.lavozim || "Ishchi", w.telegram || "", login, passwordHash, ""]
      );
      if (login && passwordHash) {
        await upsertUser(login, "worker", name || login, id);
      }
    }
    for (const w of fromStaff) {
      const name = (w.name || "").trim();
      if (!name) continue;
      const { rows: exists } = await query(`SELECT id FROM workers WHERE lower(name) = lower($1)`, [name]);
      if (exists.length) continue;
      const login = name.toLowerCase();
      const passwordHash = RESERVED.has(login) ? null : await hashPassword(accountPassword(login));
      await query(`INSERT INTO workers (id, name, lavozim, photo, login, password_hash) VALUES ($1,$2,$3,$4,$5,$6)`, [
        name,
        name,
        w.lavozim || "Ishchi",
        w.photo || "",
        RESERVED.has(login) ? null : login,
        passwordHash,
      ]);
      if (passwordHash) await upsertUser(login, "worker", name, name);
    }
  }

  for (const a of admin.announcements || []) {
    if (!a.id) continue;
    await query(
      `INSERT INTO announcements (id, title, message, created_at)
       VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING`,
      [a.id, a.title || "", a.message || "", a.createdAt || ""]
    );
  }
  if (admin.botUsername) await setSetting("bot_username", admin.botUsername);
  if (admin.telegramOffset) await setSetting("telegram_offset", String(admin.telegramOffset));

  const logs = readJson("data/daily-logs.json", {
    logs: [] as { id?: string; workerId?: string; date?: string; text?: string; updatedAt?: string }[],
  });
  for (const log of logs.logs || []) {
    if (!log.workerId || !log.date) continue;
    const exists = await query(`SELECT 1 AS ok FROM workers WHERE id = $1`, [log.workerId]);
    if (!exists.rows[0]) continue;
    await query(
      `INSERT INTO daily_logs (id, worker_id, date, text, updated_at)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (worker_id, date) DO NOTHING`,
      [log.id || workerId(), log.workerId, log.date, log.text || "", log.updatedAt ? log.updatedAt.replace(" ", "T") : sqlNowFallback()]
    );
  }
}

function sqlNowFallback() {
  return new Date().toISOString();
}

export async function seed() {
  await upsertUser("admin", "admin", "Sayt admin", null);
  await upsertUser("director", "director", "Direktor", null);
  await upsertUser("ishchi", "worker", "Ishchi", null);

  const { rows: seededRows } = await query<{ value: string }>(
    `SELECT value FROM app_settings WHERE key = 'seeded'`
  );
  const alreadySeeded = seededRows[0]?.value === "1";
  if (alreadySeeded) return;

  const imported = await importPostgresDump();
  if (!imported) await seedFromJsonFiles();

  await upsertUser("admin", "admin", "Sayt admin", null);
  await upsertUser("director", "director", "Direktor", null);
  await upsertUser("ishchi", "worker", "Ishchi", null);

  await setSetting("seeded", "1");
}

export async function closeSeed() {
  closeDb();
}
