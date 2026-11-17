import { serve } from "@hono/node-server";
import { channels } from "./channels/manager.js";
import { closeDatabase, prepareDatabase } from "./db/index.js";
import { describeLlm, isLlmConfigured, llmSettings, settingsHint } from "./engine/llm.js";
import { env, envFileWarnings } from "./env.js";
import { app } from "./http/app.js";
import { warmUpEmbedder } from "./knowledge/embedder.js";
import { resumePendingIngestions } from "./knowledge/ingest.js";
import { createLogger } from "./lib/logger.js";

const log = createLogger("server");

try {
  await prepareDatabase();
} catch (error) {
  log.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

await resumePendingIngestions();
warmUpEmbedder();
void channels.startSaved();

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  log.info(`Server siap di http://localhost:${info.port}`);
  for (const warning of envFileWarnings) log.warn(warning);
  if (isLlmConfigured()) log.info(`Model AI: ${describeLlm()}`);
  else log.warn(`${llmSettings.problem} Isi di file .env. Dashboard bisa dipakai, tetapi bot belum bisa menjawab.`);
  const hint = settingsHint();
  if (hint) log.warn(hint);
});

server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") log.error(`Port ${env.PORT} sedang dipakai program lain. Ganti PORT di .env atau tutup program itu.`);
  else log.error("Server gagal menyala", error);
  process.exit(1);
});

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  log.info("Menutup server...");
  server.close();
  await channels.stopAll();
  await closeDatabase().catch(() => {});
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
