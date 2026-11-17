import { sql } from "drizzle-orm";
import { bigint, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, vector } from "drizzle-orm/pg-core";

/** Ukuran vektor dari model embedding (multilingual-e5-small). Ganti model = ganti angka ini + migrasi. */
export const EMBEDDING_DIMENSIONS = 384;

export const CHANNELS = ["web", "telegram", "whatsapp", "discord"] as const;
export type Channel = (typeof CHANNELS)[number];

/** Saluran yang butuh sambungan (token atau pindai QR). Web selalu aktif lewat widget. */
export const CONNECTABLE_CHANNELS = ["telegram", "whatsapp", "discord"] as const;
export type ConnectableChannel = (typeof CONNECTABLE_CHANNELS)[number];

export interface SourceRef {
  documentId: string;
  title: string;
}

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

/** Satu bisnis (klien). Semua data lain menggantung ke sini lewat tenant_id. */
export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  /** Kunci publik yang dipakai widget di website. Bukan rahasia. */
  publicKey: text("public_key").notNull().unique(),
  botName: text("bot_name").notNull(),
  greeting: text("greeting").notNull(),
  /** Aturan tambahan dari bisnis: gaya bahasa, hal yang harus atau tidak boleh dilakukan. */
  instructions: text("instructions").notNull().default(""),
  accentColor: text("accent_color").notNull().default("#14694F"),
  createdAt: createdAt(),
});

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    fileName: text("file_name"),
    content: text("content").notNull(),
    status: text("status", { enum: ["processing", "ready", "failed"] })
      .notNull()
      .default("processing"),
    error: text("error"),
    chunkCount: integer("chunk_count").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("documents_tenant_idx").on(t.tenantId)],
);

/** Potongan dokumen beserta vektornya. Inilah isi "vector database" tiap bisnis. */
export const chunks = pgTable(
  "chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }).notNull(),
  },
  (t) => [
    index("chunks_tenant_idx").on(t.tenantId),
    index("chunks_document_idx").on(t.documentId),
    index("chunks_fts_idx").using("gin", sql`to_tsvector('indonesian', ${t.content})`),
  ],
);

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    channel: text("channel", { enum: CHANNELS }).notNull(),
    /** ID pelanggan di salurannya: ID pengunjung web, chat ID Telegram, nomor WhatsApp, dst. */
    externalId: text("external_id").notNull(),
    customerName: text("customer_name"),
    /** "bot": bot yang menjawab. "human": staf yang menjawab, bot diam. */
    mode: text("mode", { enum: ["bot", "human"] })
      .notNull()
      .default("bot"),
    handoffReason: text("handoff_reason"),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
    lastMessagePreview: text("last_message_preview").notNull().default(""),
    lastMessageRole: text("last_message_role", { enum: ["customer", "bot", "agent"] }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("conversations_identity_idx").on(t.tenantId, t.channel, t.externalId),
    index("conversations_recent_idx").on(t.tenantId, t.lastMessageAt),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    /** "event" adalah catatan di linimasa (mis. "diteruskan ke staf"), tidak dikirim ke pelanggan. */
    role: text("role", { enum: ["customer", "bot", "agent", "event"] }).notNull(),
    content: text("content").notNull(),
    /** Dokumen yang dipakai bot untuk menjawab, supaya staf bisa memeriksa asal jawabannya. */
    sources: jsonb("sources").$type<SourceRef[]>(),
    createdAt: createdAt(),
  },
  (t) => [index("messages_conversation_idx").on(t.conversationId, t.id)],
);

export const channelConnections = pgTable(
  "channel_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    channel: text("channel", { enum: CONNECTABLE_CHANNELS }).notNull(),
    /** Token bot, terenkripsi. Kosong untuk WhatsApp (sesinya disimpan sebagai berkas). */
    secret: text("secret"),
    /** Sidik jari token, supaya satu bot tidak tersambung ke dua bisnis sekaligus. */
    fingerprint: text("fingerprint").unique(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("channel_connections_unique_idx").on(t.tenantId, t.channel)],
);

export type Tenant = typeof tenants.$inferSelect;
export type DocumentRow = typeof documents.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type MessageRole = Message["role"];
