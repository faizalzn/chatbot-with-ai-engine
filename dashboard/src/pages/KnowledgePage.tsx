import { useMutation, useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import { BookOpenText, Check, CircleAlert, Ellipsis, FileText, PenLine, Trash2, Upload, X } from "lucide-react";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { Badge, Loading, Page, Spinner } from "../components/Bits";
import { Button, IconButton } from "../components/Button";
import { Field } from "../components/Field";
import { Menu, MenuItem } from "../components/Menu";
import { ConfirmDialog, Modal, ModalBody, ModalFooter } from "../components/Modal";
import { useToast } from "../components/Toast";
import { useTenant } from "../layout/AppShell";
import { api, keys, messageOf, queryClient, type DocumentDetail, type DocumentSummary } from "../lib/api";
import { ago } from "../lib/time";

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const ACCEPTED = [".pdf", ".docx", ".txt", ".md"];
const NUMBER = new Intl.NumberFormat("id-ID");

interface UploadItem {
  key: number;
  name: string;
  /** Kosong selama masih diunggah. Berisi pesan bila gagal. */
  error: string | null;
}

/** Memeriksa file sebelum dikirim, supaya penolakan yang sudah pasti tidak perlu menunggu unggahan selesai. */
function rejectReason(file: File): string | null {
  const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  if (extension === ".doc") return "File Word lama (.doc) belum didukung. Buka di Word, pilih Simpan sebagai, lalu pilih format .docx.";
  if (!ACCEPTED.includes(extension)) return "Jenis file ini belum didukung. Pakai PDF, Word (.docx), atau teks (.txt, .md).";
  if (file.size > MAX_UPLOAD_BYTES) return "File terlalu besar. Ukuran paling besar 15 MB.";
  return null;
}

type Editing = { mode: "new" } | { mode: "edit"; documentId: string } | null;

export function KnowledgePage() {
  const tenant = useTenant();
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const nextKey = useRef(1);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const [editing, setEditing] = useState<Editing>(null);
  const [deleting, setDeleting] = useState<DocumentSummary | null>(null);

  const documents = useQuery({
    queryKey: keys.documents(tenant.id),
    queryFn: () => api<DocumentSummary[]>(`/tenants/${tenant.id}/documents`),
    // Selama ada dokumen yang masih dipelajari, daftar diperiksa terus supaya statusnya berubah sendiri.
    refetchInterval: (query) => (query.state.data?.some((document) => document.status === "processing") ? 1500 : false),
  });
  const reload = () => queryClient.invalidateQueries({ queryKey: keys.documents(tenant.id) });

  const remove = useMutation({
    mutationFn: (documentId: string) => api(`/documents/${documentId}`, { method: "DELETE" }),
    onSuccess: async () => {
      setDeleting(null);
      await reload();
      toast("Dokumen dihapus. Bot tidak lagi memakainya.");
    },
  });

  async function upload(files: File[]) {
    for (const file of files) {
      const key = nextKey.current++;
      const rejected = rejectReason(file);
      setUploads((current) => [...current, { key, name: file.name, error: rejected }]);
      if (rejected) continue;

      try {
        const form = new FormData();
        form.append("file", file);
        await api(`/tenants/${tenant.id}/documents/upload`, { form });
        setUploads((current) => current.filter((item) => item.key !== key));
        await reload();
      } catch (error) {
        setUploads((current) => current.map((item) => (item.key === key ? { ...item, error: messageOf(error) } : item)));
      }
    }
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    void upload([...event.dataTransfer.files]);
  }

  const rows = documents.data ?? [];

  return (
    <Page
      title="Pengetahuan"
      description="Dokumen yang dipelajari bot. Bot hanya menjawab berdasarkan isi dokumen di sini, jadi makin lengkap isinya, makin banyak pertanyaan yang bisa dijawab."
      actions={
        <Button icon={<PenLine className="size-4" aria-hidden />} onClick={() => setEditing({ mode: "new" })}>
          Tulis langsung
        </Button>
      }
    >
      <input
        ref={fileInput}
        type="file"
        multiple
        accept={ACCEPTED.join(",")}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(event) => {
          void upload([...(event.target.files ?? [])]);
          event.target.value = "";
        }}
      />

      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={clsx(
          "flex flex-wrap items-center gap-x-4 gap-y-3 rounded-lg border border-dashed px-4 py-4 transition-colors sm:px-5",
          dragging ? "border-brand bg-brand-soft" : "border-line-strong bg-sunken",
        )}
      >
        <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-line bg-white text-ink-2" aria-hidden>
          <Upload className="size-5" />
        </span>
        <div className="min-w-48 flex-1">
          <p className="font-semibold">{dragging ? "Lepaskan file di sini" : "Seret file ke sini, atau pilih dari komputer"}</p>
          <p className="text-sm text-ink-2">PDF, Word (.docx), atau teks. Paling besar 15 MB per file.</p>
        </div>
        <Button variant="primary" onClick={() => fileInput.current?.click()}>
          Pilih file
        </Button>
      </div>

      {uploads.length > 0 && (
        <ul className="mt-3 space-y-2">
          {uploads.map((item) => (
            <li
              key={item.key}
              className={clsx("flex items-start gap-3 rounded-lg border px-3.5 py-2.5 text-[0.9rem]", item.error ? "border-danger-line bg-danger-soft" : "border-line")}
            >
              {item.error ? <CircleAlert className="mt-0.5 size-[1.125rem] shrink-0 text-danger" aria-hidden /> : <Spinner className="mt-1 shrink-0 text-ink-3" />}
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{item.name}</p>
                <p className={item.error ? "text-danger" : "text-ink-2"} role={item.error ? "alert" : "status"}>
                  {item.error ?? "Sedang diunggah…"}
                </p>
              </div>
              {item.error && (
                <IconButton label="Tutup pesan ini" className="-my-1 -mr-1.5 size-8" onClick={() => setUploads((current) => current.filter((other) => other.key !== item.key))}>
                  <X className="size-4" aria-hidden />
                </IconButton>
              )}
            </li>
          ))}
        </ul>
      )}

      <section className="mt-8" aria-label="Daftar dokumen">
        {documents.isPending ? (
          <Loading />
        ) : documents.isError ? (
          <p className="text-danger">{messageOf(documents.error)}</p>
        ) : rows.length === 0 ? (
          <div className="rounded-lg border border-line px-6 py-10 text-center">
            <BookOpenText className="mx-auto size-6 text-ink-3" aria-hidden />
            <h2 className="mt-3 font-bold">Bot belum punya pengetahuan</h2>
            <p className="mx-auto mt-1 max-w-md text-ink-2">
              Mulai dari hal yang paling sering ditanyakan pelanggan: daftar produk dan harga, jam buka, cara memesan, pengiriman, dan cara pembayaran.
            </p>
          </div>
        ) : (
          <>
            <h2 className="text-sm font-semibold text-ink-2">{rows.length} dokumen</h2>
            <ul className="mt-2 divide-y divide-line rounded-lg border border-line">
              {rows.map((document) => (
                <DocumentRow key={document.id} document={document} onOpen={() => setEditing({ mode: "edit", documentId: document.id })} onDelete={() => setDeleting(document)} />
              ))}
            </ul>
          </>
        )}
      </section>

      {editing && <DocumentEditor tenantId={tenant.id} editing={editing} onClose={() => setEditing(null)} />}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleting(null);
            remove.reset();
          }
        }}
        title="Hapus dokumen ini?"
        confirmLabel="Hapus dokumen"
        busy={remove.isPending}
        error={remove.isError ? messageOf(remove.error) : null}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      >
        <p>
          Bot tidak akan lagi menjawab berdasarkan <b className="font-semibold text-ink">{deleting?.title}</b>. Dokumen yang sudah dihapus tidak bisa dikembalikan.
        </p>
      </ConfirmDialog>
    </Page>
  );
}

