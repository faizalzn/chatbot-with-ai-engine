import Anthropic from "@anthropic-ai/sdk";
import { env } from "../env.js";
import {
  LlmNotConfiguredError,
  LlmRequestError,
  LlmUnreachableError,
  type LlmCall,
  type LlmRequest,
  type LlmResponse,
  type LlmSettings,
  withDetail,
} from "./llm-types.js";
import { callOpenAiCompatible } from "./openai-compatible.js";

export * from "./llm-types.js";

type SettingsSource = Pick<
  typeof env,
  "LLM_PROVIDER" | "LLM_BASE_URL" | "LLM_API_KEY" | "LLM_MODEL" | "LLM_EFFORT" | "LLM_MAX_TOKENS" | "ANTHROPIC_API_KEY" | "ANTHROPIC_MODEL" | "ANTHROPIC_EFFORT"
> & { ANTHROPIC_AUTH_TOKEN?: string | undefined };

export function resolveLlmSettings(source: SettingsSource): LlmSettings {
  const provider = source.LLM_PROVIDER;
  let baseUrl = source.LLM_BASE_URL?.trim().replace(/\/+$/, "") ?? null;
  if (baseUrl && provider === "openai") baseUrl = baseUrl.replace(/\/chat\/completions$/, "");
  // SDK Anthropic menambahkan /v1/messages sendiri, jadi akhiran /v1 yang ikut ditulis dibuang.
  if (baseUrl && provider === "anthropic") baseUrl = baseUrl.replace(/\/v1(\/messages)?$/, "");

  const apiKey = source.LLM_API_KEY ?? source.ANTHROPIC_API_KEY ?? null;
  // ANTHROPIC_MODEL dari .env lama hanya berlaku untuk format anthropic, karena nama model berbeda antar-penyedia.
  const model = source.LLM_MODEL ?? (provider === "anthropic" ? (source.ANTHROPIC_MODEL ?? "claude-opus-5-5") : null);
  const official = provider === "anthropic" && (!baseUrl || new URL(baseUrl).hostname === "api.anthropic.com");

  let problem: string | null = null;
  if (!model) problem = "LLM_MODEL belum diisi. Format OpenAI butuh nama model, misalnya gpt-5.5 atau nama model di 9router.";
  // Server lokal (9router, Ollama) sering tidak meminta kunci, jadi kunci hanya wajib untuk alamat resmi.
  else if (!apiKey && !baseUrl && !(provider === "anthropic" && source.ANTHROPIC_AUTH_TOKEN)) problem = "LLM_API_KEY belum diisi.";

  return {
    provider,
    baseUrl,
    apiKey,
    model,
    // Untuk server selain API Claude resmi, effort hanya dikirim bila LLM_EFFORT sengaja diisi.
    effort: source.LLM_EFFORT ?? (official ? (source.ANTHROPIC_EFFORT ?? "low") : null),
    maxTokens: source.LLM_MAX_TOKENS ?? null,
    official,
    problem,
  };
}

export const llmSettings = resolveLlmSettings({ ...env, ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN });

/**
 * Kesalahan pemasangan yang paling sering: kunci dari 9router atau penyedia lain dikirim ke API Claude resmi,
 * karena LLM_PROVIDER dan LLM_BASE_URL belum diisi. Kunci Anthropic selalu diawali "sk-ant-".
 */
export function settingsHint(settings: LlmSettings = llmSettings): string | null {
  if (!settings.official || !settings.apiKey || settings.apiKey.startsWith("sk-ant-")) return null;
  return (
    'Kunci API ini bukan kunci Anthropic (kunci Anthropic diawali "sk-ant-"), padahal tujuannya API Claude resmi. ' +
    "Bila memakai 9router atau penyedia lain, isi LLM_PROVIDER dan LLM_BASE_URL di .env, misalnya LLM_PROVIDER=openai dan LLM_BASE_URL=http://localhost:20128/v1."
  );
}

export function isLlmConfigured(): boolean {
  return llmSettings.problem === null;
}

/** Ringkasan pengaturan untuk log dan dashboard. Tidak memuat kunci API. */
export function describeLlm(settings: LlmSettings = llmSettings): string {
  const format = settings.provider === "openai" ? "format OpenAI" : "format Anthropic";
  const where = settings.baseUrl ?? (settings.provider === "openai" ? "api.openai.com" : "api.anthropic.com");
  return `${settings.model ?? "(model belum diisi)"} lewat ${where} (${format})`;
}

