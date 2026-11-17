/**
 * Memotong dokumen menjadi potongan kecil yang masing-masing bisa dipahami sendiri.
 *
 * Tiap potongan diawali judul dokumen dan jalur sub-judulnya ("FAQ › Pengiriman › Ongkir"),
 * supaya pencarian dan model tetap tahu konteksnya walau potongan dibaca terpisah.
 */

/** Ukuran yang dituju per potongan. Cukup kecil untuk pencarian yang tajam, cukup besar untuk satu topik utuh. */
const TARGET_CHARS = 900;
/** Batas keras. Model embedding memotong teks di atas ±512 token, jadi potongan tidak boleh melewatinya. */
const MAX_CHARS = 1400;

interface Section {
  path: string[];
  body: string;
}

export function chunkDocument(title: string, rawText: string): string[] {
  const chunks: string[] = [];
  for (const section of splitSections(normalize(rawText), title)) {
    const label = [title.trim(), ...section.path].filter(Boolean).join(" › ");
    for (const piece of pack(splitBlocks(section.body).flatMap(splitOversized), "\n\n")) {
      chunks.push(label ? `${label}\n\n${piece}` : piece);
    }
  }
  return chunks;
}

function normalize(text: string): string {
  return text
    .replace(/^﻿/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t ]/g, " ")
    .replace(/[ ]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Memecah teks berdasarkan sub-judul Markdown (#, ##, ...). Teks tanpa sub-judul menjadi satu bagian. */
function splitSections(text: string, title: string): Section[] {
  const sections: Section[] = [];
  const stack: { level: number; text: string }[] = [];
  let body: string[] = [];

  const flush = () => {
    const content = body.join("\n").trim();
    if (content) sections.push({ path: stack.map((heading) => heading.text), body: content });
    body = [];
  };

  for (const line of text.split("\n")) {
    const heading = /^(#{1,6})\s+(.+?)\s*#*$/.exec(line);
    if (!heading) {
      body.push(line);
      continue;
    }
    flush();
    const level = heading[1]!.length;
    const headingText = heading[2]!.replace(/[*_`]/g, "").trim();
    while (stack.length && stack[stack.length - 1]!.level >= level) stack.pop();
    // Sub-judul teratas yang sama dengan judul dokumen tidak perlu diulang di jalur.
    const repeatsTitle = stack.length === 0 && headingText.toLowerCase() === title.trim().toLowerCase();
    stack.push({ level, text: repeatsTitle ? "" : headingText });
  }
  flush();

  return sections.map((section) => ({ ...section, path: section.path.filter(Boolean) }));
}

function splitBlocks(body: string): string[] {
  return body
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
}

/** Blok yang terlalu panjang dipecah per baris, lalu per kalimat. Tabel dipecah per baris dengan kepala tabel diulang. */
function splitOversized(block: string): string[] {
  if (block.length <= MAX_CHARS) return [block];

  const lines = block.split("\n");
  const isTable = lines.length > 2 && lines[0]!.trim().startsWith("|") && /^\|?[\s:|-]+\|?$/.test(lines[1]!.trim());
  if (isTable) {
    const header = `${lines[0]}\n${lines[1]}`;
    return pack(lines.slice(2), "\n", TARGET_CHARS - header.length).map((rows) => `${header}\n${rows}`);
  }

  const units = lines.flatMap((line) => (line.length <= MAX_CHARS ? [line] : splitSentences(line)));
  return pack(units, "\n");
}

function splitSentences(text: string): string[] {
  const sentences = text.split(/(?<=[.!?])\s+/).flatMap((sentence) => {
    if (sentence.length <= MAX_CHARS) return [sentence];
    // Tidak ada tanda baca sama sekali: potong di spasi terdekat.
    const parts: string[] = [];
    let rest = sentence;
    while (rest.length > MAX_CHARS) {
      const cut = rest.lastIndexOf(" ", MAX_CHARS);
      const at = cut > MAX_CHARS / 2 ? cut : MAX_CHARS;
      parts.push(rest.slice(0, at).trim());
      rest = rest.slice(at).trim();
    }
    if (rest) parts.push(rest);
    return parts;
  });
  return pack(sentences, " ");
}

/** Menggabungkan unit-unit berurutan selama hasilnya belum melewati ukuran yang dituju. */
function pack(units: string[], separator: string, target = TARGET_CHARS): string[] {
  const packed: string[] = [];
  let current = "";
  for (const unit of units) {
    if (!unit.trim()) continue;
    if (!current) current = unit;
    else if (current.length + separator.length + unit.length <= target) current += separator + unit;
    else {
      packed.push(current);
      current = unit;
    }
  }
  if (current) packed.push(current);
  return packed;
}