function DocumentStatus({ document }: { document: DocumentSummary }) {
  if (document.status === "processing") return <Badge icon={<Spinner className="size-3" />}>Sedang dipelajari…</Badge>;
  if (document.status === "failed") return <Badge tone="danger">Gagal dipelajari</Badge>;
  return (
    <Badge tone="brand" icon={<Check className="size-3" aria-hidden />}>
      Sudah dipelajari
    </Badge>
  );
}

function DocumentRow({ document, onOpen, onDelete }: { document: DocumentSummary; onOpen: () => void; onDelete: () => void }) {
  return (
    <li className="flex items-center gap-3 px-3.5 py-3 sm:px-4">
      <FileText className="size-5 shrink-0 text-ink-3" aria-hidden />
      <div className="min-w-0 flex-1">
        <button type="button" onClick={onOpen} className="block max-w-full truncate rounded text-left font-semibold hover:underline hover:underline-offset-2">
          {document.title}
        </button>
        <p className="truncate text-sm text-ink-3">
          {document.fileName ?? "Ditulis langsung"} · {NUMBER.format(document.length)} karakter · diubah {ago(document.updatedAt)}
        </p>
        {document.status === "failed" && <p className="mt-1 text-sm text-danger">{document.error ?? "Dokumen ini tidak bisa diproses. Buka lalu simpan ulang untuk mencoba lagi."}</p>}
        <div className="mt-1.5 sm:hidden">
          <DocumentStatus document={document} />
        </div>
      </div>
      <div className="hidden sm:block">
        <DocumentStatus document={document} />
      </div>
      <Menu
        trigger={
          <IconButton label={`Tindakan untuk ${document.title}`}>
            <Ellipsis className="size-5" aria-hidden />
          </IconButton>
        }
      >
        <MenuItem icon={<PenLine className="size-4 text-ink-2" aria-hidden />} onSelect={onOpen}>
          Lihat dan ubah
        </MenuItem>
        <MenuItem danger icon={<Trash2 className="size-4" aria-hidden />} onSelect={onDelete}>
          Hapus
        </MenuItem>
      </Menu>
    </li>
  );
}

