import type Anthropic from "@anthropic-ai/sdk";

export type LlmMessageParam = Anthropic.Beta.BetaMessageParam;
export type LlmContentBlock = Anthropic.Beta.BetaContentBlock;

export interface LlmRequest {
  system: string;
  messages: LlmMessageParam[];
  tools: Anthropic.Beta.BetaTool[];
  /** Dipanggil untuk tiap potongan teks jawaban, saat jawaban ditampilkan sambil diketik. */
  onText?: (delta: string) => void;
}

/**
 * Jawaban model dalam bentuk Messages API. Penyedia berformat OpenAI diterjemahkan ke bentuk ini,
 * jadi inti bot cukup mengenal satu bentuk.
 */
export interface LlmResponse {
  content: LlmContentBlock[];
  stop_reason: Anthropic.Beta.BetaStopReason | null;
  usage?: unknown;
}

/** Satu panggilan ke model. Dipisah sebagai fungsi supaya pengujian bisa menggantinya dengan model tiruan. */
export type LlmCall = (request: LlmRequest) => Promise<LlmResponse>;

export interface LlmSettings {
  provider: "anthropic" | "openai";
  /** Kosong berarti alamat resmi penyedia. */
  baseUrl: string | null;
  apiKey: string | null;
  model: string | null;
  effort: "low" | "medium" | "high" | "xhigh" | "max" | null;
  maxTokens: number | null;
  /** True bila memakai API Claude resmi, yang menerima fitur khusus seperti effort dan model cadangan. */
  official: boolean;
  /** Penjelasan bila pengaturan belum cukup untuk memanggil model. */
  problem: string | null;
}

/** Menambahkan keterangan asli dari server penyedia, bila ada, ke penjelasan kesalahan. */
export function withDetail(message: string, detail: string): string {
  const clean = detail.trim().replace(/[\s.]+$/, "");
  return clean ? `${message} Keterangan dari server: ${clean}.` : message;
}

/** Masalah pengaturan (kunci ditolak, model tidak dikenal, pengaturan kurang). Mengulang tidak akan menolong. */
export class LlmNotConfiguredError extends Error {}

/** Server model tidak bisa dihubungi: alamatnya salah, servernya mati, atau jaringan putus. */
export class LlmUnreachableError extends Error {}

/** Penyedia menolak atau gagal memproses permintaan. Pesannya sudah memuat penjelasan dari penyedia. */
export class LlmRequestError extends Error {}
