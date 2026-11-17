import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { Conversation, Message, SourceRef, Tenant } from "../db/schema.js";
import { searchKnowledge, type SearchHit } from "../knowledge/search.js";
import { createLogger } from "../lib/logger.js";
import { withLock } from "../lib/locks.js";
import {
  addMessage,
  findOrCreateConversation,
  getConversation,
  handOffToStaff,
  recentMessages,
  type CustomerIdentity,
} from "./conversations.js";
import { callModel, LlmNotConfiguredError, LlmRequestError, LlmUnreachableError, type LlmCall, type LlmMessageParam } from "./llm.js";
import { buildLatestTurn, buildSystemPrompt, buildTurns, formatHits, HANDOFF_TOOL, SEARCH_TOOL, TOOLS } from "./prompt.js";

const log = createLogger("bot");

/** Jumlah pesan terakhir yang dikirim ke model sebagai konteks. */
const HISTORY_LIMIT = 24;
/** Batas bolak-balik model dan alat dalam satu jawaban, supaya tidak berputar tanpa henti. */
const MAX_STEPS = 5;
/** Dokumen sumber yang ditampilkan ke staf per jawaban. */
const MAX_SOURCES = 4;

export const REPLY_HANDOFF = "Baik, percakapan ini saya teruskan ke staf kami. Mohon ditunggu, staf akan membalas di sini.";
export const REPLY_FAILURE = "Maaf, sedang ada gangguan di sistem kami. Pesan Anda sudah kami terima dan staf kami akan membantu secepatnya.";
export const REPLY_REFUSAL = "Maaf, saya tidak bisa membantu untuk permintaan itu. Ada hal lain yang bisa saya bantu?";
/** Hanya tampil di halaman "Coba bot", tidak pernah ke pelanggan. */
export const REPLY_NOT_CONFIGURED = "Bot belum bisa menjawab karena sambungan ke model AI bermasalah:";
const FIX_HINT = "Periksa pengaturan LLM_ di file .env, lalu nyalakan ulang server.";

/** Kesalahan yang berasal dari sambungan ke model, bukan dari bagian lain sistem. */
const isModelError = (error: unknown): error is Error =>
  error instanceof LlmNotConfiguredError || error instanceof LlmUnreachableError || error instanceof LlmRequestError;

const SearchInput = z.object({ kueri: z.string().trim().min(1) });
const HandoffInput = z.object({ alasan: z.string().trim().min(1) });

export interface ReplyListener {
  /** Potongan teks jawaban saat sedang ditulis model. */
  onText?: (delta: string) => void;
  /** Bot sedang mencari lagi di basis pengetahuan. */
  onSearching?: () => void;
}

interface Draft {
  text: string;
  sources: SourceRef[];
  handoffReason: string | null;
}

/** Menyusun jawaban untuk pesan pelanggan yang belum dijawab. Tidak menyimpan apa pun. */
async function draftReply(tenant: Tenant, conversation: Conversation, listener: ReplyListener, llm: LlmCall): Promise<Draft | null> {
  const turns = buildTurns(await recentMessages(conversation.id, HISTORY_LIMIT));
  if (!turns) return null;

  const seen = new Map<string, string>();
  const remember = (hits: SearchHit[]) => {
    for (const hit of hits) if (!seen.has(hit.documentId)) seen.set(hit.documentId, hit.title);
  };

  // Pertanyaan lanjutan yang pendek ("kalau ke Bali?") sulit dicari sendirian, jadi pesan sebelumnya ikut disertakan.
  const searchQuery = turns.pending.length < 40 && turns.previousCustomerText ? `${turns.previousCustomerText}\n${turns.pending}` : turns.pending;
  const initialHits = await searchKnowledge(tenant.id, searchQuery);
  remember(initialHits);

  const system = buildSystemPrompt(tenant, conversation.channel);
  const messages: LlmMessageParam[] = [...turns.earlier, { role: "user", content: buildLatestTurn(turns.pending, initialHits) }];

  const parts: string[] = [];
  let handoffReason: string | null = null;

  for (let step = 0; step < MAX_STEPS; step++) {
    let started = false;
    const response = await llm({
      system,
      messages,
      tools: TOOLS,
      onText: (delta) => {
        // Teks dari langkah berbeda (sebelum dan sesudah mencari) dipisah satu baris kosong.
        if (!started && parts.length > 0) listener.onText?.("\n\n");
        started = true;
        listener.onText?.(delta);
      },
    });
    log.debug(`langkah ${step + 1}: ${response.stop_reason}`, response.usage);

    if (response.stop_reason === "refusal") return { text: REPLY_REFUSAL, sources: [], handoffReason: null };

    const text = response.content
      .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();
    if (text) parts.push(text);

    const toolUses = response.content.filter((block): block is Anthropic.Beta.BetaToolUseBlock => block.type === "tool_use");
    // Panggilan alat yang terpotong batas token tidak boleh dijalankan karena isinya bisa tidak lengkap.
    if (response.stop_reason !== "tool_use" || toolUses.length === 0) break;

    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const use of toolUses) {
      if (use.name === SEARCH_TOOL) {
        const input = SearchInput.safeParse(use.input);
        if (!input.success) {
          results.push({ type: "tool_result", tool_use_id: use.id, is_error: true, content: "Kueri kosong atau tidak valid." });
          continue;
        }
        listener.onSearching?.();
        const hits = await searchKnowledge(tenant.id, input.data.kueri);
        remember(hits);
        results.push({
          type: "tool_result",
          tool_use_id: use.id,
          content: hits.length ? formatHits(hits) : "Tidak ada hasil. Coba kata kunci lain, atau sampaikan bahwa informasinya belum tersedia.",
        });
      } else if (use.name === HANDOFF_TOOL) {
        const input = HandoffInput.safeParse(use.input);
        handoffReason = input.success ? input.data.alasan : "Pelanggan perlu dibantu staf.";
        results.push({
          type: "tool_result",
          tool_use_id: use.id,
          content: "Percakapan sudah diteruskan ke staf. Tutup dengan satu pesan singkat untuk pelanggan.",
        });
      } else {
        results.push({ type: "tool_result", tool_use_id: use.id, is_error: true, content: `Alat "${use.name}" tidak tersedia.` });
      }
    }

    // Isi balasan model dikembalikan apa adanya (termasuk blok berpikirnya), sesuai ketentuan API untuk pemakaian alat.
    messages.push({ role: "assistant", content: response.content }, { role: "user", content: results });
  }

  const text = parts.join("\n\n").trim() || (handoffReason ? REPLY_HANDOFF : "");
  if (!text) throw new Error("Model tidak menghasilkan jawaban");

  const sources = [...seen].slice(0, MAX_SOURCES).map(([documentId, title]) => ({ documentId, title }));
  return { text, sources, handoffReason };
}

