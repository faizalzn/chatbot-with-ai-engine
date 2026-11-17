# Sahut

Chatbot layanan pelanggan untuk bisnis, dijalankan oleh model AI pilihan Anda: Claude, GPT, Gemini, atau model lain lewat API berformat Anthropic maupun OpenAI. Satu bot bisa menjawab pelanggan di **website, WhatsApp, Telegram, dan Discord** sekaligus. Jawabannya diambil dari dokumen milik bisnis itu sendiri (daftar harga, kebijakan, FAQ), dan percakapan diteruskan ke staf bila bot tidak tahu jawabannya atau pelanggan minta dilayani manusia.

Satu instalasi bisa melayani banyak bisnis. Tiap bisnis punya dokumen, pengaturan bot, dan salurannya sendiri, jadi untuk klien baru Anda cukup menambah bisnis dan mengunggah dokumennya. Kode tidak perlu diubah.

## Fitur

- **Jawaban dari dokumen bisnis.** Unggah file `.md`, `.txt`, `.pdf`, atau `.docx`. Dokumen dipotong per bagian, diubah menjadi vektor oleh model yang berjalan di komputer sendiri (tanpa biaya API), lalu dicari dengan gabungan pencarian makna dan kata kunci. Bot hanya menjawab dari dokumen dan tidak mengarang harga atau kebijakan.
- **Empat saluran.** Widget chat untuk website (satu baris kode), WhatsApp (pindai QR), Telegram, dan Discord (tempel token bot). Semua disambungkan dari dashboard.
- **Serah-terima ke staf.** Bot meneruskan percakapan bila diminta pelanggan, saat ada komplain atau refund, atau saat bot gagal menjawab. Staf membalas dari dashboard, lalu mengembalikan percakapan ke bot setelah selesai.
- **Dashboard yang mudah dipakai orang awam.** Ada kotak masuk percakapan, pengelola dokumen, penyambung saluran, halaman untuk mencoba bot (lengkap dengan daftar dokumen yang dibaca bot), dan pengaturan nama, sapaan, gaya bicara, serta warna widget.
- **Jawaban mengalir.** Di website, jawaban muncul kata demi kata seperti diketik. Pesan beruntun dari pelanggan ("halo", "mau tanya", "ongkir ke Bandung?") digabung dan dijawab sekali.

## Kebutuhan

