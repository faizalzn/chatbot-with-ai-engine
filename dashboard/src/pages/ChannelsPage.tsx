import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, Copy, ExternalLink, Globe, Hash, MessageCircle, Send, type LucideIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Badge, Callout, channelName, Loading, Page, Spinner } from "../components/Bits";
import { Button, LinkButton } from "../components/Button";
import { Field } from "../components/Field";
import { ConfirmDialog } from "../components/Modal";
import { useToast } from "../components/Toast";
import { useTenant } from "../layout/AppShell";
import { api, keys, messageOf, queryClient, type ChannelsInfo, type ChannelStatus, type ConnectableChannel } from "../lib/api";

function StatusBadge({ status }: { status: ChannelStatus }) {
  switch (status.state) {
    case "connected":
      return (
        <Badge tone="brand" icon={<Check className="size-3" aria-hidden />}>
          Tersambung
        </Badge>
      );
    case "connecting":
      return <Badge icon={<Spinner className="size-3" />}>Menyambungkan…</Badge>;
    case "qr":
      return <Badge tone="warn">Menunggu dipindai</Badge>;
    case "error":
      return <Badge tone="danger">Bermasalah</Badge>;
    case "disconnected":
      return <Badge>Belum tersambung</Badge>;
  }
}

interface CardProps {
  icon: LucideIcon;
  title: string;
  summary: string;
  badge: ReactNode;
  children: ReactNode;
}

function ChannelCard({ icon: Icon, title, summary, badge, children }: CardProps) {
  return (
    <section className="rounded-lg border border-line">
      <header className="flex items-center gap-3 border-b border-line px-4 py-3.5 sm:px-5">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-line bg-sunken text-ink-2" aria-hidden>
          <Icon className="size-[1.125rem]" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-bold">{title}</h2>
          <p className="text-sm text-ink-2">{summary}</p>
        </div>
        {badge}
      </header>
      <div className="space-y-4 px-4 py-4 sm:px-5">{children}</div>
    </section>
  );
}

/** Langkah berurutan. Angka dipakai karena urutannya memang harus diikuti. */
function Steps({ children }: { children: ReactNode }) {
  return <ol className="list-decimal space-y-1.5 pl-5 text-ink-2 marker:font-semibold marker:text-ink">{children}</ol>;
}

function Term({ children }: { children: ReactNode }) {
  return <b className="font-semibold text-ink">{children}</b>;
}

/** Sambungan yang sudah aktif: tersambung sebagai siapa, tautan untuk mulai memakainya, dan tombol memutus. */
function Connected({ status, linkLabel, note, onDisconnect }: { status: Extract<ChannelStatus, { state: "connected" }>; linkLabel: string; note: string; onDisconnect: () => void }) {
  return (
    <>
      <p>
        Tersambung sebagai <Term>{status.label}</Term>. <span className="text-ink-2">{note}</span>
      </p>
      <div className="flex flex-wrap gap-2">
        {status.link && (
          <LinkButton href={status.link} target="_blank" rel="noopener noreferrer" icon={<ExternalLink className="size-4" aria-hidden />}>
            {linkLabel}
          </LinkButton>
        )}
        <Button variant="danger-quiet" onClick={onDisconnect}>
          Putuskan
        </Button>
      </div>
    </>
  );
}

