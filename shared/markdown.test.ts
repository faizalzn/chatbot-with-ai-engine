import { describe, expect, it } from "vitest";
import { parseInline, parseMarkdown, safeHref } from "./markdown";

describe("parseInline", () => {
  it("mengenali tebal, miring, dan kode", () => {
    expect(parseInline("Harga **Rp 25.000** untuk *ukuran kecil*, kode `HEMAT10`.")).toEqual([
      { type: "text", text: "Harga " },
      { type: "bold", children: [{ type: "text", text: "Rp 25.000" }] },
      { type: "text", text: " untuk " },
      { type: "italic", children: [{ type: "text", text: "ukuran kecil" }] },
      { type: "text", text: ", kode " },
      { type: "code", text: "HEMAT10" },
      { type: "text", text: "." },
    ]);
  });

  it("mengubah pindah baris menjadi jeda baris", () => {
    expect(parseInline("baris satu\nbaris dua")).toEqual([{ type: "text", text: "baris satu" }, { type: "break" }, { type: "text", text: "baris dua" }]);
  });

  it("membuat tautan dari [teks](alamat) dan dari alamat web polos tanpa tanda baca penutup", () => {
    expect(parseInline("Lihat [katalog](https://contoh.id/katalog) atau https://contoh.id/promo.")).toEqual([
      { type: "text", text: "Lihat " },
      { type: "link", href: "https://contoh.id/katalog", text: "katalog" },
      { type: "text", text: " atau " },
      { type: "link", href: "https://contoh.id/promo", text: "https://contoh.id/promo" },
      { type: "text", text: "." },
    ]);
  });

  it("menampilkan tautan berbahaya sebagai teks biasa", () => {
    expect(parseInline("[klik](javascript:alert)")).toEqual([{ type: "text", text: "[klik](javascript:alert)" }]);

    const nested = parseInline("[klik](javascript:alert(1))");
    expect(nested.some((node) => node.type === "link")).toBe(false);
    expect(nested.map((node) => (node.type === "text" ? node.text : "")).join("")).toBe("[klik](javascript:alert(1))");
  });

  it("tidak menganggap bintang yang berdiri sendiri sebagai miring", () => {
    expect(parseInline("2 * 3 = 6")).toEqual([{ type: "text", text: "2 * 3 = 6" }]);
  });

  it("tidak pernah menghasilkan HTML", () => {
    expect(parseInline("<img src=x onerror=alert(1)>")).toEqual([{ type: "text", text: "<img src=x onerror=alert(1)>" }]);
  });
});

describe("safeHref", () => {
  it("hanya mengizinkan web, email, dan telepon", () => {
    expect(safeHref(" https://contoh.id ")).toBe("https://contoh.id");
    expect(safeHref("mailto:halo@contoh.id")).toBe("mailto:halo@contoh.id");
    expect(safeHref("tel:+62812")).toBe("tel:+62812");
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("data:text/html,hai")).toBeNull();
    expect(safeHref("/relatif")).toBeNull();
  });
});

describe("parseMarkdown", () => {
  it("memisahkan paragraf dengan baris kosong", () => {
    expect(parseMarkdown("Halo Kak!\r\n\r\nAda yang bisa dibantu?")).toEqual([
      { type: "paragraph", children: [{ type: "text", text: "Halo Kak!" }] },
      { type: "paragraph", children: [{ type: "text", text: "Ada yang bisa dibantu?" }] },
    ]);
  });

  it("mengenali daftar berbutir dan bernomor, termasuk nomor awalnya", () => {
    const blocks = parseMarkdown("Pilihan:\n- Kecil\n• Besar\n\n3. Bayar\n4) Kirim");

    expect(blocks).toEqual([
      { type: "paragraph", children: [{ type: "text", text: "Pilihan:" }] },
      { type: "list", ordered: false, start: 1, items: [[{ type: "text", text: "Kecil" }], [{ type: "text", text: "Besar" }]] },
      { type: "list", ordered: true, start: 3, items: [[{ type: "text", text: "Bayar" }], [{ type: "text", text: "Kirim" }]] },
    ]);
  });

  it("memulai daftar baru bila jenisnya berganti", () => {
    const blocks = parseMarkdown("- satu\n1. dua");
    expect(blocks.map((block) => block.type === "list" && block.ordered)).toEqual([false, true]);
  });

  it("menyambung baris menjorok ke butir sebelumnya", () => {
    expect(parseMarkdown("- Transfer bank\n  BCA 123456")).toEqual([
      { type: "list", ordered: false, start: 1, items: [[{ type: "text", text: "Transfer bank" }, { type: "break" }, { type: "text", text: "BCA 123456" }]] },
    ]);
  });

  it("menutup daftar saat bertemu baris biasa", () => {
    expect(parseMarkdown("- satu\nTerima kasih").map((block) => block.type)).toEqual(["list", "paragraph"]);
  });

  it("menampilkan judul sebagai baris tebal", () => {
    expect(parseMarkdown("## Jam buka ##\nSetiap hari")).toEqual([
      { type: "paragraph", children: [{ type: "bold", children: [{ type: "text", text: "Jam buka" }] }] },
      { type: "paragraph", children: [{ type: "text", text: "Setiap hari" }] },
    ]);
  });

  it("mengembalikan daftar kosong untuk teks kosong", () => {
    expect(parseMarkdown("  \n\n ")).toEqual([]);
  });
});
