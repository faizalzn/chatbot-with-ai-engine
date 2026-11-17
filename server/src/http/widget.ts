import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { customerVisibleMessagesAfter, findConversation } from "../engine/conversations.js";
import { UserFacingError } from "../lib/errors.js";
import { RateLimiter } from "../lib/rate-limit.js";
import { findTenantByPublicKey } from "../tenants.js";
import { clientIp, readJson, serializeMessage, TEST_PREFIX } from "./helpers.js";
import { streamBotReply } from "./reply-stream.js";

/**
 * API publik untuk widget chat yang ditempel di website klien.
 * Tidak memakai login: bisnis dikenali dari kunci publiknya, pengunjung dari ID acak
 * yang dibuat widget dan disimpan di peramban masing-masing.
 */
export const widgetRoutes = new Hono();

// Widget berjalan di domain klien, jadi API ini harus bisa dipanggil lintas domain. Tidak ada cookie yang terlibat.
widgetRoutes.use("*", cors({ origin: "*", allowMethods: ["GET", "POST", "OPTIONS"], maxAge: 86400 }));

// Pelindung tagihan API dari penyalahgunaan.
const perVisitor = new RateLimiter(12, 60_000);
const perIp = new RateLimiter(40, 60_000);

const VisitorId = z
  .string()
  .regex(/^[A-Za-z0-9_-]{8,64}$/)
  .refine((id) => !id.startsWith(TEST_PREFIX));

const NewMessage = z.object({
  visitorId: VisitorId,
  text: z.string().trim().min(1, "Pesan masih kosong.").max(2000, "Pesan terlalu panjang. Persingkat lalu kirim lagi."),
});

async function tenantFor(publicKey: string) {
  const tenant = await findTenantByPublicKey(publicKey);
  if (!tenant) throw new UserFacingError("Widget ini tidak dikenali. Periksa kode yang ditempel di website.", 404);
  return tenant;
}

widgetRoutes.get("/:publicKey/config", async (c) => {
  const tenant = await tenantFor(c.req.param("publicKey"));
  return c.json({
    businessName: tenant.name,
    botName: tenant.botName,
    greeting: tenant.greeting,
    accentColor: tenant.accentColor,
  });
});

/** Riwayat percakapan pengunjung. Dipanggil berkala oleh widget untuk mengambil balasan staf. */
widgetRoutes.get("/:publicKey/messages", async (c) => {
  const tenant = await tenantFor(c.req.param("publicKey"));
  const visitorId = VisitorId.safeParse(c.req.query("visitorId"));
  if (!visitorId.success) throw new UserFacingError("ID pengunjung tidak valid.");
  const after = Number(c.req.query("after") ?? 0) || 0;

  const conversation = await findConversation({ tenantId: tenant.id, channel: "web", externalId: visitorId.data });
  if (!conversation) return c.json({ messages: [], withStaff: false });

  const messages = await customerVisibleMessagesAfter(conversation.id, after);
  return c.json({ messages: messages.map((message) => serializeMessage(message, false)), withStaff: conversation.mode === "human" });
});

widgetRoutes.post("/:publicKey/messages", async (c) => {
  const tenant = await tenantFor(c.req.param("publicKey"));
  const { visitorId, text } = await readJson(c, NewMessage);

  if (!perVisitor.allow(`${tenant.id}:${visitorId}`) || !perIp.allow(clientIp(c))) {
    return c.json({ error: "Terlalu banyak pesan dalam waktu singkat. Tunggu sebentar, lalu coba lagi." }, 429);
  }

  return streamBotReply(c, { tenant, tenantId: tenant.id, channel: "web", externalId: visitorId, texts: [text] }, { includeSources: false });
});
