import { clsx } from "clsx";
import { X } from "lucide-react";
import { AlertDialog, Dialog } from "radix-ui";
import { useEffect, useState, type ReactNode } from "react";
import { Button, IconButton } from "./Button";

const WIDTH = { sm: "max-w-md", md: "max-w-lg", lg: "max-w-3xl" };

const OVERLAY = "fixed inset-0 z-50 grid animate-fade place-items-center overflow-y-auto bg-ink/45 p-4";
const PANEL = "w-full animate-pop rounded-xl border border-line bg-white shadow-float outline-none";

interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  size?: keyof typeof WIDTH;
  /** Klik di luar tidak menutup dialog. Dipakai untuk dialog berisi tulisan panjang supaya tidak hilang tanpa sengaja. */
  keepOnOutsideClick?: boolean;
  children: ReactNode;
}

export function Modal({ open, onOpenChange, title, description, size = "md", keepOnOutsideClick, children }: ModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={OVERLAY}>
          <Dialog.Content
            className={clsx(PANEL, WIDTH[size])}
            onInteractOutside={keepOnOutsideClick ? (event) => event.preventDefault() : undefined}
            // Bila tidak ada isian yang meminta fokus, fokus jatuh ke dialognya, bukan ke tombol tutup.
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              (event.currentTarget as HTMLElement).focus();
            }}
            {...(description ? {} : { "aria-describedby": undefined })}
          >
            <div className="flex items-start gap-4 px-6 pt-5">
              <div className="min-w-0 flex-1">
                <Dialog.Title className="text-lg font-bold tracking-[-0.01em]">{title}</Dialog.Title>
                {description && <Dialog.Description className="mt-1 text-ink-2">{description}</Dialog.Description>}
              </div>
              <Dialog.Close asChild>
                <IconButton label="Tutup" className="-mt-1 -mr-2">
                  <X className="size-5" aria-hidden />
                </IconButton>
              </Dialog.Close>
            </div>
            {children}
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function ModalBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={clsx("px-6 py-5", className)}>{children}</div>;
}

export function ModalFooter({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap justify-end gap-2 px-6 pb-5">{children}</div>;
}

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Penjelasan akibat tindakan ini, dalam kalimat biasa. */
  children: ReactNode;
  confirmLabel: string;
  tone?: "danger" | "primary";
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  /** Bila diisi, tombol konfirmasi baru aktif setelah teks ini diketik. Untuk tindakan yang menghapus banyak data. */
  typeToConfirm?: string;
}

/** Dialog konfirmasi untuk tindakan yang tidak bisa dibatalkan. Tetap terbuka selama tindakan berjalan. */
export function ConfirmDialog({ open, onOpenChange, title, children, confirmLabel, tone = "danger", busy, error, onConfirm, typeToConfirm }: ConfirmDialogProps) {
  const [typed, setTyped] = useState("");
  useEffect(() => {
    if (!open) setTyped("");
  }, [open]);

  const unlocked = !typeToConfirm || typed.trim().toLowerCase() === typeToConfirm.trim().toLowerCase();

  return (
    <AlertDialog.Root open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className={OVERLAY}>
          <AlertDialog.Content className={clsx(PANEL, WIDTH.sm)}>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (unlocked) onConfirm();
              }}
            >
              <div className="px-6 pt-5">
                <AlertDialog.Title className="text-lg font-bold tracking-[-0.01em]">{title}</AlertDialog.Title>
                <AlertDialog.Description asChild>
                  <div className="mt-2 space-y-2 text-ink-2">{children}</div>
                </AlertDialog.Description>

                {typeToConfirm && (
                  <label className="mt-4 block text-[0.9rem]">
                    <span className="text-ink-2">
                      Ketik <b className="font-semibold text-ink">{typeToConfirm}</b> untuk melanjutkan.
                    </span>
                    <input className="field mt-2" value={typed} onChange={(event) => setTyped(event.target.value)} autoComplete="off" spellCheck={false} />
                  </label>
                )}
                {error && (
                  <p role="alert" className="mt-3 text-sm font-medium text-danger">
                    {error}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap justify-end gap-2 px-6 pt-5 pb-5">
                <AlertDialog.Cancel asChild>
                  <Button disabled={busy}>Batal</Button>
                </AlertDialog.Cancel>
                <Button type="submit" variant={tone} busy={busy} disabled={!unlocked}>
                  {confirmLabel}
                </Button>
              </div>
            </form>
          </AlertDialog.Content>
        </AlertDialog.Overlay>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
