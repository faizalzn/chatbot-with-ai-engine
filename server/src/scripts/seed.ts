// Memuat tiga bisnis contoh dari data/samples. Aman dijalankan berulang: bisnis yang sudah ada dilewati.
//   npm run seed
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { closeDatabase, prepareDatabase } from "../db/index.js";
import { ROOT_DIR } from "../env.js";
import { ingestionIdle } from "../knowledge/ingest.js";
import { createTenant, findTenantBySlugOrName, type NewTenant } from "../tenants.js";
import { loadFolder } from "./load-folder.js";

const samplesDir = join(ROOT_DIR, "data", "samples");

await prepareDatabase();

for (const entry of await readdir(samplesDir, { withFileTypes: true })) {
  const folder = join(samplesDir, entry.name);
  const profilePath = join(folder, "profil.json");
  if (!entry.isDirectory() || !existsSync(profilePath)) continue;

  const profile = JSON.parse(await readFile(profilePath, "utf8")) as NewTenant;
  if (await findTenantBySlugOrName(profile.slug ?? profile.name)) {
    console.log(`- ${profile.name}: sudah ada, dilewati`);
    continue;
  }

  const tenant = await createTenant(profile);
  const count = await loadFolder(tenant.id, folder);
  console.log(`- ${profile.name}: dibuat, ${count} dokumen sedang dipelajari...`);
}

await ingestionIdle();
console.log("Selesai. Data contoh siap dipakai.");
await closeDatabase();
process.exit(0);
