import { clsx } from "clsx";
import { LoaderCircle } from "lucide-react";
import { Tooltip } from "radix-ui";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode, Ref } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "danger-quiet";
type Size = "md" | "sm";

const BASE =
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-lg font-semibold whitespace-nowrap select-none transition-colors disabled:cursor-not-allowed disabled:opacity-50";

const VARIANT: Record<Variant, string> = {
  primary: "bg-brand text-white not-disabled:hover:bg-brand-strong",
  secondary: "border border-line-strong bg-white text-ink not-disabled:hover:bg-sunken",
  ghost: "text-ink-2 not-disabled:hover:bg-hover not-disabled:hover:text-ink",
  danger: "bg-danger text-white not-disabled:hover:bg-danger-strong",
  "danger-quiet": "border border-danger-line bg-white text-danger not-disabled:hover:bg-danger-soft",
};

const SIZE: Record<Size, string> = {
  md: "h-10 px-4 text-[0.9rem]",
  sm: "h-8 px-3 text-sm",
};

export function buttonClass(variant: Variant = "secondary", size: Size = "md", extra?: string): string {
  return clsx(BASE, VARIANT[variant], SIZE[size], extra);
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** Menampilkan putaran tunggu dan mencegah klik ganda selama tindakan berjalan. */
  busy?: boolean;
  icon?: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}

export function Button({ variant, size, busy = false, icon, className, children, disabled, type = "button", ...rest }: ButtonProps) {
  return (
    <button type={type} disabled={disabled || busy} className={buttonClass(variant, size, className)} {...rest}>
      {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}

interface LinkButtonProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
}

/** Tautan ke halaman lain yang tampil sebagai tombol. */
export function LinkButton({ variant, size, icon, className, children, ...rest }: LinkButtonProps) {
  return (
    <a className={buttonClass(variant, size, className)} {...rest}>
      {icon}
      {children}
    </a>
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Nama tindakan. Dibacakan pembaca layar dan muncul saat tombol disorot. */
  label: string;
  ref?: Ref<HTMLButtonElement>;
}

export function IconButton({ label, className, children, type = "button", ...rest }: IconButtonProps) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button
          type={type}
          aria-label={label}
          className={clsx(
            "inline-grid size-9 shrink-0 place-items-center rounded-lg text-ink-2 transition-colors hover:bg-hover hover:text-ink disabled:opacity-50",
            className,
          )}
          {...rest}
        >
          {children}
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content sideOffset={6} className="z-[70] animate-fade rounded-md bg-ink px-2 py-1 text-xs font-medium text-white">
          {label}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
