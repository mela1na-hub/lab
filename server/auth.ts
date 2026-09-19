import type { Request, Response, NextFunction } from "express";
import { SESSION_DAYS } from "./env.js";
import { query } from "./db.js";
import { randomId } from "./crypto.js";

export type Role = "admin" | "director" | "worker";

export type AuthUser = {
  id: string;
  username: string;
  role: Role;
  label: string;
  workerId: string;
};

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

const COOKIE = "ttati_sid";

function isHttps(req: Request) {
  const xf = String(req.get("x-forwarded-proto") || "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  if (xf) return xf === "https";
  return req.secure === true || req.protocol === "https";
}

export function cookieOptions(req: Request) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: isHttps(req),
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
  };
}

export function clearCookieOptions(req: Request) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: isHttps(req),
    path: "/",
    maxAge: 0,
  };
}

export async function createSession(userId: string) {
  const id = randomId(24);
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await query(
    `INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, $3)`,
    [id, userId, expires.toISOString()]
  );
  return id;
}

export async function destroySession(sid: string) {
  await query(`DELETE FROM sessions WHERE id = $1`, [sid]);
}

export async function destroyRoleSessions(role: Role) {
  await query(
    `DELETE FROM sessions s USING users u WHERE s.user_id = u.id AND u.role = $1`,
    [role]
  );
}

export async function loadAuth(req: Request): Promise<AuthUser | null> {
  const sid = req.cookies?.[COOKIE];
  if (!sid) return null;
  const { rows } = await query<{
    user_id: string;
    username: string;
    role: Role;
    label: string;
    worker_id: string | null;
    expires_at: Date;
  }>(
    `SELECT u.id AS user_id, u.username, u.role, u.label, u.worker_id, s.expires_at
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = $1`,
    [sid]
  );
  const row = rows[0];
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await destroySession(sid);
    return null;
  }
  return {
    id: row.user_id,
    username: row.username,
    role: row.role,
    label: row.label,
    workerId: row.worker_id || "",
  };
}

export async function attachUser(req: Request, _res: Response, next: NextFunction) {
  try {
    req.user = (await loadAuth(req)) || undefined;
    next();
  } catch (err) {
    next(err);
  }
}

export function requireAuth(roles?: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ ok: false, error: "Kirish kerak." });
      return;
    }
    if (roles && !roles.includes(req.user.role)) {
      res.status(403).json({ ok: false, error: "Ruxsat yo'q." });
      return;
    }
    next();
  };
}

export async function setWorkerOnSession(userId: string, workerId: string, label: string) {
  await query(
    `UPDATE users SET worker_id = $2, label = $3, updated_at = now() WHERE id = $1`,
    [userId, workerId || null, label]
  );
}

export { COOKIE };
