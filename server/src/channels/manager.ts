import { rm } from "node:fs/promises";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { channelConnections, type ConnectableChannel } from "../db/schema.js";
import { handleCustomerMessages } from "../engine/engine.js";
import { ROOT_DIR } from "../env.js";
import { decryptSecret, encryptSecret, fingerprint } from "../lib/crypto.js";
import { UserFacingError } from "../lib/errors.js";
import { formatForChannel, splitForChannel } from "../lib/format.js";
import { createLogger } from "../lib/logger.js";
import { RateLimiter } from "../lib/rate-limit.js";
import { findTenantById } from "../tenants.js";
import { createDiscordAdapter } from "./discord.js";
import { InboundBuffer } from "./inbound-buffer.js";
import { createTelegramAdapter } from "./telegram.js";
import { CHANNEL_LABEL, type AdapterEvents, type ChannelAdapter, type ChannelStatus, type InboundText } from "./types.js";
import { createWhatsAppAdapter } from "./whatsapp.js";

const log = createLogger("saluran");

/** Pesan pelanggan yang lebih panjang dari ini dipotong sebelum diproses. */
const MAX_TEXT_LENGTH = 4000;
const TYPING_INTERVAL_MS = 4500;

interface Sender {
  tenantId: string;
  channel: ConnectableChannel;
  externalId: string;
  customerName?: string | null;
}

interface Entry {
  adapter: ChannelAdapter;
  /** Dimatikan saat adapter dihentikan, supaya kejadian yang datang terlambat diabaikan. */
  alive: { value: boolean };
}

const keyOf = (tenantId: string, channel: ConnectableChannel) => `${tenantId}:${channel}`;
const whatsappSessionDir = (tenantId: string) => join(ROOT_DIR, "data", "whatsapp", tenantId);

/** Menyalakan, memutus, dan memakai sambungan saluran pesan untuk semua bisnis. */
class ChannelManager {
  private readonly entries = new Map<string, Entry>();
  private readonly statuses = new Map<string, ChannelStatus>();
  private readonly buffer = new InboundBuffer<Sender>((texts, sender) => void this.answer(texts, sender));
  /** Pelindung tagihan API: satu pelanggan paling banyak 20 pesan per 10 menit. */
  private readonly limiter = new RateLimiter(20, 10 * 60_000);

  status(tenantId: string, channel: ConnectableChannel): ChannelStatus {
    return this.statuses.get(keyOf(tenantId, channel)) ?? { state: "disconnected" };
  }

  /** Menyalakan kembali semua sambungan yang tersimpan. Dipanggil sekali saat server menyala. */
  async startSaved(): Promise<void> {
    const rows = await db.select().from(channelConnections);
    await Promise.all(
      rows.map(async (row) => {
        try {
          await this.launch(row.tenantId, row.channel, row.secret ? decryptSecret(row.secret) : null);
        } catch (error) {
          const message = error instanceof UserFacingError ? error.message : "Gagal tersambung saat server dinyalakan. Coba sambungkan ulang.";
          this.statuses.set(keyOf(row.tenantId, row.channel), { state: "error", message });
          log.error(`${CHANNEL_LABEL[row.channel]} untuk bisnis ${row.tenantId} gagal tersambung`, error);
        }
      }),
    );
    if (rows.length) log.info(`${rows.length} sambungan saluran dinyalakan kembali`);
  }

  /** Menyambungkan saluran. Telegram dan Discord butuh token bot, WhatsApp dilanjutkan dengan memindai QR. */
  async connect(tenantId: string, channel: ConnectableChannel, token?: string): Promise<ChannelStatus> {
    const key = keyOf(tenantId, channel);

    if (channel === "whatsapp") {
      await db.insert(channelConnections).values({ tenantId, channel }).onConflictDoNothing();
      await this.launch(tenantId, channel, null);
      return this.status(tenantId, channel);
    }

    const secret = token?.trim();
    if (!secret) throw new UserFacingError("Token belum diisi.");

    const print = fingerprint(`${channel}:${secret}`);
    const [existing] = await db.select().from(channelConnections).where(eq(channelConnections.fingerprint, print));
    if (existing && existing.tenantId !== tenantId) {
      throw new UserFacingError("Bot ini sudah tersambung ke bisnis lain. Buat bot baru khusus untuk bisnis ini.", 409);
    }

    try {
      await this.launch(tenantId, channel, secret);
    } catch (error) {
      // Belum ada yang tersimpan, jadi kembalikan ke keadaan "belum tersambung". Pesan kesalahan tampil di formulir.
      this.statuses.delete(key);
      throw error instanceof UserFacingError ? error : new UserFacingError(`Gagal tersambung ke ${CHANNEL_LABEL[channel]}. Coba lagi.`);
    }

    await db
      .insert(channelConnections)
      .values({ tenantId, channel, secret: encryptSecret(secret), fingerprint: print })
      .onConflictDoUpdate({
        target: [channelConnections.tenantId, channelConnections.channel],
        set: { secret: encryptSecret(secret), fingerprint: print },
      });
    return this.status(tenantId, channel);
  }

