import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { z } from "zod";

/** Folder utama proyek. Dari server/src maupun server/dist, letaknya dua tingkat di atas. */
export const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Mengurai isi .env. Bila satu nama ditulis lebih dari sekali, isian terakhir yang tidak kosong yang dipakai,
 * supaya baris kosong yang ditambahkan belakangan (misalnya oleh `npm run setup`) tidak menghapus isian sebelumnya.
 */
export function parseEnvFile(content: string): { values: Record<string, string>; warnings: string[] } {
  const found = new Map<string, { line: number; value: string }[]>();
  content.split(/\r?\n/).forEach((text, index) => {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(text);
    if (!match?.[1]) return;
    const value = (parseEnv(text)[match[1]] ?? "").trim();
    found.set(match[1], [...(found.get(match[1]) ?? []), { line: index + 1, value }]);
  });

  const values: Record<string, string> = {};
  const warnings: string[] = [];
  for (const [name, entries] of found) {
    const chosen = entries.findLast((entry) => entry.value !== "") ?? entries.at(-1);
    if (!chosen) continue;
    values[name] = chosen.value;
    if (entries.length > 1) {
      const where = entries.map((entry) => entry.line).join(", ");
      warnings.push(`${name} ditulis ${entries.length} kali di .env (baris ${where}). Yang dipakai: baris ${chosen.line}. Hapus yang lain supaya tidak membingungkan.`);
    }
  }
  return { values, warnings };
}

/** Catatan tentang isi .env yang perlu diketahui pemilik, misalnya pengaturan yang ditulis dua kali. */
export const envFileWarnings: string[] = [];

// Pengujian otomatis memakai nilai tetap dari vitest.config.ts dan tidak boleh ikut membaca rahasia di .env.
const envFile = resolve(ROOT_DIR, ".env");
if (process.env.NODE_ENV !== "test" && existsSync(envFile)) {
  const { values, warnings } = parseEnvFile(readFileSync(envFile, "utf8"));
  envFileWarnings.push(...warnings);
  // Variabel yang sudah ada di lingkungan (misalnya dari perintah atau Docker) tidak ditimpa.
  for (const [name, value] of Object.entries(values)) process.env[name] ??= value;
}

/** Baris kosong seperti "LLM_MODEL=" di .env dianggap tidak diisi. */
const blank = <T extends z.ZodType>(schema: T) => z.preprocess((value) => (value === "" ? undefined : value), schema);
const optional = (schema: z.ZodString) => blank(schema.optional());
const EFFORT = z.enum(["low", "medium", "high", "xhigh", "max"]);

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  PUBLIC_URL: z.url().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1),
  ADMIN_PASSWORD: z.string().min(8, "minimal 8 karakter"),
  SESSION_SECRET: z.string().min(32, "minimal 32 karakter"),
  ENCRYPTION_KEY: z
    .string()
    .refine((value) => Buffer.from(value, "base64").length === 32, "harus 32 byte dalam base64"),
  /** Format API model AI: "anthropic" (Messages API) atau "openai" (Chat Completions). */
  LLM_PROVIDER: blank(z.enum(["anthropic", "openai"], { error: 'harus "anthropic" atau "openai"' }).default("anthropic")),
  LLM_BASE_URL: blank(z.url({ error: "harus alamat lengkap, misalnya http://localhost:20128/v1" }).optional()),
  LLM_API_KEY: optional(z.string()),
  LLM_MODEL: optional(z.string()),
  LLM_EFFORT: blank(EFFORT.optional()),
  LLM_MAX_TOKENS: blank(z.coerce.number().int().positive().optional()),
  // Nama lama, tetap dibaca supaya .env dari versi sebelumnya masih jalan.
  ANTHROPIC_API_KEY: optional(z.string()),
  ANTHROPIC_MODEL: optional(z.string()),
  ANTHROPIC_EFFORT: blank(EFFORT.optional()),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  /** Isi "true" bila server berada di belakang reverse proxy (nginx, Caddy), supaya IP pengunjung terbaca benar. */
  TRUST_PROXY: z.stringbool().default(false),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const problems = parsed.error.issues.map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`);
  console.error(
    ["Konfigurasi .env belum lengkap:", ...problems, "", 'Jalankan "npm run setup" di folder utama proyek, lalu coba lagi.'].join("\n"),
  );
  process.exit(1);
}

export const env = {
  ...parsed.data,
  PUBLIC_URL: parsed.data.PUBLIC_URL.replace(/\/+$/, ""),
  isProduction: parsed.data.NODE_ENV === "production",
};
