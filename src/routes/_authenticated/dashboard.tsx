import { createFileRoute, Link, useRouter, useNavigate } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  getDashboardStats,
  getProfile,
  listCampaigns,
  deleteCampaign,
  cloneCampaign,
} from "@/lib/campaigns.functions";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Send, XCircle, Eye, MailCheck, Plus, Trash2, AlertTriangle, Copy } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";

const statsQuery = queryOptions({
  queryKey: ["dashboard-stats"],
  queryFn: () => getDashboardStats(),
});
const profileQuery = queryOptions({
  queryKey: ["profile"],
  queryFn: () => getProfile(),
});
const campaignsQuery = queryOptions({
  queryKey: ["campaigns"],
  queryFn: () => listCampaigns(),
});

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — Conexão Implantes" },
      { name: "description", content: "Acompanhe envios, aberturas e cota diária das suas campanhas." },
      { property: "og:title", content: "Dashboard — Conexão Implantes" },
      { property: "og:description", content: "Acompanhe envios, aberturas e cota diária das suas campanhas." },
    ],
  }),
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(statsQuery),
      context.queryClient.ensureQueryData(profileQuery),
      context.queryClient.ensureQueryData(campaignsQuery),
    ]),
  errorComponent: ({ error, reset }) => (
    <div className="rounded-lg bg-brand-surface p-6">
      <p className="text-destructive">Erro: {error.message}</p>
      <Button onClick={reset} className="mt-3">Tentar novamente</Button>
    </div>
  ),
  component: Dashboard,
});

function StatCard({ icon: Icon, label, value, tone }: { icon: typeof Send; label: string; value: string; tone?: string }) {
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

function Dashboard() {
  const router = useRouter();
  const navigate = useNavigate();
  const { data: stats } = useSuspenseQuery(statsQuery);
  const { data: profile } = useSuspenseQuery(profileQuery);
  const { data: campaigns } = useSuspenseQuery(campaignsQuery);
  const del = useServerFn(deleteCampaign);
  const clone = useServerFn(cloneCampaign);

  const pct = Math.min(100, Math.round((stats.usedToday / stats.dailyLimit) * 100));

  if (profile.status !== "approved") {
    return (
      <div className="max-w-2xl mx-auto rounded-xl bg-brand-surface p-8 text-center space-y-4">
        <div className="mx-auto h-12 w-12 rounded-full gradient-brand text-primary-foreground flex items-center justify-center">
          <AlertTriangle className="h-6 w-6" />
        </div>
        {profile.status === "pending" ? (
          <>
            <h1 className="text-2xl font-semibold">Aguardando aprovação</h1>
            <p className="text-muted-foreground">
              Seu cadastro foi recebido e está aguardando aprovação do Super Admin. Você
              receberá acesso ao painel assim que sua conta e cota diária forem liberadas.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-semibold">Acesso rejeitado</h1>
            <p className="text-muted-foreground">
              Seu cadastro foi rejeitado pelo Super Admin. Entre em contato com o
              administrador da plataforma se acreditar que se trata de um engano.
            </p>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {!profile.smtp_configured && (
        <div className="flex items-start gap-3 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-4">
          <AlertTriangle className="h-5 w-5 text-yellow-400 mt-0.5" />
          <div className="flex-1">
            <p className="font-medium">Configure seu SMTP</p>
            <p className="text-sm text-muted-foreground">
              É necessário salvar as credenciais SMTP antes de disparar campanhas.
            </p>
          </div>
          <Link to="/settings">
            <Button size="sm" className="gradient-brand text-primary-foreground">Configurar</Button>
          </Link>
        </div>
      )}

      <section>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-3xl font-semibold">Dashboard</h1>
            <p className="text-sm text-muted-foreground">Visão geral das campanhas e cota diária.</p>
          </div>
          <Link to="/campaigns/new">
            <Button className="gradient-brand text-primary-foreground">
              <Plus className="mr-1 h-4 w-4" /> Nova campanha
            </Button>
          </Link>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard icon={Send} label="Enviados" value={stats.sent.toString()} />
          <StatCard icon={XCircle} label="Falharam" value={stats.failed.toString()} tone="bg-brand-error/20 text-brand-error" />
          <StatCard icon={Eye} label="Aberturas" value={stats.opened.toString()} tone="bg-brand-success/20 text-brand-success" />
          <StatCard icon={MailCheck} label="Taxa de abertura" value={`${stats.openRate.toFixed(1)}%`} />
        </div>
      </section>

      <section className="rounded-xl bg-brand-surface p-6">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold">Cota diária</h2>
          <span className="text-sm text-muted-foreground">
            {stats.usedToday} / {stats.dailyLimit} emails hoje
          </span>
        </div>
        <Progress value={pct} className="h-2" />
        <p className="mt-2 text-xs text-muted-foreground">Reset automático à meia-noite (fuso do servidor).</p>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">Campanhas recentes</h2>
        {campaigns.length === 0 ? (
          <div className="rounded-xl bg-brand-surface p-10 text-center text-muted-foreground">
            Nenhuma campanha ainda. <Link to="/campaigns/new" className="text-brand-accent hover:underline">Crie a primeira</Link>.
          </div>
        ) : (
          <div className="rounded-xl bg-brand-surface overflow-hidden divide-y divide-brand-surface-hover/40">
            {campaigns.map((c) => (
              <div key={c.id} className="flex items-center justify-between p-4 hover:bg-brand-surface-hover/30 transition-colors">
                <Link to="/campaigns/$id" params={{ id: c.id }} className="flex-1 min-w-0">
                  <p className="font-medium truncate">{c.title}</p>
                  <p className="text-xs text-muted-foreground truncate">{c.subject} · {c.total_recipients} destinatários</p>
                </Link>
                <div className="flex items-center gap-3">
                  <StatusBadge status={c.status} />
                  <button
                    onClick={async (e) => {
                      e.preventDefault();
                      try {
                        const { id } = await clone({ data: { id: c.id } });
                        toast.success("Campanha clonada");
                        navigate({ to: "/campaigns/$id", params: { id } });
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : "Falha ao clonar");
                      }
                    }}
                    className="text-muted-foreground hover:text-brand-accent p-1"
                    aria-label="Clonar"
                    title="Clonar campanha"
                  >
                    <Copy className="h-4 w-4" />
                  </button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-destructive p-1"
                        aria-label="Excluir"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Excluir campanha?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Esta ação é permanente. A campanha "{c.title}" e todos os seus destinatários serão removidos.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={async () => {
                            try {
                              await del({ data: { id: c.id } });
                              toast.success("Campanha excluída");
                              router.invalidate();
                            } catch (err) {
                              toast.error(err instanceof Error ? err.message : "Falha ao excluir");
                            }
                          }}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          Excluir
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    draft: { label: "Rascunho", cls: "bg-brand-badge-bg text-muted-foreground" },
    processing: { label: "Enviando", cls: "bg-brand-warning/20 text-brand-warning" },
    paused: { label: "Pausada", cls: "bg-brand-badge-bg text-muted-foreground" },
    completed: { label: "Concluída", cls: "bg-brand-success/20 text-brand-success" },
    failed: { label: "Falhou", cls: "bg-brand-error/20 text-brand-error" },
  };
  const v = map[status] ?? map.draft;
  return <span className={`text-xs px-2 py-1 rounded-md font-medium ${v.cls}`}>{v.label}</span>;
}
