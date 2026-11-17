import { describe, expect, it } from "vitest";
import { parseEnvFile } from "./env.js";

describe("parseEnvFile", () => {
  it("membaca nilai biasa, bertanda kutip, dan komentar", () => {
    const { values, warnings } = parseEnvFile('# komentar\nPORT=3000\r\nLLM_BASE_URL="http://localhost:20128/v1"\nLLM_MODEL=cc/claude-sonnet-5-5 # model\nKOSONG=\n');

    expect(values).toEqual({ PORT: "3000", LLM_BASE_URL: "http://localhost:20128/v1", LLM_MODEL: "cc/claude-sonnet-5-5", KOSONG: "" });
    expect(warnings).toEqual([]);
  });

  it("tidak membiarkan baris kosong yang ditambahkan belakangan menghapus isian sebelumnya", () => {
    // Pola yang terjadi bila pengaturan diisi di atas, lalu `npm run setup` menambahkan blok kosong di akhir.
    const { values, warnings } = parseEnvFile(
      ["LLM_PROVIDER=openai", "LLM_BASE_URL=http://localhost:20128/v1", "", "# --- Ditambahkan oleh npm run setup", "LLM_PROVIDER=anthropic", "LLM_BASE_URL="].join("\n"),
    );

    expect(values.LLM_BASE_URL).toBe("http://localhost:20128/v1");
    // Dua isian yang sama-sama terisi: yang terakhir berlaku, seperti aturan .env pada umumnya.
    expect(values.LLM_PROVIDER).toBe("anthropic");
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain("LLM_PROVIDER ditulis 2 kali di .env (baris 1, 5). Yang dipakai: baris 5.");
    expect(warnings[1]).toContain("Yang dipakai: baris 2.");
  });
});
