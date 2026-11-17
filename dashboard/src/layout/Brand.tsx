import { clsx } from "clsx";
import { DEFAULT_ACCENT, isHexColor, readableOn } from "../../../shared/color";

/** Lambang produk: kotak hijau berisi gelembung percakapan. Sama dengan ikon tab peramban. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={clsx("size-8", className)} role="img" aria-label="Sahut">
      <rect width="32" height="32" rx="8" fill="#14694F" />
      <path d="M9 10.5h14v9h-7.5L11 23v-3.5H9z" fill="#fff" />
    </svg>
  );
}

/** Kotak kecil berwarna merek bisnis dengan huruf depannya. Membantu membedakan bisnis sekilas. */
export function TenantMark({ name, color, className }: { name: string; color: string; className?: string }) {
  const background = isHexColor(color) ? color : DEFAULT_ACCENT;
  return (
    <span
      aria-hidden
      className={clsx("grid size-7 shrink-0 place-items-center rounded-md text-xs font-bold", className)}
      style={{ background, color: readableOn(background) }}
    >
      {name.trim().charAt(0).toUpperCase()}
    </span>
  );
}

/** Jumlah percakapan yang menunggu staf. */
export function WaitingCount({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <span
      className={clsx("grid h-5 min-w-5 place-items-center rounded-md bg-warn-solid px-1.5 text-xs font-bold text-white tabular-nums", className)}
      aria-label={`${count} percakapan menunggu staf`}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
