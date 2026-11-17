import { describe, expect, it } from "vitest";
import { chunkDocument } from "./chunker.js";

const paragraph = (seed: string, sentences: number) => Array.from({ length: sentences }, (_, index) => `${seed} kalimat nomor ${index + 1} yang cukup panjang untuk mengisi potongan.`).join(" ");

describe("chunkDocument", () => {
  it("mengawali tiap potongan dengan judul dokumen dan jalur sub-judulnya", () => {
    const chunks = chunkDocument("Pengiriman", "# Pengiriman\n\nKami mengirim setiap hari kerja.\n\n## Ongkos kirim\n\nJawa Rp 12.000.\n\n### Luar Jawa\n\nMulai Rp 25.000.");

    expect(chunks).toEqual([
      "Pengiriman\n\nKami mengirim setiap hari kerja.",
      "Pengiriman › Ongkos kirim\n\nJawa Rp 12.000.",
      "Pengiriman › Ongkos kirim › Luar Jawa\n\nMulai Rp 25.000.",
    ]);
  });

  it("mengganti jalur saat bertemu sub-judul yang setingkat", () => {
    const chunks = chunkDocument("FAQ", "## Pembayaran\n\nTransfer bank.\n\n### Cicilan\n\nBelum tersedia.\n\n## Garansi\n\nSatu tahun.");

    expect(chunks.map((chunk) => chunk.split("\n")[0])).toEqual(["FAQ › Pembayaran", "FAQ › Pembayaran › Cicilan", "FAQ › Garansi"]);
  });

  it("membuang tanda format dari sub-judul", () => {
    const [chunk] = chunkDocument("Menu", "## **Kopi** `susu`\n\nRp 20.000.");
    expect(chunk).toBe("Menu › Kopi susu\n\nRp 20.000.");
  });

  it("menjadikan teks tanpa sub-judul sebagai satu potongan berjudul", () => {
    expect(chunkDocument("Jam buka", "Senin sampai Sabtu.\r\nMinggu tutup.")).toEqual(["Jam buka\n\nSenin sampai Sabtu.\nMinggu tutup."]);
  });

  it("mengembalikan daftar kosong untuk teks kosong", () => {
    expect(chunkDocument("Kosong", "  \n\n ")).toEqual([]);
  });

  it("memecah bagian panjang menjadi beberapa potongan yang semuanya membawa labelnya", () => {
    const body = Array.from({ length: 12 }, (_, index) => paragraph(`Paragraf ${index + 1}`, 4)).join("\n\n");
    const chunks = chunkDocument("Panduan", `## Langkah\n\n${body}`);

    expect(chunks.length).toBeGreaterThan(2);
    for (const chunk of chunks) {
      expect(chunk.startsWith("Panduan › Langkah\n\n")).toBe(true);
      expect(chunk.length).toBeLessThanOrEqual(1400 + "Panduan › Langkah\n\n".length);
    }
    // Tidak ada isi yang hilang saat dipecah.
    expect(chunks.join(" ")).toContain("Paragraf 1 kalimat nomor 1");
    expect(chunks.join(" ")).toContain("Paragraf 12 kalimat nomor 4");
  });

  it("memecah satu paragraf raksasa tanpa melewati batas ukuran", () => {
    const chunks = chunkDocument("Syarat", paragraph("Ketentuan", 60));

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(1400 + "Syarat\n\n".length);
  });

  it("mengulang kepala tabel di tiap potongan tabel yang dipecah", () => {
    const header = "| Paket | Kecepatan | Harga |\n|---|---|---|";
    const rows = Array.from({ length: 60 }, (_, index) => `| Paket ${index + 1} | ${10 * (index + 1)} Mbps | Rp ${100 + index}.000 per bulan |`).join("\n");
    const chunks = chunkDocument("Harga", `${header}\n${rows}`);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk).toContain(header);
    expect(chunks.join("\n")).toContain("| Paket 60 |");
  });
});
