/**
 * Penerjemah ke API berformat OpenAI (Chat Completions): OpenAI, OpenRouter, Groq, DeepSeek,
 * Gemini, Ollama, 9router, dan server lain yang meniru formatnya.
 *
 * Inti bot bekerja dengan bentuk Messages API (blok teks, tool_use, tool_result). Di sini bentuk itu
 * diubah ke pesan Chat Completions, lalu jawaban yang dialirkan diubah kembali.
 */
import type Anthropic from "@anthropic-ai/sdk";
import {
  LlmNotConfiguredError,
  LlmRequestError,
  LlmUnreachableError,
  type LlmContentBlock,
  type LlmMessageParam,
  type LlmRequest,
  type LlmResponse,
  type LlmSettings,
  withDetail,
} from "./llm-types.js";

interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export interface ChatTool {
  type: "function";
  function: { name: string; description?: string; parameters: unknown };
}

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const REQUEST_TIMEOUT_MS = 180_000;
const RETRY_DELAYS_MS = [1000, 3000];

function toolResultText(content: Anthropic.Beta.BetaToolResultBlockParam["content"]): string {
  if (typeof content === "string") return content;
  return (content ?? []).map((block) => (block.type === "text" ? block.text : "")).join("\n");
}

/** Mengubah riwayat berbentuk Messages API menjadi pesan Chat Completions. */
export function toChatMessages(system: string, messages: LlmMessageParam[]): ChatMessage[] {
  const out: ChatMessage[] = [{ role: "system", content: system }];

  for (const message of messages) {
    const content = message.content ?? [];
    if (typeof content === "string") {
      out.push(message.role === "user" ? { role: "user", content } : { role: "assistant", content });
      continue;
    }

    const texts: string[] = [];
    if (message.role === "assistant") {
      const calls: ToolCall[] = [];
      for (const block of content) {
        if (block.type === "text") texts.push(block.text);
        else if (block.type === "tool_use") calls.push({ id: block.id, type: "function", function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) } });
        // Blok berpikir khusus Claude tidak punya padanan di format OpenAI, jadi dilewati.
      }
      out.push({ role: "assistant", content: texts.join("") || null, ...(calls.length ? { tool_calls: calls } : {}) });
      continue;
    }

    // Hasil alat harus langsung menyusul pesan asisten yang memanggilnya, baru teks pengguna sesudahnya.
    for (const block of content) {
      if (block.type === "tool_result") {
        const text = toolResultText(block.content);
        out.push({ role: "tool", tool_call_id: block.tool_use_id, content: block.is_error ? `Error: ${text}` : text });
      } else if (block.type === "text") texts.push(block.text);
    }
    if (texts.length) out.push({ role: "user", content: texts.join("\n\n") });
  }

  return out;
}

export function toChatTools(tools: Anthropic.Beta.BetaTool[]): ChatTool[] {
  return tools.map((tool) => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.input_schema } }));
}

interface ChoiceDelta {
  content?: string | null;
  tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[];
}

interface Choice {
  delta?: ChoiceDelta;
  message?: ChoiceDelta;
  finish_reason?: string | null;
}

interface Chunk {
  choices?: Choice[];
  usage?: unknown;
  error?: { message?: string };
}

/** Mengumpulkan potongan jawaban (teks dan panggilan alat yang datang sepotong-sepotong) menjadi satu jawaban utuh. */
class ReplyCollector {
  private text = "";
  private readonly calls: { id: string; name: string; arguments: string }[] = [];
  private finish: string | null = null;
  usage: unknown;

  constructor(private readonly onText?: (delta: string) => void) {}

  add(chunk: Chunk): void {
    if (chunk.error?.message) throw new LlmRequestError(`Penyedia model mengirim kesalahan: ${chunk.error.message}`);
    if (chunk.usage) this.usage = chunk.usage;
    const choice = chunk.choices?.[0];
    if (!choice) return;

    const delta = choice.delta ?? choice.message ?? {};
    if (typeof delta.content === "string" && delta.content) {
      this.text += delta.content;
      this.onText?.(delta.content);
    }
    for (const part of delta.tool_calls ?? []) {
      // Sebagian penyedia tidak menyertakan index. Potongan dengan id baru dianggap panggilan baru.
      let call = part.index !== undefined ? this.calls[part.index] : part.id ? this.calls.find((item) => item.id === part.id) : this.calls.at(-1);
      if (!call) {
        call = { id: part.id ?? "", name: "", arguments: "" };
        if (part.index !== undefined) this.calls[part.index] = call;
        else this.calls.push(call);
      }
      if (part.id) call.id = part.id;
      if (part.function?.name) call.name += part.function.name;
      if (part.function?.arguments) call.arguments += part.function.arguments;
    }
    if (choice.finish_reason) this.finish = choice.finish_reason;
  }

