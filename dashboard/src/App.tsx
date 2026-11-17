import { useQuery } from "@tanstack/react-query";
import { Building2 } from "lucide-react";
import { useState } from "react";
import { Navigate, Route, Routes } from "react-router";
import { EmptyState, Loading } from "./components/Bits";
import { Button } from "./components/Button";
import { AppShell, logout, useTenants } from "./layout/AppShell";
import { NewBusinessDialog } from "./layout/NewBusinessDialog";
import { api, messageOf, SESSION_KEY } from "./lib/api";
import { lastTenant } from "./lib/storage";
import { ChannelsPage } from "./pages/ChannelsPage";
import { ConversationsPage } from "./pages/ConversationsPage";
import { KnowledgePage } from "./pages/KnowledgePage";
import { LoginPage } from "./pages/LoginPage";
import { SettingsPage } from "./pages/SettingsPage";
import { TestBotPage } from "./pages/TestBotPage";

function Problem({ title, detail, onRetry }: { title: string; detail: string; onRetry: () => void }) {
  return (
    <div className="grid h-full place-items-center p-6 text-center">
      <div>
        <p className="text-lg font-bold">{title}</p>
        <p className="mt-1 text-ink-2">{detail}</p>
        <Button className="mt-5" onClick={onRetry}>
          Coba lagi
        </Button>
      </div>
    </div>
  );
}

/** Halaman awal: membuka bisnis yang terakhir dipakai, atau mengajak membuat bisnis pertama. */
function Home() {
  const tenants = useTenants();
  const [creating, setCreating] = useState(false);

  if (tenants.isPending) return <Loading />;
  if (tenants.isError) return <Problem title="Daftar bisnis tidak bisa dimuat" detail={messageOf(tenants.error)} onRetry={() => void tenants.refetch()} />;

  const target = tenants.data.find((tenant) => tenant.id === lastTenant()) ?? tenants.data[0];
  if (target) return <Navigate to={`/b/${target.id}/percakapan`} replace />;

  return (
    <div className="grid h-full place-items-center">
      <EmptyState
        icon={<Building2 />}
        title="Belum ada bisnis"
        actions={
          <>
            <Button variant="primary" onClick={() => setCreating(true)}>
              Tambah bisnis
            </Button>
            <Button variant="ghost" onClick={() => void logout()}>
              Keluar
            </Button>
          </>
        }
      >
        <p>Tambahkan bisnis pertama, lalu masukkan dokumen yang perlu dipelajari botnya.</p>
        <p className="mt-2 text-sm text-ink-3">
          Ingin melihat contoh dulu? Jalankan <code className="font-mono">npm run seed</code> untuk memuat tiga bisnis contoh.
        </p>
      </EmptyState>
      <NewBusinessDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}

export function App() {
  const session = useQuery({
    queryKey: SESSION_KEY,
    queryFn: () => api<{ authenticated: boolean }>("/auth/session"),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  if (session.isPending) return <Loading />;
  if (session.isError) return <Problem title="Server tidak bisa dihubungi" detail={messageOf(session.error)} onRetry={() => void session.refetch()} />;
  if (!session.data.authenticated) return <LoginPage />;

  return (
    <Routes>
      <Route index element={<Home />} />
      <Route path="b/:tenantId" element={<AppShell />}>
        <Route index element={<Navigate to="percakapan" replace />} />
        <Route path="percakapan" element={<ConversationsPage />} />
        <Route path="percakapan/:conversationId" element={<ConversationsPage />} />
        <Route path="pengetahuan" element={<KnowledgePage />} />
        <Route path="saluran" element={<ChannelsPage />} />
        <Route path="coba" element={<TestBotPage />} />
        <Route path="pengaturan" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
