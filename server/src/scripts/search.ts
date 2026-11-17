// Alat bantu untuk memeriksa hasil pencarian tanpa memanggil model:
//   npm run search -w server -- kopi-sukaseduh "berapa ongkir ke Surabaya?"
import { closeDatabase } from "../db/index.js";
import { searchKnowledge } from "../knowledge/search.js";
import { findTenantBySlugOrName } from "../tenants.js";

const [name, ...words] = process.argv.slice(2);
const query = words.join(" ");
const tenant = name ? await findTenantBySlugOrName(name) : null;

if (!tenant || !query) {
  console.error('Cara pakai: npm run search -w server -- <bisnis> "pertanyaan"');
  if (name && !tenant) console.error(`Bisnis tidak ditemukan: ${name}`);
  process.exit(1);
}

for (const hit of await searchKnowledge(tenant.id, query)) {
  const [label, ...body] = hit.content.split("\n\n");
  console.log(`\n[${hit.score.toFixed(4)}] ${label}`);
  console.log(`  ${body.join(" ").replace(/\s+/g, " ").slice(0, 220)}`);
}

await closeDatabase();
process.exit(0);
