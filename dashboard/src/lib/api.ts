import { QueryClient } from "@tanstack/react-query";
import { errorMessage, type ChatMessage } from "../../../shared/reply-stream";

export type { ChatMessage, ChatSource } from "../../../shared/reply-stream";

export type Channel = "web" | "telegram" | "whatsapp" | "discord";
export type ConnectableChannel = Exclude<Channel, "web">;

export interface SystemStatus {
  botReady: boolean;
  /** Apa yang kurang di pengaturan model AI, bila bot belum siap. */
  problem: string | null;
  model: string | null;
  provider: "anthropic" | "openai";
  /** Model dan alamat yang dipakai, misalnya "cx/gpt-5.6-luna lewat http://localhost:20128/v1 (format OpenAI)". */
  description: string;
}

export interface TenantSummary {
  id: string;
  name: string;
  accentColor: string;
  /** Jumlah percakapan yang menunggu balasan staf. */
  waiting: number;
}

export interface Tenant {
  id: string;
  name: string;
  publicKey: string;
  botName: string;
  greeting: string;
  instructions: string;
  accentColor: string;
}

export interface DocumentSummary {
  id: string;
  title: string;
  fileName: string | null;
  status: "processing" | "ready" | "failed";
  error: string | null;
  chunkCount: number;
  length: number;
  updatedAt: string;
}

export interface DocumentDetail {
  id: string;
  title: string;
  fileName: string | null;
  content: string;
  status: DocumentSummary["status"];
}

export interface ConversationSummary {
  id: string;
  channel: Channel;
  name: string;
  mode: "bot" | "human";
  /** Staf yang menangani, dan pesan terakhir belum dibalas staf. */
  waiting: boolean;
  handoffReason: string | null;
  preview: string;
  lastRole: "customer" | "bot" | "agent" | null;
  lastAt: string;
}

export interface ConversationDetail extends ConversationSummary {
  messages: ChatMessage[];
}

export type ChannelStatus =
  | { state: "disconnected" }
  | { state: "connecting" }
  | { state: "qr"; qr: string }
  | { state: "connected"; label: string; link?: string }
  | { state: "error"; message: string };

export interface ChannelsInfo {
  web: { snippet: string; demoUrl: string };
  telegram: ChannelStatus;
  whatsapp: ChannelStatus;
  discord: ChannelStatus;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 2000,
      // Kesalahan dari server (mis. "tidak ditemukan") tidak akan berubah bila diulang. Hanya gangguan jaringan yang dicoba lagi.
      retry: (failures, error) => failures < 2 && error instanceof ApiError && error.status === 0,
    },
  },
});

export const SESSION_KEY = ["session"] as const;

/** Server menolak permintaan lintas situs yang tidak membawa header ini. */
const CLIENT_HEADERS = { "x-sahut-client": "dashboard" };

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  form?: FormData;
}

/** Memanggil API dan mengembalikan `Response` mentah. Dipakai langsung hanya untuk jawaban yang dialirkan. */
export async function send(path: string, options: RequestOptions = {}): Promise<Response> {
  const hasBody = options.body !== undefined;
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method: options.method ?? (hasBody || options.form ? "POST" : "GET"),
      credentials: "same-origin",
      headers: hasBody ? { ...CLIENT_HEADERS, "Content-Type": "application/json" } : CLIENT_HEADERS,
      body: options.form ?? (hasBody ? JSON.stringify(options.body) : undefined),
    });
  } catch {
    throw new ApiError("Tidak bisa terhubung ke server. Periksa koneksi internet, lalu coba lagi.", 0);
  }

  // Sesi habis: kembali ke halaman masuk.
  if (response.status === 401 && !path.startsWith("/auth/")) {
    queryClient.setQueryData(SESSION_KEY, { authenticated: false });
  }
  if (!response.ok) throw new ApiError(await errorMessage(response, "Terjadi gangguan. Coba lagi sebentar lagi."), response.status);
  return response;
}

export async function api<Result>(path: string, options?: RequestOptions): Promise<Result> {
  return (await send(path, options)).json() as Promise<Result>;
}

/** Kunci cache, dikumpulkan di satu tempat supaya pembaruan data tidak salah alamat. */
export const keys = {
  status: ["status"] as const,
  tenants: ["tenants"] as const,
  tenant: (tenantId: string) => ["tenant", tenantId] as const,
  documents: (tenantId: string) => ["documents", tenantId] as const,
  document: (documentId: string) => ["document", documentId] as const,
  conversations: (tenantId: string) => ["conversations", tenantId] as const,
  conversation: (conversationId: string) => ["conversation", conversationId] as const,
  channels: (tenantId: string) => ["channels", tenantId] as const,
};

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Terjadi gangguan. Coba lagi sebentar lagi.";
}
