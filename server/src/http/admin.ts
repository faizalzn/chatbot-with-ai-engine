import { and, desc, eq, like, notLike, sql } from "drizzle-orm";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { channels } from "../channels/manager.js";
import { db } from "../db/index.js";
import { CONNECTABLE_CHANNELS, conversations, documents, tenants, type ConnectableChannel, type Conversation } from "../db/schema.js";
import { addMessage, getConversation, handOffToStaff, recentMessages, returnToBot } from "../engine/conversations.js";
import { describeLlm, isLlmConfigured, llmSettings } from "../engine/llm.js";
import { env } from "../env.js";
import { extractText, titleFromFileName } from "../knowledge/extract.js";
import { createDocument, updateDocument } from "../knowledge/ingest.js";
import { UserFacingError } from "../lib/errors.js";
import { createTenant, findTenantById } from "../tenants.js";
import { requireAuth } from "./auth.js";
import { displayName, readJson, serializeMessage, TEST_PREFIX } from "./helpers.js";
import { streamBotReply } from "./reply-stream.js";

/** API untuk dashboard. Semua rute di sini butuh login. */
export const adminRoutes = new Hono();
adminRoutes.use("*", requireAuth);

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

/** Percakapan menunggu staf bila staf yang menangani dan pesan terakhir bukan dari staf. */
const waitingForStaff = sql<boolean>`(${conversations.mode} = 'human' AND ${conversations.lastMessageRole} IS DISTINCT FROM 'agent')`;
const notTestChat = notLike(conversations.externalId, `${TEST_PREFIX}%`);

async function requireTenant(id: string) {
  const tenant = z.uuid().safeParse(id).success ? await findTenantById(id) : null;
  if (!tenant) throw new UserFacingError("Bisnis tidak ditemukan.", 404);
  return tenant;
}

async function requireConversation(id: string) {
  const conversation = z.uuid().safeParse(id).success ? await getConversation(id) : null;
  if (!conversation) throw new UserFacingError("Percakapan tidak ditemukan.", 404);
  return conversation;
}

function requireChannel(value: string): ConnectableChannel {
  if (!(CONNECTABLE_CHANNELS as readonly string[]).includes(value)) throw new UserFacingError("Saluran tidak dikenal.", 404);
  return value as ConnectableChannel;
}

function conversationSummary(conversation: Conversation) {
  return {
    id: conversation.id,
    channel: conversation.channel,
    name: displayName(conversation),
    mode: conversation.mode,
    waiting: conversation.mode === "human" && conversation.lastMessageRole !== "agent",
    handoffReason: conversation.handoffReason,
    preview: conversation.lastMessagePreview,
    lastRole: conversation.lastMessageRole,
    lastAt: conversation.lastMessageAt,
  };
}

// --- Keadaan sistem ------------------------------------------------------------

adminRoutes.get("/status", (c) =>
  c.json({ botReady: isLlmConfigured(), problem: llmSettings.problem, model: llmSettings.model, provider: llmSettings.provider, description: describeLlm() }),
);

// --- Bisnis --------------------------------------------------------------------

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Warna harus berupa kode seperti #14694F.");

const NewTenant = z.object({
  name: z.string().trim().min(2, "Nama bisnis belum diisi.").max(80, "Nama bisnis terlalu panjang."),
});

const TenantChanges = z.object({
  name: z.string().trim().min(2, "Nama bisnis belum diisi.").max(80, "Nama bisnis terlalu panjang.").optional(),
  botName: z.string().trim().min(1, "Nama bot belum diisi.").max(40, "Nama bot terlalu panjang.").optional(),
  greeting: z.string().trim().min(1, "Salam pembuka belum diisi.").max(500, "Salam pembuka terlalu panjang.").optional(),
  instructions: z.string().trim().max(4000, "Arahan terlalu panjang. Ringkas menjadi paling banyak 4.000 karakter.").optional(),
  accentColor: hexColor.optional(),
});

adminRoutes.get("/tenants", async (c) => {
  const rows = await db.select().from(tenants).orderBy(tenants.createdAt);
  const waiting = await db
    .select({ tenantId: conversations.tenantId, count: sql<number>`count(*)::int` })
    .from(conversations)
    .where(and(waitingForStaff, notTestChat))
    .groupBy(conversations.tenantId);
  const waitingByTenant = new Map(waiting.map((row) => [row.tenantId, row.count]));

  return c.json(rows.map((tenant) => ({ id: tenant.id, name: tenant.name, accentColor: tenant.accentColor, waiting: waitingByTenant.get(tenant.id) ?? 0 })));
});

