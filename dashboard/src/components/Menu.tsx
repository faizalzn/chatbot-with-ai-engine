import { clsx } from "clsx";
import { DropdownMenu } from "radix-ui";
import type { ReactNode } from "react";

interface MenuProps {
  /** Tombol yang membuka menu. */
  trigger: ReactNode;
  align?: "start" | "end";
  /** Menu paling sempit selebar tombolnya, dan boleh melebar supaya isi yang panjang tidak terpotong. */
  matchTrigger?: boolean;
  children: ReactNode;
}

export function Menu({ trigger, align = "end", matchTrigger, children }: MenuProps) {
  return (
    // Tidak modal: menu yang membuka dialog tidak meninggalkan halaman dalam keadaan terkunci.
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align={align}
          sideOffset={6}
          className={clsx(
            "z-40 max-h-[min(28rem,var(--radix-dropdown-menu-content-available-height))] animate-pop overflow-y-auto rounded-lg border border-line bg-white p-1 shadow-float",
            matchTrigger ? "max-w-80 min-w-(--radix-dropdown-menu-trigger-width)" : "min-w-48",
          )}
        >
          {children}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

interface MenuItemProps {
  icon?: ReactNode;
  danger?: boolean;
  onSelect: () => void;
  children: ReactNode;
}

export function MenuItem({ icon, danger, onSelect, children }: MenuItemProps) {
  return (
    <DropdownMenu.Item
      onSelect={onSelect}
      className={clsx(
        "flex min-h-9 cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[0.9rem] outline-none select-none",
        danger ? "text-danger data-highlighted:bg-danger-soft" : "text-ink data-highlighted:bg-hover",
      )}
    >
      {icon}
      {children}
    </DropdownMenu.Item>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <DropdownMenu.Label className="px-2.5 pt-1.5 pb-1 text-xs font-semibold text-ink-3">{children}</DropdownMenu.Label>;
}

export function MenuSeparator() {
  return <DropdownMenu.Separator className="my-1 h-px bg-line" />;
}
