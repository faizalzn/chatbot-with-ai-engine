import { Bot, GrammyError } from "grammy";
import { UserFacingError } from "../lib/errors.js";
import { createLogger } from "../lib/logger.js";
import { ATTACHMENT_NOTE, type AdapterEvents, type ChannelAdapter } from "./types.js";

const log = createLogger("telegram");

/**
 * Bot Telegram lewat long polling: server yang menarik pesan dari Telegram,
 * jadi tidak perlu alamat publik atau HTTPS. Hanya chat pribadi yang dijawab.
 */
export function createTelegramAdapter(token: string, events: AdapterEvents): ChannelAdapter {
  const bot = new Bot(token);

  bot.on("message", (ctx) => {
    if (ctx.chat.type !== "private") return;
    const externalId = String(ctx.chat.id);
    const text = ctx.message.text?.trim();

    if (text === "/start" || text?.startsWith("/start ")) {
      events.onGreeting(externalId);
      return;
    }
    const customerName = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ");
    events.onText({ externalId, customerName, text: text || ctx.message.caption?.trim() || ATTACHMENT_NOTE });
  });

  bot.catch((error) => log.error("Gagal menangani pesan", error.error));

  return {
    async start() {
      try {
        await bot.init();
      } catch (error) {
        if (error instanceof GrammyError && (error.error_code === 401 || error.error_code === 404)) {
          throw new UserFacingError("Token ditolak Telegram. Salin ulang token dari @BotFather, lalu coba lagi.");
        }
        throw new UserFacingError("Tidak bisa menghubungi Telegram. Periksa koneksi internet server, lalu coba lagi.");
      }

      events.onStatus({ state: "connected", label: `@${bot.botInfo.username}`, link: `https://t.me/${bot.botInfo.username}` });
      // bot.start() baru selesai ketika bot dihentikan, jadi tidak ditunggu.
      void bot.start({ allowed_updates: ["message"] }).catch((error: unknown) => {
        const conflict = error instanceof GrammyError && error.error_code === 409;
        log.error("Sambungan terputus", error);
        events.onStatus({
          state: "error",
          message: conflict
            ? "Bot ini sedang dipakai di tempat lain. Satu bot Telegram hanya bisa tersambung ke satu sistem."
            : "Sambungan ke Telegram terputus. Sambungkan ulang untuk mencoba lagi.",
        });
      });
    },

    async stop() {
      await bot.stop();
    },

    async send(externalId, text) {
      await bot.api.sendMessage(Number(externalId), text);
    },

    async showTyping(externalId) {
      await bot.api.sendChatAction(Number(externalId), "typing");
    },
  };
}
