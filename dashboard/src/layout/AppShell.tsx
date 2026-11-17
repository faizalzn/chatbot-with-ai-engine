import { useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import { BookOpenText, Cable, Check, ChevronsUpDown, FlaskConical, LogOut, Menu as MenuIcon, MessagesSquare, Plus, Settings, TriangleAlert, type LucideIcon } from "lucide-react";
import { Dialog, VisuallyHidden } from "radix-ui";
import { useEffect, useState } from "react";
import { Navigate, NavLink, Outlet, useLocation, useNavigate, useOutletContext, useParams } from "react-router";
import { Loading } from "../components/Bits";
import { Button, IconButton } from "../components/Button";
import { Menu, MenuItem, MenuLabel, MenuSeparator } from "../components/Menu";
import { api, keys, messageOf, queryClient, SESSION_KEY, type SystemStatus, type TenantSummary } from "../lib/api";
import { rememberTenant } from "../lib/storage";
import { TenantMark, WaitingCount } from "./Brand";
import { NewBusinessDialog } from "./NewBusinessDialog";

interface ShellContext {
  tenant: TenantSummary;
}

/** Bisnis yang sedang dibuka. Tersedia di semua halaman di dalam kerangka dashboard. */
export function useTenant(): TenantSummary {
  return useOutletContext<ShellContext>().tenant;
}

export function useTenants() {
  return useQuery({ queryKey: keys.tenants, queryFn: () => api<TenantSummary[]>("/tenants"), refetchInterval: 5000 });
}

export async function logout(): Promise<void> {
  await api("/auth/logout", { method: "POST" }).catch(() => {});
  queryClient.setQueryData(SESSION_KEY, { authenticated: false });
  queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== SESSION_KEY[0] });
}

const SECTIONS: { path: string; label: string; icon: LucideIcon }[] = [
  { path: "percakapan", label: "Percakapan", icon: MessagesSquare },
  { path: "pengetahuan", label: "Pengetahuan", icon: BookOpenText },
  { path: "saluran", label: "Saluran", icon: Cable },
  { path: "coba", label: "Coba bot", icon: FlaskConical },
  { path: "pengaturan", label: "Pengaturan", icon: Settings },
];

interface SidebarProps {
  tenant: TenantSummary;
  tenants: TenantSummary[];
  onCreate: () => void;
}

function Sidebar({ tenant, tenants, onCreate }: SidebarProps) {
  const navigate = useNavigate();
  const section = useLocation().pathname.split("/")[3] ?? "percakapan";

  return (
    <div className="flex h-full flex-col gap-4 p-3">
      <Menu
        align="start"
        matchTrigger
        trigger={
          <button
            type="button"
            className="flex w-full items-center gap-2.5 rounded-lg border border-line bg-white px-2.5 py-2 text-left transition-colors hover:border-line-strong"
            aria-label={`Bisnis: ${tenant.name}. Pindah bisnis`}
          >
            <TenantMark name={tenant.name} color={tenant.accentColor} />
            <span className="min-w-0 flex-1 truncate text-[0.9rem] font-semibold">{tenant.name}</span>
            <ChevronsUpDown className="size-4 shrink-0 text-ink-3" aria-hidden />
          </button>
        }
      >
        <MenuLabel>Pindah bisnis</MenuLabel>
        {tenants.map((other) => (
          <MenuItem key={other.id} icon={<TenantMark name={other.name} color={other.accentColor} className="size-6" />} onSelect={() => navigate(`/b/${other.id}/${section}`)}>
            <span className="min-w-0 flex-1">{other.name}</span>
            <WaitingCount count={other.waiting} />
            {other.id === tenant.id && <Check className="size-4 shrink-0 text-brand" aria-label="Sedang dibuka" />}
          </MenuItem>
        ))}
        <MenuSeparator />
        <MenuItem icon={<Plus className="size-4 text-ink-2" aria-hidden />} onSelect={onCreate}>
          Tambah bisnis
        </MenuItem>
      </Menu>

      <nav aria-label="Menu utama" className="flex flex-col gap-0.5">
        {SECTIONS.map(({ path, label, icon: Icon }) => (
          <NavLink
            key={path}
            to={`/b/${tenant.id}/${path}`}
            className={({ isActive }) =>
              clsx(
                "group flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-[0.9rem] transition-colors",
                isActive ? "bg-white font-semibold text-ink ring-1 ring-line" : "font-medium text-ink-2 hover:bg-hover hover:text-ink",
              )
            }
          >
            <Icon className="size-[1.125rem] shrink-0 group-aria-[current=page]:text-brand" aria-hidden />
            <span className="flex-1">{label}</span>
            {path === "percakapan" && <WaitingCount count={tenant.waiting} />}
          </NavLink>
        ))}
      </nav>

      <Button variant="ghost" size="sm" className="mt-auto justify-start px-2.5" icon={<LogOut className="size-4" aria-hidden />} onClick={() => void logout()}>
        Keluar
      </Button>
    </div>
  );
}

