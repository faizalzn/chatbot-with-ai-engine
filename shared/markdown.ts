/**
 * Pengurai Markdown ringkas untuk gelembung chat: paragraf, daftar, tebal, miring, kode, dan tautan.
 *
 * Hasilnya pohon data, bukan HTML. Penampil (widget dan dashboard) membuat elemennya sendiri
 * dari pohon ini, sehingga teks dari bot, staf, atau pelanggan tidak pernah dijalankan sebagai HTML.
 */

export type Inline =
  | { type: "text"; text: string }
  | { type: "break" }
  | { type: "bold"; children: Inline[] }
  | { type: "italic"; children: Inline[] }
  | { type: "code"; text: string }
  | { type: "link"; href: string; text: string };

export type Block =
  | { type: "paragraph"; children: Inline[] }
  | { type: "list"; ordered: boolean; start: number; items: Inline[][] };

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*(\d{1,3})[.)]\s+(.*)$/;
const HEADING = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/;
const CONTINUATION = /^\s{2,}\S/;

// Urutan menentukan prioritas: kode, tautan [teks](alamat), **tebal**, *miring*, lalu alamat web polos.
const TOKEN = new RegExp(
  [
    "`([^`\\n]+)`",
    "\\[([^\\]\\n]+)\\]\\(([^)\\s]+)\\)",
    "\\*\\*([^\\s*](?:[^\\n]*?[^\\s*])?)\\*\\*",
    "\\*([^\\s*](?:[^*\\n]*[^\\s*])?)\\*",
    "(https?:\\/\\/[^\\s<>()\\[\\]]*[^\\s<>()\\[\\].,!?;:'\"*])",
  ].join("|"),
  "g",
);

/** Hanya alamat web, email, dan telepon yang boleh menjadi tautan. Skema lain (mis. javascript:) ditolak. */
export function safeHref(raw: string): string | null {
  const href = raw.trim();
  return /^(https?:\/\/|mailto:|tel:)/i.test(href) ? href : null;
}

function pushText(out: Inline[], text: string): void {
  text.split("\n").forEach((line, index) => {
    if (index > 0) out.push({ type: "break" });
    if (line) out.push({ type: "text", text: line });
  });
}

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let cursor = 0;

  for (const match of text.matchAll(TOKEN)) {
    const [whole, code, linkText, linkTarget, bold, italic, bareUrl] = match;
    const index = match.index ?? 0;
    pushText(out, text.slice(cursor, index));
    cursor = index + whole.length;

    if (code !== undefined) out.push({ type: "code", text: code });
    else if (linkText !== undefined && linkTarget !== undefined) {
      const href = safeHref(linkTarget);
      if (href) out.push({ type: "link", href, text: linkText });
      else pushText(out, whole);
    } else if (bold !== undefined) out.push({ type: "bold", children: parseInline(bold) });
    else if (italic !== undefined) out.push({ type: "italic", children: parseInline(italic) });
    else if (bareUrl !== undefined) out.push({ type: "link", href: bareUrl, text: bareUrl });
  }

  pushText(out, text.slice(cursor));
  return out;
}

export function parseMarkdown(source: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; start: number; items: string[] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ type: "paragraph", children: parseInline(paragraph.join("\n")) });
    paragraph = [];
  };
  const flushList = () => {
    if (list) blocks.push({ type: "list", ordered: list.ordered, start: list.start, items: list.items.map(parseInline) });
    list = null;
  };

  for (const line of source.replace(/\r\n?/g, "\n").split("\n")) {
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }

    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    if (bullet || numbered) {
      flushParagraph();
      const ordered = !bullet;
      if (list && list.ordered !== ordered) flushList();
      list ??= { ordered, start: numbered ? Number(numbered[1]) : 1, items: [] };
      list.items.push((bullet ? bullet[1] : numbered?.[2]) ?? "");
      continue;
    }

    // Baris menjorok setelah butir daftar adalah lanjutan butir itu.
    if (list && CONTINUATION.test(line)) {
      list.items[list.items.length - 1] += `\n${line.trim()}`;
      continue;
    }
    flushList();

    // Bot diminta tidak memakai judul. Kalau tetap muncul, tampilkan sebagai baris tebal.
    const heading = HEADING.exec(line);
    if (heading) {
      flushParagraph();
      blocks.push({ type: "paragraph", children: [{ type: "bold", children: parseInline(heading[1] ?? "") }] });
      continue;
    }

    paragraph.push(line.trim());
  }

  flushParagraph();
  flushList();
  return blocks;
}