export interface IncomingMessages extends CustomerIdentity {
  tenant: Tenant;
  /** Satu atau beberapa pesan beruntun dari pelanggan yang sama. */
  texts: string[];
  /** Pesan uji dari dashboard, bukan dari pelanggan. Kesalahan pemasangan boleh dijelaskan apa adanya. */
  internal?: boolean;
}

export interface TurnOutcome {
  conversation: Conversation;
  customerMessages: Message[];
  /** Balasan bot yang sudah tersimpan. Kosong bila staf yang sedang menangani percakapan ini. */
  reply: Message | null;
  /** True bila percakapan ini sekarang ditangani staf. */
  withStaff: boolean;
}

/**
 * Pintu masuk tunggal untuk pesan pelanggan dari semua saluran: menyimpan pesan,
 * lalu menjawab dengan bot kecuali percakapan sedang ditangani staf.
 */
export function handleCustomerMessages(input: IncomingMessages, listener: ReplyListener = {}, llm: LlmCall = callModel): Promise<TurnOutcome> {
  const lockKey = `${input.tenantId}:${input.channel}:${input.externalId}`;

  return withLock(lockKey, async () => {
    const conversation = await findOrCreateConversation(input);
    const customerMessages: Message[] = [];
    for (const text of input.texts) customerMessages.push(await addMessage(conversation.id, "customer", text));

    if (conversation.mode === "human") return { conversation, customerMessages, reply: null, withStaff: true };

    let draft: Draft | null;
    try {
      draft = await draftReply(input.tenant, conversation, listener, llm);
    } catch (error) {
      const modelError = isModelError(error);
      if (modelError) log.error(`Bot tidak bisa menjawab: ${error.message}`);
      else log.error(`Bot gagal menjawab percakapan ${conversation.id}`, error);

      // Di halaman "Coba bot", pemilik perlu tahu penyebab teknisnya, dan tidak ada pelanggan yang perlu ditolong staf.
      if (modelError && input.internal) {
        const hint = error instanceof LlmNotConfiguredError ? ` ${FIX_HINT}` : "";
        const reply = await addMessage(conversation.id, "bot", `${REPLY_NOT_CONFIGURED} ${error.message}${hint}`);
        return { conversation, customerMessages, reply, withStaff: false };
      }

      // Pelanggan tidak boleh dibiarkan tanpa jawaban, dan tidak perlu tahu urusan teknisnya. Minta maaf dan serahkan ke staf.
      const reason =
        error instanceof LlmNotConfiguredError
          ? "Bot tidak bisa menjawab karena pengaturan model AI belum benar (kunci API, alamat, atau nama model)."
          : "Bot gagal menjawab karena gangguan sistem.";
      const reply = await addMessage(conversation.id, "bot", REPLY_FAILURE);
      await handOffToStaff(conversation.id, reason, `${reason} Percakapan diserahkan ke staf.`);
      return { conversation: { ...conversation, mode: "human" }, customerMessages, reply, withStaff: true };
    }

    // Staf bisa saja mengambil alih selagi bot menyusun jawaban. Kalau begitu, jawaban bot dibuang.
    const current = await getConversation(conversation.id);
    if (!draft || !current || current.mode === "human") {
      return { conversation: current ?? conversation, customerMessages, reply: null, withStaff: current?.mode === "human" };
    }

    const reply = await addMessage(conversation.id, "bot", draft.text, draft.sources);
    if (draft.handoffReason) {
      await handOffToStaff(conversation.id, draft.handoffReason, `Bot meneruskan percakapan ke staf. ${draft.handoffReason}`);
      return { conversation: { ...current, mode: "human" }, customerMessages, reply, withStaff: true };
    }
    return { conversation: current, customerMessages, reply, withStaff: false };
  });
}