function BotNotReady({ problem }: { problem: string | null }) {
  return (
    <div role="status" className="flex items-start gap-2.5 border-b border-warn-line bg-warn-soft px-5 py-2.5 text-[0.9rem] text-warn sm:px-8">
      <TriangleAlert className="mt-0.5 size-[1.125rem] shrink-0" aria-hidden />
      <p>
        <b className="font-semibold">Bot belum bisa menjawab.</b> {problem ?? "Pengaturan model AI belum lengkap."} Lengkapi bagian model AI di file{" "}
        <code className="font-mono text-[0.85em]">.env</code>, lalu nyalakan ulang server.
      </p>
    </div>
  );
}

/** Kerangka dashboard: navigasi di kiri, halaman bisnis yang dipilih di kanan. */
export function AppShell() {
  const { tenantId } = useParams();
  const location = useLocation();
  const tenants = useTenants();
  const status = useQuery({ queryKey: keys.status, queryFn: () => api<SystemStatus>("/status"), staleTime: 60_000 });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  const tenant = tenants.data?.find((candidate) => candidate.id === tenantId);
  const waiting = tenant?.waiting ?? 0;
  const tenantName = tenant?.name;

  useEffect(() => setDrawerOpen(false), [location.pathname]);
  useEffect(() => {
    if (tenantId && tenantName) rememberTenant(tenantId);
  }, [tenantId, tenantName]);
  useEffect(() => {
    if (tenantName) document.title = `${waiting > 0 ? `(${waiting}) ` : ""}${tenantName} · Sahut`;
    return () => {
      document.title = "Sahut";
    };
  }, [tenantName, waiting]);

  if (tenants.isPending) return <Loading />;
  if (tenants.isError) {
    return (
      <div className="grid h-full place-items-center p-6 text-center">
        <div>
          <p className="font-semibold">Daftar bisnis tidak bisa dimuat</p>
          <p className="mt-1 text-ink-2">{messageOf(tenants.error)}</p>
          <Button className="mt-4" onClick={() => void tenants.refetch()}>
            Coba lagi
          </Button>
        </div>
      </div>
    );
  }
  if (!tenant) return <Navigate to="/" replace />;

  const sidebar = (
    <Sidebar
      tenant={tenant}
      tenants={tenants.data}
      onCreate={() => {
        setDrawerOpen(false);
        setCreating(true);
      }}
    />
  );

  return (
    <div className="flex h-full">
      <aside className="hidden w-64 shrink-0 border-r border-line bg-sunken md:block">{sidebar}</aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-2 md:hidden">
          <IconButton label="Buka menu" onClick={() => setDrawerOpen(true)}>
            <MenuIcon className="size-5" aria-hidden />
          </IconButton>
          <TenantMark name={tenant.name} color={tenant.accentColor} className="size-6" />
          <span className="min-w-0 flex-1 truncate font-semibold">{tenant.name}</span>
          <WaitingCount count={waiting} className="mr-2" />
        </header>

        {status.data && !status.data.botReady && <BotNotReady problem={status.data.problem} />}

        <main className="min-h-0 flex-1">
          <Outlet context={{ tenant } satisfies ShellContext} />
        </main>
      </div>

      <Dialog.Root open={drawerOpen} onOpenChange={setDrawerOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 animate-fade bg-ink/45 md:hidden" />
          <Dialog.Content aria-describedby={undefined} className="fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] animate-slide border-r border-line bg-sunken outline-none md:hidden">
            <VisuallyHidden.Root>
              <Dialog.Title>Menu</Dialog.Title>
            </VisuallyHidden.Root>
            {sidebar}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <NewBusinessDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}
