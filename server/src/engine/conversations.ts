import { and, desc, eq, gt, ne, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { conversations, messages, type Channel, type Conversation, type Message, type MessageRole, type SourceRef } from "../db/schema.js";

export interface CustomerIdentity {
  tenantId: string;
  channel: Channel;
  externalId: string;
  customerName?: string | null;
}

/** Mengambil percakapan pelanggan ini, atau membuatnya bila ini pesan pertamanya. */
export async function findOrCreateConversation(identity: CustomerIdentity): Promise<Conversation> {
  const name = identity.customerName?.trim().slice(0, 80) || null;
  const [conversation] = await db
    .insert(conversations)
    .values({ tenantId: identity.tenantId, channel: identity.channel, externalId: identity.externalId, customerName: name })
    .onConflictDoUpdate({
      target: [conversations.tenantId, conversations.channel, conversations.externalId],
      set: { customerName: sql`COALESCE(${name}, ${conversations.customerName})` },
    })
    .returning();
  return conversation!;
}

export async function findConversation(identity: Omit<CustomerIdentity, "customerName">): Promise<Conversation | null> {
  const [conversation] = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.tenantId, identity.tenantId),
        eq(conversations.channel, identity.channel),
        eq(conversations.externalId, identity.externalId),
      ),
    );
  return conversation ?? null;
}

export async function getConversation(id: string): Promise<Conversation | null> {
  const [conversation] = await db.select().from(conversations).where(eq(conversations.id, id));
  return conversation ?? null;
}

function preview(content: string): string {
  const oneLine = content.replace(/\s+/g, " ").trim();
  return oneLine.length > 140 ? `${oneLine.slice(0, 139)}…` : oneLine;
}

/** Menyimpan pesan dan memperbarui ringkasan percakapan untuk daftar di dashboard. */
export async function addMessage(conversationId: string, role: MessageRole, content: string, sources?: SourceRef[]): Promise<Message> {
  return db.transaction(async (tx) => {
    const [message] = await tx
      .insert(messages)
      .values({ conversationId, role, content, sources: sources?.length ? sources : null })
      .returning();
    if (role !== "event") {
      await tx
        .update(conversations)
        .set({ lastMessageAt: message!.createdAt, lastMessagePreview: preview(content), lastMessageRole: role })
        .where(eq(conversations.id, conversationId));
    }
    return message!;
  });
}

/** Pesan terbaru dalam urutan lama ke baru. */
export async function recentMessages(conversationId: string, limit: number): Promise<Message[]> {
  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.id))
    .limit(limit);
  return rows.reverse();
}

/** Pesan yang terlihat pelanggan (tanpa catatan internal) setelah ID tertentu. Dipakai widget web. */
export async function customerVisibleMessagesAfter(conversationId: string, afterId: number): Promise<Message[]> {
  return db
    .select()
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), gt(messages.id, afterId), ne(messages.role, "event")))
    .orderBy(messages.id)
    .limit(200);
}

/** Menyerahkan percakapan ke staf: bot berhenti menjawab sampai staf mengembalikannya. */
export async function handOffToStaff(conversationId: string, reason: string | null, note: string): Promise<void> {
  await db.update(conversations).set({ mode: "human", handoffReason: reason }).where(eq(conversations.id, conversationId));
  await addMessage(conversationId, "event", note);
}

export async function returnToBot(conversationId: string): Promise<void> {
  await db.update(conversations).set({ mode: "bot", handoffReason: null }).where(eq(conversations.id, conversationId));
  await addMessage(conversationId, "event", "Staf mengembalikan percakapan ke bot.");
}
