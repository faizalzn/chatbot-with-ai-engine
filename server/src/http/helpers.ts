import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";
import type { z } from "zod";
import type { Conversation, Message } from "../db/schema.js";
import { env } from "../env.js";
import { UserFacingError } from "../lib/errors.js";

/** Membaca isi permintaan JSON dan memeriksanya. Pesan kesalahan skema ditulis untuk dibaca pengguna. */
export async function readJson<Schema extends z.ZodType>(c: Context, schema: Schema): Promise<z.infer<Schema>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new UserFacingError("Permintaan tidak bisa dibaca.");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new UserFacingError(parsed.error.issues[0]?.message ?? "Data tidak valid.");
  return parsed.data;
}

export function clientIp(c: Context): string {
  if (env.TRUST_PROXY) {
    const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
    if (forwarded) return forwarded;
  }
  return getConnInfo(c).remote.address ?? "tidak-dikenal";
}

/** Percakapan uji coba dari halaman "Coba bot" memakai awalan ini dan tidak tampil di kotak masuk. */
export const TEST_PREFIX = "uji:";

/** Nama yang ditampilkan untuk pelanggan ketika salurannya tidak memberi nama. */
export function displayName(conversation: Pick<Conversation, "channel" | "externalId" | "customerName">): string {
  if (conversation.customerName) return conversation.customerName;
  switch (conversation.channel) {
    case "web":
      return `Pengunjung web ${conversation.externalId.slice(-4).toUpperCase()}`;
    case "whatsapp": {
      const number = /^(\d+)@s\.whatsapp\.net$/.exec(conversation.externalId)?.[1];
      return number ? `+${number}` : "Pengguna WhatsApp";
    }
    case "telegram":
      return "Pengguna Telegram";
    case "discord":
      return "Pengguna Discord";
  }
}

export function serializeMessage(message: Message, includeSources: boolean) {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    createdAt: message.createdAt,
    ...(includeSources && message.sources ? { sources: message.sources } : {}),
  };
}
