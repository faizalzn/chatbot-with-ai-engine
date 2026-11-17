import { pool } from "../db/index.js";
import { embedQuery } from "./embedder.js";

export interface SearchHit {
  chunkId: string;
  documentId: string;
  title: string;
  content: string;
  score: number;
}

/** Jumlah potongan yang diberikan ke model untuk satu pertanyaan. */
export const DEFAULT_LIMIT = 6;

/** Jumlah kandidat yang diambil tiap metode sebelum digabung. */
const CANDIDATES = 20;

// Dua angka di bawah dipilih lewat `npm run check:search -w server` pada data contoh.
// Kata kunci sengaja hanya jadi pelengkap: ia menolong untuk nama produk dan kode, tetapi
// stemming bahasa Indonesia di PostgreSQL kasar, jadi bobot besar justru menurunkan mutu.
const KEYWORD_WEIGHT = 0.2;
const RANK_SMOOTHING = 10;

// Kata yang terlalu umum untuk membantu pencarian kata kunci.
const STOPWORDS = new Set(
  `ada adalah agar aja akan aku anda apa apakah atau bagaimana bagi bahwa banget banyak baru belum berapa bisa boleh buat
  bukan dalam dan dapat dari deh dengan di dia dimana dong enggak ga gak gimana gitu hanya harus ingin ini itu jadi jika juga
  kah kak kalau kami kamu kan kapan karena kita ke kenapa ketika lagi lah lalu lebih mana masih mau mengapa mereka min mohon
  nah nggak nih nya oleh pada pengen punya saat saja sama sampai saya sebagai secara sedang sekarang semua seperti siapa sih
  sudah supaya tak tanya tapi telah tentang terima kasih tetapi tidak tolong tuh udah untuk ya yang yg halo hai hi selamat
  pagi siang sore malam permisi the a an is are to of for and or in on how what when where can i you do does`.split(/\s+/),
);

/** Menyusun kata penting dari pertanyaan menjadi kueri "kata1 | kata2" untuk pencarian teks PostgreSQL. */
export function buildKeywordQuery(query: string): string {
  const words = query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const unique = [...new Set(words.filter((word) => word.length > 1 && !STOPWORDS.has(word)))];
  return unique.slice(0, 12).join(" | ");
}

/**
 * Pencarian gabungan di basis pengetahuan satu bisnis.
 *
 * Pencarian makna (vektor) menemukan potongan yang maksudnya mirip walau katanya berbeda.
 * Pencarian kata kunci menangkap istilah persis seperti nama paket atau kode produk.
 * Keduanya digabung berdasarkan peringkat (Reciprocal Rank Fusion), jadi skor mentahnya tidak perlu disetarakan.
 */
export async function searchKnowledge(tenantId: string, query: string, limit = DEFAULT_LIMIT): Promise<SearchHit[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const vector = `[${(await embedQuery(trimmed.slice(0, 1000))).join(",")}]`;
  const keywords = buildKeywordQuery(trimmed);

  const result = await pool.query<{ id: string; document_id: string; title: string; content: string; score: number }>(
    `
    WITH semantic AS (
      SELECT id, ROW_NUMBER() OVER (ORDER BY embedding <=> $2::vector) AS rank
      FROM chunks
      WHERE tenant_id = $1
      ORDER BY embedding <=> $2::vector
      LIMIT $4
    ),
    keyword AS (
      SELECT id, ROW_NUMBER() OVER (ORDER BY ts_rank_cd(to_tsvector('indonesian', content), terms) DESC) AS rank
      FROM chunks, to_tsquery('indonesian', $3) AS terms
      WHERE tenant_id = $1 AND $3 <> '' AND to_tsvector('indonesian', content) @@ terms
      ORDER BY ts_rank_cd(to_tsvector('indonesian', content), terms) DESC
      LIMIT $4
    )
    SELECT c.id, c.document_id, d.title, c.content,
           (COALESCE(1.0 / ($5 + semantic.rank), 0) + $6 * COALESCE(1.0 / ($5 + keyword.rank), 0))::float8 AS score
    FROM chunks c
    JOIN documents d ON d.id = c.document_id
    LEFT JOIN semantic ON semantic.id = c.id
    LEFT JOIN keyword ON keyword.id = c.id
    WHERE semantic.id IS NOT NULL OR keyword.id IS NOT NULL
    ORDER BY score DESC, c.position
    LIMIT $7
    `,
    [tenantId, vector, keywords, CANDIDATES, RANK_SMOOTHING, KEYWORD_WEIGHT, limit],
  );

  return result.rows.map((row) => ({
    chunkId: row.id,
    documentId: row.document_id,
    title: row.title,
    content: row.content,
    score: row.score,
  }));
}