  result(): LlmResponse {
    const content: LlmContentBlock[] = [];
    if (this.text) content.push({ type: "text", text: this.text, citations: null } as LlmContentBlock);

    const calls = this.calls.filter((call) => call?.name);
    calls.forEach((call, index) => {
      let input: unknown = {};
      try {
        input = call.arguments.trim() ? JSON.parse(call.arguments) : {};
      } catch {
        // Argumen rusak dibiarkan kosong. Inti bot akan memeriksanya dan memberi tahu model.
      }
      content.push({ type: "tool_use", id: call.id || `panggilan_${index + 1}`, name: call.name, input } as LlmContentBlock);
    });

    return { content, stop_reason: stopReason(this.finish, calls.length > 0), usage: this.usage };
  }
}

function stopReason(finish: string | null, hasToolCalls: boolean): LlmResponse["stop_reason"] {
  if (finish === "length") return "max_tokens";
  if (finish === "content_filter") return "refusal";
  // Beberapa penyedia menulis "stop" walau jawabannya berisi panggilan alat.
  if (hasToolCalls) return "tool_use";
  return "end_turn";
}

/** Membaca jawaban Chat Completions, baik yang dialirkan (SSE) maupun yang dikirim sekaligus (JSON). */
export async function readChatResponse(response: Response, onText?: (delta: string) => void): Promise<LlmResponse> {
  const collector = new ReplyCollector(onText);

  if (!response.headers.get("content-type")?.includes("text/event-stream")) {
    // Sebagian server mengabaikan permintaan aliran dan langsung mengirim jawaban utuh.
    collector.add((await response.json()) as Chunk);
    return collector.result();
  }

  if (!response.body) return collector.result();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = done ? "" : (lines.pop() ?? "");
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        let chunk: Chunk;
        try {
          chunk = JSON.parse(data) as Chunk;
        } catch {
          continue;
        }
        collector.add(chunk);
      }
      if (done) break;
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  return collector.result();
}

async function errorDetail(response: Response): Promise<string> {
  const raw = await response.text().catch(() => "");
  try {
    const body = JSON.parse(raw) as { error?: { message?: unknown } | string; message?: unknown };
    const message = typeof body.error === "string" ? body.error : (body.error?.message ?? body.message);
    if (typeof message === "string") return message.slice(0, 300);
  } catch {
    // Bukan JSON, misalnya halaman galat dari proxy.
  }
  return raw.replace(/\s+/g, " ").trim().slice(0, 200);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function callOpenAiCompatible(settings: LlmSettings, request: LlmRequest, fetcher: typeof fetch = fetch): Promise<LlmResponse> {
  const baseUrl = settings.baseUrl ?? DEFAULT_BASE_URL;
  const body = JSON.stringify({
    model: settings.model,
    messages: toChatMessages(request.system, request.messages),
    tools: toChatTools(request.tools),
    stream: true,
    // Bila tidak diatur, batas panjang jawaban mengikuti bawaan tiap penyedia, karena batas maksimalnya berbeda-beda.
    ...(settings.maxTokens ? { max_tokens: settings.maxTokens } : {}),
    ...(settings.effort ? { reasoning_effort: settings.effort } : {}),
  });
  const headers: Record<string, string> = { "content-type": "application/json", accept: "text/event-stream, application/json" };
  if (settings.apiKey) headers.authorization = `Bearer ${settings.apiKey}`;

  for (let attempt = 0; ; attempt++) {
    const retry = attempt < RETRY_DELAYS_MS.length ? RETRY_DELAYS_MS[attempt] : undefined;
    let response: Response;
    try {
      response = await fetcher(`${baseUrl}/chat/completions`, { method: "POST", headers, body, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (error) {
      if (retry !== undefined) {
        await sleep(retry);
        continue;
      }
      if (error instanceof Error && error.name === "TimeoutError") throw new LlmUnreachableError(`${baseUrl} tidak menjawab dalam ${REQUEST_TIMEOUT_MS / 1000} detik.`);
      throw new LlmUnreachableError(`Tidak bisa menghubungi ${baseUrl}. Pastikan alamatnya benar dan servernya menyala.`);
    }

    if (response.ok) return readChatResponse(response, request.onText);

    const detail = await errorDetail(response);
    const status = response.status;
    if (status === 401 || status === 403) {
      const message = settings.apiKey ? `Kunci API ditolak oleh ${baseUrl} (${status}).` : `${baseUrl} meminta kunci API, tetapi LLM_API_KEY masih kosong.`;
      throw new LlmNotConfiguredError(withDetail(message, detail));
    }
    if (status === 404) throw new LlmNotConfiguredError(withDetail(`Model "${settings.model}" atau alamatnya tidak ditemukan di ${baseUrl}.`, detail));
    // Batas pemakaian dan gangguan sesaat di sisi penyedia layak dicoba lagi. Kesalahan lain tidak.
    if ((status === 429 || status >= 500) && retry !== undefined) {
      await sleep(retry);
      continue;
    }
    throw new LlmRequestError(withDetail(`${baseUrl} menolak permintaan (${status}).`, detail));
  }
}
