import { Hono, type MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import { env } from "../env.js";
import { createSessionToken, isValidSessionToken, safeEqual } from "../lib/crypto.js";
import { RateLimiter } from "../lib/rate-limit.js";
import { clientIp, readJson } from "./helpers.js";

const COOKIE = "sahut_session";
/** Header yang selalu dikirim dashboard. Situs lain tidak bisa menyertakannya, jadi permintaan palsu lintas situs tertolak. */
const CLIENT_HEADER = "x-sahut-client";

const loginAttempts = new RateLimiter(8, 60_000);

export const authRoutes = new Hono();

authRoutes.get("/session", (c) => c.json({ authenticated: isValidSessionToken(getCookie(c, COOKIE)) }));

authRoutes.post("/login", async (c) => {
  if (!loginAttempts.allow(clientIp(c))) {
    return c.json({ error: "Terlalu banyak percobaan. Tunggu satu menit, lalu coba lagi." }, 429);
  }
  const { password } = await readJson(c, z.object({ password: z.string() }));
  if (!safeEqual(password, env.ADMIN_PASSWORD)) return c.json({ error: "Kata sandi salah." }, 401);

  const session = createSessionToken();
  setCookie(c, COOKIE, session.token, {
    httpOnly: true,
    sameSite: "Lax",
    secure: env.isProduction,
    path: "/",
    maxAge: session.maxAgeSeconds,
  });
  return c.json({ authenticated: true });
});

authRoutes.post("/logout", (c) => {
  deleteCookie(c, COOKIE, { path: "/" });
  return c.json({ authenticated: false });
});

export const requireAuth: MiddlewareHandler = async (c, next) => {
  if (!isValidSessionToken(getCookie(c, COOKIE))) {
    return c.json({ error: "Sesi berakhir. Silakan masuk lagi." }, 401);
  }
  if (c.req.method !== "GET" && c.req.method !== "HEAD" && !c.req.header(CLIENT_HEADER)) {
    return c.json({ error: "Permintaan ditolak." }, 403);
  }
  await next();
};
