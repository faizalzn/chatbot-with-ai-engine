import mammoth from "mammoth";
import { extractText as extractPdfText } from "unpdf";
import { UserFacingError } from "../lib/errors.js";

export const SUPPORTED_EXTENSIONS = ["pdf", "docx", "txt", "md"] as const;

/** Mengambil teks dari file yang diunggah. */
export async function extractText(fileName: string, bytes: Uint8Array): Promise<string> {
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  let text: string;

  try {
    if (extension === "pdf") {
      text = (await extractPdfText(bytes, { mergePages: true })).text;
    } else if (extension === "docx") {
      text = (await mammoth.extractRawText({ buffer: Buffer.from(bytes) })).value;
    } else if (extension === "txt" || extension === "md" || extension === "markdown") {
      text = new TextDecoder("utf-8").decode(bytes);
    } else if (extension === "doc") {
      throw new UserFacingError("File Word lama (.doc) belum didukung. Simpan ulang sebagai .docx, lalu unggah lagi.");
    } else {
      throw new UserFacingError("Jenis file ini belum didukung. Gunakan PDF, Word (.docx), atau teks (.txt).");
    }
  } catch (error) {
    if (error instanceof UserFacingError) throw error;
    throw new UserFacingError("File tidak bisa dibaca. Pastikan file tidak rusak dan tidak dikunci kata sandi.");
  }

  if (text.trim().length < 20) {
    throw new UserFacingError(
      "Tidak ada teks yang bisa dibaca dari file ini. Kalau file berisi hasil pindaian atau foto, ketik isinya lewat \"Tulis langsung\".",
    );
  }
  return text;
}

/** "panduan-pengiriman_2024.pdf" menjadi "panduan pengiriman 2024". */
export function titleFromFileName(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : "Dokumen tanpa judul";
}
