/** Pembatas laju sederhana di memori: paling banyak `max` kejadian per `windowMs` untuk tiap kunci. */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  private calls = 0;

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  /** Mencatat satu kejadian. Mengembalikan false bila kunci ini sudah melewati batas. */
  allow(key: string, now = Date.now()): boolean {
    if (++this.calls % 500 === 0) this.sweep(now);

    const recent = (this.hits.get(key) ?? []).filter((time) => now - time < this.windowMs);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }

  private sweep(now: number): void {
    for (const [key, times] of this.hits) {
      if (times.every((time) => now - time >= this.windowMs)) this.hits.delete(key);
    }
  }
}
