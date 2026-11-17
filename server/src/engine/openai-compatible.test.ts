import { describe, expect, it, vi } from "vitest";
import { LlmNotConfiguredError, LlmRequestError, LlmUnreachableError, type LlmRequest, type LlmSettings } from "./llm-types.js";
import { callOpenAiCompatible, readChatResponse, toChatMessages, toChatTools } from "./openai-compatible.js";
import { TOOLS } from "./prompt.js";

const settings: LlmSettings = {
  provider: "openai",
  baseUrl: "http://localhost:20128/v1",
  apiKey: "kunci-uji",
  model: "cc/claude-sonnet-5-5",
  effort: null,
  maxTokens: null,
  official: false,
  problem: null,
};

const request: LlmRequest = { system: "Kamu asisten toko.", messages: [{ role: "user", content: "Ongkir?" }], tools: TOOLS };

function sse(events: unknown[], init: ResponseInit = {}): Response {
  const encoder = new TextEncoder();
  const text = [...events.map((event) => `data: ${JSON.stringify(event)}\n\n`), "data: [DONE]\n\n"].join("");
  // Dipotong di tengah baris supaya pembaca diuji untuk potongan yang tidak rapi.
  const pieces = [text.slice(0, 37), text.slice(37, 90), text.slice(90)];
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const piece of pieces) controller.enqueue(encoder.encode(piece));
      controller.close();
    },
  });
  return new Response(body, { headers: { "content-type": "text/event-stream" }, ...init });
}

const delta = (value: object, finish: string | null = null) => ({ choices: [{ index: 0, delta: value, finish_reason: finish }] });

describe("toChatMessages", () => {
  it("menerjemahkan teks, panggilan alat, dan hasil alat ke urutan Chat Completions", () => {
    const messages = toChatMessages("Sistem", [
      { role: "user", content: "Ongkir ke Bandung?" },
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "", signature: "x" },
          { type: "text", text: "Sebentar." },
          { type: "tool_use", id: "alat-1", name: "cari_pengetahuan", input: { kueri: "ongkir bandung" } },
        ],
      },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "alat-1", content: "[1] Jawa Rp 12.000" },
          { type: "tool_result", tool_use_id: "alat-2", is_error: true, content: [{ type: "text", text: "Kueri kosong." }] },
        ],
      },
    ]);

    expect(messages).toEqual([
      { role: "system", content: "Sistem" },
      { role: "user", content: "Ongkir ke Bandung?" },
      {
        role: "assistant",
        content: "Sebentar.",
        tool_calls: [{ id: "alat-1", type: "function", function: { name: "cari_pengetahuan", arguments: '{"kueri":"ongkir bandung"}' } }],
      },
      { role: "tool", tool_call_id: "alat-1", content: "[1] Jawa Rp 12.000" },
      { role: "tool", tool_call_id: "alat-2", content: "Error: Kueri kosong." },
    ]);
  });

  it("mengirim isi kosong sebagai null bila asisten hanya memanggil alat", () => {
    const [, assistant] = toChatMessages("S", [{ role: "assistant", content: [{ type: "tool_use", id: "a", name: "teruskan_ke_staf", input: { alasan: "refund" } }] }]);
    expect(assistant).toMatchObject({ role: "assistant", content: null });
  });
});

describe("toChatTools", () => {
  it("memakai skema masukan alat sebagai parameter fungsi", () => {
    const tools = toChatTools(TOOLS);
    expect(tools.map((tool) => tool.function.name)).toEqual(TOOLS.map((tool) => tool.name));
    expect(tools[0]).toMatchObject({ type: "function", function: { parameters: TOOLS[0]?.input_schema } });
  });
});

