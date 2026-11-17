import { CircleAlert, CircleCheck, X } from "lucide-react";
import { Toast as RadixToast } from "radix-ui";
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

type Tone = "success" | "error";

interface ToastItem {
  id: number;
  message: string;
  tone: Tone;
}

const ToastContext = createContext<(message: string, tone?: Tone) => void>(() => {});

/** Menampilkan pemberitahuan singkat di pojok layar, misalnya "Perubahan disimpan". */
export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const notify = useCallback((message: string, tone: Tone = "success") => {
    setItems((current) => [...current.slice(-2), { id: nextId.current++, message, tone }]);
  }, []);

  return (
    <ToastContext value={notify}>
      <RadixToast.Provider label="Pemberitahuan" swipeDirection="right">
        {children}
        {items.map((item) => (
          <RadixToast.Root
            key={item.id}
            // Pesan kesalahan perlu waktu baca lebih lama.
            duration={item.tone === "error" ? 8000 : 4000}
            onOpenChange={(open) => {
              if (!open) setItems((current) => current.filter((other) => other.id !== item.id));
            }}
            className="flex animate-pop items-start gap-2.5 rounded-lg bg-ink py-3 pr-2 pl-3.5 text-[0.9rem] text-white shadow-float"
          >
            {item.tone === "error" ? (
              <CircleAlert className="mt-0.5 size-[1.125rem] shrink-0 text-[#ffb4ab]" aria-hidden />
            ) : (
              <CircleCheck className="mt-0.5 size-[1.125rem] shrink-0 text-[#8fd6bb]" aria-hidden />
            )}
            <RadixToast.Description className="min-w-0 flex-1 leading-snug">{item.message}</RadixToast.Description>
            <RadixToast.Close aria-label="Tutup pemberitahuan" className="-my-1 grid size-7 shrink-0 place-items-center rounded-md text-white/70 hover:bg-white/10 hover:text-white">
              <X className="size-4" aria-hidden />
            </RadixToast.Close>
          </RadixToast.Root>
        ))}
        <RadixToast.Viewport className="fixed right-4 bottom-4 z-[60] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2 outline-none" />
      </RadixToast.Provider>
    </ToastContext>
  );
}
