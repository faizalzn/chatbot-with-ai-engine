import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { handleCustomerMessages, type IncomingMessages } from "../engine/engine.js";
import { createLogger } from "../lib/logger.js";
import { serializeMessage } from "./helpers.js";

const log = createLogger("web");

/**
 * Memproses pesan pelanggan dari web dan mengalirkan jawaban bot sambil ditulis (Server-Sent Events).
 *
 * Urutan kejadian: nol atau lebih "delta" (potongan teks) dan "searching", lalu satu "done" berisi
 * pesan final yang tersimpan, atau satu "error". Klien sebaiknya mengganti teks sementaranya
 * dengan isi "done", karena teks final bisa berbeda dari potongan yang sudah dialirkan.
 */
export function streamBotReply(c: Context, input: IncomingMessages, options: { includeSources: boolean }) {
  c.header("X-Accel-Buffering", "no"); // minta reverse proxy tidak menahan aliran
  return streamSSE(c, async (stream) => {
    // Potongan teks datang lewat callback sinkron, jadi penulisan dirangkai supaya urutannya terjaga.
    let writes: Promise<unknown> = Promise.resolve();
    const send = (event: string, data: unknown) => {
      writes = writes.then(() => stream.writeSSE({ event, data: JSON.stringify(data) })).catch(() => {});
    };

    try {
      const outcome = await handleCustomerMessages(input, {
        onText: (text) => send("delta", { text }),
        onSearching: () => send("searching", {}),
      });
      send("done", {
        customerMessageId: outcome.customerMessages.at(-1)?.id ?? null,
        message: outcome.reply ? serializeMessage(outcome.reply, options.includeSources) : null,
        withStaff: outcome.withStaff,
      });
    } catch (error) {
      log.error("Gagal memproses pesan dari web", error);
      send("error", { error: "Maaf, pesan belum bisa diproses. Coba kirim lagi." });
    }
    await writes;
  });
}
