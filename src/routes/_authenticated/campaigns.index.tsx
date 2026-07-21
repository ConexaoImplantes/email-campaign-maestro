import { createFileRoute, Link, useRouter, useNavigate } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listCampaigns, deleteCampaign, cloneCampaign } from "@/lib/campaigns.functions";
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
import { Plus, Trash2, Copy } from "lucide-react";
import { toast } from "sonner";
import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";

const campaignsQuery = queryOptions({
  queryKey: ["campaigns"],
  queryFn: () => listCampaigns(),
});

const FILTERS = [
  { key: "all", label: "Todas" },
  { key: "processing", label: "Em andamento" },
  { key: "paused", label: "Pausadas" },
  { key: "completed", label: "Concluídas" },
  { key: "draft", label: "Rascunhos" },
  { key: "failed", label: "Falharam" },
] as const;

type FilterKey = (typeof FILTERS)[number]["key"];

export const Route = createFileRoute("/_authenticated/campaigns/")({
  head: () => ({
    meta: [
      { title: "Campanhas — Conexão Implantes" },
      { name: "description", content: "Todas as suas campanhas de email em um só lugar." },
      { property: "og:title", content: "Campanhas — Conexão Implantes" },
      { property: "og:description", content: "Todas as suas campanhas de email em um só lugar." },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(campaignsQuery),
  errorComponent: ({ error, reset }) => (
    <div className="rounded-lg bg-brand-surface p-6">
      <p className="text-destructive">Erro: {error.message}</p>
      <Button onClick={reset} className="mt-3">Tentar novamente</Button>
    </div>
  ),
  component: CampaignsList,
});

function CampaignsList() {
  const router = useRouter();
  const navigate = useNavigate();
  const { data: campaigns } = useSuspenseQuery(campaignsQuery);
  const del = useServerFn(deleteCampaign);
  const clone = useServerFn(cloneCampaign);
  const [filter, setFilter] = useState<FilterKey>("all");

  const counts = useMemo(() => {
    const acc: Record<string, number> = { all: campaigns.length };
    for (const c of campaigns) acc[c.status] = (acc[c.status] ?? 0) + 1;
    return acc;
  }, [campaigns]);

  const filtered = filter === "all" ? campaigns : campaigns.filter((c) => c.status === filter);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold">Campanhas</h1>
          <p className="text-sm text-muted-foreground">Acompanhe todas as campanhas que você iniciou.</p>
        </div>
        <Link to="/campaigns/new">
          <Button className="gradient-brand text-primary-foreground">
            <Plus className="mr-1 h-4 w-4" /> Nova campanha
          </Button>
        </Link>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={cn(
              "px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
              filter === f.key
                ? "bg-brand-accent/15 text-brand-accent"
                : "bg-brand-surface text-muted-foreground hover:text-foreground",
            )}
          >
            {f.label} <span className="opacity-60">({counts[f.key] ?? 0})</span>
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl bg-brand-surface p-10 text-center text-muted-foreground">
          Nenhuma campanha nesta categoria.
        </div>
      ) : (
        <div className="rounded-xl bg-brand-surface overflow-hidden divide-y divide-brand-surface-hover/40">
          {filtered.map((c) => (
            <div key={c.id} className="flex items-center justify-between p-4 hover:bg-brand-surface-hover/30 transition-colors">
              <Link to="/campaigns/$id" params={{ id: c.id }} className="flex-1 min-w-0">
                <p className="font-medium truncate">{c.title}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {c.subject} · {c.total_recipients} destinatários ·{" "}
                  {new Date(c.created_at).toLocaleDateString("pt-BR")}
                </p>
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
                      onClick={(e) => e.preventDefault()}
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
