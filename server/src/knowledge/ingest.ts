import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { chunks, documents, type DocumentRow } from "../db/schema.js";
import { createLogger } from "../lib/logger.js";
import { chunkDocument } from "./chunker.js";
import { embedPassages } from "./embedder.js";
import { UserFacingError } from "../lib/errors.js";

const log = createLogger("pengetahuan");

/** Sekitar 400 halaman teks. Di atas ini biasanya salah unggah (mis. ekspor data mentah). */
export const MAX_DOCUMENT_CHARS = 1_000_000;

const INSERT_BATCH = 100;

export interface NewDocument {
  title: string;
  content: string;
  fileName?: string | null;
}

/** Menyimpan dokumen lalu mempelajarinya di latar belakang. Dokumen langsung muncul dengan status "processing". */
export async function createDocument(tenantId: string, input: NewDocument): Promise<DocumentRow> {
  const content = validateContent(input.content);
  const [row] = await db
    .insert(documents)
    .values({ tenantId, title: input.title.trim(), fileName: input.fileName ?? null, content })
    .returning();
  enqueueIngestion(row!.id);
  return row!;
}

export async function updateDocument(documentId: string, input: { title: string; content: string }): Promise<DocumentRow | null> {
  const content = validateContent(input.content);
  const [row] = await db
    .update(documents)
    .set({ title: input.title.trim(), content, status: "processing", error: null, updatedAt: new Date() })
    .where(eq(documents.id, documentId))
    .returning();
  if (row) enqueueIngestion(row.id);
  return row ?? null;
}

function validateContent(content: string): string {
  const trimmed = content.trim();
  if (trimmed.length < 20) throw new UserFacingError("Isi dokumen terlalu pendek. Tulis setidaknya satu atau dua kalimat.");
  if (trimmed.length > MAX_DOCUMENT_CHARS) {
    throw new UserFacingError("Dokumen terlalu besar. Pecah menjadi beberapa dokumen yang lebih kecil, lalu unggah satu per satu.");
  }
  return trimmed;
}

// Dokumen diproses satu per satu supaya pembuatan vektor tidak berebut CPU dengan percakapan yang sedang berjalan.
let queue: Promise<void> = Promise.resolve();

export function enqueueIngestion(documentId: string): Promise<void> {
  queue = queue.then(() => ingestDocument(documentId));
  return queue;
}

/** Selesai ketika semua dokumen yang sedang antre sudah dipelajari. Dipakai skrip, bukan server. */
export function ingestionIdle(): Promise<void> {
  return queue;
}

/** Memotong dokumen, membuat vektor tiap potongan, dan mengganti potongan lama. Tidak pernah melempar kesalahan. */
export async function ingestDocument(documentId: string): Promise<void> {
  try {
    const [document] = await db.select().from(documents).where(eq(documents.id, documentId));
    if (!document) return; // sudah dihapus sebelum sempat diproses

    const pieces = chunkDocument(document.title, document.content);
    if (pieces.length === 0) throw new UserFacingError("Dokumen ini tidak berisi teks yang bisa dipelajari.");
    const embeddings = await embedPassages(pieces);

    await db.transaction(async (tx) => {
      await tx.delete(chunks).where(eq(chunks.documentId, documentId));
      for (let start = 0; start < pieces.length; start += INSERT_BATCH) {
        await tx.insert(chunks).values(
          pieces.slice(start, start + INSERT_BATCH).map((content, offset) => ({
            tenantId: document.tenantId,
            documentId,
            position: start + offset,
            content,
            embedding: embeddings[start + offset]!,
          })),
        );
      }
      await tx
        .update(documents)
        .set({ status: "ready", error: null, chunkCount: pieces.length, updatedAt: new Date() })
        .where(eq(documents.id, documentId));
    });
    log.info(`"${document.title}" dipelajari (${pieces.length} potongan)`);
  } catch (error) {
    log.error(`Gagal mempelajari dokumen ${documentId}`, error);
    const message = error instanceof UserFacingError ? error.message : "Terjadi gangguan saat mempelajari dokumen ini. Coba simpan ulang.";
    await db
      .update(documents)
      .set({ status: "failed", error: message, updatedAt: new Date() })
      .where(eq(documents.id, documentId))
      .catch(() => {});
  }
}

/** Saat server menyala, lanjutkan dokumen yang prosesnya terputus (mis. server dimatikan di tengah jalan). */
export async function resumePendingIngestions(): Promise<void> {
  const pending = await db.select({ id: documents.id }).from(documents).where(eq(documents.status, "processing"));
  for (const { id } of pending) void enqueueIngestion(id);
  if (pending.length) log.info(`Melanjutkan ${pending.length} dokumen yang belum selesai dipelajari`);
}
