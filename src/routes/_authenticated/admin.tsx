import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
  adminGlobalStats,
  adminListUsers,
  adminUpdateLimits,
  adminSaveUserSmtp,
  isAdmin,
} from "@/lib/admin.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Users,
  Send,
  XCircle,
  Eye,
  Mail,
  Activity,
  Shield,
  Pencil,
  Server,
} from "lucide-react";

const adminGuardQuery = queryOptions({
  queryKey: ["is-admin"],
  queryFn: () => isAdmin(),
});
const globalStatsQuery = queryOptions({
  queryKey: ["admin-global-stats"],
  queryFn: () => adminGlobalStats(),
  refetchInterval: 5000,
});
const usersQuery = queryOptions({
  queryKey: ["admin-users"],
  queryFn: () => adminListUsers(),
});

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({
    meta: [
      { title: "Super Admin — Conexão Implantes" },
      { name: "description", content: "Painel administrativo: SMTP, cotas diárias e métricas de consumo." },
      { property: "og:title", content: "Super Admin — Conexão Implantes" },
      { property: "og:description", content: "Painel administrativo: SMTP, cotas diárias e métricas de consumo." },
    ],
  }),
  loader: async ({ context }) => {
    const guard = await context.queryClient.ensureQueryData(adminGuardQuery);
    if (!guard.isAdmin) throw new Error("Acesso negado — somente super admin.");
    await Promise.all([
      context.queryClient.ensureQueryData(globalStatsQuery),
      context.queryClient.ensureQueryData(usersQuery),
    ]);
  },
  errorComponent: ({ error, reset }) => (
    <div className="rounded-lg bg-brand-surface p-6">
      <p className="text-destructive">Erro: {error.message}</p>
      <Button onClick={reset} className="mt-3">Tentar novamente</Button>
    </div>
  ),
  component: AdminPage,
});

function Stat({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Send;
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="rounded-xl bg-brand-surface p-5 border border-transparent card-hover-glow">
      <div className="flex items-center gap-3">
        <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${tone ?? "gradient-brand text-primary-foreground"}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
          <p className="text-2xl font-semibold">{value}</p>
        </div>
      </div>
    </div>
  );
}

