import { defineConfig } from "drizzle-kit";

// Setelah mengubah src/db/schema.ts, jalankan `npm run db:generate -w server`.
// Migrasi yang dihasilkan dijalankan otomatis saat server menyala.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
});
