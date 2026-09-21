# Production deployment — Qashqadaryo Soil Lab

The public site is the same HTML/CSS/JS. The PowerShell listener is **not** production. Use Node.js + SQLite.

Default logins: `admin` / `admin123`, `director` / `director123`, `ishchi` / `ishchi123`. Ishchi akkauntlari uchun ham id = ism, parol = `ism123`.

## Architecture

| Piece | Production choice |
| --- | --- |
| Frontend | Existing HTML/CSS/JS, served by Node (or later Vercel with API rewrites) |
| Backend | Node.js / TypeScript (`server/`) |
| Database | SQLite (`data/app.sqlite`, schema in `sql/001_init.sql`) |
| Files | Disk next to the app (`images/`, `media/`, `files/reports/`) or a persistent volume |
| Process | `npm start` on Railway, Render, Fly.io, or a VPS with nginx + Let's Encrypt |

Vercel **alone** cannot run this API. Pair Vercel (static) with a Node host, or serve everything from Node.

## Local run

1. Install Node.js 20+.
2. Copy `.env.example` to `.env`. Set `SESSION_SECRET` (32+ random chars).
3. `npm install`
4. `npm start`
5. Open the URL in `PUBLIC_URL` (default http://127.0.0.1:3000/). SQLite file is created at `data/app.sqlite`.

`OCHISH.bat` starts `npm start`.

## Functionality inventory (preserved)

### Pages

- `index.html` — public site, hidden admin (3× A / 3 logo taps)
- `hisobotlar.html` — soil reports (login)
- `admin.html` — director / worker panel
- `sozlamalar.html` — site admin
- `kunlik.html` — worker calendar
- `galereya.html`, `rahbariyat.html`, `aloqa.html` — redirects into index sections

### Roles

- `admin` — site settings, media, gallery, contact, worker logins, Telegram, passwords
- `director` — daily work, soil reports, announcements
- `worker` — daily logs, soil reports (same as before)

### JSON files migrated into Postgres

- `admin-data.json` → users (passwords hashed, **token not imported**), workers, announcements
- `data/staff.json` → `director_profile` + workers
- `data/contact.json` → `contact`
- `data/site-media.json` → `site_media`
- `data/gallery.json` → `gallery_items`
- `data/districts.json` → `districts` + `districts_meta`
- `data/district-overrides.json` → `district_overrides`
- `data/daily-logs.json` → `daily_logs`

Those `/data/*.json` URLs are still served, generated from Postgres.

### API map

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/api/health` | public | hosting health check |
| GET | `/api/site-link` | public | uses `PUBLIC_URL` or request Host |
| POST | `/api/login` | public + rate limit | hashed passwords, lockout |
| POST | `/api/logout` | cookie | |
| GET | `/api/me` | any logged-in | |
| POST | `/api/password-change` | any logged-in | |
| POST | `/api/password-reset/request` | public + rate limit | always 200; token hashed in DB |
| POST | `/api/password-reset/confirm` | public | |
| GET | `/api/state` | admin, director | |
| GET | `/api/announcements` | director, worker | |
| GET | `/api/daily/workers` | director, worker | |
| GET | `/api/daily/logs` | director, worker | worker only own id |
| POST | `/api/daily/identity` | worker | |
| POST | `/api/daily/staff` | director | |
| POST | `/api/daily/staff/delete` | director | |
| POST | `/api/daily/logs` | worker | |
| POST | `/api/token` | admin | Telegram token encrypted at rest |
| POST | `/api/workers` | admin | |
| POST | `/api/staff` | admin | |
| POST | `/api/passwords` | admin | role passwords |
| POST | `/api/districts` | director, worker | |
| POST | `/api/districts/delete` | director, worker | |
| POST | `/api/districts/file` | director, worker | raw upload |
| POST | `/api/contact` | admin | |
| GET | `/api/telegram/chats` | admin | |
| POST | `/api/telegram/test` | admin | |
| POST | `/api/announce` | director | |
| POST | `/api/announce/delete` | director | |
| POST | `/api/upload` | admin | |
| POST | `/api/gallery` | admin | YouTube |
| POST | `/api/gallery/upload` | admin | raw upload |
| POST | `/api/gallery/delete` | admin | |

Frontend still calls the same `/api/...` paths with `credentials: "same-origin"`. Cookie name remains `ttati_sid` (HttpOnly, SameSite=Lax, Secure in production).

## Hosting steps

1. Create a Node service (Railway/Render/Fly/VPS). Set env from `.env.example`. `NODE_ENV=production`, `COOKIE_SECURE=true`, `TRUST_PROXY=true`, `PUBLIC_URL=https://your-domain`.
2. Attach a persistent volume for `data/app.sqlite`, `images/`, `media/`, `files/`.
3. Point the domain to the service. Terminate TLS at the platform or nginx. Redirect HTTP → HTTPS.
4. Start command: `npm install && npm start`
5. Confirm `/api/health` returns `{"ok":true}` and login works on a phone using mobile data.

Optional: put HTML on Vercel and rewrite `/api/*` and `/data/*` plus `/images/*` to the Node origin. Same-origin cookies then need that rewrite on the same public host.