export function ChannelsPage() {
  const tenant = useTenant();
  const toast = useToast();
  const queryKey = keys.channels(tenant.id);
  const [disconnecting, setDisconnecting] = useState<ConnectableChannel | null>(null);

  const channels = useQuery({
    queryKey,
    queryFn: () => api<ChannelsInfo>(`/tenants/${tenant.id}/channels`),
    // Saat menunggu kode QR atau sambungan, status diperiksa lebih sering supaya layar mengikuti.
    refetchInterval: (query) => {
      const data = query.state.data;
      const busy = data && [data.whatsapp, data.telegram, data.discord].some((status) => status.state === "connecting" || status.state === "qr");
      return busy ? 2000 : 10_000;
    },
  });

  const setStatus = (channel: ConnectableChannel, status: ChannelStatus) => {
    queryClient.setQueryData<ChannelsInfo>(queryKey, (current) => (current ? { ...current, [channel]: status } : current));
  };

  const connect = useMutation({
    mutationFn: ({ channel, token }: { channel: ConnectableChannel; token?: string }) =>
      api<ChannelStatus>(`/tenants/${tenant.id}/channels/${channel}/connect`, { body: token ? { token } : {} }),
    onSuccess: (status, { channel }) => {
      setStatus(channel, status);
      if (status.state === "connected") toast(`${channelName(channel)} tersambung.`);
    },
  });

  const disconnect = useMutation({
    mutationFn: (channel: ConnectableChannel) => api(`/tenants/${tenant.id}/channels/${channel}/disconnect`, { method: "POST" }),
    onSuccess: (_, channel) => {
      setStatus(channel, { state: "disconnected" });
      setDisconnecting(null);
      toast(`${channelName(channel)} diputuskan.`);
    },
  });

  const connectError = (channel: ConnectableChannel) => (connect.isError && connect.variables?.channel === channel ? messageOf(connect.error) : null);
  const connecting = (channel: ConnectableChannel) => connect.isPending && connect.variables?.channel === channel;

  return (
    <Page title="Saluran" description="Tempat pelanggan bisa mengobrol dengan bot. Semua saluran memakai pengetahuan yang sama, dan percakapannya masuk ke satu kotak masuk.">
      {channels.isPending ? (
        <Loading />
      ) : channels.isError ? (
        <Callout tone="danger">{messageOf(channels.error)}</Callout>
      ) : (
        <div className="space-y-5">
          <WebsiteCard web={channels.data.web} />

          <ChannelCard icon={MessageCircle} title="WhatsApp" summary="Bot membalas chat pribadi di satu nomor WhatsApp." badge={<StatusBadge status={channels.data.whatsapp} />}>
            <WhatsAppBody
              status={channels.data.whatsapp}
              busy={connecting("whatsapp")}
              error={connectError("whatsapp")}
              onConnect={() => connect.mutate({ channel: "whatsapp" })}
              onCancel={() => disconnect.mutate("whatsapp")}
              onDisconnect={() => setDisconnecting("whatsapp")}
            />
          </ChannelCard>

          <ChannelCard icon={Send} title="Telegram" summary="Bot membalas chat pribadi lewat bot Telegram milik Anda." badge={<StatusBadge status={channels.data.telegram} />}>
            {channels.data.telegram.state === "connected" ? (
              <Connected
                status={channels.data.telegram}
                linkLabel="Buka bot di Telegram"
                note="Bagikan nama bot ini ke pelanggan. Mereka cukup mencarinya di Telegram lalu menekan Start."
                onDisconnect={() => setDisconnecting("telegram")}
              />
            ) : (
              <TokenForm
                status={channels.data.telegram}
                busy={connecting("telegram")}
                error={connectError("telegram")}
                placeholder="Contoh: 7123456789:AAHk3…"
                onConnect={(token) => connect.mutate({ channel: "telegram", token })}
              >
                <Steps>
                  <li>
                    Buka Telegram, cari <Term>@BotFather</Term>, lalu kirim pesan <Term>/newbot</Term>.
                  </li>
                  <li>Ikuti pertanyaannya: beri nama bot, lalu nama pengguna yang berakhiran “bot”.</li>
                  <li>BotFather membalas dengan token, yaitu deretan angka dan huruf. Salin, lalu tempel di bawah ini.</li>
                </Steps>
              </TokenForm>
            )}
          </ChannelCard>

          <ChannelCard icon={Hash} title="Discord" summary="Bot membalas pesan langsung dan pesan di server yang menyebut namanya." badge={<StatusBadge status={channels.data.discord} />}>
            {channels.data.discord.state === "connected" ? (
              <Connected
                status={channels.data.discord}
                linkLabel="Undang bot ke server"
                note="Undang bot ke server Discord Anda. Anggota bisa bertanya dengan menyebut nama bot (@nama) atau lewat pesan langsung."
                onDisconnect={() => setDisconnecting("discord")}
              />
            ) : (
              <TokenForm
                status={channels.data.discord}
                busy={connecting("discord")}
                error={connectError("discord")}
                placeholder="Tempel token bot Discord"
                onConnect={(token) => connect.mutate({ channel: "discord", token })}
              >
                <Steps>
                  <li>
                    Buka{" "}
                    <a href="https://discord.com/developers/applications" target="_blank" rel="noopener noreferrer" className="font-semibold text-brand underline underline-offset-2">
                      Discord Developer Portal
                    </a>
                    , klik <Term>New Application</Term>, lalu beri nama.
                  </li>
                  <li>
                    Buka menu <Term>Bot</Term>, klik <Term>Reset Token</Term>, lalu salin tokennya.
                  </li>
                  <li>Tempel token di bawah ini. Setelah tersambung, tombol untuk mengundang bot ke server muncul di sini.</li>
                </Steps>
              </TokenForm>
            )}
          </ChannelCard>
        </div>
      )}

      <ConfirmDialog
        open={disconnecting !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDisconnecting(null);
            disconnect.reset();
          }
        }}
        title={`Putuskan ${disconnecting ? channelName(disconnecting) : "saluran"}?`}
        confirmLabel="Putuskan"
        busy={disconnect.isPending}
        error={disconnect.isError ? messageOf(disconnect.error) : null}
        onConfirm={() => disconnecting && disconnect.mutate(disconnecting)}
      >
        <p>Bot berhenti membalas pelanggan di saluran ini. Riwayat percakapan yang sudah ada tetap tersimpan.</p>
        <p>{disconnecting === "whatsapp" ? "Untuk menyambungkan lagi, kode QR perlu dipindai ulang." : "Untuk menyambungkan lagi, token perlu dimasukkan ulang."}</p>
      </ConfirmDialog>
    </Page>
  );
}

