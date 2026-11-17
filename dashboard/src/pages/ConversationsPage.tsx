import { useMutation, useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import { ArrowLeft, Bot, Ellipsis, Hand, Inbox, MessagesSquare, SendHorizontal, Trash2 } from "lucide-react";
import { ToggleGroup } from "radix-ui";
import { useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Badge, ChannelTag, channelName, EmptyState, Loading } from "../components/Bits";
import { Button, buttonClass, IconButton } from "../components/Button";
import { Bubble, ChatScroll, Markdown } from "../components/Chat";
import { AutoTextarea } from "../components/Field";
import { Menu, MenuItem } from "../components/Menu";
import { ConfirmDialog } from "../components/Modal";
import { useToast } from "../components/Toast";
import { useTenant } from "../layout/AppShell";
import { api, keys, messageOf, queryClient, type ChatMessage, type ConversationDetail, type ConversationSummary } from "../lib/api";
import { clock, dayLabel, listTime, sameDay } from "../lib/time";

type Filter = "all" | "waiting";

const FILTER_ITEM =
  "flex h-8 items-center justify-center gap-1.5 rounded-md text-sm font-semibold text-ink-2 transition-colors hover:text-ink data-[state=on]:bg-white data-[state=on]:text-ink data-[state=on]:ring-1 data-[state=on]:ring-line";

const REPLY_PREFIX = { customer: "", bot: "Bot: ", agent: "Staf: " };

/** Kotak masuk: daftar percakapan di kiri, isi percakapan yang dipilih di kanan. */
export function ConversationsPage() {
  const tenant = useTenant();
  const { conversationId } = useParams();
  const [filter, setFilter] = useState<Filter>("all");

  const list = useQuery({
    queryKey: keys.conversations(tenant.id),
    queryFn: () => api<ConversationSummary[]>(`/tenants/${tenant.id}/conversations`),
    refetchInterval: 4000,
  });

  const all = list.data ?? [];
  const waiting = all.filter((conversation) => conversation.waiting);
  const shown = filter === "waiting" ? waiting : all;

  return (
    <div className="flex h-full min-h-0">
      <section className={clsx("w-full flex-col border-line lg:flex lg:w-[22.5rem] lg:shrink-0 lg:border-r", conversationId ? "hidden" : "flex")} aria-label="Daftar percakapan">
        <div className="px-4 pt-6 pb-3">
          <h1 className="text-xl font-bold tracking-[-0.015em]">Percakapan</h1>
          <ToggleGroup.Root
            type="single"
            value={filter}
            onValueChange={(value) => value && setFilter(value as Filter)}
            aria-label="Saring percakapan"
            className="mt-4 grid grid-cols-2 gap-0.5 rounded-lg border border-line bg-sunken p-0.5"
          >
            <ToggleGroup.Item value="all" className={FILTER_ITEM}>
              Semua
            </ToggleGroup.Item>
            <ToggleGroup.Item value="waiting" className={FILTER_ITEM}>
              Menunggu staf
              {waiting.length > 0 && <span className="rounded bg-warn-solid px-1.5 text-xs leading-[1.125rem] font-bold text-white tabular-nums">{waiting.length}</span>}
            </ToggleGroup.Item>
          </ToggleGroup.Root>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto border-t border-line">
          {list.isPending ? (
            <Loading />
          ) : list.isError ? (
            <p className="p-4 text-danger">{messageOf(list.error)}</p>
          ) : all.length === 0 ? (
            <EmptyState
              icon={<Inbox />}
              title="Belum ada percakapan"
              actions={
                <>
                  <Link to={`/b/${tenant.id}/saluran`} className={buttonClass("secondary", "sm")}>
                    Atur saluran
                  </Link>
                  <Link to={`/b/${tenant.id}/coba`} className={buttonClass("ghost", "sm")}>
                    Coba bot
                  </Link>
                </>
              }
            >
              Pesan pelanggan dari website, WhatsApp, Telegram, dan Discord akan muncul di sini.
            </EmptyState>
          ) : shown.length === 0 ? (
            <p className="px-6 py-10 text-center text-ink-2">Tidak ada percakapan yang menunggu staf.</p>
          ) : (
            <ul>
              {shown.map((conversation) => (
                <li key={conversation.id}>
                  <ConversationRow conversation={conversation} to={`/b/${tenant.id}/percakapan/${conversation.id}`} active={conversation.id === conversationId} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className={clsx("min-w-0 flex-1 flex-col lg:flex", conversationId ? "flex" : "hidden")} aria-label="Isi percakapan">
        {conversationId ? (
          <ConversationView key={conversationId} tenantId={tenant.id} conversationId={conversationId} />
        ) : (
          <div className="grid h-full place-items-center">
            <EmptyState icon={<MessagesSquare />} title={all.length ? "Pilih percakapan" : "Belum ada yang perlu dibalas"}>
              {all.length ? "Pilih salah satu percakapan di sebelah kiri untuk membaca dan membalasnya." : "Saat pelanggan mulai mengirim pesan, percakapannya bisa dibuka di sini."}
            </EmptyState>
          </div>
        )}
      </section>
    </div>
  );
}

function ConversationRow({ conversation, to, active }: { conversation: ConversationSummary; to: string; active: boolean }) {
  return (
    <Link
      to={to}
      aria-current={active ? "true" : undefined}
      className={clsx(
        "block border-b border-line px-4 py-3 transition-colors",
        active ? "bg-sunken shadow-[inset_3px_0_0_var(--color-brand)]" : "hover:bg-sunken",
      )}
    >
      <div className="flex items-baseline gap-2">
        <span className={clsx("min-w-0 flex-1 truncate", conversation.waiting ? "font-bold" : "font-semibold")}>{conversation.name}</span>
        <time dateTime={conversation.lastAt} className="shrink-0 text-xs text-ink-3 tabular-nums">
          {listTime(conversation.lastAt)}
        </time>
      </div>
      <p className={clsx("mt-0.5 truncate text-[0.9rem]", conversation.waiting ? "text-ink" : "text-ink-2")}>
        {conversation.lastRole && REPLY_PREFIX[conversation.lastRole]}
        {conversation.preview || "Belum ada pesan"}
      </p>
      <div className="mt-1.5 flex items-center gap-2 text-xs text-ink-3">
        <ChannelTag channel={conversation.channel} />
        {conversation.waiting ? <Badge tone="warn">Menunggu staf</Badge> : conversation.mode === "human" ? <Badge>Ditangani staf</Badge> : null}
      </div>
    </Link>
  );
}

const SENDER_GAP_MS = 5 * 60 * 1000;

/** Pelanggan di kiri. Pihak bisnis di kanan: bot berwarna lembut, staf berwarna penuh, supaya jelas siapa yang menjawab. */
const BUBBLE_STYLE = {
  customer: { side: "left", tone: "plain" },
  bot: { side: "right", tone: "soft" },
  agent: { side: "right", tone: "solid" },
} as const;

/** Menyusun linimasa: pemisah hari, catatan kejadian, dan gelembung pesan dengan nama pengirim di awal tiap rangkaian. */
function timeline(messages: ChatMessage[], customerName: string): ReactNode[] {
  const senderName = { customer: customerName, bot: "Bot", agent: "Staf" };
  const items: ReactNode[] = [];

  messages.forEach((message, index) => {
    const previous = messages[index - 1];
    const newDay = !previous || !sameDay(previous.createdAt, message.createdAt);
    if (newDay) {
      items.push(
        <div key={`hari-${message.id}`} className="my-3 flex items-center gap-3 text-xs font-semibold text-ink-3">
          <span className="h-px flex-1 bg-line" />
          {dayLabel(message.createdAt)}
          <span className="h-px flex-1 bg-line" />
        </div>,
      );
    }

    if (message.role === "event") {
      items.push(
        <p key={message.id} className="mx-auto my-2 max-w-lg rounded-md bg-sunken px-3 py-1.5 text-center text-xs text-ink-2">
          {message.content} <span className="text-ink-3 tabular-nums">· {clock(message.createdAt)}</span>
        </p>,
      );
      return;
    }

    const continues =
      !newDay && previous?.role === message.role && new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime() < SENDER_GAP_MS;

    items.push(
      <Bubble
        key={message.id}
        {...BUBBLE_STYLE[message.role]}
        sources={message.sources}
        meta={
          continues ? undefined : (
            <>
              <span className="font-semibold text-ink-2">{senderName[message.role]}</span> <span className="tabular-nums">· {clock(message.createdAt)}</span>
            </>
          )
        }
      >
        {message.role === "customer" ? <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{message.content}</p> : <Markdown text={message.content} />}
      </Bubble>,
    );
  });

  return items;
}

function ConversationView({ tenantId, conversationId }: { tenantId: string; conversationId: string }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [text, setText] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const listPath = `/b/${tenantId}/percakapan`;

  const detail = useQuery({
    queryKey: keys.conversation(conversationId),
    queryFn: () => api<ConversationDetail>(`/conversations/${conversationId}`),
    refetchInterval: (query) => (query.state.error ? false : 3000),
  });

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: keys.conversation(conversationId) }),
      queryClient.invalidateQueries({ queryKey: keys.conversations(tenantId) }),
      queryClient.invalidateQueries({ queryKey: keys.tenants }),
    ]);
  const reportError = (error: unknown) => toast(messageOf(error), "error");

  const takeover = useMutation({
    mutationFn: () => api(`/conversations/${conversationId}/takeover`, { method: "POST" }),
    onSuccess: refresh,
    onError: reportError,
  });
  const release = useMutation({
    mutationFn: () => api(`/conversations/${conversationId}/release`, { method: "POST" }),
    onSuccess: async () => {
      await refresh();
      toast("Percakapan dikembalikan ke bot.");
    },
    onError: reportError,
  });
  const reply = useMutation({
    mutationFn: (content: string) => api(`/conversations/${conversationId}/reply`, { body: { text: content } }),
    onSuccess: async () => {
      setText("");
      await refresh();
    },
  });
  const remove = useMutation({
    mutationFn: () => api(`/conversations/${conversationId}`, { method: "DELETE" }),
    onSuccess: () => {
      setConfirmingDelete(false);
      navigate(listPath, { replace: true });
      queryClient.removeQueries({ queryKey: keys.conversation(conversationId) });
      void queryClient.invalidateQueries({ queryKey: keys.conversations(tenantId) });
      void queryClient.invalidateQueries({ queryKey: keys.tenants });
      toast("Percakapan dihapus.");
    },
  });

  if (detail.isPending) return <Loading />;
  if (detail.isError) {
    return (
      <div className="grid h-full place-items-center">
        <EmptyState
          icon={<MessagesSquare />}
          title="Percakapan tidak bisa dibuka"
          actions={
            <Link to={listPath} className={buttonClass("secondary", "sm")}>
              Kembali ke daftar
            </Link>
          }
        >
          {messageOf(detail.error)}
        </EmptyState>
      </div>
    );
  }

  const conversation = detail.data;
  const withBot = conversation.mode === "bot";
  const submit = () => {
    const content = text.trim();
    if (content && !reply.isPending) reply.mutate(content);
  };

  return (
    <>
      <header className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-3 sm:px-5">
        <IconButton label="Kembali ke daftar" className="lg:hidden" onClick={() => navigate(listPath)}>
          <ArrowLeft className="size-5" aria-hidden />
        </IconButton>
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-bold">{conversation.name}</h2>
          <div className="flex items-center gap-2 text-sm text-ink-3">
            <ChannelTag channel={conversation.channel} />
            <span aria-hidden>·</span>
            <span className="truncate">{withBot ? "Dijawab bot" : "Ditangani staf"}</span>
          </div>
        </div>
        {withBot ? (
          <Button size="sm" icon={<Hand className="size-4" aria-hidden />} busy={takeover.isPending} onClick={() => takeover.mutate()}>
            Ambil alih
          </Button>
        ) : (
          <Button size="sm" icon={<Bot className="size-4" aria-hidden />} busy={release.isPending} onClick={() => release.mutate()}>
            Kembalikan ke bot
          </Button>
        )}
        <Menu
          trigger={
            <IconButton label="Tindakan lain">
              <Ellipsis className="size-5" aria-hidden />
            </IconButton>
          }
        >
          <MenuItem danger icon={<Trash2 className="size-4" aria-hidden />} onSelect={() => setConfirmingDelete(true)}>
            Hapus percakapan
          </MenuItem>
        </Menu>
      </header>

      {!withBot && conversation.handoffReason && (
        <div className="shrink-0 border-b border-warn-line bg-warn-soft px-4 py-2.5 text-[0.9rem] text-warn sm:px-5">
          <b className="font-semibold">Diteruskan ke staf.</b> {conversation.handoffReason}
        </div>
      )}

      <ChatScroll watch={conversation.messages.at(-1)?.id} className="px-4 py-4 sm:px-5">
        <div className="mx-auto flex max-w-3xl flex-col gap-1.5">{timeline(conversation.messages, conversation.name)}</div>
      </ChatScroll>

      <form
        className="shrink-0 border-t border-line px-4 py-3 sm:px-5"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="mx-auto max-w-3xl">
          {reply.isError && (
            <p role="alert" className="mb-2 text-sm font-medium text-danger">
              {messageOf(reply.error)}
            </p>
          )}
          <div className="flex items-end gap-2">
            <AutoTextarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  submit();
                }
              }}
              placeholder={`Balas ${conversation.name}…`}
              aria-label="Tulis balasan"
              maxLength={4000}
              className="min-h-10"
            />
            <Button type="submit" variant="primary" busy={reply.isPending} disabled={!text.trim()} icon={<SendHorizontal className="size-4" aria-hidden />}>
              Kirim
            </Button>
          </div>
          <p className="mt-2 text-xs text-ink-3">
            {withBot
              ? "Bot masih menjawab percakapan ini. Kalau Anda mengirim balasan, percakapan diambil alih dan bot berhenti menjawab sampai dikembalikan."
              : `Balasan dikirim ke pelanggan lewat ${channelName(conversation.channel)}. Enter untuk mengirim, Shift+Enter untuk baris baru.`}
          </p>
        </div>
      </form>

      <ConfirmDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title="Hapus percakapan ini?"
        confirmLabel="Hapus percakapan"
        busy={remove.isPending}
        error={remove.isError ? messageOf(remove.error) : null}
        onConfirm={() => remove.mutate()}
      >
        <p>
          Seluruh riwayat pesan dengan <b className="font-semibold text-ink">{conversation.name}</b> dihapus dari dashboard dan tidak bisa dikembalikan.
        </p>
        <p>Pesan yang sudah sampai ke pelanggan tetap ada di aplikasi mereka.</p>
      </ConfirmDialog>
    </>
  );
}
