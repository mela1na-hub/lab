import fs from "node:fs";
import path from "node:path";
import express from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { PORT, ROOT, TRUST_PROXY, COOKIE_SECURE, ensureDirs, isProd } from "./env.js";
import { migrate, closeDb } from "./db.js";
import { seed } from "./seed.js";
import { attachUser } from "./auth.js";
import { apiErrorHandler, mountApi } from "./routes.js";
import {
  contactPublic,
  galleryItems,
  mediaPublic,
  overrideList,
  setting,
  staffPublic,
} from "./lib.js";
import { query } from "./db.js";
import { startBotPoller } from "./botPoll.js";

ensureDirs();

const app = express();
if (TRUST_PROXY) app.set("trust proxy", 1);

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  })
);
app.use(cookieParser());
app.use((req, res, next) => {
  if (
    req.path === "/api/gallery/upload" ||
    req.path === "/api/districts/file" ||
    req.path === "/api/daily/video"
  ) {
    next();
    return;
  }
  express.urlencoded({ extended: false, limit: "1mb" })(req, res, () => {
    express.json({ limit: "10mb" })(req, res, next);
  });
});
app.use(attachUser);

const BLOCKED = new Set([
  "admin-data.json",
  "serve.ps1",
  "serve.log",
  "ochish.bat",
  "telefon-ruxsat.bat",
  ".gitignore",
  ".env",
  "package.json",
  "package-lock.json",
  "docker-compose.yml",
  "tsconfig.json",
  "daily-logs.json",
]);

function blocked(rel: string) {
  const name = path.basename(rel).toLowerCase();
  if (BLOCKED.has(name)) return true;
  const n = rel.replace(/\\/g, "/").toLowerCase();
  return (
    n.startsWith("server/") ||
    n.startsWith("sql/") ||
    n.startsWith("node_modules/") ||
    n.startsWith(".git/") ||
    n.startsWith("docs/") ||
    n.endsWith(".sqlite") ||
    n.endsWith(".sqlite-wal") ||
    n.endsWith(".sqlite-shm") ||
    n.endsWith("pg-export.json")
  );
}

app.get("/data/gallery.json", async (_req, res) => {
  const v = Number((await setting("gallery_v")) || "1");
  res.json({ v, items: await galleryItems() });
});
app.get("/data/site-media.json", async (_req, res) => {
  res.json(await mediaPublic());
});
app.get("/data/contact.json", async (_req, res) => {
  res.json(await contactPublic());
});
app.get("/data/staff.json", async (_req, res) => {
  res.json(await staffPublic());
});
app.get("/data/district-overrides.json", async (req, res) => {
  if (!req.user) {
    res.status(401).json({ ok: false, error: "Kirish kerak." });
    return;
  }
  res.json({ districts: await overrideList() });
});
app.get("/data/districts.json", async (req, res) => {
  if (!req.user) {
    res.status(401).json({ ok: false, error: "Kirish kerak." });
    return;
  }
  const meta = JSON.parse((await setting("districts_meta")) || "{}");
  const { rows } = await query<{ data: unknown }>(`SELECT data FROM districts ORDER BY id`);
  res.json({
    institute: meta.institute || {},
    staff: meta.staff || {},
    districts: rows.map((r) => r.data),
  });
});

mountApi(app);

app.use((req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    next();
    return;
  }
  const rel = decodeURIComponent(req.path.replace(/^\//, ""));
  if (!rel || rel.endsWith("/")) {
    next();
    return;
  }
  if (blocked(rel)) {
    res.status(404).end();
    return;
  }
  const n = rel.replace(/\\/g, "/").toLowerCase();
  const protectedFile =
    n === "data/districts.json" ||
    n === "data/district-overrides.json" ||
    n.startsWith("files/reports/") ||
    n.startsWith("files/daily/");
  if (protectedFile && !req.user) {
    res.status(401).json({ ok: false, error: "Kirish kerak." });
    return;
  }
  next();
});

app.use(
  express.static(ROOT, {
    index: "index.html",
    fallthrough: true,
    setHeaders(res, filePath) {
      if (filePath.endsWith(".html") || filePath.endsWith(".js") || filePath.endsWith(".css")) {
        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
        res.setHeader("Pragma", "no-cache");
      }
    },
  })
);

app.get("/", (_req, res) => {
  res.sendFile(path.join(ROOT, "index.html"));
});

app.use(apiErrorHandler);

async function main() {
  if ((process.env.SESSION_SECRET || "").length < 16) {
    throw new Error("SESSION_SECRET must be at least 16 characters.");
  }
  await migrate();
  await seed();
  app.listen(PORT, "0.0.0.0", () => {
    const mode = isProd ? "production" : "development";
    console.log(`Soil Lab listening on port ${PORT} (${mode})`);
    console.log(`Cookie Secure=${COOKIE_SECURE}`);
    if (fs.existsSync(path.join(ROOT, ".env"))) {
      console.log("Loaded environment from .env");
    }
    startBotPoller();
    console.log("Telegram bot poller started");
  });
}

main().catch((err) => {
  console.error(err);
  try {
    closeDb();
  } finally {
    process.exit(1);
  }
});