function WebsiteCard({ web }: { web: ChannelsInfo["web"] }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const local = /\/\/(localhost|127\.0\.0\.1)/.test(web.snippet);

  async function copy() {
    try {
      await navigator.clipboard.writeText(web.snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast("Kode tidak bisa disalin otomatis. Blok kodenya, lalu salin secara manual.", "error");
    }
  }

  return (
    <ChannelCard
      icon={Globe}
      title="Website"
      summary="Tombol chat di pojok website Anda."
      badge={
        <Badge tone="brand" icon={<Check className="size-3" aria-hidden />}>
          Siap dipasang
        </Badge>
      }
    >
      <p className="text-ink-2">
        Tempel kode ini di halaman website, tepat sebelum <code className="font-mono text-[0.85em] text-ink">&lt;/body&gt;</code>. Kalau website dikelola orang lain, kirimkan kode ini kepadanya.
      </p>
      <div className="flex flex-col items-stretch gap-2 sm:flex-row">
        <pre className="min-w-0 flex-1 overflow-x-auto rounded-lg border border-line bg-sunken px-3.5 py-2.5 font-mono text-sm leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere] select-all">
          {web.snippet}
        </pre>
        <Button className="sm:h-auto" icon={copied ? <Check className="size-4 text-brand" aria-hidden /> : <Copy className="size-4" aria-hidden />} onClick={() => void copy()}>
          {copied ? "Tersalin" : "Salin"}
        </Button>
      </div>
      {local && (
        <Callout>
          Alamat pada kode ini masih <Term>localhost</Term>, jadi hanya berfungsi di komputer ini. Setelah server dipasang di internet, isi <code className="font-mono text-[0.85em]">PUBLIC_URL</code> di file{" "}
          <code className="font-mono text-[0.85em]">.env</code> dengan alamat aslinya.
        </Callout>
      )}
      <div>
        <LinkButton href={web.demoUrl} target="_blank" rel="noopener noreferrer" icon={<ExternalLink className="size-4" aria-hidden />}>
          Buka halaman contoh
        </LinkButton>
        <p className="mt-2 text-sm text-ink-3">Halaman contoh memperlihatkan tombol chat seperti saat sudah terpasang di website.</p>
      </div>
    </ChannelCard>
  );
}

interface WhatsAppBodyProps {
  status: ChannelStatus;
  busy: boolean;
  error: string | null;
  onConnect: () => void;
  onCancel: () => void;
  onDisconnect: () => void;
}

function WhatsAppBody({ status, busy, error, onConnect, onCancel, onDisconnect }: WhatsAppBodyProps) {
  if (status.state === "connected") {
    return <Connected status={status} linkLabel="Buka chat ke nomor ini" note="Pelanggan yang mengirim pesan ke nomor ini dibalas oleh bot." onDisconnect={onDisconnect} />;
  }

  if (status.state === "qr") {
    return (
      <div className="flex flex-wrap items-start gap-x-8 gap-y-5">
        <img src={status.qr} alt="Kode QR untuk menautkan WhatsApp" width={232} height={232} className="size-58 shrink-0 rounded-lg border border-line" />
        <div className="min-w-60 flex-1 space-y-4">
          <Steps>
            <li>Buka WhatsApp di ponsel yang memakai nomor untuk bot.</li>
            <li>
              Buka <Term>Pengaturan</Term> (di Android: ketuk titik tiga), lalu pilih <Term>Perangkat tertaut</Term>.
            </li>
            <li>
              Ketuk <Term>Tautkan perangkat</Term>, lalu arahkan kamera ke kode QR ini.
            </li>
          </Steps>
          <p className="text-sm text-ink-3">Kode berganti sendiri setiap beberapa saat. Pindai kode yang sedang tampil.</p>
          <Button onClick={onCancel}>Batal</Button>
        </div>
      </div>
    );
  }

  if (status.state === "connecting") {
    return (
      <div className="flex flex-wrap items-center gap-3 text-ink-2">
        <Spinner />
        <span className="flex-1">Menghubungi WhatsApp. Kode QR muncul sebentar lagi.</span>
        <Button onClick={onCancel}>Batal</Button>
      </div>
    );
  }

  return (
    <>
      <Callout tone="warn" title="Pakai nomor khusus, bukan nomor utama">
        Sambungan ini memakai cara tidak resmi (seperti WhatsApp Web), dan WhatsApp bisa memblokir nomor yang memakainya. Cocok untuk uji coba dan demo. Untuk dipakai sungguhan,
        gunakan WhatsApp Business API resmi.
      </Callout>
      {status.state === "error" && <Callout tone="danger">{status.message}</Callout>}
      {error && <Callout tone="danger">{error}</Callout>}
      <Button variant="primary" busy={busy} onClick={onConnect}>
        {status.state === "error" ? "Sambungkan ulang" : "Sambungkan WhatsApp"}
      </Button>
    </>
  );
}

interface TokenFormProps {
  status: ChannelStatus;
  busy: boolean;
  error: string | null;
  placeholder: string;
  onConnect: (token: string) => void;
  /** Langkah mendapatkan token. */
  children: ReactNode;
}

function TokenForm({ status, busy, error, placeholder, onConnect, children }: TokenFormProps) {
  const [token, setToken] = useState("");

  return (
    <>
      {status.state === "error" && <Callout tone="danger">{status.message}</Callout>}
      {children}
      <form
        className="flex flex-wrap items-start gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (token.trim()) onConnect(token.trim());
        }}
      >
        <Field label="Token bot" error={error} className="min-w-60 flex-1">
          {(control) => (
            <input
              {...control}
              className="field h-10 font-mono text-sm placeholder:font-sans"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder={placeholder}
              autoComplete="off"
              spellCheck={false}
              maxLength={200}
            />
          )}
        </Field>
        <Button type="submit" variant="primary" className="mt-[1.85rem]" busy={busy || status.state === "connecting"} disabled={!token.trim()}>
          Sambungkan
        </Button>
      </form>
      <p className="text-sm text-ink-3">Token disimpan dalam keadaan terenkripsi dan tidak ditampilkan lagi setelah tersambung.</p>
    </>
  );
}
