import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "../env.js";

const encryptionKey = Buffer.from(env.ENCRYPTION_KEY, "base64");

/** Mengenkripsi rahasia (mis. token bot) sebelum disimpan ke database. */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

export function decryptSecret(blob: string): string {
  const [version, iv, tag, data] = blob.split(".");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Format rahasia tidak dikenal");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

/** Sidik jari satu arah, untuk mendeteksi token yang sama tanpa menyimpan token aslinya. */
export function fingerprint(value: string): string {
  return createHmac("sha256", encryptionKey).update(value).digest("hex");
}

export function randomToken(bytes = 18): string {
  return randomBytes(bytes).toString("base64url");
}

/** Perbandingan yang lamanya tidak bergantung pada isi, supaya kata sandi tidak bisa ditebak lewat waktu respons. */
export function safeEqual(a: string, b: string): boolean {
  const left = createHash("sha256").update(a).digest();
  const right = createHash("sha256").update(b).digest();
  return timingSafeEqual(left, right);
}

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function sign(payload: string): string {
  return createHmac("sha256", env.SESSION_SECRET).update(payload).digest("base64url");
}

export function createSessionToken(now = Date.now()): { token: string; maxAgeSeconds: number } {
  const payload = String(now + SESSION_TTL_MS);
  return { token: `${payload}.${sign(payload)}`, maxAgeSeconds: SESSION_TTL_MS / 1000 };
}

export function isValidSessionToken(token: string | undefined, now = Date.now()): boolean {
  if (!token) return false;
  const [payload, signature] = token.split(".");
  if (!payload || !signature || !safeEqual(signature, sign(payload))) return false;
  const expiresAt = Number(payload);
  return Number.isFinite(expiresAt) && expiresAt > now;
}
