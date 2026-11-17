import { useMutation, useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import { Check, MessageCircle } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { isHexColor, readableOn } from "../../../shared/color";
import { Callout, Loading, Page } from "../components/Bits";
import { Button } from "../components/Button";
import { Field } from "../components/Field";
import { ConfirmDialog } from "../components/Modal";
import { useToast } from "../components/Toast";
import { useTenant } from "../layout/AppShell";
import { api, keys, messageOf, queryClient, type Tenant } from "../lib/api";

const SWATCHES = [
  { color: "#14694F", name: "Hijau tua" },
  { color: "#0B6E79", name: "Biru kehijauan" },
  { color: "#1F4FBF", name: "Biru" },
  { color: "#5B3FBF", name: "Ungu" },
  { color: "#B4233A", name: "Merah" },
  { color: "#C2410C", name: "Jingga bata" },
  { color: "#7A4A21", name: "Cokelat" },
  { color: "#1F2933", name: "Arang" },
];

type Form = Pick<Tenant, "name" | "botName" | "greeting" | "instructions" | "accentColor">;

const FIELDS: (keyof Form)[] = ["name", "botName", "greeting", "instructions", "accentColor"];

function toForm(tenant: Tenant): Form {
  return { name: tenant.name, botName: tenant.botName, greeting: tenant.greeting, instructions: tenant.instructions, accentColor: tenant.accentColor };
}

function Section({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section className="border-t border-line py-7 first:border-t-0 first:pt-0">
      <h2 className="font-bold">{title}</h2>
      <p className="mt-0.5 text-sm text-ink-2">{description}</p>
      <div className="mt-5 space-y-5">{children}</div>
    </section>
  );
}

export function SettingsPage() {
  const tenantId = useTenant().id;
  const tenant = useQuery({ queryKey: keys.tenant(tenantId), queryFn: () => api<Tenant>(`/tenants/${tenantId}`) });

  return (
    <Page title="Pengaturan" description="Nama, cara bot menyapa dan menjawab, serta tampilan tombol chat di website." width="narrow">
      {tenant.isPending ? <Loading /> : tenant.isError ? <Callout tone="danger">{messageOf(tenant.error)}</Callout> : <SettingsForm key={tenant.data.id} tenant={tenant.data} />}
    </Page>
  );
}

function SettingsForm({ tenant }: { tenant: Tenant }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [form, setForm] = useState<Form>(() => toForm(tenant));
  const [deleting, setDeleting] = useState(false);
  const set = <Key extends keyof Form>(key: Key, value: Form[Key]) => setForm((current) => ({ ...current, [key]: value }));

  const saved = toForm(tenant);
  const dirty = FIELDS.some((key) => form[key].trim() !== saved[key]);
  const colorValid = isHexColor(form.accentColor);
  const complete = form.name.trim().length >= 2 && form.botName.trim().length >= 1 && form.greeting.trim().length >= 1 && colorValid;

  // Mengingatkan sebelum tab ditutup selagi ada perubahan yang belum disimpan.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const save = useMutation({
    mutationFn: () => api<Tenant>(`/tenants/${tenant.id}`, { method: "PATCH", body: form }),
    onSuccess: (updated) => {
      queryClient.setQueryData(keys.tenant(tenant.id), updated);
      setForm(toForm(updated));
      void queryClient.invalidateQueries({ queryKey: keys.tenants });
      toast("Perubahan disimpan.");
    },
  });

  const remove = useMutation({
    mutationFn: () => api(`/tenants/${tenant.id}`, { method: "DELETE" }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.tenants });
      navigate("/", { replace: true });
      toast(`${tenant.name} dihapus.`);
    },
  });

  return (
    <>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (dirty && complete) save.mutate();
        }}
      >
        <Section title="Identitas" description="Nama yang dilihat pelanggan saat mengobrol dengan bot.">
          <Field label="Nama bisnis">{(control) => <input {...control} className="field" value={form.name} onChange={(event) => set("name", event.target.value)} maxLength={80} />}</Field>
          <Field label="Nama bot" hint="Nama panggilan bot, misalnya “Sena” atau “Asisten Toko Melati”.">
            {(control) => <input {...control} className="field" value={form.botName} onChange={(event) => set("botName", event.target.value)} maxLength={40} />}
          </Field>
        </Section>

        <Section title="Cara bot menyapa dan menjawab" description="Bot selalu menjawab berdasarkan dokumen di halaman Pengetahuan. Di sini Anda mengatur gayanya.">
          <Field label="Salam pembuka" hint="Pesan pertama yang dilihat pelanggan saat membuka chat.">
            {(control) => <textarea {...control} className="field resize-y" rows={3} value={form.greeting} onChange={(event) => set("greeting", event.target.value)} maxLength={500} />}
          </Field>
          <Field
            label="Arahan untuk bot"
            optional
            hint="Aturan tambahan dalam kalimat biasa: gaya bahasa, sapaan untuk pelanggan, atau hal yang harus selalu diteruskan ke staf."
          >
            {(control) => (
              <textarea
                {...control}
                className="field resize-y leading-relaxed"
                rows={6}
                value={form.instructions}
                onChange={(event) => set("instructions", event.target.value)}
                maxLength={4000}
                placeholder={"Contoh:\nSapa pelanggan dengan “Kak”.\nKeluhan soal pesanan rusak selalu diteruskan ke staf."}
              />
            )}
          </Field>
        </Section>

        <Section title="Tampilan tombol chat" description="Warna tombol dan jendela chat di website. Pilih yang serasi dengan warna merek Anda.">
          <div>
            <p className="text-[0.9rem] font-semibold" id="label-warna">
              Warna
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2" role="group" aria-labelledby="label-warna">
              {SWATCHES.map(({ color, name }) => {
                const selected = form.accentColor.toLowerCase() === color.toLowerCase();
                return (
                  <button
                    key={color}
                    type="button"
                    onClick={() => set("accentColor", color)}
                    aria-label={name}
                    aria-pressed={selected}
                    title={name}
                    className={clsx("grid size-9 place-items-center rounded-lg text-white transition-shadow", selected && "ring-2 ring-ink ring-offset-2 ring-offset-white")}
                    style={{ background: color }}
                  >
                    {selected && <Check className="size-4" aria-hidden />}
                  </button>
                );
              })}
              <span className="mx-1 h-6 w-px bg-line" aria-hidden />
              <label className="flex items-center gap-2 text-sm text-ink-2">
                Warna lain
                <input
                  type="color"
                  value={colorValid ? form.accentColor : "#14694F"}
                  onChange={(event) => set("accentColor", event.target.value.toUpperCase())}
                  className="size-9 cursor-pointer rounded-lg border border-line-strong bg-white p-1"
                />
              </label>
              <input
                className="field w-28 font-mono text-sm uppercase"
                value={form.accentColor}
                onChange={(event) => set("accentColor", event.target.value.trim())}
                aria-label="Kode warna"
                aria-invalid={!colorValid || undefined}
                maxLength={7}
                spellCheck={false}
              />
            </div>
            {!colorValid && <p className="mt-1.5 text-sm font-medium text-danger">Kode warna terdiri dari tanda # dan enam karakter, misalnya #14694F.</p>}
          </div>

          <WidgetPreview color={colorValid ? form.accentColor : "#14694F"} botName={form.botName || "Bot"} businessName={form.name} greeting={form.greeting} />
        </Section>

        <div className="sticky bottom-0 flex flex-wrap items-center justify-end gap-x-4 gap-y-2 border-t border-line bg-white py-3">
          {save.isError && (
            <p role="alert" className="mr-auto text-sm font-medium text-danger">
              {messageOf(save.error)}
            </p>
          )}
          {dirty && !save.isError && <p className="mr-auto text-sm text-ink-2">Ada perubahan yang belum disimpan.</p>}
          <Button disabled={!dirty || save.isPending} onClick={() => setForm(saved)}>
            Batalkan
          </Button>
          <Button type="submit" variant="primary" busy={save.isPending} disabled={!dirty || !complete}>
            Simpan perubahan
          </Button>
        </div>
      </form>

      <section className="mt-10 rounded-lg border border-danger-line px-4 py-4 sm:px-5">
        <h2 className="font-bold">Hapus bisnis</h2>
        <p className="mt-0.5 text-sm text-ink-2">Menghapus bot, seluruh dokumen pengetahuan, riwayat percakapan, dan sambungan saluran bisnis ini.</p>
        <Button variant="danger-quiet" className="mt-4" onClick={() => setDeleting(true)}>
          Hapus bisnis ini
        </Button>
      </section>

      <ConfirmDialog
        open={deleting}
        onOpenChange={(open) => {
          setDeleting(open);
          if (!open) remove.reset();
        }}
        title={`Hapus ${tenant.name}?`}
        confirmLabel="Hapus selamanya"
        typeToConfirm={tenant.name}
        busy={remove.isPending}
        error={remove.isError ? messageOf(remove.error) : null}
        onConfirm={() => remove.mutate()}
      >
        <p>Bot, dokumen pengetahuan, riwayat percakapan, dan sambungan WhatsApp, Telegram, serta Discord milik bisnis ini ikut terhapus.</p>
        <p>Tindakan ini tidak bisa dibatalkan.</p>
      </ConfirmDialog>
    </>
  );
}

