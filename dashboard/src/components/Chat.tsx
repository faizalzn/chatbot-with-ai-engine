import { clsx } from "clsx";
import { FileText } from "lucide-react";
import { Fragment, useLayoutEffect, useRef, type ReactNode } from "react";
import { parseMarkdown, type Inline } from "../../../shared/markdown";
import type { ChatSource } from "../lib/api";

function renderInline(nodes: Inline[]): ReactNode {
  return nodes.map((node, index) => {
    switch (node.type) {
      case "text":
        return <Fragment key={index}>{node.text}</Fragment>;
      case "break":
        return <br key={index} />;
      case "bold":
        return (
          <strong key={index} className="font-semibold">
            {renderInline(node.children)}
          </strong>
        );
      case "italic":
        return <em key={index}>{renderInline(node.children)}</em>;
      case "code":
        return (
          <code key={index} className="rounded bg-ink/8 px-1 py-px font-mono text-[0.85em]">
            {node.text}
          </code>
        );
      case "link":
        return (
          <a key={index} href={node.href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
            {node.text}
          </a>
        );
    }
  });
}

/** Teks berformat dari bot atau staf. Dibangun dari pohon data, jadi isi pesan tidak pernah dijalankan sebagai HTML. */
export function Markdown({ text }: { text: string }) {
  return (
    <div className="space-y-2 [overflow-wrap:anywhere]">
      {parseMarkdown(text).map((block, index) => {
        if (block.type === "paragraph") return <p key={index}>{renderInline(block.children)}</p>;
        const List = block.ordered ? "ol" : "ul";
        return (
          <List key={index} start={block.ordered ? block.start : undefined} className={clsx("space-y-1 pl-5", block.ordered ? "list-decimal" : "list-disc")}>
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex}>{renderInline(item)}</li>
            ))}
          </List>
        );
      })}
    </div>
  );
}

type BubbleTone = "plain" | "soft" | "solid";

const TONE: Record<BubbleTone, string> = {
  plain: "bg-sunken",
  soft: "border border-brand-line bg-brand-soft",
  solid: "bg-brand text-white",
};

interface BubbleProps {
  /** Sisi layar. Kanan untuk pihak yang sedang memakai layar ini, kiri untuk lawan bicaranya. */
  side: "left" | "right";
  tone: BubbleTone;
  /** Nama pengirim dan jam, ditampilkan di atas gelembung pertama dari rangkaian pesan yang sama. */
  meta?: ReactNode;
  sources?: ChatSource[];
  sourcesLabel?: string;
  children: ReactNode;
}

/** Satu pesan dalam percakapan. */
export function Bubble({ side, tone, meta, sources, sourcesLabel = "Sumber", children }: BubbleProps) {
  const right = side === "right";
  return (
    <div className={clsx("flex flex-col", right ? "items-end" : "items-start")}>
      {meta && <div className="mx-1 mt-2 mb-1 text-xs text-ink-3">{meta}</div>}
      <div className={clsx("max-w-[min(34rem,86%)] rounded-[14px] px-3.5 py-2.5", right ? "rounded-br-[4px]" : "rounded-bl-[4px]", TONE[tone])}>{children}</div>
      {sources && sources.length > 0 && (
        <div className="mx-1 mt-1.5 flex max-w-[min(34rem,86%)] items-start gap-1.5 text-xs text-ink-3">
          <FileText className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>
            {sourcesLabel}: {sources.map((source) => source.title).join(", ")}
          </span>
        </div>
      )}
    </div>
  );
}

export function TypingDots({ label }: { label?: string }) {
  return (
    <span role="status" aria-label={label ?? "Bot sedang menulis"} className="flex h-6 items-center gap-1 text-sm text-ink-3">
      {label && <span className="mr-1">{label}</span>}
      {[0, 150, 300].map((delay) => (
        <span key={delay} className="size-1.5 animate-pulse rounded-full bg-ink-3" style={{ animationDelay: `${delay}ms` }} />
      ))}
    </span>
  );
}

/**
 * Daftar pesan yang bisa digulir. Selalu mengikuti pesan terbaru,
 * kecuali pengguna sedang menggulir ke atas untuk membaca pesan lama.
 */
export function ChatScroll({ watch, className, children }: { watch: unknown; className?: string; children: ReactNode }) {
  const container = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useLayoutEffect(() => {
    const element = container.current;
    if (element && stick.current) element.scrollTop = element.scrollHeight;
  }, [watch]);

  return (
    <div
      ref={container}
      onScroll={(event) => {
        const element = event.currentTarget;
        stick.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
      }}
      className={clsx("min-h-0 flex-1 overflow-y-auto overscroll-contain", className)}
    >
      {children}
    </div>
  );
}
