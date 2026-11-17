/**
 * Pembaca jawaban bot yang dialirkan server (Server-Sent Events).
 * Dipakai widget web dan halaman "Coba bot" di dashboard, supaya keduanya membaca aliran dengan cara yang sama.
 */

export interface ChatSource {
  documentId: string;
  title: string;
}

export interface ChatMessage {
  id: number;
  role: "customer" | "bot" | "agent" | "event";
  content: string;
  createdAt: string;
  /** Dokumen yang dibaca bot. Hanya dikirim ke dashboard. */
  sources?: ChatSource[];
}

export interface ReplyResult {
  customerMessageId: number | null;
  /** Kosong bila percakapan sedang ditangani staf, sehingga bot tidak menjawab. */
  message: ChatMessage | null;
  withStaff: boolean;
}

export interface ReplyHandlers {
  onDelta?(text: string): void;
  onSearching?(): void;
}

/** Kegagalan yang pesannya layak ditampilkan apa adanya ke pengguna. */
export class ReplyError extends Error {}

export interface SseEvent {
  event: string;
  data: string;
}

function parseEvent(raw: string): SseEvent | null {
  let event = "message";
  const data: string[] = [];
  for (const line of raw.split("\n")) {
    if (!line || line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
  }
  return data.length ? { event, data: data.join("\n") } : null;
}

/** Memecah aliran teks menjadi kejadian SSE. Kejadian dipisahkan satu baris kosong. */
export async function* readSse(response: Response): AsyncGenerator<SseEvent> {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffer += (done ? decoder.decode() : decoder.decode(value, { stream: true })).replace(/\r\n/g, "\n");

      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const event = parseEvent(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        if (event) yield event;
        boundary = buffer.indexOf("\n\n");
      }
      if (done) return;
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

/** Mengambil pesan kesalahan dari jawaban server, bila ada. */
export async function errorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (body && typeof body === "object" && "error" in body && typeof body.error === "string") return body.error;
  } catch {
    // Jawaban bukan JSON, misalnya halaman galat dari proxy.
  }
  return fallback;
}

const GENERIC_FAILURE = "Pesan belum bisa diproses. Coba kirim lagi.";

/**
 * Mengikuti jawaban bot sampai selesai.
 * Teks yang dialirkan lewat `onDelta` bersifat sementara: pakai `message.content` dari hasil akhir sebagai isi final.
 */
export async function readReply(response: Response, handlers: ReplyHandlers = {}): Promise<ReplyResult> {
  if (!response.ok) throw new ReplyError(await errorMessage(response, GENERIC_FAILURE));

  for await (const { event, data } of readSse(response)) {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(data) as Record<string, unknown>;
    } catch {
      continue;
    }

    if (event === "delta" && typeof payload.text === "string") handlers.onDelta?.(payload.text);
    else if (event === "searching") handlers.onSearching?.();
    else if (event === "done") return payload as unknown as ReplyResult;
    else if (event === "error") throw new ReplyError(typeof payload.error === "string" ? payload.error : GENERIC_FAILURE);
  }

  throw new ReplyError("Sambungan terputus sebelum jawaban selesai. Coba kirim lagi.");
}
