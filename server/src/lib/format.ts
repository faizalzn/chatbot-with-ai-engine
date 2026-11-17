import type { Channel } from "../db/schema.js";

/** Batas panjang satu pesan di tiap saluran, dengan sedikit ruang cadangan. */
const MAX_LENGTH: Record<Channel, number> = {
  web: 100_000,
  telegram: 4000,
  whatsapp: 4000,
  discord: 1900,
};

/**
 * Menyesuaikan format jawaban dengan saluran tujuan. Model diminta menulis format yang tepat,
 * tetapi sisa Markdown kadang lolos, jadi dirapikan lagi di sini sebelum dikirim.
 */
export function formatForChannel(channel: Channel, text: string): string {
  if (channel === "web" || channel === "discord") return text.trim();

  const emphasis = channel === "whatsapp" ? "*$1*" : "$1";
  return text
    .replace(/^#{1,6}\s+(.+)$/gm, emphasis)
    .replace(/\*\*(.+?)\*\*/g, emphasis)
    .replace(/__(.+?)__/g, "$1")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, "$1 ($2)")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

/** Memecah pesan panjang di batas paragraf, baris, atau kata supaya tidak ditolak saluran. */
export function splitForChannel(channel: Channel, text: string): string[] {
  const max = MAX_LENGTH[channel];
  const parts: string[] = [];
  let rest = text.trim();
  while (rest.length > max) {
    const window = rest.slice(0, max);
    const cut = [window.lastIndexOf("\n\n"), window.lastIndexOf("\n"), window.lastIndexOf(" ")].find((index) => index > max / 2) ?? max;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}
