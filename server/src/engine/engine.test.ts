import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Conversation, Message, SourceRef, Tenant } from "../db/schema.js";
import { searchKnowledge, type SearchHit } from "../knowledge/search.js";
import type { CustomerIdentity } from "./conversations.js";
import { handleCustomerMessages, REPLY_FAILURE, REPLY_HANDOFF, REPLY_NOT_CONFIGURED, REPLY_REFUSAL } from "./engine.js";
import { LlmNotConfiguredError, LlmUnreachableError, type LlmCall, type LlmRequest, type LlmResponse } from "./llm.js";

// Database diganti penyimpanan di memori, supaya yang diuji murni alur bot: mencari, memanggil model, dan menyerahkan ke staf.
const store = vi.hoisted(() => ({
  conversations: new Map<string, Conversation>(),
  messages: [] as Message[],
}));

vi.mock("./conversations.js", () => {
  const byId = (id: string) => [...store.conversations.values()].find((conversation) => conversation.id === id);
  const addMessage = async (conversationId: string, role: Message["role"], content: string, sources?: SourceRef[]): Promise<Message> => {
    const message: Message = { id: store.messages.length + 1, conversationId, role, content, sources: sources?.length ? sources : null, createdAt: new Date() };
    store.messages.push(message);
    return message;
  };

  return {
    addMessage,
    async findOrCreateConversation(identity: CustomerIdentity): Promise<Conversation> {
      const key = `${identity.tenantId}:${identity.channel}:${identity.externalId}`;
      let conversation = store.conversations.get(key);
      if (!conversation) {
        conversation = {
          id: `percakapan-${store.conversations.size + 1}`,
          tenantId: identity.tenantId,
          channel: identity.channel,
          externalId: identity.externalId,
          customerName: identity.customerName ?? null,
          mode: "bot",
          handoffReason: null,
          lastMessageAt: new Date(),
          lastMessagePreview: "",
          lastMessageRole: null,
          createdAt: new Date(),
        };
        store.conversations.set(key, conversation);
      }
      return { ...conversation };
    },
    async getConversation(id: string): Promise<Conversation | null> {
      const conversation = byId(id);
      return conversation ? { ...conversation } : null;
    },
    async recentMessages(conversationId: string, limit: number): Promise<Message[]> {
      return store.messages.filter((message) => message.conversationId === conversationId).slice(-limit);
    },
    async handOffToStaff(conversationId: string, reason: string | null, note: string): Promise<void> {
      const conversation = byId(conversationId);
      if (conversation) Object.assign(conversation, { mode: "human", handoffReason: reason });
      await addMessage(conversationId, "event", note);
    },
  };
});

vi.mock("../knowledge/search.js", () => ({ searchKnowledge: vi.fn() }));
vi.mock("../lib/logger.js", () => ({ createLogger: () => ({ debug() {}, info() {}, warn() {}, error() {} }) }));

const search = vi.mocked(searchKnowledge);

const tenant: Tenant = {
  id: "bisnis-1",
  slug: "toko-uji",
  name: "Toko Uji",
  publicKey: "pk_uji",
  botName: "Rani",
  greeting: "Halo!",
  instructions: "",
  accentColor: "#14694F",
  createdAt: new Date(),
};

const incoming = (texts: string[], extra: { internal?: boolean } = {}) => ({ tenant, tenantId: tenant.id, channel: "web" as const, externalId: "pengunjung-1", texts, ...extra });
const hit = (documentId: string, title: string, content: string): SearchHit => ({ chunkId: `potongan-${documentId}`, documentId, title, content, score: 1 });

const text = (value: string) => ({ type: "text", text: value });
const toolUse = (name: string, input: unknown, id = "alat-1") => ({ type: "tool_use", id, name, input });
const reply = (content: unknown[], stopReason = "end_turn") => ({ content, stop_reason: stopReason, usage: {} }) as unknown as LlmResponse;

const onlyConversation = () => [...store.conversations.values()][0]!;
const roles = () => store.messages.map((message) => message.role);

beforeEach(() => {
  store.conversations.clear();
  store.messages.length = 0;
  search.mockReset();
  search.mockResolvedValue([]);
});

