import { useMutation } from "@tanstack/react-query";
import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { Button } from "../components/Button";
import { Field } from "../components/Field";
import { Logo } from "../layout/Brand";
import { api, messageOf, queryClient, SESSION_KEY } from "../lib/api";

export function LoginPage() {
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);

  const login = useMutation({
    mutationFn: () => api<{ authenticated: boolean }>("/auth/login", { body: { password } }),
    onSuccess: (session) => queryClient.setQueryData(SESSION_KEY, session),
  });

  return (
    <div className="grid min-h-full place-items-center px-5 py-10">
      <main className="w-full max-w-sm">
        <div className="flex items-center gap-2.5">
          <Logo />
          <span className="text-lg font-bold tracking-[-0.01em]">Sahut</span>
        </div>

        <h1 className="mt-8 text-xl font-bold tracking-[-0.015em]">Masuk ke dashboard</h1>
        <p className="mt-1 text-ink-2">Tempat membalas pelanggan dan mengatur apa yang diketahui bot.</p>

        <form
          className="mt-7"
          onSubmit={(event) => {
            event.preventDefault();
            login.mutate();
          }}
        >
          <Field label="Kata sandi" error={login.isError ? messageOf(login.error) : null}>
            {(control) => (
              <div className="relative">
                <input
                  {...control}
                  className="field h-11 pr-11"
                  type={visible ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => setVisible((current) => !current)}
                  aria-label={visible ? "Sembunyikan kata sandi" : "Tampilkan kata sandi"}
                  aria-pressed={visible}
                  className="absolute top-1/2 right-1.5 grid size-8 -translate-y-1/2 place-items-center rounded-md text-ink-3 hover:bg-hover hover:text-ink"
                >
                  {visible ? <EyeOff className="size-[1.125rem]" aria-hidden /> : <Eye className="size-[1.125rem]" aria-hidden />}
                </button>
              </div>
            )}
          </Field>

          <Button type="submit" variant="primary" className="mt-5 h-11 w-full" busy={login.isPending} disabled={!password}>
            Masuk
          </Button>
        </form>

        <p className="mt-8 border-t border-line pt-5 text-sm text-ink-3">
          Kata sandi dibuat otomatis saat pemasangan dan tersimpan di file <code className="font-mono">.env</code> sebagai{" "}
          <code className="font-mono">ADMIN_PASSWORD</code>.
        </p>
      </main>
    </div>
  );
}
