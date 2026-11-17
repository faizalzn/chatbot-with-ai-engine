import { join } from "node:path";
import { env as transformersEnv, pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";
import { ROOT_DIR } from "../env.js";
import { createLogger } from "../lib/logger.js";

/**
 * Mengubah teks menjadi vektor, dijalankan lokal di server (tanpa API berbayar).
 *
 * Modelnya multibahasa dan bekerja baik untuk bahasa Indonesia. Diunduh sekali (±120 MB)
 * ke data/models saat pertama dipakai. Untuk beralih ke layanan embedding lain, cukup ganti
 * isi dua fungsi di bawah dan sesuaikan EMBEDDING_DIMENSIONS di skema database.
 */
const MODEL = "Xenova/multilingual-e5-small";
const BATCH_SIZE = 16;

const log = createLogger("embedding");

transformersEnv.cacheDir = join(ROOT_DIR, "data", "models");

let extractor: Promise<FeatureExtractionPipeline> | null = null;

function loadExtractor(): Promise<FeatureExtractionPipeline> {
  if (!extractor) {
    log.info("Menyiapkan model pencarian (unduhan pertama bisa makan beberapa menit)...");
    const started = Date.now();
    extractor = pipeline("feature-extraction", MODEL, { dtype: "q8" }).then(
      (loaded) => {
        log.info(`Model pencarian siap (${Math.round((Date.now() - started) / 1000)} dtk)`);
        return loaded;
      },
      (error) => {
        extractor = null; // biarkan percobaan berikutnya mengulang dari awal
        throw error;
      },
    );
  }
  return extractor;
}

async function embed(texts: string[]): Promise<number[][]> {
  const model = await loadExtractor();
  const vectors: number[][] = [];
  for (let start = 0; start < texts.length; start += BATCH_SIZE) {
    const output = await model(texts.slice(start, start + BATCH_SIZE), { pooling: "mean", normalize: true });
    vectors.push(...(output.tolist() as number[][]));
  }
  return vectors;
}

// Model E5 dilatih dengan awalan "passage:" untuk isi dokumen dan "query:" untuk pertanyaan.
export function embedPassages(passages: string[]): Promise<number[][]> {
  return embed(passages.map((passage) => `passage: ${passage}`));
}

export async function embedQuery(query: string): Promise<number[]> {
  const [vector] = await embed([`query: ${query}`]);
  return vector!;
}

/** Memuat model lebih awal supaya pertanyaan pertama pelanggan tidak menunggu. */
export function warmUpEmbedder(): void {
  loadExtractor().catch((error) => log.error("Model pencarian gagal dimuat", error));
}
