import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { SESSION_SECRET } from "./env.js";

const KEY = crypto.createHash("sha256").update(SESSION_SECRET).digest();

export async function hashPassword(plain: string) {
  return bcrypt.hash(plain, 12);
}

export async function verifyPassword(plain: string, hash: string) {
  return bcrypt.compare(plain, hash);
}

export function randomId(bytes = 16) {
  return crypto.randomBytes(bytes).toString("hex");
}

export function workerId() {
  return crypto.randomBytes(6).toString("hex");
}

export function galleryId() {
  const d = new Date();
  const stamp = d.toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const n = Math.floor(1000 + Math.random() * 9000);
  return `g${stamp}${n}`;
}

export function encryptSecret(plain: string) {
  if (!plain) return "";
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decryptSecret(packed: string) {
  if (!packed) return "";
  const buf = Buffer.from(packed, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}

export function sha256(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
