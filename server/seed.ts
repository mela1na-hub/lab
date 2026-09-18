import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./env.js";
import { pool, query } from "./db.js";
import { hashPassword, randomId, workerId } from "./crypto.js";
import { setSetting } from "./lib.js";

function readJson<T>(rel: string, fallback: T): T {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) return fallback;
  return JSON.parse(fs.readFileSync(p, "utf8")) as T;
}

async function ensureUser(username: string, role: string, label: string, password: string, workerIdValue: string | null) {
  const { rows } = await query(`SELECT id FROM users WHERE username = $1`, [username]);
  if (rows.length) return;
  let pass = password;
  if (!pass || pass.length < 12) {
    pass = randomId(12);
    console.warn(
      `Created ${username} with a generated password (save it now, it will not be shown again): ${pass}`
    );
  }
  const hash = await hashPassword(pass);
  await query(
    `INSERT INTO users (username, password_hash, role, label, worker_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [username, hash, role, label, workerIdValue]
  );
}

export async function seed() {
  const { rows: seededRows } = await query<{ value: string }>(
    `SELECT value FROM app_settings WHERE key = 'seeded'`
  );
  const alreadySeeded = seededRows[0]?.value === "1";

  await ensureUser(
    "admin",
    "admin",
    "Sayt admin",
    process.env.INITIAL_ADMIN_PASSWORD || "",
    null
  );
  await ensureUser(
    "director",
    "director",
    "Direktor",
    process.env.INITIAL_DIRECTOR_PASSWORD || "",
    null
  );
  await ensureUser(
    "ishchi",
    "worker",
    "Ishchi",
    process.env.INITIAL_WORKER_PASSWORD || "",
    null
  );

  if (alreadySeeded) return;

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
  const { rows: gcount } = await query<{ n: string }>(`SELECT count(*)::text AS n FROM gallery_items`);
  if (Number(gcount[0].n) === 0) {
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
  await setSetting("districts_meta", JSON.stringify({
    institute: districtsFile.institute || {},
    staff: districtsFile.staff || {},
  }));
  const { rows: dcount } = await query<{ n: string }>(`SELECT count(*)::text AS n FROM districts`);
  if (Number(dcount[0].n) === 0) {
    for (const d of districtsFile.districts || []) {
      if (!d?.id) continue;
      await query(
        `INSERT INTO districts (id, data, is_base) VALUES ($1, $2::jsonb, TRUE) ON CONFLICT (id) DO NOTHING`,
        [d.id, JSON.stringify(d)]
      );
    }
  }

  const overrides = readJson("data/district-overrides.json", { districts: [] as any[] });
  for (const d of overrides.districts || []) {
    if (!d?.id) continue;
    await query(
      `INSERT INTO district_overrides (id, data) VALUES ($1, $2::jsonb) ON CONFLICT (id) DO NOTHING`,
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
  const { rows: wcount } = await query<{ n: string }>(`SELECT count(*)::text AS n FROM workers`);
  if (Number(wcount[0].n) === 0) {
    const fromAdmin = admin.workers || [];
    const fromStaff = staff.workers || [];
    const seen = new Set<string>();
    for (const w of fromAdmin) {
      const id = w.id || workerId();
      if (seen.has(id)) continue;
      seen.add(id);
      const login = (w.login || "").trim().toLowerCase() || null;
      let passwordHash: string | null = null;
      const rawPass = (w.password || "").trim();
      if (rawPass && !["admin123", "director123", "ishchi123"].includes(rawPass)) {
        passwordHash = await hashPassword(rawPass);
      }
      await query(
        `INSERT INTO workers (id, name, lavozim, telegram, login, password_hash, photo)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
        [id, w.name || "", w.lavozim || "Ishchi", w.telegram || "", login, passwordHash, ""]
      );
      if (login && passwordHash) {
        await query(
          `INSERT INTO users (username, password_hash, role, label, worker_id)
           VALUES ($1,$2,'worker',$3,$4)
           ON CONFLICT (username) DO NOTHING`,
          [login, passwordHash, w.name || login, id]
        );
      }
    }
    for (const w of fromStaff) {
      const name = (w.name || "").trim();
      if (!name) continue;
      const { rows: exists } = await query(`SELECT id FROM workers WHERE lower(name) = lower($1)`, [name]);
      if (exists.length) continue;
      await query(
        `INSERT INTO workers (id, name, lavozim, photo) VALUES ($1,$2,$3,$4)`,
        [workerId(), name, w.lavozim || "Ishchi", w.photo || ""]
      );
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
    const exists = await query(`SELECT 1 FROM workers WHERE id = $1`, [log.workerId]);
    if (!exists.rows[0]) continue;
    await query(
      `INSERT INTO daily_logs (id, worker_id, date, text, updated_at)
       VALUES ($1,$2,$3,$4, COALESCE($5::timestamptz, now()))
       ON CONFLICT (worker_id, date) DO NOTHING`,
      [
        log.id || workerId(),
        log.workerId,
        log.date,
        log.text || "",
        log.updatedAt ? log.updatedAt.replace(" ", "T") : null,
      ]
    );
  }

  await setSetting("seeded", "1");
}

export async function closeSeed() {
  await pool.end();
}