- [Node.js](https://nodejs.org) 24 atau lebih baru
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) untuk database PostgreSQL + pgvector
- Akses ke model AI: kunci API Claude dari [platform.claude.com](https://platform.claude.com), kunci dari penyedia lain, atau router lokal seperti [9router](https://github.com/decolua/9router). Lihat [Memilih model AI](#memilih-model-ai).

## Menjalankan di komputer sendiri

```bash
npm install
npm run setup      # membuat .env dan mengisi semua kata sandi serta kunci rahasia secara acak
```

Buka `.env` dan isi bagian **Model AI** (lihat [Memilih model AI](#memilih-model-ai)), lalu:

```bash
npm run db:up      # menyalakan database
npm run seed       # memuat tiga bisnis contoh (kedai kopi, klinik gigi, penyedia internet)
npm run dev
```

Buka **http://localhost:5173** dan masuk dengan kata sandi di baris `ADMIN_PASSWORD` pada `.env`.

Saat pertama dijalankan, model pencarian (sekitar 130 MB) diunduh ke `data/models/`. Setelah itu semuanya berjalan tanpa internet kecuali panggilan ke model AI.

Untuk mencoba widget seperti pelanggan, buka **Saluran → Website → Buka halaman contoh**.

Sudah punya `.env` dari versi sebelumnya? Jalankan `npm run setup` sekali lagi. Pengaturan baru ditambahkan di bagian akhir `.env`, dan isi yang lama tidak diubah.

## Memilih model AI

Model diatur di `.env`. Sahut mengenal dua format API, jadi hampir semua penyedia bisa dipakai tanpa mengubah kode:

| Pengaturan       | Isi |
| ---------------- | --- |
| `LLM_PROVIDER`   | `anthropic` untuk Messages API (API Claude resmi dan server yang meniru formatnya), atau `openai` untuk Chat Completions (OpenAI, OpenRouter, Groq, DeepSeek, Gemini, Ollama, 9router, dan lainnya). |
| `LLM_BASE_URL`   | Alamat API. Kosongkan untuk alamat resmi (`api.anthropic.com` atau `api.openai.com`). |
| `LLM_API_KEY`    | Kunci API. Boleh kosong untuk server lokal yang tidak meminta kunci. |
| `LLM_MODEL`      | Nama model persis seperti di penyedia. Wajib untuk format `openai`; untuk `anthropic` bawaannya `claude-opus-5-5`. |
| `LLM_EFFORT`     | Opsional. Seberapa dalam model berpikir (`low` sampai `max`). |
| `LLM_MAX_TOKENS` | Opsional. Batas panjang jawaban, bila penyedia menolak bawaannya. |

**9router** (router lokal di `http://localhost:20128`). Nama model bisa dilihat di dashboard 9router atau di `http://localhost:20128/v1/models`. Kunci boleh kosong bila 9router tidak meminta kunci.

```env
LLM_PROVIDER=openai
LLM_BASE_URL=http://localhost:20128/v1
LLM_API_KEY=kunci-dari-dashboard-9router
LLM_MODEL=cc/claude-sonnet-5-5
```

9router juga menerima format Anthropic. Isi `LLM_PROVIDER=anthropic` dengan alamat yang sama bila ingin memakai format itu.

**API Claude resmi.** Fitur khusus Claude ikut aktif otomatis: tingkat berpikir `low` yang cepat untuk layanan pelanggan, dan pengalihan ke model cadangan bila model menolak karena salah tangkap filter keamanan.

```env
LLM_PROVIDER=anthropic
LLM_API_KEY=sk-ant-...
```

**Penyedia lain berformat OpenAI.** Isi `LLM_PROVIDER=openai`, kunci, nama model, dan alamat berikut:

| Penyedia   | `LLM_BASE_URL` |
| ---------- | -------------- |
| OpenAI     | (kosongkan) |
| OpenRouter | `https://openrouter.ai/api/v1` |
| Groq       | `https://api.groq.com/openai/v1` |
| DeepSeek   | `https://api.deepseek.com/v1` |
| Gemini     | `https://generativelanguage.googleapis.com/v1beta/openai` |
| Ollama     | `http://localhost:11434/v1` |

Pilih model yang mendukung pemanggilan alat (*tool calling* atau *function calling*). Bot memakai alat untuk mencari ulang di dokumen dan untuk meneruskan percakapan ke staf. Model tanpa dukungan itu akan ditolak penyedianya.

Untuk memastikan pengaturannya benar, jalankan `npm run check:llm`. Perintah ini menampilkan pengaturan yang benar-benar terbaca (kunci API tidak ditampilkan), memperingatkan bila ada nama yang ditulis dua kali di `.env`, lalu mengirim satu pesan uji ke model.

Saat `npm run dev` berjalan, server menyala ulang sendiri setiap kali `.env` disimpan. Model yang sedang dipakai tertulis di log saat server menyala dan di halaman **Coba bot**. Bila sambungannya bermasalah (kunci ditolak, nama model salah, server tidak menyala), halaman **Coba bot** menampilkan penyebabnya. Pelanggan tidak melihat pesan teknis itu: mereka mendapat permintaan maaf, dan percakapannya diteruskan ke staf.

## Menyiapkan klien baru

Cara termudah lewat dashboard: **Tambah bisnis**, lalu unggah dokumennya di **Pengetahuan**.

Kalau dokumennya sudah terkumpul dalam satu folder, bisa juga lewat terminal:

```bash
npm run ingest -- "Nama Bisnis" ./folder-dokumen-klien
```

Bisnis dibuat otomatis bila belum ada. Bila sudah ada, dokumennya ditambahkan.

Tips menyusun dokumen agar jawaban bot tepat:

- Satu file per topik (produk dan harga, pengiriman, pembayaran, FAQ). Judul `# ...` di baris pertama dipakai sebagai judul dokumen.
- Pakai sub-judul `## ...` untuk tiap bagian. Dokumen dipotong per bagian, jadi satu bagian sebaiknya membahas satu hal.
- Tulis angka apa adanya ("Rp 25.000", "pukul 08.00–17.00 WIB"). Hindari "lihat tabel di atas", karena bot hanya membaca potongan yang relevan.
- Contoh yang baik ada di `data/samples/`. Tiap folder juga memuat `profil.json` (nama bot, sapaan, arahan khusus, warna) yang dipakai `npm run seed`.

Arahan khusus seperti "sapa pelanggan dengan Kak" atau "komplain barang rusak selalu diteruskan ke staf" diatur di **Pengaturan → Arahan untuk bot**.

## Menyambungkan saluran

Semua dilakukan dari halaman **Saluran** di dashboard. Petunjuk langkah demi langkahnya juga tersedia di halaman itu.

| Saluran  | Yang dibutuhkan |
| -------- | --------------- |
| Website  | Salin satu baris kode dan tempel sebelum `</body>` di website klien. |
| WhatsApp | Pindai QR dengan WhatsApp di ponsel (**Perangkat tertaut → Tautkan perangkat**). |
| Telegram | Buat bot lewat [@BotFather](https://t.me/BotFather) dengan perintah `/newbot`, lalu tempel tokennya. |
| Discord  | Buat aplikasi di [Discord Developer Portal](https://discord.com/developers/applications), salin token dari tab **Bot**, lalu tempel. Setelah tersambung, dashboard menampilkan tautan untuk mengundang bot ke server. Bot menjawab pesan langsung (DM) dan pesan yang menyebut @nama-bot. |

Token Telegram dan Discord disimpan terenkripsi di database. Sesi WhatsApp disimpan di `data/whatsapp/`.

> **Catatan WhatsApp.** Proyek ini memakai WhatsApp Web tidak resmi (pustaka [Baileys](https://github.com/WhiskeySockets/Baileys)) supaya bisa dicoba tanpa pendaftaran ke Meta. Cara ini melanggar ketentuan WhatsApp dan nomornya bisa diblokir, jadi pakai nomor cadangan untuk demo. Untuk klien sungguhan, gunakan [WhatsApp Business Platform](https://developers.facebook.com/docs/whatsapp/cloud-api) resmi. Saluran lain sudah memakai API resmi.

### Widget website

```html
<script src="https://alamat-server-anda/widget.js" data-key="KUNCI_PUBLIK_BISNIS" async></script>
```

Tambahkan `data-position="left"` bila tombol chat ingin di kiri bawah. Nama bot, sapaan, dan warna diambil dari pengaturan bisnis, jadi perubahan di dashboard langsung terlihat tanpa mengganti kode di website. Widget berjalan di dalam Shadow DOM sehingga tampilannya tidak bentrok dengan CSS website klien, dan ukurannya sekitar 19 kB.

## Menjalankan di server

```bash
npm run build
npm start
```

Server, dashboard, dan widget berjalan di satu port (`PORT`, bawaan 3000). Sebelum itu, ubah `PUBLIC_URL` di `.env` menjadi alamat publik server (misalnya `https://chat.contoh.id`), karena alamat ini dipakai di kode widget yang ditempel ke website klien. Pasang HTTPS di depan server, misalnya dengan Caddy atau Nginx.

## Struktur proyek

```
server/      API, inti bot, pencarian dokumen, dan penyambung saluran (Hono, Drizzle, Claude API atau API berformat OpenAI)
dashboard/   Dashboard admin (React, Vite, Tailwind, Radix)
widget/      Widget chat website (TypeScript murni, satu file JS)
shared/      Kode yang dipakai widget dan dashboard: pengurai Markdown aman dan pembaca aliran jawaban
data/        Contoh dokumen bisnis, model pencarian, dan sesi WhatsApp
scripts/     Skrip persiapan .env
```

Alur satu pesan masuk:

1. Pesan dari saluran mana pun masuk ke `server/src/engine/engine.ts`. Pesan beruntun digabung lebih dulu.
2. Potongan dokumen yang relevan dicari (`server/src/knowledge/search.ts`) dan dikirim ke model AI bersama riwayat percakapan (`server/src/engine/llm.ts`; penerjemah format OpenAI ada di `openai-compatible.ts`).
3. Model menjawab. Bila perlu, model bisa mencari ulang dengan kata kunci lain (`cari_pengetahuan`) atau meneruskan ke staf (`teruskan_ke_staf`).
4. Jawaban dikirim balik lewat saluran asal, dan dokumen yang dibaca dicatat untuk ditampilkan di dashboard.

## Pengujian

```bash
npm test             # tes otomatis: inti bot, prompt, pemotong dokumen, enkripsi, Markdown, aliran jawaban
npm run typecheck    # pemeriksaan tipe untuk server, dashboard, dan widget
npm run check:search -w server   # mutu pencarian pada data contoh (butuh npm run seed)
```

`check:search` menjalankan sekumpulan pertanyaan pelanggan sungguhan terhadap data contoh dan memeriksa apakah potongan yang berisi jawabannya ikut ditemukan. Jalankan setelah mengubah cara memotong dokumen atau cara mencari.
