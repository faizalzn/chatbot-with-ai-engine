import { describe, expect, it } from "vitest";
import { formatForChannel, splitForChannel } from "./format.js";

describe("formatForChannel", () => {
  const answer = "# Ongkir\n\n**Jawa** Rp 12.000. Lihat [daftar lengkap](https://contoh.id/ongkir) atau kode `ONGKIR`.";

  it("mengubah Markdown menjadi format WhatsApp", () => {
    expect(formatForChannel("whatsapp", answer)).toBe("*Ongkir*\n\n*Jawa* Rp 12.000. Lihat daftar lengkap (https://contoh.id/ongkir) atau kode ONGKIR.");
  });

  it("membuang tanda format untuk Telegram", () => {
    expect(formatForChannel("telegram", answer)).toBe("Ongkir\n\nJawa Rp 12.000. Lihat daftar lengkap (https://contoh.id/ongkir) atau kode ONGKIR.");
  });

  it("membiarkan Markdown untuk web dan Discord", () => {
    expect(formatForChannel("web", `  ${answer}\n`)).toBe(answer);
    expect(formatForChannel("discord", answer)).toBe(answer);
  });
});

describe("splitForChannel", () => {
  it("tidak memecah pesan pendek", () => {
    expect(splitForChannel("telegram", "Halo, ada yang bisa dibantu?")).toEqual(["Halo, ada yang bisa dibantu?"]);
  });

  it("memecah pesan panjang di batas paragraf tanpa melewati batas saluran", () => {
    const paragraphs = Array.from({ length: 40 }, (_, index) => `Paragraf ${index + 1}. ${"Isi penjelasan yang agak panjang. ".repeat(4).trim()}`);
    const parts = splitForChannel("discord", paragraphs.join("\n\n"));

    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      expect(part.length).toBeLessThanOrEqual(1900);
      // Tiap bagian dimulai di awal paragraf, bukan di tengah kalimat.
      expect(part.startsWith("Paragraf ")).toBe(true);
    }
    expect(parts.join("\n\n")).toBe(paragraphs.join("\n\n"));
  });

  it("tetap memecah teks yang tidak punya spasi", () => {
    const parts = splitForChannel("discord", "x".repeat(5000));
    expect(parts.map((part) => part.length)).toEqual([1900, 1900, 1200]);
  });
});
