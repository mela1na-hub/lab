# lab

Tuproqshunoslik va agrokimyoviy tadqiqotlar instituti — Qashqadaryo bo‘linmasi.

**Production:** Node.js + PostgreSQL. See [docs/DEPLOY.md](docs/DEPLOY.md).

```bash
docker compose up -d
cp .env.example .env   # set SESSION_SECRET and passwords
npm install
npm start
```

Or double-click `OCHISH.bat` after `.env` exists.

The old `serve.ps1` listener is deprecated and is not for the public internet.
