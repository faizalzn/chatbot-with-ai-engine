import { ChannelType, Client, Events, GatewayIntentBits, Partials } from "discord.js";
import { UserFacingError } from "../lib/errors.js";
import { createLogger } from "../lib/logger.js";
import { ATTACHMENT_NOTE, type AdapterEvents, type ChannelAdapter, type ChannelStatus } from "./types.js";

const log = createLogger("discord");

/**
 * Bot Discord. Menjawab pesan langsung (DM) dan pesan di server yang menyebut (@mention) bot.
 * Dua jenis pesan itu bisa dibaca tanpa izin khusus "Message Content Intent",
 * jadi tidak ada yang perlu diaktifkan di Discord Developer Portal selain membuat bot.
 *
 * ID pelanggan: "dm:<userId>" untuk DM, "ch:<channelId>:<userId>" untuk percakapan di server.
 */
export function createDiscordAdapter(token: string, events: AdapterEvents): ChannelAdapter {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.DirectMessages],
    partials: [Partials.Channel],
  });

  client.on(Events.MessageCreate, (message) => {
    if (message.author.bot || !client.user) return;
    const isDirect = message.channel.type === ChannelType.DM;
    if (!isDirect && !message.mentions.users.has(client.user.id)) return;

    const text = message.content.replace(/<@!?\d+>/g, "").trim();
    events.onText({
      externalId: isDirect ? `dm:${message.author.id}` : `ch:${message.channelId}:${message.author.id}`,
      customerName: message.author.displayName || message.author.username,
      text: text || (message.attachments.size > 0 ? ATTACHMENT_NOTE : "Halo"),
    });
  });

  client.on(Events.Error, (error) => log.error("Kesalahan sambungan", error));
  client.on(Events.ShardDisconnect, () => events.onStatus({ state: "error", message: "Sambungan ke Discord terputus. Sambungkan ulang untuk mencoba lagi." }));
  client.on(Events.ShardResume, () => events.onStatus(connected()));

  function connected(): ChannelStatus {
    const bot = client.user;
    // Tautan undangan dengan izin secukupnya: melihat kanal, mengirim pesan, membaca riwayat pesan.
    const link = bot ? `https://discord.com/oauth2/authorize?client_id=${bot.id}&scope=bot&permissions=68608` : undefined;
    return { state: "connected", label: bot?.tag ?? "Bot Discord", link };
  }

  async function resolveTarget(externalId: string) {
    const [kind, first, second] = externalId.split(":");
    if (kind === "dm" && first) {
      const user = await client.users.fetch(first);
      return { channel: await user.createDM(), mention: "" };
    }
    if (kind === "ch" && first && second) {
      const channel = await client.channels.fetch(first);
      if (channel?.isSendable()) return { channel, mention: `<@${second}> ` };
    }
    throw new Error(`Tujuan Discord tidak dikenal: ${externalId}`);
  }

  return {
    async start() {
      const ready = new Promise<void>((resolve) => client.once(Events.ClientReady, () => resolve()));
      try {
        await client.login(token);
      } catch (error) {
        const code = (error as { code?: string }).code;
        await client.destroy().catch(() => {});
        if (code === "TokenInvalid") {
          throw new UserFacingError("Token ditolak Discord. Salin ulang token bot dari Discord Developer Portal, lalu coba lagi.");
        }
        throw new UserFacingError("Tidak bisa menghubungi Discord. Periksa koneksi internet server, lalu coba lagi.");
      }
      await ready;
      events.onStatus(connected());
    },

    async stop() {
      await client.destroy();
    },

    async send(externalId, text) {
      const { channel, mention } = await resolveTarget(externalId);
      await channel.send(mention + text);
    },

    async showTyping(externalId) {
      const { channel } = await resolveTarget(externalId);
      await channel.sendTyping();
    },
  };
}
