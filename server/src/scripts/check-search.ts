// Mengukur mutu pencarian pada data contoh: untuk tiap pertanyaan, apakah potongan yang memuat
// jawabannya masuk hasil pencarian? Jalankan setelah mengubah pemotong dokumen, model embedding,
// atau bobot pencarian, supaya tahu perubahan itu memperbaiki atau merusak.
//   npm run check:search -w server      (butuh `npm run seed` lebih dulu)
import { closeDatabase } from "../db/index.js";
import { searchKnowledge } from "../knowledge/search.js";
import { findTenantBySlugOrName } from "../tenants.js";

/** [pertanyaan pelanggan, teks yang harus muncul di salah satu potongan hasil] */
const CASES: Record<string, [string, string][]> = {
  "kopi-sukaseduh": [
    ["ongkir ke surabaya berapa ya kak", "Rp 16.000 sampai Rp 22.000"],
    ["bisa bayar di tempat ga?", "COD"],
    ["kopi yang cocok buat es kopi susu apa", "House Blend"],
    ["kalau pesan jam 3 sore dikirimnya kapan", "14.00 WIB"],
    ["paket saya bocor pas diterima, gimana?", "video saat membuka paket"],
    ["minimal belanja buat gratis ongkir", "Rp 250.000"],
    ["grinder nya ada garansi?", "6 bulan"],
    ["cara nyimpen kopi biar ga cepet basi", "Jangan simpan di kulkas"],
    ["bisa kirim ke malaysia?", "luar Indonesia"],
    ["mau berhenti langganan caranya gimana", "3 hari sebelum jadwal kirim"],
  ],
  "klinik-senyum-pagi": [
    ["bisa pakai bpjs?", "tidak bekerja sama dengan BPJS"],
    ["biaya pasang behel berapa", "Rp 6.500.000"],
    ["hari minggu buka gak", "Minggu dan libur nasional"],
    ["dokter gigi anak praktek hari apa", "Sp.KGA"],
    ["habis cabut gigi boleh merokok?", "Jangan merokok"],
    ["scaling berapa biayanya", "Rp 250.000 sampai Rp 400.000"],
    ["kalau mau batalin janji gimana", "3 jam sebelum jadwal"],
    ["alamat kliniknya dimana", "Palagan"],
    ["behel bisa dicicil?", "dicicil tanpa bunga"],
    ["gusi masih berdarah sejam setelah cabut gigi", "perdarahan yang tetap deras"],
  ],
  "lintang-fiber": [
    ["harga paket 100 mbps", "Rp 379.000"],
    ["lampu los merah kedip kedip", "sinyal serat optik terputus"],
    ["bayar tagihan lewat apa aja", "Virtual account"],
    ["internet saya diisolir, udah bayar tapi belum nyala", "aktif kembali otomatis dalam 1 jam"],
    ["ada fup nggak", "tanpa FUP"],
    ["cara ganti password wifi", "Wi-Fi Saya"],
    ["biaya pasang baru berapa", "Rp 250.000"],
    ["daerah gresik sudah tercover belum", "Kebomas"],
    ["mau pindah rumah, internetnya bisa ikut pindah?", "Rp 150.000"],
    ["wifi lemot banget padahal paket 50", "5 GHz"],
  ],
};

let total = 0;
let found = 0;
let first = 0;

for (const [slug, cases] of Object.entries(CASES)) {
  const tenant = await findTenantBySlugOrName(slug);
  if (!tenant) {
    console.error(`Bisnis "${slug}" belum ada. Jalankan "npm run seed" lebih dulu.`);
    process.exit(1);
  }
  console.log(`\n${tenant.name}`);
  for (const [question, expected] of cases) {
    const hits = await searchKnowledge(tenant.id, question);
    const position = hits.findIndex((hit) => hit.content.includes(expected));
    total++;
    if (position >= 0) found++;
    if (position === 0) first++;
    console.log(`  ${position < 0 ? "TIDAK KETEMU" : `peringkat ${position + 1}  `}  ${question}`);
  }
}

console.log(`\nKetemu di hasil teratas: ${found}/${total}. Di peringkat pertama: ${first}/${total}.`);
await closeDatabase();
process.exit(found === total ? 0 : 1);