adminRoutes.post("/tenants", async (c) => {
  const input = await readJson(c, NewTenant);
  return c.json(await createTenant(input), 201);
});

adminRoutes.get("/tenants/:tenantId", async (c) => c.json(await requireTenant(c.req.param("tenantId"))));

adminRoutes.patch("/tenants/:tenantId", async (c) => {
  const tenant = await requireTenant(c.req.param("tenantId"));
  const changes = await readJson(c, TenantChanges);
  const [updated] = await db.update(tenants).set(changes).where(eq(tenants.id, tenant.id)).returning();
  return c.json(updated);
});

adminRoutes.delete("/tenants/:tenantId", async (c) => {
  const tenant = await requireTenant(c.req.param("tenantId"));
  await Promise.all(CONNECTABLE_CHANNELS.map((channel) => channels.disconnect(tenant.id, channel)));
  await db.delete(tenants).where(eq(tenants.id, tenant.id));
  return c.json({ deleted: true });
});

// --- Pengetahuan ---------------------------------------------------------------

const DocumentInput = z.object({
  title: z.string().trim().min(2, "Judul belum diisi.").max(120, "Judul terlalu panjang."),
  content: z.string().trim().min(20, "Isi terlalu pendek. Tulis setidaknya satu atau dua kalimat."),
});

const documentSummary = {
  id: documents.id,
  title: documents.title,
  fileName: documents.fileName,
  status: documents.status,
  error: documents.error,
  chunkCount: documents.chunkCount,
  length: sql<number>`char_length(${documents.content})`,
  updatedAt: documents.updatedAt,
};

async function requireDocument(id: string) {
  const [document] = z.uuid().safeParse(id).success ? await db.select().from(documents).where(eq(documents.id, id)) : [];
  if (!document) throw new UserFacingError("Dokumen tidak ditemukan.", 404);
  return document;
}

adminRoutes.get("/tenants/:tenantId/documents", async (c) => {
  const tenant = await requireTenant(c.req.param("tenantId"));
  return c.json(await db.select(documentSummary).from(documents).where(eq(documents.tenantId, tenant.id)).orderBy(desc(documents.updatedAt)));
});

adminRoutes.post("/tenants/:tenantId/documents", async (c) => {
  const tenant = await requireTenant(c.req.param("tenantId"));
  const input = await readJson(c, DocumentInput);
  const document = await createDocument(tenant.id, input);
  return c.json({ id: document.id }, 201);
});

adminRoutes.post(
  "/tenants/:tenantId/documents/upload",
  bodyLimit({
    maxSize: MAX_UPLOAD_BYTES + 1024 * 1024,
    onError: (c) => c.json({ error: "File terlalu besar. Ukuran paling besar 15 MB." }, 413),
  }),
  async (c) => {
    const tenant = await requireTenant(c.req.param("tenantId"));
    const form = await c.req.parseBody();
    const file = form.file;
    if (!(file instanceof File)) throw new UserFacingError("File belum dipilih.");
    if (file.size > MAX_UPLOAD_BYTES) throw new UserFacingError("File terlalu besar. Ukuran paling besar 15 MB.");

    const content = await extractText(file.name, new Uint8Array(await file.arrayBuffer()));
    const document = await createDocument(tenant.id, { title: titleFromFileName(file.name).slice(0, 120), content, fileName: file.name });
    return c.json({ id: document.id }, 201);
  },
);

adminRoutes.get("/documents/:documentId", async (c) => {
  const document = await requireDocument(c.req.param("documentId"));
  return c.json({ id: document.id, title: document.title, fileName: document.fileName, content: document.content, status: document.status });
});

adminRoutes.put("/documents/:documentId", async (c) => {
  const document = await requireDocument(c.req.param("documentId"));
  await updateDocument(document.id, await readJson(c, DocumentInput));
  return c.json({ id: document.id });
});

adminRoutes.delete("/documents/:documentId", async (c) => {
  const document = await requireDocument(c.req.param("documentId"));
  await db.delete(documents).where(eq(documents.id, document.id));
  return c.json({ deleted: true });
});

// --- Percakapan ----------------------------------------------------------------

const StaffReply = z.object({
  text: z.string().trim().min(1, "Pesan masih kosong.").max(4000, "Pesan terlalu panjang."),
});

adminRoutes.get("/tenants/:tenantId/conversations", async (c) => {
  const tenant = await requireTenant(c.req.param("tenantId"));
  const rows = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.tenantId, tenant.id), notTestChat))
    .orderBy(desc(waitingForStaff), desc(conversations.lastMessageAt))
    .limit(200);
  return c.json(rows.map(conversationSummary));
});

