import { rm } from "node:fs/promises";
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  isJidBroadcast,
  isJidGroup,
  isJidNewsletter,
  isJidStatusBroadcast,
  useMultiFileAuthState,
  type WASocket,
} from "baileys";
import pino from "pino";
import QRCode from "qrcode";
import { createLogger } from "../lib/logger.js";
import { ATTACHMENT_NOTE, type AdapterEvents, type ChannelAdapter } from "./types.js";

const log = createLogger("whatsapp");

/** Pesan yang lebih lama dari ini saat diterima dianggap tumpukan lama dan tidak dijawab. */
const MAX_MESSAGE_AGE_MS = 10 * 60 * 1000;

/**
 * WhatsApp lewat Baileys, yaitu sambungan TIDAK RESMI yang meniru WhatsApp Web
 * (pindai QR dari menu "Perangkat tertaut"). Cocok untuk demo karena gratis dan
 * cepat disiapkan, tetapi melanggar ketentuan WhatsApp dan nomornya bisa diblokir.
 *
 * Untuk klien sungguhan, tulis adapter baru di atas WhatsApp Cloud API resmi dengan
 * antarmuka ChannelAdapter yang sama. Bagian lain sistem tidak perlu diubah.
 *
 * Hanya chat pribadi yang dijawab. Grup, status, dan saluran diabaikan.
 */
export function createWhatsAppAdapter(sessionDir: string, events: AdapterEvents): ChannelAdapter {
  let socket: WASocket | null = null;
  let stopped = false;
  let retries = 0;
  let retryTimer: NodeJS.Timeout | null = null;

  const wipeSession = () => rm(sessionDir, { recursive: true, force: true }).catch(() => {});

  async function connect(): Promise<void> {
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    // Versi protokol terbaru diambil dari server WhatsApp. Kalau gagal, bawaan pustaka dipakai.
    const latest = await fetchLatestBaileysVersion().catch(() => null);
    if (stopped) return;

    const sock = makeWASocket({
      auth: state,
      ...(latest ? { version: latest.version } : {}),
      logger: pino({ level: "silent" }),
      browser: Browsers.appropriate("Chrome"),
      markOnlineOnConnect: false,
      syncFullHistory: false,
    });
    socket = sock;

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", (update) => {
      if (stopped || socket !== sock) return;

      if (update.qr) {
        QRCode.toDataURL(update.qr, { margin: 1, width: 320 }).then(
          (qr) => !stopped && socket === sock && events.onStatus({ state: "qr", qr }),
          (error) => log.error("Gagal membuat gambar QR", error),
        );
      }

      if (update.connection === "open") {
        retries = 0;
        const number = sock.user?.id.split(/[:@]/)[0];
        events.onStatus({ state: "connected", label: number ? `+${number}` : "WhatsApp", link: number ? `https://wa.me/${number}` : undefined });
      }

      if (update.connection === "close") {
        const code = (update.lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
        const paired = Boolean(sock.authState.creds.me);
        socket = null;

        const giveUp = (message: string) => {
          stopped = true;
          void wipeSession().then(() => events.onLoggedOut(message));
        };

        if (code === DisconnectReason.loggedOut || code === DisconnectReason.badSession) {
          return giveUp("WhatsApp memutus tautan perangkat ini. Sambungkan ulang dengan memindai kode QR baru.");
        }
        if (code === DisconnectReason.forbidden) {
          return giveUp("WhatsApp menolak nomor ini. Kemungkinan nomornya dibatasi atau diblokir.");
        }
        if (code === DisconnectReason.connectionReplaced) {
          return giveUp("Sesi WhatsApp ini dibuka di tempat lain. Sambungkan ulang bila ingin memakainya di sini.");
        }
        if (!paired && code !== DisconnectReason.restartRequired) {
          return giveUp("Kode QR tidak dipindai tepat waktu. Sambungkan ulang untuk mendapat kode baru.");
        }

        // Putus biasa (jaringan, atau WhatsApp meminta mulai ulang setelah QR dipindai): sambung lagi.
        events.onStatus({ state: "connecting" });
        const delay = code === DisconnectReason.restartRequired ? 0 : Math.min(30_000, 2000 * 2 ** retries++);
        retryTimer = setTimeout(() => {
          connect().catch((error) => {
            log.error("Gagal menyambung ulang", error);
            events.onStatus({ state: "error", message: "Tidak bisa menghubungi WhatsApp. Periksa koneksi internet server." });
          });
        }, delay);
      }
    });

    sock.ev.on("messages.upsert", ({ messages, type }) => {
      if (type !== "notify") return;
      for (const message of messages) {
        const jid = message.key.remoteJid;
        if (!jid || message.key.fromMe || !message.message) continue;
        if (isJidGroup(jid) || isJidBroadcast(jid) || isJidStatusBroadcast(jid) || isJidNewsletter(jid)) continue;

        const sentAt = Number(message.messageTimestamp?.toString() ?? 0) * 1000;
        if (sentAt && Date.now() - sentAt > MAX_MESSAGE_AGE_MS) continue;

        const content = message.message.ephemeralMessage?.message ?? message.message;
        const text = (content.conversation || content.extendedTextMessage?.text || "").trim();
        const caption = (content.imageMessage?.caption || content.videoMessage?.caption || content.documentMessage?.caption || "").trim();
        const hasAttachment = Boolean(
          content.imageMessage || content.videoMessage || content.audioMessage || content.documentMessage || content.stickerMessage,
        );
        // Reaksi, tanda terima, dan pesan protokol lain tidak punya teks maupun lampiran, jadi dilewati.
        if (!text && !hasAttachment) continue;

        void sock.readMessages([message.key]).catch(() => {});
        events.onText({ externalId: jid, customerName: message.pushName, text: text || caption || ATTACHMENT_NOTE });
      }
    });
  }

  function requireSocket(): WASocket {
    if (!socket) throw new Error("WhatsApp sedang tidak tersambung");
    return socket;
  }

  return {
    async start() {
      events.onStatus({ state: "connecting" });
      await connect();
    },

    async stop() {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      socket?.end(undefined);
      socket = null;
    },

    async forget() {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      // logout() melepas tautan perangkat di sisi WhatsApp. Kalau gagal, sesi lokal tetap dihapus.
      await socket?.logout().catch(() => {});
      socket = null;
      await wipeSession();
    },

    async send(externalId, text) {
      await requireSocket().sendMessage(externalId, { text });
    },

    async showTyping(externalId) {
      await requireSocket().sendPresenceUpdate("composing", externalId);
    },
  };
}
