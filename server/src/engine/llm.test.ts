import { describe, expect, it } from "vitest";
import { describeLlm, resolveLlmSettings } from "./llm.js";

const empty = {
  LLM_PROVIDER: "anthropic" as const,
  LLM_BASE_URL: undefined,
  LLM_API_KEY: undefined,
  LLM_MODEL: undefined,
  LLM_EFFORT: undefined,
  LLM_MAX_TOKENS: undefined,
  ANTHROPIC_API_KEY: undefined,
  ANTHROPIC_MODEL: undefined,
  ANTHROPIC_EFFORT: undefined,
};

describe("resolveLlmSettings", () => {
  it("memakai API Claude resmi dengan model dan effort bawaan", () => {
    const settings = resolveLlmSettings({ ...empty, LLM_API_KEY: "sk-ant-uji" });

    expect(settings).toMatchObject({ provider: "anthropic", baseUrl: null, model: "claude-opus-5-5", effort: "low", official: true, problem: null });
  });

  it("masih membaca nama pengaturan lama dari .env versi sebelumnya", () => {
    const settings = resolveLlmSettings({ ...empty, ANTHROPIC_API_KEY: "sk-ant-lama", ANTHROPIC_MODEL: "claude-sonnet-5-5", ANTHROPIC_EFFORT: "medium" });

    expect(settings).toMatchObject({ apiKey: "sk-ant-lama", model: "claude-sonnet-5-5", effort: "medium", problem: null });
  });

  it("meminta kunci untuk alamat resmi", () => {
    expect(resolveLlmSettings(empty).problem).toContain("LLM_API_KEY");
    expect(resolveLlmSettings({ ...empty, ANTHROPIC_AUTH_TOKEN: "token" }).problem).toBeNull();
  });

  it("menyiapkan 9router berformat OpenAI tanpa kunci dan tanpa effort", () => {
    const settings = resolveLlmSettings({ ...empty, LLM_PROVIDER: "openai", LLM_BASE_URL: "http://localhost:20128/v1/", LLM_MODEL: "cc/claude-sonnet-5-5", ANTHROPIC_EFFORT: "low" });

    expect(settings).toMatchObject({ baseUrl: "http://localhost:20128/v1", apiKey: null, official: false, effort: null, problem: null });
    expect(describeLlm(settings)).toBe("cc/claude-sonnet-5-5 lewat http://localhost:20128/v1 (format OpenAI)");
  });

  it("mewajibkan nama model untuk format OpenAI dan tidak memakai nama model Claude dari .env lama", () => {
    const settings = resolveLlmSettings({ ...empty, LLM_PROVIDER: "openai", LLM_API_KEY: "sk-uji", ANTHROPIC_MODEL: "claude-opus-5-5" });

    expect(settings.model).toBeNull();
    expect(settings.problem).toContain("LLM_MODEL");
  });

  it("merapikan alamat yang ditulis lengkap sampai ke endpoint", () => {
    expect(resolveLlmSettings({ ...empty, LLM_PROVIDER: "openai", LLM_MODEL: "m", LLM_BASE_URL: "https://openrouter.ai/api/v1/chat/completions" }).baseUrl).toBe("https://openrouter.ai/api/v1");
    // SDK Anthropic menambahkan /v1/messages sendiri.
    expect(resolveLlmSettings({ ...empty, LLM_BASE_URL: "http://localhost:20128/v1" }).baseUrl).toBe("http://localhost:20128");
  });

  it("menganggap server lain berformat Anthropic sebagai bukan API resmi", () => {
    const proxy = resolveLlmSettings({ ...empty, LLM_BASE_URL: "http://localhost:20128", ANTHROPIC_EFFORT: "low" });
    expect(proxy).toMatchObject({ official: false, effort: null, problem: null });

    const official = resolveLlmSettings({ ...empty, LLM_API_KEY: "k", LLM_BASE_URL: "https://api.anthropic.com" });
    expect(official.official).toBe(true);
  });
});
