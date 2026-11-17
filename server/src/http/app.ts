import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { UserFacingError } from "../lib/errors.js";
import { createLogger } from "../lib/logger.js";
import { adminRoutes } from "./admin.js";
import { authRoutes } from "./auth.js";
import { staticRoutes } from "./static.js";
import { widgetRoutes } from "./widget.js";

const log = createLogger("http");

export const app = new Hono();

app.onError((error, c) => {
  if (error instanceof UserFacingError) return c.json({ error: error.message }, error.status);
  if (error instanceof HTTPException) return error.getResponse();
  log.error(`${c.req.method} ${c.req.path}`, error);
  return c.json({ error: "Terjadi gangguan di server. Coba lagi sebentar lagi." }, 500);
});

app.notFound((c) => c.json({ error: "Alamat tidak ditemukan." }, 404));

// Urutan penting: rute publik didaftarkan sebelum rute dashboard yang mewajibkan login.
app.route("/api/widget", widgetRoutes);
app.route("/api/auth", authRoutes);
app.route("/api", adminRoutes);
app.route("/", staticRoutes);
