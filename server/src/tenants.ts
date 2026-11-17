import { eq, or } from "drizzle-orm";
import { db } from "./db/index.js";
import { tenants, type Tenant } from "./db/schema.js";
import { randomToken } from "./lib/crypto.js";

export interface NewTenant {
  name: string;
  slug?: string;
  botName?: string;
  greeting?: string;
  instructions?: string;
  accentColor?: string;
}

export function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "bisnis";
}

async function uniqueSlug(base: string): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    const candidate = attempt === 1 ? base : `${base}-${attempt}`;
    const [existing] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, candidate));
    if (!existing) return candidate;
  }
}

export async function createTenant(input: NewTenant): Promise<Tenant> {
  const name = input.name.trim();
  const [tenant] = await db
    .insert(tenants)
    .values({
      name,
      slug: await uniqueSlug(slugify(input.slug ?? name)),
      publicKey: `pk_${randomToken(15)}`,
      botName: input.botName?.trim() || "Asisten",
      greeting: input.greeting?.trim() || `Halo! Saya asisten ${name}. Ada yang bisa saya bantu?`,
      instructions: input.instructions?.trim() ?? "",
      ...(input.accentColor ? { accentColor: input.accentColor } : {}),
    })
    .returning();
  return tenant!;
}

export async function findTenantBySlugOrName(value: string): Promise<Tenant | null> {
  const [tenant] = await db
    .select()
    .from(tenants)
    .where(or(eq(tenants.slug, slugify(value)), eq(tenants.name, value.trim())));
  return tenant ?? null;
}

export async function findTenantByPublicKey(publicKey: string): Promise<Tenant | null> {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.publicKey, publicKey));
  return tenant ?? null;
}

export async function findTenantById(id: string): Promise<Tenant | null> {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, id));
  return tenant ?? null;
}
