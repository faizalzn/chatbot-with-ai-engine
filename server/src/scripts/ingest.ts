// Memuat satu folder dokumen klien ke basis pengetahuan sebuah bisnis.
// Bisnis dibuat otomatis kalau belum ada, jadi ini cara tercepat menyiapkan klien baru:
//   npm run ingest -- "Nama Bisnis" ./folder-dokumen
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { closeDatabase, prepareDatabase } from "../db/index.js";
import { ingestionIdle } from "../knowledge/ingest.js";
import { createTenant, findTenantBySlugOrName } from "../tenants.js";
import { loadFolder } from "./load-folder.js";

const [name, folderArg] = process.argv.slice(2);
// npm menjalankan skrip dari folder server, jadi jalur relatif dihitung dari folder tempat perintah diketik.
const folder = folderArg ? resolve(process.env.INIT_CWD ?? process.cwd(), folderArg) : "";

if (!name || !folder || !existsSync(folder)) {
  console.error('Cara pakai: npm run ingest -- "Nama Bisnis" ./folder-dokumen');
  if (folder && !existsSync(folder)) console.error(`Folder tidak ditemukan: ${folder}`);
  process.exit(1);
}

await prepareDatabase();

let tenant = await findTenantBySlugOrName(name);
if (tenant) {
  console.log(`Menambahkan dokumen ke bisnis yang sudah ada: ${tenant.name}`);
} else {
  tenant = await createTenant({ name });
  console.log(`Bisnis baru dibuat: ${tenant.name}`);
}

const count = await loadFolder(tenant.id, folder);
console.log(`${count} dokumen sedang dipelajari...`);
await ingestionIdle();
console.log("Selesai.");
await closeDatabase();
process.exit(0);
