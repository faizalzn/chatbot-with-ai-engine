import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InboundBuffer } from "./inbound-buffer.js";

describe("InboundBuffer", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("menggabungkan pesan beruntun menjadi satu setelah pelanggan diam", () => {
    const flush = vi.fn();
    const buffer = new InboundBuffer<string>(flush, 1500, 6000);

    buffer.push("andi", "halo", "meta");
    vi.advanceTimersByTime(1000);
    buffer.push("andi", "mau tanya", "meta");
    vi.advanceTimersByTime(1000);
    buffer.push("andi", "ongkir ke Bandung berapa?", "meta");

    vi.advanceTimersByTime(1499);
    expect(flush).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(flush).toHaveBeenCalledExactlyOnceWith(["halo", "mau tanya", "ongkir ke Bandung berapa?"], "meta");
  });

  it("memisahkan pesan dari pelanggan yang berbeda", () => {
    const flush = vi.fn();
    const buffer = new InboundBuffer<string>(flush, 1500, 6000);

    buffer.push("andi", "halo", "andi");
    buffer.push("budi", "permisi", "budi");
    vi.advanceTimersByTime(1500);

    expect(flush).toHaveBeenCalledTimes(2);
    expect(flush).toHaveBeenCalledWith(["halo"], "andi");
    expect(flush).toHaveBeenCalledWith(["permisi"], "budi");
  });

  it("tetap melepas pesan setelah batas tunggu walau pelanggan terus mengetik", () => {
    const flush = vi.fn();
    const buffer = new InboundBuffer<string>(flush, 1500, 6000);

    // Satu pesan tiap detik: jeda diam 1,5 detik tidak pernah tercapai.
    for (let second = 0; second < 6; second++) {
      buffer.push("andi", `pesan ${second + 1}`, "meta");
      vi.advanceTimersByTime(1000);
    }

    expect(flush).toHaveBeenCalledExactlyOnceWith(["pesan 1", "pesan 2", "pesan 3", "pesan 4", "pesan 5", "pesan 6"], "meta");
  });

  it("memulai kumpulan baru setelah yang lama dilepas", () => {
    const flush = vi.fn();
    const buffer = new InboundBuffer<string>(flush, 1500, 6000);

    buffer.push("andi", "pertama", "meta");
    vi.advanceTimersByTime(1500);
    buffer.push("andi", "kedua", "meta");
    vi.advanceTimersByTime(1500);

    expect(flush.mock.calls.map(([texts]) => texts)).toEqual([["pertama"], ["kedua"]]);
  });

  it("membuang pesan yang belum dilepas saat dibersihkan", () => {
    const flush = vi.fn();
    const buffer = new InboundBuffer<string>(flush, 1500, 6000);

    buffer.push("andi", "halo", "meta");
    buffer.clear();
    vi.advanceTimersByTime(10_000);

    expect(flush).not.toHaveBeenCalled();
  });
});