const EXAMPLE = `# Jam buka
Senin sampai Sabtu, pukul 09.00 sampai 17.00. Minggu dan hari libur nasional tutup.

# Cara memesan
Pesanan dibuat lewat website atau WhatsApp. Pesanan sebelum pukul 14.00 dikirim di hari yang sama.`;

function DocumentEditor({ tenantId, editing, onClose }: { tenantId: string; editing: NonNullable<Editing>; onClose: () => void }) {
  const toast = useToast();
  const documentId = editing.mode === "edit" ? editing.documentId : null;
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [loaded, setLoaded] = useState(documentId === null);

  const existing = useQuery({
    queryKey: keys.document(documentId ?? ""),
    queryFn: () => api<DocumentDetail>(`/documents/${documentId}`),
    enabled: documentId !== null,
    staleTime: 0,
    gcTime: 0,
  });

  // Isi dokumen disalin ke formulir satu kali. Setelah itu, yang berlaku adalah ketikan pengguna.
  useEffect(() => {
    if (existing.data && !loaded) {
      setTitle(existing.data.title);
      setContent(existing.data.content);
      setLoaded(true);
    }
  }, [existing.data, loaded]);

  const save = useMutation({
    mutationFn: () =>
      documentId ? api(`/documents/${documentId}`, { method: "PUT", body: { title, content } }) : api(`/tenants/${tenantId}/documents`, { body: { title, content } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.documents(tenantId) });
      onClose();
      toast("Dokumen disimpan. Bot sedang mempelajarinya.");
    },
  });

  const unchanged = existing.data ? title === existing.data.title && content === existing.data.content : false;

  return (
    <Modal
      open
      onOpenChange={(open) => !open && !save.isPending && onClose()}
      title={documentId ? "Lihat dan ubah dokumen" : "Tulis pengetahuan"}
      description={documentId ? "Setelah disimpan, bot mempelajari ulang isi dokumen ini." : "Tulis seperti menjelaskan kepada karyawan baru. Bot memakai isi tulisan ini apa adanya."}
      size="lg"
      keepOnOutsideClick
    >
      {existing.isError ? (
        <ModalBody>
          <p className="text-danger">{messageOf(existing.error)}</p>
        </ModalBody>
      ) : !loaded ? (
        <ModalBody>
          <Loading label="Membuka dokumen…" />
        </ModalBody>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <ModalBody className="space-y-5">
            <Field label="Judul">
              {(control) => (
                <input
                  {...control}
                  className="field"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Contoh: Pengiriman dan ongkos kirim"
                  maxLength={120}
                  autoFocus={!documentId}
                />
              )}
            </Field>
            <Field
              label="Isi"
              hint="Pisahkan tiap topik dengan baris judul yang diawali tanda #. Judul seperti itu membantu bot menemukan bagian yang tepat."
              error={save.isError ? messageOf(save.error) : null}
            >
              {(control) => (
                <textarea
                  {...control}
                  className="field h-[min(24rem,45dvh)] resize-y leading-relaxed"
                  value={content}
                  onChange={(event) => setContent(event.target.value)}
                  placeholder={EXAMPLE}
                  spellCheck={false}
                />
              )}
            </Field>
          </ModalBody>
          <ModalFooter>
            <Button onClick={onClose} disabled={save.isPending}>
              Batal
            </Button>
            <Button type="submit" variant="primary" busy={save.isPending} disabled={title.trim().length < 2 || content.trim().length < 20 || unchanged}>
              {documentId ? "Simpan perubahan" : "Simpan"}
            </Button>
          </ModalFooter>
        </form>
      )}
    </Modal>
  );
}