function AdminPage() {
  const { data: stats } = useSuspenseQuery(globalStatsQuery);
  const { data: users } = useSuspenseQuery(usersQuery);
  const qc = useQueryClient();
  const saveLimits = useServerFn(adminUpdateLimits);
  const saveSmtp = useServerFn(adminSaveUserSmtp);

  const pct = stats.totalLimit > 0 ? Math.min(100, Math.round((stats.usedToday / stats.totalLimit) * 100)) : 0;

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-lg gradient-brand text-primary-foreground flex items-center justify-center">
          <Shield className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-3xl font-semibold">Super Admin</h1>
          <p className="text-sm text-muted-foreground">SMTP, cotas diárias e métricas de consumo em toda a plataforma.</p>
        </div>
      </div>

      <section>
        <h2 className="text-lg font-semibold mb-3">Métricas globais</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat icon={Users} label="Usuários" value={stats.users.toString()} />
          <Stat icon={Mail} label="Campanhas" value={stats.campaigns.toString()} />
          <Stat icon={Send} label="Enviados" value={stats.sent.toString()} />
          <Stat
            icon={XCircle}
            label="Falharam"
            value={stats.failed.toString()}
            tone="bg-brand-error/20 text-brand-error"
          />
          <Stat icon={Eye} label="Aberturas" value={stats.opened.toString()} tone="bg-brand-success/20 text-brand-success" />
          <Stat icon={Activity} label="Em processamento" value={stats.processing.toString()} />
          <Stat icon={Mail} label="Pendentes" value={stats.pending.toString()} />
          <Stat icon={Eye} label="Taxa abertura" value={`${stats.openRate.toFixed(1)}%`} />
        </div>
      </section>

      <section className="rounded-xl bg-brand-surface p-6">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold">Consumo diário global</h2>
          <span className="text-sm text-muted-foreground">
            {stats.usedToday} / {stats.totalLimit} emails hoje
          </span>
        </div>
        <Progress value={pct} className="h-2" />
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">Usuários da plataforma</h2>
        <div className="rounded-xl bg-brand-surface overflow-hidden">
          <div className="grid grid-cols-12 gap-3 px-4 py-3 text-xs uppercase tracking-wider text-muted-foreground border-b border-brand-surface-hover/40">
            <div className="col-span-4">Usuário</div>
            <div className="col-span-2">SMTP</div>
            <div className="col-span-2 text-right">Cota</div>
            <div className="col-span-3 text-right">Métricas</div>
            <div className="col-span-1 text-right">Ações</div>
          </div>
          {users.map((u) => (
            <UserRow
              key={u.id}
              user={u}
              onSaveLimit={async (limit) => {
                await saveLimits({ data: { user_id: u.id, daily_limit: limit } });
                toast.success("Cota atualizada");
                qc.invalidateQueries({ queryKey: ["admin-users"] });
              }}
              onSaveSmtp={async (form) => {
                await saveSmtp({ data: { user_id: u.id, ...form } });
                toast.success("SMTP atualizado");
                qc.invalidateQueries({ queryKey: ["admin-users"] });
              }}
            />
          ))}
          {users.length === 0 && (
            <div className="p-8 text-center text-muted-foreground">Nenhum usuário cadastrado.</div>
          )}
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">Campanhas recentes (todos os usuários)</h2>
        <div className="rounded-xl bg-brand-surface overflow-hidden divide-y divide-brand-surface-hover/40">
          {stats.recentCampaigns.length === 0 && (
            <div className="p-8 text-center text-muted-foreground">Nenhuma campanha ainda.</div>
          )}
          {stats.recentCampaigns.map((c) => (
            <div key={c.id} className="flex items-center justify-between p-4">
              <div className="min-w-0">
                <p className="font-medium truncate">{c.title}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {c.email ?? c.user_id.slice(0, 8)} · {c.subject} · {c.total_recipients} destinatários
                </p>
              </div>
              <span className="text-xs px-2 py-1 rounded-md bg-brand-surface-hover/40 text-muted-foreground uppercase tracking-wider">
                {c.status}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

type AdminUser = Awaited<ReturnType<typeof adminListUsers>>[number];

function UserRow({
  user,
  onSaveLimit,
  onSaveSmtp,
}: {
  user: AdminUser;
  onSaveLimit: (limit: number) => Promise<void>;
  onSaveSmtp: (form: {
    smtp_host: string;
    smtp_port: number;
    smtp_user: string;
    smtp_pass?: string;
    from_name?: string | null;
  }) => Promise<void>;
}) {
  const [limit, setLimit] = useState(user.daily_limit);
  const [savingLimit, setSavingLimit] = useState(false);
  const [smtpOpen, setSmtpOpen] = useState(false);
  const usedPct = user.daily_limit > 0 ? Math.min(100, Math.round(((user.emails_sent_today ?? 0) / user.daily_limit) * 100)) : 0;

  return (
    <div className="grid grid-cols-12 gap-3 px-4 py-4 items-center border-b border-brand-surface-hover/30 last:border-0">
      <div className="col-span-4 min-w-0">
        <div className="flex items-center gap-2">
          <p className="font-medium truncate">{user.email ?? user.id.slice(0, 8)}</p>
          {user.is_admin && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-brand-accent/20 text-brand-accent uppercase tracking-wider">
              Admin
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground truncate">{user.smtp_user ?? "sem SMTP"}</p>
      </div>
      <div className="col-span-2 text-sm">
        {user.smtp_configured ? (
          <span className="text-brand-success">Configurado</span>
        ) : (
          <span className="text-muted-foreground">Pendente</span>
        )}
        <p className="text-xs text-muted-foreground truncate">
          {user.smtp_host}:{user.smtp_port}
        </p>
      </div>
      <div className="col-span-2">
        <div className="flex items-center gap-2 justify-end">
          <Input
            type="number"
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            className="h-8 w-20 text-right"
          />
          <Button
            size="sm"
            variant="secondary"
            disabled={savingLimit || limit === user.daily_limit}
            onClick={async () => {
              setSavingLimit(true);
              try {
                await onSaveLimit(limit);
              } catch (e) {
                toast.error("Falha", { description: (e as Error).message });
              } finally {
                setSavingLimit(false);
              }
            }}
          >
            Salvar
          </Button>
        </div>
        <div className="mt-1 text-xs text-muted-foreground text-right">
          {user.emails_sent_today ?? 0} usados · {usedPct}%
        </div>
      </div>
      <div className="col-span-3 text-right text-sm">
        <p>{user.stats.campaigns} campanhas · {user.stats.sent} enviados</p>
        <p className="text-xs text-muted-foreground">
          {user.stats.failed} falhas · {user.stats.opened} aberturas
        </p>
      </div>
      <div className="col-span-1 flex justify-end">
        <Dialog open={smtpOpen} onOpenChange={setSmtpOpen}>
          <DialogTrigger asChild>
            <Button size="icon" variant="ghost" aria-label="Editar SMTP">
              <Server className="h-4 w-4" />
            </Button>
          </DialogTrigger>
          <SmtpDialog
            user={user}
            onClose={() => setSmtpOpen(false)}
            onSave={async (form) => {
              await onSaveSmtp(form);
              setSmtpOpen(false);
            }}
          />
        </Dialog>
      </div>
    </div>
  );
}

function SmtpDialog({
  user,
  onClose,
  onSave,
}: {
  user: AdminUser;
  onClose: () => void;
  onSave: (form: {
    smtp_host: string;
    smtp_port: number;
    smtp_user: string;
    smtp_pass?: string;
    from_name?: string | null;
  }) => Promise<void>;
}) {
  const [form, setForm] = useState({
    smtp_host: user.smtp_host,
    smtp_port: user.smtp_port,
    smtp_user: user.smtp_user ?? "",
    smtp_pass: "",
    from_name: user.from_name ?? "",
  });
  const [busy, setBusy] = useState(false);

  return (
    <DialogContent className="max-w-lg">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Pencil className="h-4 w-4" /> SMTP de {user.email}
        </DialogTitle>
      </DialogHeader>
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await onSave({
              smtp_host: form.smtp_host,
              smtp_port: Number(form.smtp_port),
              smtp_user: form.smtp_user,
              smtp_pass: form.smtp_pass || undefined,
              from_name: form.from_name || null,
            });
          } catch (err) {
            toast.error("Falha ao salvar", { description: (err as Error).message });
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <Label htmlFor="ah">Servidor</Label>
            <Input id="ah" value={form.smtp_host} onChange={(e) => setForm({ ...form, smtp_host: e.target.value })} required />
          </div>
          <div>
            <Label htmlFor="ap">Porta</Label>
            <Input id="ap" type="number" value={form.smtp_port} onChange={(e) => setForm({ ...form, smtp_port: Number(e.target.value) })} required />
          </div>
        </div>
        <div>
          <Label htmlFor="au">Usuário</Label>
          <Input id="au" type="email" value={form.smtp_user} onChange={(e) => setForm({ ...form, smtp_user: e.target.value })} required autoComplete="off" />
        </div>
        <div>
          <Label htmlFor="apw">Senha (deixe vazio para manter)</Label>
          <Input
            id="apw"
            type="password"
            value={form.smtp_pass}
            onChange={(e) => setForm({ ...form, smtp_pass: e.target.value })}
            placeholder={user.smtp_configured ? "•••••••• (atual)" : "senha SMTP"}
            autoComplete="new-password"
          />
        </div>
        <div>
          <Label htmlFor="afn">Nome remetente</Label>
          <Input id="afn" value={form.from_name} onChange={(e) => setForm({ ...form, from_name: e.target.value })} />
        </div>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={busy} className="gradient-brand text-primary-foreground">
            {busy ? "Salvando..." : "Salvar SMTP"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