describe("readChatResponse", () => {
  it("mengalirkan teks dan mengakhiri dengan end_turn", async () => {
    const onText = vi.fn();
    const result = await readChatResponse(sse([delta({ role: "assistant", content: "" }), delta({ content: "Ongkir " }), delta({ content: "Rp 12.000." }, "stop")]), onText);

    expect(onText.mock.calls).toEqual([["Ongkir "], ["Rp 12.000."]]);
    expect(result).toMatchObject({ stop_reason: "end_turn", content: [{ type: "text", text: "Ongkir Rp 12.000." }] });
  });

  it("menyusun panggilan alat yang datang sepotong-sepotong", async () => {
    const result = await readChatResponse(
      sse([
        delta({ tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "cari_pengetahuan", arguments: "" } }] }),
        delta({ tool_calls: [{ index: 0, function: { arguments: '{"kue' } }] }),
        delta({ tool_calls: [{ index: 0, function: { arguments: 'ri":"garansi"}' } }] }),
        delta({ tool_calls: [{ index: 1, id: "call_2", function: { name: "teruskan_ke_staf", arguments: '{"alasan":"refund"}' } }] }),
        delta({}, "tool_calls"),
      ]),
    );

    expect(result.stop_reason).toBe("tool_use");
    expect(result.content).toEqual([
      { type: "tool_use", id: "call_1", name: "cari_pengetahuan", input: { kueri: "garansi" } },
      { type: "tool_use", id: "call_2", name: "teruskan_ke_staf", input: { alasan: "refund" } },
    ]);
  });

  it("menganggap jawaban berisi panggilan alat sebagai tool_use walau penyedia menulis stop", async () => {
    const result = await readChatResponse(sse([delta({ tool_calls: [{ function: { name: "cari_pengetahuan", arguments: '{"kueri":"x"}' } }] }, "stop")]));

    expect(result.stop_reason).toBe("tool_use");
    expect(result.content[0]).toMatchObject({ type: "tool_use", id: "panggilan_1", input: { kueri: "x" } });
  });

  it("memetakan jawaban terpotong dan filter konten", async () => {
    expect((await readChatResponse(sse([delta({ content: "Sebagian" }, "length")]))).stop_reason).toBe("max_tokens");
    expect((await readChatResponse(sse([delta({}, "content_filter")]))).stop_reason).toBe("refusal");
  });

  it("membiarkan argumen alat yang rusak tetap kosong supaya diperiksa inti bot", async () => {
    const result = await readChatResponse(sse([delta({ tool_calls: [{ index: 0, id: "c", function: { name: "cari_pengetahuan", arguments: '{"kueri":' } }] }, "tool_calls")]));
    expect(result.content[0]).toMatchObject({ type: "tool_use", input: {} });
  });

  it("menerima jawaban utuh bila server tidak mengalirkan", async () => {
    const response = new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "Halo Kak!" }, finish_reason: "stop" }] }), {
      headers: { "content-type": "application/json" },
    });

    expect(await readChatResponse(response)).toMatchObject({ stop_reason: "end_turn", content: [{ type: "text", text: "Halo Kak!" }] });
  });

  it("melaporkan kesalahan yang dikirim di tengah aliran", async () => {
    await expect(readChatResponse(sse([{ error: { message: "quota habis" } }]))).rejects.toThrow(LlmRequestError);
  });
});

describe("callOpenAiCompatible", () => {
  it("mengirim permintaan ke /chat/completions dengan kunci, model, dan alat", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(sse([delta({ content: "Halo" }, "stop")]));

    await callOpenAiCompatible(settings, request, fetcher);

    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe("http://localhost:20128/v1/chat/completions");
    expect((init?.headers as Record<string, string>).authorization).toBe("Bearer kunci-uji");
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({ model: "cc/claude-sonnet-5-5", stream: true, messages: [{ role: "system" }, { role: "user", content: "Ongkir?" }] });
    expect(body.tools).toHaveLength(TOOLS.length);
    // Tanpa pengaturan, batas token dan effort mengikuti bawaan penyedia.
    expect(body).not.toHaveProperty("max_tokens");
    expect(body).not.toHaveProperty("reasoning_effort");
  });

  it("tidak mengirim kunci bila tidak diisi, dan memakai alamat OpenAI bila alamat kosong", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(sse([delta({ content: "Halo" }, "stop")]));

    await callOpenAiCompatible({ ...settings, apiKey: null, baseUrl: null, maxTokens: 2000, effort: "low" }, request, fetcher);

    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(init?.headers).not.toHaveProperty("authorization");
    expect(JSON.parse(String(init?.body))).toMatchObject({ max_tokens: 2000, reasoning_effort: "low" });
  });

  it("menjelaskan kunci yang ditolak dan model yang tidak dikenal", async () => {
    const rejected = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ error: { message: "Invalid API key" } }), { status: 401 }));
    const error = await callOpenAiCompatible(settings, request, rejected).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(LlmNotConfiguredError);
    expect((error as Error).message).toContain("Invalid API key");

    const missing = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ error: "model not found" }), { status: 404 }));
    await expect(callOpenAiCompatible(settings, request, missing)).rejects.toThrow('Model "cc/claude-sonnet-5-5"');

    const noKey = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ error: { message: "Missing API key" } }), { status: 401 }));
    await expect(callOpenAiCompatible({ ...settings, apiKey: null }, request, noKey)).rejects.toThrow("LLM_API_KEY masih kosong");
  });

  it("mencoba lagi saat penyedia sibuk, lalu berhasil", async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(new Response("{}", { status: 429 }))
        .mockResolvedValueOnce(sse([delta({ content: "Halo" }, "stop")]));

      const pending = callOpenAiCompatible(settings, request, fetcher);
      await vi.runAllTimersAsync();

      expect((await pending).content).toMatchObject([{ type: "text", text: "Halo" }]);
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("menyerah dengan pesan jelas bila server tidak bisa dihubungi", async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("fetch failed"));

      const pending = callOpenAiCompatible(settings, request, fetcher).catch((reason: unknown) => reason);
      await vi.runAllTimersAsync();

      const error = await pending;
      expect(error).toBeInstanceOf(LlmUnreachableError);
      expect((error as Error).message).toContain("http://localhost:20128/v1");
      expect(fetcher).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("tidak mengulang permintaan yang memang salah", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ error: { message: "tools not supported" } }), { status: 400 }));

    await expect(callOpenAiCompatible(settings, request, fetcher)).rejects.toThrow("tools not supported");
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
