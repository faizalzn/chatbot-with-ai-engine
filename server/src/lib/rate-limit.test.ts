import { describe, expect, it } from "vitest";
import { RateLimiter } from "./rate-limit.js";

describe("RateLimiter", () => {
  it("mengizinkan sampai batas, lalu menolak sampai jendela waktunya lewat", () => {
    const limiter = new RateLimiter(3, 60_000);
    const start = 1_000_000;

    expect([0, 1, 2].map((offset) => limiter.allow("pengunjung", start + offset))).toEqual([true, true, true]);
    expect(limiter.allow("pengunjung", start + 3)).toBe(false);
    expect(limiter.allow("pengunjung", start + 59_999)).toBe(false);
    expect(limiter.allow("pengunjung", start + 60_001)).toBe(true);
  });

  it("menghitung tiap kunci secara terpisah", () => {
    const limiter = new RateLimiter(1, 60_000);

    expect(limiter.allow("a", 0)).toBe(true);
    expect(limiter.allow("a", 1)).toBe(false);
    expect(limiter.allow("b", 1)).toBe(true);
  });

  it("tidak menghitung percobaan yang ditolak", () => {
    const limiter = new RateLimiter(1, 1000);

    expect(limiter.allow("a", 0)).toBe(true);
    expect(limiter.allow("a", 900)).toBe(false);
    // Yang dihitung hanya pesan pertama, jadi tepat satu jendela setelahnya sudah boleh lagi.
    expect(limiter.allow("a", 1000)).toBe(true);
  });
});
