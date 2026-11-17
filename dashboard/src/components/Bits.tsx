import { clsx } from "clsx";
import { CircleAlert, Info, LoaderCircle, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import type { Channel } from "../lib/api";

export function Spinner({ className }: { className?: string }) {
  return <LoaderCircle className={clsx("size-4 animate-spin", className)} aria-hidden />;
}

/** Tanda tunggu untuk satu halaman atau panel yang datanya sedang dimuat. */
export function Loading({ label = "Memuat…" }: { label?: string }) {
  return (
    <div role="status" className="flex h-full min-h-40 items-center justify-center gap-2.5 text-ink-3">
      <Spinner />
      {label}
    </div>
  );
}

type Tone = "neutral" | "brand" | "warn" | "danger";

const BADGE: Record<Tone, string> = {
  neutral: "bg-sunken text-ink-2",
  brand: "bg-brand-soft text-brand-strong",
  warn: "bg-warn-soft text-warn",
  danger: "bg-danger-soft text-danger",
};

export function Badge({ tone = "neutral", icon, children }: { tone?: Tone; icon?: ReactNode; children: ReactNode }) {
  return (
    <span className={clsx("inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-semibold whitespace-nowrap", BADGE[tone])}>
      {icon}
      {children}
    </span>
  );
}

const CALLOUT = {
  info: { box: "border-line bg-sunken text-ink-2", icon: <Info className="text-ink-3" /> },
  warn: { box: "border-warn-line bg-warn-soft text-warn", icon: <TriangleAlert /> },
  danger: { box: "border-danger-line bg-danger-soft text-danger", icon: <CircleAlert /> },
};

interface CalloutProps {
  tone?: keyof typeof CALLOUT;
  title?: string;
  className?: string;
  children: ReactNode;
}

/** Kotak keterangan: catatan, peringatan, atau kesalahan yang perlu dibaca sebelum melanjutkan. */
export function Callout({ tone = "info", title, className, children }: CalloutProps) {
  const style = CALLOUT[tone];
  return (
    <div role={tone === "danger" ? "alert" : undefined} className={clsx("flex gap-3 rounded-lg border px-3.5 py-3 text-[0.9rem] leading-relaxed", style.box, className)}>
      <span className="mt-0.5 shrink-0 [&>svg]:size-[1.125rem]" aria-hidden>
        {style.icon}
      </span>
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children}
      </div>
    </div>
  );
}

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

/** Tampilan saat belum ada isi: menjelaskan apa yang akan muncul di sini dan langkah berikutnya. */
export function EmptyState({ icon, title, children, actions, className }: EmptyStateProps) {
  return (
    <div className={clsx("mx-auto flex max-w-md flex-col items-center px-6 py-14 text-center", className)}>
      <span className="grid size-11 place-items-center rounded-lg border border-line bg-sunken text-ink-2 [&>svg]:size-5" aria-hidden>
        {icon}
      </span>
      <h2 className="mt-4 text-lg font-bold tracking-[-0.01em]">{title}</h2>
      {children && <div className="mt-1.5 text-ink-2">{children}</div>}
      {actions && <div className="mt-5 flex flex-wrap justify-center gap-2">{actions}</div>}
    </div>
  );
}

interface PageProps {
  title: string;
  description: ReactNode;
  actions?: ReactNode;
  /** Lebar isi. Formulir memakai "narrow" supaya baris teks tidak terlalu panjang. */
  width?: "narrow" | "wide";
  children: ReactNode;
}

/** Kerangka halaman biasa: judul, satu kalimat penjelasan, tindakan utama, lalu isi yang bisa digulir. */
export function Page({ title, description, actions, width = "wide", children }: PageProps) {
  return (
    <div className="h-full overflow-y-auto">
      <div className={clsx("mx-auto px-5 py-7 sm:px-8 sm:py-9", width === "narrow" ? "max-w-2xl" : "max-w-4xl")}>
        <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
          <div className="min-w-0 max-w-xl">
            <h1 className="text-xl font-bold tracking-[-0.015em]">{title}</h1>
            <p className="mt-1 text-ink-2">{description}</p>
          </div>
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </header>
        <div className="mt-7">{children}</div>
      </div>
    </div>
  );
}

const CHANNEL: Record<Channel, { name: string; color: string }> = {
  web: { name: "Website", color: "#68717a" },
  whatsapp: { name: "WhatsApp", color: "#1fa855" },
  telegram: { name: "Telegram", color: "#229ed9" },
  discord: { name: "Discord", color: "#5865f2" },
};

export function channelName(channel: Channel): string {
  return CHANNEL[channel].name;
}

/** Nama saluran dengan penanda warna kecil, supaya asal percakapan terbaca sekilas. */
export function ChannelTag({ channel, className }: { channel: Channel; className?: string }) {
  const { name, color } = CHANNEL[channel];
  return (
    <span className={clsx("inline-flex items-center gap-1.5 whitespace-nowrap", className)}>
      <span className="size-2 rounded-[3px]" style={{ background: color }} aria-hidden />
      {name}
    </span>
  );
}
