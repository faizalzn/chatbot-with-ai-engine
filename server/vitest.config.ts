import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Folder "shared" (dipakai widget dan dashboard) tidak punya paket sendiri, jadi tesnya ikut dijalankan dari sini.
    dir: "..",
    include: ["server/src/**/*.test.ts", "shared/**/*.test.ts"],
    env: {
      NODE_ENV: "test",
      LOG_LEVEL: "error",
      DATABASE_URL: "postgres://unused:unused@127.0.0.1:1/unused",
      ADMIN_PASSWORD: "kata-sandi-uji",
      SESSION_SECRET: "rahasia-sesi-untuk-pengujian-saja-0123456789",
      ENCRYPTION_KEY: "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
    },
  },
});
