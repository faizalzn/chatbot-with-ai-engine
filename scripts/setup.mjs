// Membuat file .env dari .env.example dan mengisi semua rahasia secara acak.
// Aman dijalankan berulang kali: nilai yang sudah terisi tidak pernah ditimpa. Pengaturan baru
// dari .env.example yang belum ada di .env ditambahkan di bagian akhir.
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(root, ".env");
const examplePath = join(root, ".env.example");

const KEY_LINE = /^([A-Z_]+)=(.*)$/;
const parse = (text) =>
  Object.fromEntries(
    text
      .split(/\r?\n/)
      .map((line) => line.match(KEY_LINE))
      .filter(Boolean)
      .map((m) => [m[1], m[2]]),
  );

const example = readFileSync(examplePath, "utf8");
const hadEnv = existsSync(envPath);
let source = hadEnv ? readFileSync(envPath, "utf8") : example;
const current = parse(source);

// Pengaturan yang ditambahkan di versi baru, beserta komentar penjelasnya dari .env.example.
const added = [];
if (hadEnv) {
  const block = [];
  let comments = [];
  for (const line of example.split(/\r?\n/)) {
    const m = line.match(KEY_LINE);
    if (!m) {
      comments = line.startsWith("#") && !line.startsWith("# ---") ? [...comments, line] : [];
      continue;
    }
    if (!(m[1] in current)) {
      block.push(...comments, line);
      added.push(m[1]);
    }
    comments = [];
  }
  if (block.length) source = `${source.replace(/\s*$/, "")}\n\n# --- Ditambahkan oleh npm run setup ------------------------------------------\n${block.join("\n")}\n`;
}

const dbPassword = current.POSTGRES_PASSWORD || randomBytes(18).toString("hex");
const dbPort = current.DB_PORT || "5432";

const generated = {
  ADMIN_PASSWORD: () => randomBytes(9).toString("base64url"),
  SESSION_SECRET: () => randomBytes(32).toString("hex"),
  ENCRYPTION_KEY: () => randomBytes(32).toString("base64"),
  POSTGRES_PASSWORD: () => dbPassword,
  DATABASE_URL: () => `postgres://sahut:${dbPassword}@127.0.0.1:${dbPort}/sahut`,
};

const filled = [];
const output = source
  .split(/\r?\n/)
  .map((line) => {
    const m = line.match(KEY_LINE);
    if (!m || m[2] !== "" || !generated[m[1]]) return line;
    filled.push(m[1]);
    return `${m[1]}=${generated[m[1]]()}`;
  })
  .join("\n");

writeFileSync(envPath, output);

const changes = [filled.length && `diisi otomatis: ${filled.join(", ")}`, added.length && `pengaturan baru ditambahkan: ${added.join(", ")}`].filter(Boolean);
console.log(changes.length ? `File .env siap. ${changes.join("; ")}.` : "File .env sudah lengkap, tidak ada yang diubah.");

// Nama yang ditulis dua kali mudah membingungkan: isian yang dikira berlaku ternyata kalah oleh baris lain.
const counts = {};
for (const line of output.split(/\r?\n/)) {
  const m = line.match(KEY_LINE);
  if (m) counts[m[1]] = (counts[m[1]] ?? 0) + 1;
}
const duplicates = Object.keys(counts).filter((key) => counts[key] > 1);
if (duplicates.length) console.log(`Perhatian: ${duplicates.join(", ")} ditulis lebih dari sekali di .env. Sisakan satu baris untuk tiap nama.`);

const final = parse(output);
if (!final.LLM_API_KEY && !final.ANTHROPIC_API_KEY && !final.LLM_BASE_URL) {
  console.log("Model AI belum diatur. Buka .env dan isi bagian Model AI (LLM_PROVIDER, LLM_API_KEY, dan lainnya) supaya bot bisa menjawab.");
}
console.log("Kata sandi dashboard ada di .env pada baris ADMIN_PASSWORD.");