adminRoutes.get("/conversations/:conversationId", async (c) => {
  const conversation = await requireConversation(c.req.param("conversationId"));
  const history = await recentMessages(conversation.id, 300);
  return c.json({ ...conversationSummary(conversation), messages: history.map((message) => serializeMessage(message, true)) });
});

adminRoutes.post("/conversations/:conversationId/takeover", async (c) => {
  const conversation = await requireConversation(c.req.param("conversationId"));
  if (conversation.mode === "bot") await handOffToStaff(conversation.id, null, "Staf mengambil alih percakapan.");
  return c.json({ mode: "human" });
});

adminRoutes.post("/conversations/:conversationId/release", async (c) => {
  const conversation = await requireConversation(c.req.param("conversationId"));
  if (conversation.mode === "human") await returnToBot(conversation.id);
  return c.json({ mode: "bot" });
});

/** Balasan dari staf. Membalas percakapan yang masih dipegang bot otomatis mengambil alih percakapan itu. */
adminRoutes.post("/conversations/:conversationId/reply", async (c) => {
  const conversation = await requireConversation(c.req.param("conversationId"));
  const { text } = await readJson(c, StaffReply);

  // Dikirim dulu, baru disimpan: kalau saluran sedang terputus, staf tahu pesannya belum sampai.
  if (conversation.channel !== "web") {
    await channels.send(conversation.tenantId, conversation.channel, conversation.externalId, text);
  }
  if (conversation.mode === "bot") await handOffToStaff(conversation.id, null, "Staf mengambil alih percakapan.");
  const message = await addMessage(conversation.id, "agent", text);
  return c.json(serializeMessage(message, false), 201);
});

adminRoutes.delete("/conversations/:conversationId", async (c) => {
  const conversation = await requireConversation(c.req.param("conversationId"));
  await db.delete(conversations).where(eq(conversations.id, conversation.id));
  return c.json({ deleted: true });
});

// --- Coba bot ------------------------------------------------------------------

const TestMessage = z.object({
  sessionId: z.string().regex(/^[A-Za-z0-9_-]{8,40}$/),
  text: z.string().trim().min(1, "Pesan masih kosong.").max(2000, "Pesan terlalu panjang."),
});

/** Percakapan uji dari dashboard. Berjalan persis seperti widget web, ditambah daftar dokumen yang dibaca bot. */
adminRoutes.post("/tenants/:tenantId/test-chat", async (c) => {
  const tenant = await requireTenant(c.req.param("tenantId"));
  const { sessionId, text } = await readJson(c, TestMessage);
  return streamBotReply(
    c,
    { tenant, tenantId: tenant.id, channel: "web", externalId: `${TEST_PREFIX}${sessionId}`, customerName: "Uji coba", texts: [text], internal: true },
    { includeSources: true },
  );
});

/** Membersihkan percakapan uji lama supaya tidak menumpuk. */
adminRoutes.delete("/tenants/:tenantId/test-chat", async (c) => {
  const tenant = await requireTenant(c.req.param("tenantId"));
  await db.delete(conversations).where(and(eq(conversations.tenantId, tenant.id), like(conversations.externalId, `${TEST_PREFIX}%`)));
  return c.json({ deleted: true });
});

// --- Saluran -------------------------------------------------------------------

adminRoutes.get("/tenants/:tenantId/channels", async (c) => {
  const tenant = await requireTenant(c.req.param("tenantId"));
  return c.json({
    web: {
      snippet: `<script src="${env.PUBLIC_URL}/widget.js" data-key="${tenant.publicKey}" async></script>`,
      demoUrl: `${env.PUBLIC_URL}/demo/${tenant.publicKey}`,
    },
    telegram: channels.status(tenant.id, "telegram"),
    whatsapp: channels.status(tenant.id, "whatsapp"),
    discord: channels.status(tenant.id, "discord"),
  });
});

adminRoutes.post("/tenants/:tenantId/channels/:channel/connect", async (c) => {
  const tenant = await requireTenant(c.req.param("tenantId"));
  const channel = requireChannel(c.req.param("channel"));
  const { token } = await readJson(c, z.object({ token: z.string().max(200).optional() }));
  return c.json(await channels.connect(tenant.id, channel, token));
});

adminRoutes.post("/tenants/:tenantId/channels/:channel/disconnect", async (c) => {
  const tenant = await requireTenant(c.req.param("tenantId"));
  await channels.disconnect(tenant.id, requireChannel(c.req.param("channel")));
  return c.json({ state: "disconnected" });
});
