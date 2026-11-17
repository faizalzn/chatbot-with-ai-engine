import { describe, expect, it } from "vitest";
import { createSessionToken, decryptSecret, encryptSecret, fingerprint, isValidSessionToken, safeEqual } from "./crypto.js";

describe("enkripsi rahasia", () => {
  it("mengembalikan teks asli setelah didekripsi", () => {
    const token = "7123456789:AAHk3-contoh_token-bot";
    expect(decryptSecret(encryptSecret(token))).toBe(token);
  });

  it("menghasilkan sandi berbeda untuk teks yang sama", () => {
    expect(encryptSecret("rahasia")).not.toBe(encryptSecret("rahasia"));
  });

  it("menolak sandi yang diubah", () => {
    const parts = encryptSecret("rahasia").split(".");
    parts[3] = Buffer.from("isi palsu").toString("base64url");
    expect(() => decryptSecret(parts.join("."))).toThrow();
    expect(() => decryptSecret("bukan-format-yang-benar")).toThrow("Format rahasia tidak dikenal");
  });
});

describe("fingerprint", () => {
  it("sama untuk masukan yang sama, berbeda untuk masukan yang berbeda, dan tidak memuat nilai aslinya", () => {
    expect(fingerprint("telegram:abc")).toBe(fingerprint("telegram:abc"));
    expect(fingerprint("telegram:abc")).not.toBe(fingerprint("discord:abc"));
    expect(fingerprint("telegram:abc")).not.toContain("abc");
  });
});

describe("safeEqual", () => {
  it("membandingkan isi, termasuk untuk panjang yang berbeda", () => {
    expect(safeEqual("kata-sandi", "kata-sandi")).toBe(true);
    expect(safeEqual("kata-sandi", "kata-sandi-lain")).toBe(false);
    expect(safeEqual("", "x")).toBe(false);
  });
});

describe("token sesi", () => {
  const now = Date.UTC(2026, 10, 15);
  const day = 24 * 60 * 60 * 1000;

  it("berlaku tujuh hari", () => {
    const { token, maxAgeSeconds } = createSessionToken(now);
    expect(maxAgeSeconds).toBe(7 * 24 * 60 * 60);
    expect(isValidSessionToken(token, now + 6 * day)).toBe(true);
    expect(isValidSessionToken(token, now + 8 * day)).toBe(false);
  });

  it("menolak token kosong, rusak, atau yang masa berlakunya diubah", () => {
    const { token } = createSessionToken(now);
    const [, signature] = token.split(".");

    expect(isValidSessionToken(undefined, now)).toBe(false);
    expect(isValidSessionToken("asal", now)).toBe(false);
    expect(isValidSessionToken(`${now + 365 * day}.${signature}`, now)).toBe(false);
  });
});
