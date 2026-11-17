/**
 * Mengumpulkan pesan beruntun dari pelanggan yang sama sebelum dijawab.
 *
 * Di aplikasi chat, orang sering memecah satu pertanyaan menjadi beberapa pesan
 * ("halo" / "mau tanya" / "ongkir ke Bandung berapa?"). Tanpa jeda ini, bot akan
 * menjawab tiga kali. Pesan dilepas setelah pelanggan diam sejenak, atau paling
 * lama setelah `maxWaitMs` supaya pelanggan yang terus mengetik tetap dijawab.
 */
export class InboundBuffer<Meta> {
  private readonly pending = new Map<string, { texts: string[]; meta: Meta; firstAt: number; timer: NodeJS.Timeout }>();

  constructor(
    private readonly flush: (texts: string[], meta: Meta) => void,
    private readonly quietMs = 1500,
    private readonly maxWaitMs = 6000,
  ) {}

  push(key: string, text: string, meta: Meta): void {
    const now = Date.now();
    const entry = this.pending.get(key);
    if (entry) clearTimeout(entry.timer);

    const firstAt = entry?.firstAt ?? now;
    const texts = [...(entry?.texts ?? []), text];
    const delay = Math.max(0, Math.min(this.quietMs, firstAt + this.maxWaitMs - now));
    const timer = setTimeout(() => {
      this.pending.delete(key);
      this.flush(texts, meta);
    }, delay);
    this.pending.set(key, { texts, meta, firstAt, timer });
  }

  /** Membuang pesan yang belum dilepas. Dipakai saat server dimatikan. */
  clear(): void {
    for (const entry of this.pending.values()) clearTimeout(entry.timer);
    this.pending.clear();
  }
}