describe("handleCustomerMessages", () => {
  it("menjawab berdasarkan hasil pencarian dan mencatat dokumen sumbernya", async () => {
    search.mockResolvedValue([hit("d1", "Pengiriman", "Pengiriman\n\nOngkir Jawa Rp 12.000."), hit("d1", "Pengiriman", "Pengiriman\n\nEstimasi 2 hari.")]);
    const llm = vi.fn<LlmCall>().mockResolvedValue(reply([text("Ongkir ke Bandung Rp 12.000.")]));

    const outcome = await handleCustomerMessages(incoming(["Ongkir ke Bandung berapa?"]), {}, llm);

    expect(outcome.reply?.content).toBe("Ongkir ke Bandung Rp 12.000.");
    // Dua potongan dari dokumen yang sama dicatat sebagai satu sumber.
    expect(outcome.reply?.sources).toEqual([{ documentId: "d1", title: "Pengiriman" }]);
    expect(outcome.withStaff).toBe(false);
    expect(roles()).toEqual(["customer", "bot"]);

    expect(search).toHaveBeenCalledExactlyOnceWith(tenant.id, "Ongkir ke Bandung berapa?");
    const request = llm.mock.calls[0]![0];
    expect(request.system).toContain("Toko Uji");
    expect(request.messages.at(-1)).toMatchObject({ role: "user" });
    expect(request.messages.at(-1)?.content).toContain("Ongkir Jawa Rp 12.000.");
    expect(request.messages.at(-1)?.content).toContain("Pesan pelanggan:\nOngkir ke Bandung berapa?");
  });

  it("menjawab beberapa pesan beruntun sebagai satu pertanyaan", async () => {
    const llm = vi.fn<LlmCall>().mockResolvedValue(reply([text("Bisa, Kak.")]));

    const outcome = await handleCustomerMessages(incoming(["halo", "bisa kirim ke Bali?"]), {}, llm);

    expect(outcome.customerMessages.map((message) => message.content)).toEqual(["halo", "bisa kirim ke Bali?"]);
    expect(search).toHaveBeenCalledExactlyOnceWith(tenant.id, "halo\nbisa kirim ke Bali?");
    expect(llm).toHaveBeenCalledOnce();
  });

  it("menyertakan pesan sebelumnya saat mencari untuk pertanyaan lanjutan yang pendek", async () => {
    const llm = vi.fn<LlmCall>().mockResolvedValue(reply([text("Baik.")]));
    await handleCustomerMessages(incoming(["Berapa ongkos kirim ke Bandung?"]), {}, llm);
    search.mockClear();

    await handleCustomerMessages(incoming(["kalau ke Bali?"]), {}, llm);

    expect(search).toHaveBeenCalledExactlyOnceWith(tenant.id, "Berapa ongkos kirim ke Bandung?\nkalau ke Bali?");
  });

  it("mencari ulang ketika model memanggil alat pencarian", async () => {
    search.mockResolvedValueOnce([]).mockResolvedValueOnce([hit("d2", "Garansi", "Garansi\n\nBerlaku 1 tahun.")]);
    const llm = vi
      .fn<LlmCall>()
      .mockResolvedValueOnce(reply([toolUse("cari_pengetahuan", { kueri: "garansi produk" })], "tool_use"))
      .mockResolvedValueOnce(reply([text("Garansinya 1 tahun.")]));
    const onSearching = vi.fn();

    const outcome = await handleCustomerMessages(incoming(["Kalau rusak gimana?"]), { onSearching }, llm);

    expect(onSearching).toHaveBeenCalledOnce();
    expect(search).toHaveBeenLastCalledWith(tenant.id, "garansi produk");
    expect(outcome.reply?.content).toBe("Garansinya 1 tahun.");
    expect(outcome.reply?.sources).toEqual([{ documentId: "d2", title: "Garansi" }]);

    // Panggilan kedua membawa hasil alat sebagai giliran pengguna, tepat setelah giliran model.
    const messages = llm.mock.calls[1]![0].messages;
    expect(messages.at(-2)).toMatchObject({ role: "assistant" });
    expect(messages.at(-1)).toMatchObject({ role: "user", content: [{ type: "tool_result", tool_use_id: "alat-1", content: "[1] Garansi\n\nBerlaku 1 tahun." }] });
  });

  it("memberi tahu model bila pencarian ulang tidak menemukan apa pun atau kuerinya tidak valid", async () => {
    const llm = vi
      .fn<LlmCall>()
      .mockResolvedValueOnce(reply([toolUse("cari_pengetahuan", { kueri: "   " }, "alat-1"), toolUse("cari_pengetahuan", { kueri: "promo" }, "alat-2")], "tool_use"))
      .mockResolvedValueOnce(reply([text("Maaf, saya belum punya informasinya.")]));

    await handleCustomerMessages(incoming(["Ada promo?"]), {}, llm);

    const results = llm.mock.calls[1]![0].messages.at(-1)?.content;
    expect(results).toMatchObject([
      { tool_use_id: "alat-1", is_error: true },
      { tool_use_id: "alat-2", content: expect.stringContaining("Tidak ada hasil") },
    ]);
  });

  it("menyerahkan percakapan ke staf ketika model memanggil alat serah-terima", async () => {
    const llm = vi
      .fn<LlmCall>()
      .mockResolvedValueOnce(reply([text("Baik, saya teruskan."), toolUse("teruskan_ke_staf", { alasan: "Pelanggan minta refund pesanan #123." })], "tool_use"))
      .mockResolvedValueOnce(reply([text("Staf kami akan membalas di sini.")]));

    const outcome = await handleCustomerMessages(incoming(["Saya mau refund pesanan #123"]), {}, llm);

    expect(outcome.reply?.content).toBe("Baik, saya teruskan.\n\nStaf kami akan membalas di sini.");
    expect(outcome.withStaff).toBe(true);
    expect(outcome.conversation.mode).toBe("human");
    expect(onlyConversation()).toMatchObject({ mode: "human", handoffReason: "Pelanggan minta refund pesanan #123." });
    expect(roles()).toEqual(["customer", "bot", "event"]);
    expect(store.messages.at(-1)?.content).toContain("Pelanggan minta refund pesanan #123.");
  });

  it("memakai pesan bawaan bila model meneruskan tanpa menulis apa pun", async () => {
    const llm = vi
      .fn<LlmCall>()
      .mockResolvedValueOnce(reply([toolUse("teruskan_ke_staf", { alasan: "Minta bicara dengan manusia." })], "tool_use"))
      .mockResolvedValueOnce(reply([]));

    const outcome = await handleCustomerMessages(incoming(["Mau ngomong sama orang"]), {}, llm);

    expect(outcome.reply?.content).toBe(REPLY_HANDOFF);
    expect(outcome.withStaff).toBe(true);
  });

  it("diam selama percakapan ditangani staf", async () => {
    const llm = vi
      .fn<LlmCall>()
      .mockResolvedValueOnce(reply([toolUse("teruskan_ke_staf", { alasan: "Minta bicara dengan manusia." })], "tool_use"))
      .mockResolvedValueOnce(reply([text("Sudah saya teruskan.")]));
    await handleCustomerMessages(incoming(["Mau ngomong sama orang"]), {}, llm);
    llm.mockClear();
    search.mockClear();

    const outcome = await handleCustomerMessages(incoming(["Halo? Ada orang?"]), {}, llm);

    expect(outcome.reply).toBeNull();
    expect(outcome.withStaff).toBe(true);
    expect(outcome.customerMessages).toHaveLength(1);
    expect(llm).not.toHaveBeenCalled();
    expect(search).not.toHaveBeenCalled();
  });

  it("membuang jawaban bila staf mengambil alih selagi bot menulis", async () => {
    const llm: LlmCall = async () => {
      Object.assign(onlyConversation(), { mode: "human" });
      return reply([text("Jawaban yang sudah telanjur ditulis.")]);
    };

    const outcome = await handleCustomerMessages(incoming(["Ongkir?"]), {}, llm);

    expect(outcome.reply).toBeNull();
    expect(outcome.withStaff).toBe(true);
    expect(roles()).toEqual(["customer"]);
  });

  it("meminta maaf dan menyerahkan ke staf saat model gagal", async () => {
    const llm = vi.fn<LlmCall>().mockRejectedValue(new Error("529 overloaded"));

    const outcome = await handleCustomerMessages(incoming(["Ongkir?"]), {}, llm);

    expect(outcome.reply?.content).toBe(REPLY_FAILURE);
    expect(outcome.withStaff).toBe(true);
    expect(onlyConversation()).toMatchObject({ mode: "human", handoffReason: "Bot gagal menjawab karena gangguan sistem." });
  });

  it("berhenti setelah lima langkah bila model terus memanggil alat", async () => {
    const llm = vi.fn<LlmCall>().mockResolvedValue(reply([toolUse("cari_pengetahuan", { kueri: "lagi" })], "tool_use"));

    const outcome = await handleCustomerMessages(incoming(["Ongkir?"]), {}, llm);

    expect(llm).toHaveBeenCalledTimes(5);
    expect(outcome.reply?.content).toBe(REPLY_FAILURE);
    expect(outcome.withStaff).toBe(true);
  });

  it("tidak menjalankan panggilan alat yang terpotong batas token", async () => {
    const llm = vi.fn<LlmCall>().mockResolvedValue(reply([text("Sebagian jawaban"), toolUse("teruskan_ke_staf", { alasan: "terpotong" })], "max_tokens"));

    const outcome = await handleCustomerMessages(incoming(["Ongkir?"]), {}, llm);

    expect(llm).toHaveBeenCalledOnce();
    expect(outcome.reply?.content).toBe("Sebagian jawaban");
    expect(outcome.withStaff).toBe(false);
  });

  it("menjawab dengan penolakan sopan bila model menolak permintaan", async () => {
    const llm = vi.fn<LlmCall>().mockResolvedValue(reply([], "refusal"));

    const outcome = await handleCustomerMessages(incoming(["(permintaan yang ditolak model)"]), {}, llm);

    expect(outcome.reply?.content).toBe(REPLY_REFUSAL);
    expect(outcome.withStaff).toBe(false);
  });

  describe("saat pengaturan model AI belum benar", () => {
    const problem = "Kunci API ditolak oleh http://localhost:20128/v1 (401).";
    const llm = vi.fn<LlmCall>().mockRejectedValue(new LlmNotConfiguredError(problem));

    it("pelanggan mendapat permintaan maaf, bukan pesan teknis, dan percakapan diserahkan ke staf", async () => {
      const outcome = await handleCustomerMessages(incoming(["Ongkir?"]), {}, llm);

      expect(outcome.reply?.content).toBe(REPLY_FAILURE);
      expect(outcome.reply?.content).not.toContain("localhost");
      expect(outcome.withStaff).toBe(true);
      expect(onlyConversation().handoffReason).toContain("pengaturan model AI");
    });

    it("halaman Coba bot mendapat penjelasan teknisnya tanpa serah-terima", async () => {
      const outcome = await handleCustomerMessages(incoming(["Ongkir?"], { internal: true }), {}, llm);

      expect(outcome.reply?.content).toContain(REPLY_NOT_CONFIGURED);
      expect(outcome.reply?.content).toContain(problem);
      expect(outcome.reply?.content).toContain("LLM_");
      expect(outcome.withStaff).toBe(false);
      expect(onlyConversation().mode).toBe("bot");
    });

    it("halaman Coba bot juga diberi tahu bila server model tidak bisa dihubungi", async () => {
      const unreachable = vi.fn<LlmCall>().mockRejectedValue(new LlmUnreachableError("Tidak bisa menghubungi http://localhost:20128/v1."));

      const outcome = await handleCustomerMessages(incoming(["Ongkir?"], { internal: true }), {}, unreachable);

      expect(outcome.reply?.content).toContain("Tidak bisa menghubungi http://localhost:20128/v1.");
      expect(outcome.withStaff).toBe(false);
    });
  });

  it("meneruskan potongan teks ke pendengar dan memisahkan teks antar-langkah", async () => {
    const llm = vi
      .fn<LlmCall>()
      .mockImplementationOnce(async (request: LlmRequest) => {
        request.onText?.("Sebentar, ");
        request.onText?.("saya cek.");
        return reply([text("Sebentar, saya cek."), toolUse("cari_pengetahuan", { kueri: "ongkir" })], "tool_use");
      })
      .mockImplementationOnce(async (request: LlmRequest) => {
        request.onText?.("Rp 12.000.");
        return reply([text("Rp 12.000.")]);
      });
    const deltas: string[] = [];

    const outcome = await handleCustomerMessages(incoming(["Ongkir?"]), { onText: (delta) => deltas.push(delta) }, llm);

    expect(deltas).toEqual(["Sebentar, ", "saya cek.", "\n\n", "Rp 12.000."]);
    expect(deltas.join("")).toBe(outcome.reply?.content);
  });
});
