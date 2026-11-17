import { describe, expect, it, vi } from "vitest";
import { errorMessage, readReply, readSse, ReplyError } from "./reply-stream";

/** Membuat jawaban server yang mengirim potongan teks satu per satu, seperti jaringan sungguhan. */
function streamed(chunks: string[], init: ResponseInit = {}): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, { headers: { "content-type": "text/event-stream" }, ...init });
}

const done = { customerMessageId: 7, message: { id: 8, role: "bot", content: "Rp 12.000.", createdAt: "2026-11-15T03:30:00.000Z" }, withStaff: false };

async function collect(response: Response) {
  const events = [];
  for await (const event of readSse(response)) events.push(event);
  return events;
}

describe("readSse", () => {
  it("menyusun kejadian walau terpotong di tengah jalan", async () => {
    const events = await collect(streamed(["event: del", 'ta\ndata: {"text":"Ha', 'lo"}\n', "\n", 'event: done\r\ndata: {}\r\n\r\n']));

    expect(events).toEqual([
      { event: "delta", data: '{"text":"Halo"}' },
      { event: "done", data: "{}" },
    ]);
  });

  it("melewati komentar penjaga sambungan dan menggabungkan data beberapa baris", async () => {
    const events = await collect(streamed([": tetap tersambung\n\n", "data: baris 1\ndata: baris 2\n\n"]));

    expect(events).toEqual([{ event: "message", data: "baris 1\nbaris 2" }]);
  });

  it("menangani huruf multibita yang terbelah di antara potongan", async () => {
    const bytes = new TextEncoder().encode('data: {"text":"Terima kasih 🙏"}\n\n');
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, bytes.length - 6));
        controller.enqueue(bytes.slice(bytes.length - 6));
        controller.close();
      },
    });

    const events = await collect(new Response(body));
    expect(JSON.parse(events[0]!.data)).toEqual({ text: "Terima kasih 🙏" });
  });
});

describe("readReply", () => {
  it("meneruskan teks sementara dan tanda pencarian, lalu mengembalikan hasil akhir", async () => {
    const onDelta = vi.fn();
    const onSearching = vi.fn();
    const response = streamed([
      'event: delta\ndata: {"text":"Rp "}\n\n',
      "event: searching\ndata: {}\n\n",
      "event: delta\ndata: bukan json\n\n",
      'event: delta\ndata: {"text":"12.000."}\n\n',
      `event: done\ndata: ${JSON.stringify(done)}\n\n`,
    ]);

    await expect(readReply(response, { onDelta, onSearching })).resolves.toEqual(done);
    expect(onDelta.mock.calls).toEqual([["Rp "], ["12.000."]]);
    expect(onSearching).toHaveBeenCalledOnce();
  });

  it("memakai pesan kesalahan dari server", async () => {
    const response = streamed(['event: error\ndata: {"error":"Terlalu banyak pesan. Tunggu sebentar."}\n\n']);

    await expect(readReply(response)).rejects.toThrow(new ReplyError("Terlalu banyak pesan. Tunggu sebentar."));
  });

  it("menolak jawaban yang bukan 200 dengan pesan dari badan JSON-nya", async () => {
    const response = new Response(JSON.stringify({ error: "Pesan terlalu panjang." }), { status: 400 });

    await expect(readReply(response)).rejects.toThrow("Pesan terlalu panjang.");
  });

  it("memberi tahu bila sambungan putus sebelum jawaban selesai", async () => {
    const error = await readReply(streamed(['event: delta\ndata: {"text":"Rp"}\n\n'])).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(ReplyError);
    expect((error as Error).message).toContain("Sambungan terputus");
  });
});

describe("errorMessage", () => {
  it("memakai cadangan bila jawaban bukan JSON", async () => {
    await expect(errorMessage(new Response("<html>502</html>", { status: 502 }), "Server tidak bisa dihubungi.")).resolves.toBe("Server tidak bisa dihubungi.");
  });
});