// ---------------------------------------------------------------------------------------------
// Format Anthropic: API Claude resmi, atau server lain yang meniru Messages API.

let anthropicClient: Anthropic | null = null;

function anthropic(settings: LlmSettings): Anthropic {
  if (anthropicClient) return anthropicClient;
  // Baris kosong "ANTHROPIC_API_KEY=" di .env tidak boleh menutupi sumber kredensial lain.
  if (!process.env.ANTHROPIC_API_KEY?.trim()) delete process.env.ANTHROPIC_API_KEY;
  if (settings.official) {
    // Kunci dari .env diutamakan. ANTHROPIC_AUTH_TOKEN di lingkungan hanya dipakai bila kunci kosong.
    anthropicClient = settings.apiKey ? new Anthropic({ baseURL: settings.baseUrl ?? undefined, apiKey: settings.apiKey, authToken: null }) : new Anthropic({ baseURL: settings.baseUrl ?? undefined });
    return anthropicClient;
  }
  // Server pengganti umumnya memeriksa "Authorization: Bearer", sebagian lagi "x-api-key", jadi keduanya dikirim.
  // Server lokal tanpa kunci tetap diberi isian, karena SDK menolak berjalan tanpa kredensial.
  const key = settings.apiKey ?? "tanpa-kunci";
  anthropicClient = new Anthropic({ baseURL: settings.baseUrl ?? undefined, authToken: key, defaultHeaders: { "x-api-key": key } });
  return anthropicClient;
}

/** Model yang menerima pengalihan otomatis ke model cadangan saat menolak karena salah tangkap filter keamanan. */
const SUPPORTS_FALLBACK = /^claude-(fable-5|mythos-5|opus-5|sonnet-5-5)/;
const SUPPORTS_EFFORT = /^claude-(fable|mythos|opus|sonnet-5|sonnet-4-6|haiku-5)/;

async function callAnthropic(settings: LlmSettings, request: LlmRequest): Promise<LlmResponse> {
  const model = settings.model ?? "";
  const base = {
    model,
    // Batas ini mencakup proses berpikir model dan jawabannya, jadi dibuat longgar.
    max_tokens: settings.maxTokens ?? 16000,
    system: request.system,
    messages: request.messages,
    tools: request.tools,
  };
  // Fitur khusus API Claude resmi tidak dikirim ke server lain, karena bisa ditolak di sana.
  const effort = settings.effort && (settings.official ? SUPPORTS_EFFORT.test(model) : true) ? { output_config: { effort: settings.effort } } : {};
  const fallback = settings.official && SUPPORTS_FALLBACK.test(model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {};

  const stream = anthropic(settings).beta.messages.stream({ ...base, ...effort, ...fallback });
  if (request.onText) stream.on("text", request.onText);

  const where = settings.baseUrl ?? "api.anthropic.com";
  try {
    return await stream.finalMessage();
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
      const base = settings.apiKey ? `Kunci API ditolak oleh ${where} (${error.status}).` : `${where} meminta kunci API, tetapi LLM_API_KEY masih kosong.`;
      const message = withDetail(base, providerMessage(error));
      const hint = settingsHint(settings);
      throw new LlmNotConfiguredError(hint ? `${message} ${hint}` : message);
    }
    if (error instanceof Anthropic.NotFoundError) {
      throw new LlmNotConfiguredError(withDetail(`Model "${model}" atau alamatnya tidak ditemukan di ${where}.`, providerMessage(error)));
    }
    if (error instanceof Anthropic.APIConnectionError) {
      throw new LlmUnreachableError(`Tidak bisa menghubungi ${where}. Pastikan alamatnya benar dan servernya menyala.`);
    }
    if (error instanceof Anthropic.APIError) {
      throw new LlmRequestError(withDetail(`${where} menolak permintaan (${error.status ?? "tanpa kode"}).`, providerMessage(error)));
    }
    throw error;
  }
}

function providerMessage(error: InstanceType<typeof Anthropic.APIError>): string {
  const body = error.error as { error?: { message?: unknown }; message?: unknown } | undefined;
  const message = body?.error?.message ?? body?.message;
  return typeof message === "string" ? message.slice(0, 300) : "";
}

// ---------------------------------------------------------------------------------------------

/** Memanggil model sesuai pengaturan LLM_* di .env. */
export const callModel: LlmCall = (request) => {
  const settings = llmSettings;
  if (settings.problem) return Promise.reject(new LlmNotConfiguredError(settings.problem));
  return settings.provider === "openai" ? callOpenAiCompatible(settings, request) : callAnthropic(settings, request);
};
