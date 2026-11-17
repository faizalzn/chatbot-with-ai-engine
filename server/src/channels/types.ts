import type { ConnectableChannel } from "../db/schema.js";

export type ChannelStatus =
  | { state: "disconnected" }
  | { state: "connecting" }
  /** WhatsApp menunggu kode QR dipindai. `qr` berisi gambar siap tampil (data URL). */
  | { state: "qr"; qr: string }
  /** `link` adalah alamat yang bisa dibuka untuk mulai memakai sambungan ini, mis. halaman bot di Telegram. */
  | { state: "connected"; label: string; link?: string }
  | { state: "error"; message: string };

export interface InboundText {
  /** ID pelanggan di saluran ini. Dipakai juga sebagai tujuan saat membalas. */
  externalId: string;
  customerName?: string | null;
  text: string;
}

export interface AdapterEvents {
  onText(message: InboundText): void;
  /** Pelanggan baru membuka percakapan, misalnya menekan "Start" di Telegram. */
  onGreeting(externalId: string): void;
  onStatus(status: ChannelStatus): void;
  /** Sambungan diakhiri dari sisi saluran (mis. perangkat dikeluarkan dari WhatsApp), jadi harus dilupakan. */
  onLoggedOut(message: string): void;
}

/**
 * Penghubung ke satu saluran pesan. Mengganti cara tersambung ke sebuah saluran
 * (misalnya WhatsApp tidak resmi ke WhatsApp Cloud API) cukup dengan menulis ulang satu adapter.
 */
export interface ChannelAdapter {
  /** Selesai ketika sambungan sudah dimulai. Melempar UserFacingError bila token ditolak. */
  start(): Promise<void>;
  /** Menghentikan sambungan tanpa melupakannya, misalnya saat server dimatikan. */
  stop(): Promise<void>;
  /** Mengakhiri sambungan secara permanen dan menghapus sesi yang tersimpan, bila ada. */
  forget?(): Promise<void>;
  send(externalId: string, text: string): Promise<void>;
  showTyping(externalId: string): Promise<void>;
}

export type AdapterFactory = (events: AdapterEvents) => ChannelAdapter;

/** Pengganti isi pesan ketika pelanggan mengirim sesuatu yang bukan teks. */
export const ATTACHMENT_NOTE = "[Pelanggan mengirim foto, suara, atau berkas. Lampiran belum bisa dibaca di sini.]";

export const CHANNEL_LABEL: Record<ConnectableChannel, string> = {
  telegram: "Telegram",
  whatsapp: "WhatsApp",
  discord: "Discord",
};
