import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "../components/Button";
import { Field } from "../components/Field";
import { Modal, ModalBody, ModalFooter } from "../components/Modal";
import { useToast } from "../components/Toast";
import { api, keys, messageOf, queryClient, type Tenant } from "../lib/api";

export function NewBusinessDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [name, setName] = useState("");
  const navigate = useNavigate();
  const toast = useToast();

  const create = useMutation({
    mutationFn: () => api<Tenant>("/tenants", { body: { name } }),
    onSuccess: async (tenant) => {
      // Daftar bisnis dimuat ulang dulu, supaya halaman bisnis baru langsung dikenali.
      await queryClient.invalidateQueries({ queryKey: keys.tenants });
      onOpenChange(false);
      setName("");
      navigate(`/b/${tenant.id}/pengetahuan`);
      toast("Bisnis dibuat. Sekarang masukkan dokumen yang perlu dipelajari bot.");
    },
  });

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) create.reset();
      }}
      title="Tambah bisnis"
      description="Setiap bisnis punya bot, pengetahuan, dan percakapannya sendiri."
      size="sm"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate();
        }}
      >
        <ModalBody>
          <Field label="Nama bisnis" error={create.isError ? messageOf(create.error) : null}>
            {(control) => (
              <input {...control} className="field" value={name} onChange={(event) => setName(event.target.value)} placeholder="Contoh: Toko Roti Melati" maxLength={80} autoFocus />
            )}
          </Field>
        </ModalBody>
        <ModalFooter>
          <Button onClick={() => onOpenChange(false)}>Batal</Button>
          <Button type="submit" variant="primary" busy={create.isPending} disabled={name.trim().length < 2}>
            Buat bisnis
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