  /** Memutus saluran secara permanen dan menghapus token atau sesi yang tersimpan. */
  async disconnect(tenantId: string, channel: ConnectableChannel): Promise<void> {
    const key = keyOf(tenantId, channel);
    const entry = this.entries.get(key);
    if (entry) {
      entry.alive.value = false;
      this.entries.delete(key);
      await (entry.adapter.forget ? entry.adapter.forget() : entry.adapter.stop()).catch((error) => log.warn("Gagal memutus dengan bersih", error));
    }
    this.statuses.delete(key);
    await this.forget(tenantId, channel);
  }

  /** Mengirim teks ke pelanggan lewat salurannya. Dipakai untuk balasan bot maupun staf. */
  async send(tenantId: string, channel: ConnectableChannel, externalId: string, text: string): Promise<void> {
    const entry = this.entries.get(keyOf(tenantId, channel));
    if (!entry || this.status(tenantId, channel).state !== "connected") {
      throw new UserFacingError(`${CHANNEL_LABEL[channel]} sedang tidak tersambung, jadi pesan belum terkirim.`, 409);
    }
    for (const part of splitForChannel(channel, formatForChannel(channel, text))) {
      await entry.adapter.send(externalId, part);
    }
  }

  async stopAll(): Promise<void> {
    this.buffer.clear();
    const entries = [...this.entries.values()];
    this.entries.clear();
    await Promise.all(
      entries.map((entry) => {
        entry.alive.value = false;
        return entry.adapter.stop().catch(() => {});
      }),
    );
  }

  private async forget(tenantId: string, channel: ConnectableChannel): Promise<void> {
    await db.delete(channelConnections).where(and(eq(channelConnections.tenantId, tenantId), eq(channelConnections.channel, channel)));
    if (channel === "whatsapp") await rm(whatsappSessionDir(tenantId), { recursive: true, force: true }).catch(() => {});
  }

  private async launch(tenantId: string, channel: ConnectableChannel, token: string | null): Promise<void> {
    const key = keyOf(tenantId, channel);

    const previous = this.entries.get(key);
    if (previous) {
      previous.alive.value = false;
      this.entries.delete(key);
      await previous.adapter.stop().catch(() => {});
    }

    const alive = { value: true };
    const events: AdapterEvents = {
      onText: (message) => alive.value && this.receive({ tenantId, channel, externalId: message.externalId, customerName: message.customerName }, message),
      onGreeting: (externalId) => alive.value && void this.greet(tenantId, channel, externalId),
      onStatus: (status) => alive.value && this.statuses.set(key, status),
      onLoggedOut: (message) => {
        if (!alive.value) return;
        alive.value = false;
        this.entries.delete(key);
        this.statuses.set(key, { state: "error", message });
        void this.forget(tenantId, channel);
      },
    };

    const adapter =
      channel === "telegram"
        ? createTelegramAdapter(token ?? "", events)
        : channel === "discord"
          ? createDiscordAdapter(token ?? "", events)
          : createWhatsAppAdapter(whatsappSessionDir(tenantId), events);

    this.entries.set(key, { adapter, alive });
    this.statuses.set(key, { state: "connecting" });
    try {
      await adapter.start();
    } catch (error) {
      alive.value = false;
      this.entries.delete(key);
      await adapter.stop().catch(() => {});
      throw error;
    }
  }

  private receive(sender: Sender, message: InboundText): void {
    const customerKey = `${keyOf(sender.tenantId, sender.channel)}:${sender.externalId}`;
    if (!this.limiter.allow(customerKey)) {
      log.warn(`Pesan dari ${customerKey} diabaikan karena melewati batas laju`);
      return;
    }
    this.buffer.push(customerKey, message.text.slice(0, MAX_TEXT_LENGTH), sender);
  }

  /** Menjawab sekumpulan pesan beruntun dari satu pelanggan. */
  private async answer(texts: string[], sender: Sender): Promise<void> {
    const stopTyping = this.keepTyping(sender);
    try {
      const tenant = await findTenantById(sender.tenantId);
      if (!tenant) return;
      const outcome = await handleCustomerMessages({ tenant, ...sender, texts });
      if (outcome.reply) await this.send(sender.tenantId, sender.channel, sender.externalId, outcome.reply.content);
    } catch (error) {
      log.error(`Gagal membalas pelanggan di ${CHANNEL_LABEL[sender.channel]}`, error);
    } finally {
      stopTyping();
    }
  }

  private async greet(tenantId: string, channel: ConnectableChannel, externalId: string): Promise<void> {
    try {
      const tenant = await findTenantById(tenantId);
      if (tenant) await this.send(tenantId, channel, externalId, tenant.greeting);
    } catch (error) {
      log.error("Gagal mengirim salam pembuka", error);
    }
  }

  /** Menampilkan tanda "sedang mengetik" sampai fungsi yang dikembalikan dipanggil. */
  private keepTyping(sender: Sender): () => void {
    const show = () => {
      const entry = this.entries.get(keyOf(sender.tenantId, sender.channel));
      void entry?.adapter.showTyping(sender.externalId).catch(() => {});
    };
    show();
    const timer = setInterval(show, TYPING_INTERVAL_MS);
    return () => clearInterval(timer);
  }
}

export const channels = new ChannelManager();
