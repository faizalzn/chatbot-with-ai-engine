const LAST_TENANT = "sahut:bisnis-terakhir";

/** Penyimpanan peramban bisa diblokir. Dashboard tetap berjalan tanpanya, hanya tidak mengingat pilihan terakhir. */
export function rememberTenant(tenantId: string): void {
  try {
    localStorage.setItem(LAST_TENANT, tenantId);
  } catch {
    // Tidak apa-apa: pilihan terakhir sekadar kenyamanan.
  }
}

export function lastTenant(): string | null {
  try {
    return localStorage.getItem(LAST_TENANT);
  } catch {
    return null;
  }
}

const ID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

export function randomId(length = 16): string {
  let id = "";
  for (const byte of crypto.getRandomValues(new Uint8Array(length))) id += ID_ALPHABET[byte % ID_ALPHABET.length];
  return id;
}
