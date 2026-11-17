// Memeriksa sambungan ke model AI: pengaturan mana yang terbaca dari .env, lalu satu pesan uji singkat.
// Kunci API tidak pernah ditampilkan.
//   npm run check:llm
import { envFileWarnings } from "../env.js";
import { callModel, describeLlm, llmSettings, settingsHint } from "../engine/llm.js";
import { TOOLS } from "../engine/prompt.js";

const settings = llmSettings;
const show = (label: string, value: string) => console.log(`  ${label.padEnd(16)}${value}`);

console.log("Pengaturan model AI yang terbaca:");
show("LLM_PROVIDER", settings.provider);
show("LLM_BASE_URL", settings.baseUrl ?? "(kosong, memakai alamat resmi)");
show("LLM_MODEL", settings.model ?? "(kosong)");
show("Kunci API", settings.apiKey ? `terisi (${settings.apiKey.length} karakter)` : "kosong");
show("Tujuan", describeLlm(settings));

for (const warning of envFileWarnings) console.log(`\nPerhatian: ${warning}`);
const hint = settingsHint(settings);
if (hint) console.log(`\nPerhatian: ${hint}`);

// Proses dibiarkan selesai sendiri lewat exitCode. process.exit() saat sambungan jaringan masih ditutup
// memicu "Assertion failed" di Node untuk Windows.
if (settings.problem) {
  console.log(`\nBelum bisa diuji: ${settings.problem}`);
  process.exitCode = 1;
} else {
  await sendTestMessage();
}

async function sendTestMessage(): Promise<void> {
  console.log("\nMengirim pesan uji...");
  const started = Date.now();
  try {
    const response = await callModel({
      system: "Kamu sedang diuji. Jawab sesingkat mungkin.",
      messages: [{ role: "user", content: 'Balas dengan satu kata saja: "siap".' }],
      // Alat ikut dikirim supaya ketahuan bila model atau penyedia tidak mendukung pemanggilan alat.
      tools: TOOLS,
    });
    const text = response.content
      .map((block) => (block.type === "text" ? block.text : block.type === "tool_use" ? `[memanggil alat ${block.name}]` : ""))
      .join("")
      .trim();
    console.log(`Berhasil dalam ${((Date.now() - started) / 1000).toFixed(1)} detik. Jawaban model: ${text || "(kosong)"}`);
  } catch (error) {
    console.log(`Gagal: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
