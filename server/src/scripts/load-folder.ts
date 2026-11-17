import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { extractText, titleFromFileName } from "../knowledge/extract.js";
import { createDocument } from "../knowledge/ingest.js";

const READABLE = /\.(md|markdown|txt|pdf|docx)$/i;

/** Memuat semua dokumen di satu folder ke basis pengetahuan sebuah bisnis. Mengembalikan jumlah dokumen. */
export async function loadFolder(tenantId: string, folder: string): Promise<number> {
  const files = (await readdir(folder)).filter((file) => READABLE.test(file)).sort();
  for (const file of files) {
    const text = await extractText(file, await readFile(join(folder, file)));
    // Sub-judul pertama ("# Judul") dipakai sebagai judul dokumen bila ada.
    const heading = /^#\s+(.+)$/m.exec(text)?.[1]?.trim();
    await createDocument(tenantId, { title: heading ?? titleFromFileName(file), content: text, fileName: file });
  }
  return files.length;
}
