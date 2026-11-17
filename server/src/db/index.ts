import { join } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { env, ROOT_DIR } from "../env.js";
import * as schema from "./schema.js";

export const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 10 });

export const db = drizzle({ client: pool, schema });

/** Menyiapkan ekstensi pgvector dan menjalankan migrasi yang belum terpasang. */
export async function prepareDatabase(): Promise<void> {
  try {
    await pool.query("CREATE EXTENSION IF NOT EXISTS vector");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ECONNREFUSED") {
      throw new Error('Database belum menyala. Jalankan "npm run db:up" (Docker harus aktif), lalu coba lagi.');
    }
    throw error;
  }
  await migrate(db, { migrationsFolder: join(ROOT_DIR, "server", "drizzle") });
}

export async function closeDatabase(): Promise<void> {
  await pool.end();
}
