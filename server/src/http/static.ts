import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { Hono } from "hono";
import type { Tenant } from "../db/schema.js";
import { ROOT_DIR } from "../env.js";
import { findTenantByPublicKey } from "../tenants.js";

const dashboardDir = join(ROOT_DIR, "dashboard", "dist");
const widgetFile = join(ROOT_DIR, "widget", "dist", "widget.js");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

export const staticRoutes = new Hono();

/** Skrip widget yang dimuat website klien. */
staticRoutes.get("/widget.js", async (c) => {
  try {
    return c.body(new Uint8Array(await readFile(widgetFile)), 200, { "Content-Type": MIME[".js"]!, "Cache-Control": "public, max-age=300" });
  } catch {
    return c.body('console.warn("Widget belum dibangun. Jalankan `npm run build` di server.");', 200, { "Content-Type": MIME[".js"]! });
  }
});

/** Halaman contoh: memperlihatkan widget seperti saat terpasang di website klien. */
staticRoutes.get("/demo/:publicKey", async (c) => {
  const tenant = await findTenantByPublicKey(c.req.param("publicKey"));
  if (!tenant) return c.text("Halaman contoh tidak ditemukan.", 404);
  return c.html(demoPage(tenant));
});

/** Dashboard hasil build. Alamat yang bukan file dikembalikan ke index.html supaya navigasi di dalam aplikasi berjalan. */
staticRoutes.get("*", async (c) => {
  const path = decodeURIComponent(new URL(c.req.url).pathname);
  if (path.startsWith("/api/")) return c.json({ error: "Alamat tidak ditemukan." }, 404);

  const target = normalize(join(dashboardDir, path));
  const insideDashboard = target === dashboardDir || target.startsWith(dashboardDir + sep);
  const isFile = insideDashboard && extname(target) !== "" && (await stat(target).then((info) => info.isFile(), () => false));

  try {
    const file = isFile ? target : join(dashboardDir, "index.html");
    const extension = extname(file);
    return c.body(new Uint8Array(await readFile(file)), 200, {
      "Content-Type": MIME[extension] ?? "application/octet-stream",
      // Nama file di /assets memuat sidik isi, jadi aman disimpan lama. index.html selalu diperiksa ulang.
      "Cache-Control": path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "same-origin",
    });
  } catch {
    return c.html(
      `<!doctype html><meta charset="utf-8"><title>Sahut</title>
<body style="font:16px/1.6 system-ui,sans-serif;max-width:560px;margin:80px auto;padding:0 24px;color:#1b1f24">
<h1 style="font-size:20px">Dashboard belum dibangun</h1>
<p>Saat pengembangan (<code>npm run dev</code>), dashboard dibuka di <a href="http://localhost:5173">http://localhost:5173</a>.</p>
<p>Untuk menjalankannya dari alamat ini, jalankan <code>npm run build</code> lalu <code>npm start</code>.</p>`,
      200,
    );
  }
});

function demoPage(tenant: Tenant): string {
  const name = escapeHtml(tenant.name);
  const bot = escapeHtml(tenant.botName);
  const accent = /^#[0-9a-fA-F]{6}$/.test(tenant.accentColor) ? tenant.accentColor : "#14694F";
  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${name} (halaman contoh)</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font: 16px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; color: #1b1f24; background: #fff; }
  header { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 18px 32px; border-bottom: 1px solid #e4e7ea; }
  .brand { font-weight: 700; font-size: 18px; letter-spacing: -0.01em; }
  .brand::before { content: ""; display: inline-block; width: 10px; height: 10px; margin-right: 10px; border-radius: 3px; background: ${accent}; }
  nav { display: flex; gap: 24px; color: #5a6470; font-size: 15px; }
  main { max-width: 760px; margin: 0 auto; padding: 72px 32px 160px; }
  .note { display: inline-block; margin-bottom: 20px; padding: 4px 10px; border: 1px solid #e4e7ea; border-radius: 6px; color: #5a6470; font-size: 13px; }
  h1 { margin: 0 0 16px; font-size: clamp(30px, 5vw, 44px); line-height: 1.15; letter-spacing: -0.02em; }
  p { margin: 0 0 16px; max-width: 58ch; color: #3d4650; }
  .steps { margin: 40px 0 0; padding: 0; list-style: none; border-top: 1px solid #e4e7ea; }
  .steps li { padding: 16px 0; border-bottom: 1px solid #e4e7ea; color: #3d4650; }
  .steps b { color: #1b1f24; }
  @media (max-width: 600px) { header { padding: 16px 20px; } nav { display: none; } main { padding: 48px 20px 140px; } }
</style>
</head>
<body>
<header>
  <div class="brand">${name}</div>
  <nav><span>Beranda</span><span>Produk</span><span>Kontak</span></nav>
</header>
<main>
  <span class="note">Halaman contoh, bukan website asli</span>
  <h1>Begini tampilan asisten ${bot} di website ${name}</h1>
  <p>Tombol chat di pojok kanan bawah adalah widget yang akan muncul di website Anda. Klik tombol itu dan ajukan pertanyaan seperti yang biasa ditanyakan pelanggan.</p>
  <ul class="steps">
    <li><b>Jawaban diambil dari dokumen Anda.</b> ${bot} hanya menjawab berdasarkan pengetahuan yang sudah dimasukkan untuk ${name}.</li>
    <li><b>Yang tidak bisa dijawab diteruskan ke staf.</b> Coba minta bicara dengan manusia, lalu lihat percakapannya muncul di dashboard.</li>
    <li><b>Staf bisa membalas dari dashboard.</b> Balasan staf muncul di jendela chat yang sama.</li>
  </ul>
</main>
<script src="/widget.js" data-key="${escapeHtml(tenant.publicKey)}" async></script>
</body>
</html>`;
}