/** Gambaran kecil jendela chat, supaya pilihan warna dan salam pembuka langsung terlihat hasilnya. */
function WidgetPreview({ color, botName, businessName, greeting }: { color: string; botName: string; businessName: string; greeting: string }) {
  const onColor = readableOn(color);
  return (
    <div>
      <p className="text-[0.9rem] font-semibold">Pratinjau</p>
      <div className="mt-2 flex items-end gap-4 rounded-lg border border-line bg-sunken p-4 sm:p-5" aria-hidden>
        <div className="min-w-0 max-w-xs flex-1 overflow-hidden rounded-xl border border-line bg-white">
          <div className="flex items-center gap-3 px-3.5 py-3" style={{ background: color, color: onColor }}>
            <span className="grid size-8 shrink-0 place-items-center rounded-lg text-sm font-bold" style={{ background: `color-mix(in srgb, ${onColor} 18%, transparent)` }}>
              {botName.trim().charAt(0).toUpperCase()}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[0.9rem] leading-tight font-semibold">{botName}</span>
              <span className="block truncate text-xs opacity-85">Asisten otomatis {businessName}</span>
            </span>
          </div>
          <div className="space-y-2 px-3.5 py-3.5 text-sm">
            <p className="w-fit max-w-[90%] rounded-[14px] rounded-bl-[4px] bg-[#f1f3f4] px-3 py-2 [overflow-wrap:anywhere]">{greeting || "Salam pembuka"}</p>
            <p className="ml-auto w-fit max-w-[90%] rounded-[14px] rounded-br-[4px] px-3 py-2" style={{ background: color, color: onColor }}>
              Halo, mau tanya dong.
            </p>
          </div>
        </div>
        <span className="grid size-12 shrink-0 place-items-center rounded-full" style={{ background: color, color: onColor }}>
          <MessageCircle className="size-6" />
        </span>
      </div>
    </div>
  );
}
