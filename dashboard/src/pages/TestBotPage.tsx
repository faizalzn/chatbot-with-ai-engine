import { useQuery } from "@tanstack/react-query";
import { RotateCcw, SendHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { readReply } from "../../../shared/reply-stream";
import { Callout, Loading } from "../components/Bits";
import { Button } from "../components/Button";
import { Bubble, ChatScroll, Markdown, TypingDots } from "../components/Chat";
import { AutoTextarea } from "../components/Field";
import { useTenant } from "../layout/AppShell";
import { api, keys, messageOf, send, type ChatSource, type SystemStatus, type Tenant } from "../lib/api";
import { randomId } from "../lib/storage";

interface TestMessage {
  key: number;
  role: "customer" | "bot";
  text: string;
  sources?: ChatSource[];
  /** Jawaban masih ditulis bot. */
  pending?: boolean;
  searching?: boolean;
}

/** Halaman untuk mencoba bot seperti pelanggan, lengkap dengan dokumen yang dibaca bot untuk tiap jawaban. */
export function TestBotPage() {
  const tenantId = useTenant().id;
  // Tiap kali dimulai ulang, komponen percakapan dibuat baru dengan sesi baru.
  const [round, setRound] = useState(1);

  const tenant = useQuery({ queryKey: keys.tenant(tenantId), queryFn: () => api<Tenant>(`/tenants/${tenantId}`) });
  const status = useQuery({ queryKey: keys.status, queryFn: () => api<SystemStatus>("/status"), staleTime: 60_000 });

  return (
    <div className="flex h-full flex-col">
      <header className="shrink-0 border-b border-line px-4 py-5 sm:px-8">
        <div className="mx-auto flex max-w-3xl flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="min-w-0 max-w-xl">
            <h1 className="text-xl font-bold tracking-[-0.015em]">Coba bot</h1>
            <p className="mt-1 text-ink-2">Bertanyalah seperti pelanggan. Percakapan di sini hanya untuk uji coba dan tidak masuk ke kotak masuk.</p>
            {status.data?.botReady && <p className="mt-1.5 text-sm text-ink-3 [overflow-wrap:anywhere]">Model: {status.data.description}</p>}
          </div>
          <Button icon={<RotateCcw className="size-4" aria-hidden />} onClick={() => setRound((current) => current + 1)}>
            Mulai ulang
          </Button>
        </div>
      </header>

      {tenant.isPending ? (
        <Loading />
      ) : tenant.isError ? (
        <div className="p-6">
          <Callout tone="danger">{messageOf(tenant.error)}</Callout>
        </div>
      ) : (
        <TestChat key={`${tenantId}:${round}`} tenant={tenant.data} />
      )}
    </div>
  );
}

function TestChat({ tenant }: { tenant: Tenant }) {
  const sessionId = useRef(randomId()).current;
  const nextKey = useRef(1);
  const [messages, setMessages] = useState<TestMessage[]>([]);
  const [text, setText] = useState("");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [handedOff, setHandedOff] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Percakapan uji yang lama dibersihkan dulu supaya tidak menumpuk di server.
  useEffect(() => {
    let active = true;
    api(`/tenants/${tenant.id}/test-chat`, { method: "DELETE" })
      .catch(() => {})
      .finally(() => active && setReady(true));
    return () => {
      active = false;
    };
  }, [tenant.id]);

  const patch = (key: number, changes: Partial<TestMessage>) => {
    setMessages((current) => current.map((message) => (message.key === key ? { ...message, ...changes } : message)));
  };

  async function submit() {
    const content = text.trim();
    if (!content || busy || !ready || handedOff) return;

    const replyKey = nextKey.current + 1;
    nextKey.current += 2;
    setMessages((current) => [...current, { key: replyKey - 1, role: "customer", text: content }, { key: replyKey, role: "bot", text: "", pending: true }]);
    setText("");
    setError(null);
    setBusy(true);

    // Potongan teks datang sangat rapat. Layar cukup diperbarui sekali per bingkai.
    let draft = "";
    let frame = 0;
    const paint = () => {
      frame = 0;
      patch(replyKey, { text: draft, searching: false });
    };

    try {
      const response = await send(`/tenants/${tenant.id}/test-chat`, { body: { sessionId, text: content } });
      const result = await readReply(response, {
        onDelta: (delta) => {
          draft += delta;
          frame ||= requestAnimationFrame(paint);
        },
        onSearching: () => patch(replyKey, { searching: true }),
      });
      cancelAnimationFrame(frame);

      if (result.message) patch(replyKey, { text: result.message.content, sources: result.message.sources, pending: false, searching: false });
      else setMessages((current) => current.filter((message) => message.key !== replyKey));
      setHandedOff(result.withStaff);
    } catch (failure) {
      cancelAnimationFrame(frame);
      setMessages((current) => current.filter((message) => message.key !== replyKey));
      setError(messageOf(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <ChatScroll watch={messages} className="px-4 py-5 sm:px-8">
        <div className="mx-auto flex max-w-3xl flex-col gap-1.5">
          {/* Di halaman ini pengguna berperan sebagai pelanggan, jadi pesannya di kanan seperti di jendela chat website. */}
          <Bubble side="left" tone="plain" meta={<span className="font-semibold text-ink-2">{tenant.botName}</span>}>
            <Markdown text={tenant.greeting} />
          </Bubble>

          {messages.map((message, index) => {
            const first = messages[index - 1]?.role !== message.role;
            if (message.role === "customer") {
              return (
                <Bubble key={message.key} side="right" tone="solid" meta={first ? <span className="font-semibold text-ink-2">Anda, sebagai pelanggan</span> : undefined}>
                  <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{message.text}</p>
                </Bubble>
              );
            }
            return (
              <Bubble
                key={message.key}
                side="left"
                tone="plain"
                meta={<span className="font-semibold text-ink-2">{tenant.botName}</span>}
                sources={message.pending ? undefined : message.sources}
                sourcesLabel="Dokumen yang dibaca"
              >
                {message.text && <Markdown text={message.text} />}
                {message.pending && (!message.text || message.searching) && <TypingDots label={message.searching ? "Mencari di pengetahuan" : undefined} />}
              </Bubble>
            );
          })}

          {handedOff && (
            <Callout className="mt-4" title="Bot meneruskan percakapan ini ke staf">
              Pada percakapan sungguhan, bot berhenti menjawab di titik ini dan staf melanjutkan dari halaman Percakapan. Tekan “Mulai ulang” untuk mencoba pertanyaan lain.
            </Callout>
          )}
          {error && (
            <Callout tone="danger" className="mt-4">
              {error}
            </Callout>
          )}
        </div>
      </ChatScroll>

      <form
        className="shrink-0 border-t border-line px-4 py-3 sm:px-8"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <AutoTextarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void submit();
              }
            }}
            placeholder={handedOff ? "Mulai ulang untuk bertanya lagi" : "Tulis pertanyaan pelanggan…"}
            aria-label="Tulis pertanyaan"
            maxLength={2000}
            disabled={handedOff}
            autoFocus
            className="min-h-10"
          />
          <Button type="submit" variant="primary" busy={busy} disabled={!text.trim() || !ready || handedOff} icon={<SendHorizontal className="size-4" aria-hidden />}>
            Kirim
          </Button>
        </div>
      </form>
    </>
  );
}
