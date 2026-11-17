import { clsx } from "clsx";
import { useId, useLayoutEffect, useRef, type ReactNode, type Ref, type TextareaHTMLAttributes } from "react";

interface ControlProps {
  id: string;
  "aria-describedby": string | undefined;
  "aria-invalid": boolean | undefined;
}

interface FieldProps {
  label: string;
  /** Penjelasan singkat di bawah label: apa yang diisi dan untuk apa. */
  hint?: ReactNode;
  error?: string | null;
  optional?: boolean;
  className?: string;
  children: (control: ControlProps) => ReactNode;
}

/** Label, penjelasan, dan pesan kesalahan untuk satu isian, terhubung ke kontrolnya bagi pembaca layar. */
export function Field({ label, hint, error, optional, className, children }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;

  return (
    <div className={className}>
      <label htmlFor={id} className="block text-[0.9rem] font-semibold">
        {label}
        {optional && <span className="ml-1.5 font-normal text-ink-3">opsional</span>}
      </label>
      {hint && (
        <p id={hintId} className="mt-0.5 text-sm text-ink-2">
          {hint}
        </p>
      )}
      <div className="mt-2">{children({ id, "aria-describedby": [hintId, errorId].filter(Boolean).join(" ") || undefined, "aria-invalid": error ? true : undefined })}</div>
      {error && (
        <p id={errorId} role="alert" className="mt-1.5 text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

interface AutoTextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Tinggi paling besar dalam piksel. Lewat dari itu, isi digulir. */
  maxHeight?: number;
  ref?: Ref<HTMLTextAreaElement>;
}

/** Kolom tulis yang tingginya mengikuti isi. */
export function AutoTextarea({ maxHeight = 160, className, value, ref, ...rest }: AutoTextareaProps) {
  const inner = useRef<HTMLTextAreaElement | null>(null);

  useLayoutEffect(() => {
    const element = inner.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight + 2, maxHeight)}px`;
  }, [value, maxHeight]);

  return (
    <textarea
      ref={(element) => {
        inner.current = element;
        if (typeof ref === "function") ref(element);
        else if (ref) ref.current = element;
      }}
      rows={1}
      value={value}
      className={clsx("field resize-none", className)}
      {...rest}
    />
  );
}
