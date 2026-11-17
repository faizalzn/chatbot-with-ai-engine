/** Warna bawaan bila bisnis belum memilih warna, atau warnanya tidak valid. */
export const DEFAULT_ACCENT = "#14694F";

const INK = "#16191D";
const WHITE = "#FFFFFF";

export function isHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

/** Kecerahan relatif menurut WCAG, dari 0 (hitam) sampai 1 (putih). */
function luminance(hex: string): number {
  const channel = (offset: number) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** Warna teks (putih atau gelap) yang paling terbaca di atas warna latar ini. */
export function readableOn(background: string): string {
  const level = luminance(background);
  const withWhite = 1.05 / (level + 0.05);
  const withInk = (level + 0.05) / (luminance(INK) + 0.05);
  return withWhite >= withInk ? WHITE : INK;
}
