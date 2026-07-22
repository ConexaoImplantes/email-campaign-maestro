import { createFileRoute, Link, useRouter, useNavigate } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listCampaigns, deleteCampaign, cloneCampaign, updateCampaign, getCampaign } from "@/lib/campaigns.functions";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Trash2, Copy, Pencil } from "lucide-react";
import { toast } from "sonner";
import { useState, useMemo, useEffect } from "react";
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

type CampaignRow = Awaited<ReturnType<typeof listCampaigns>>[number];

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
  const qc = useQueryClient();
  const { data: campaigns } = useSuspenseQuery(campaignsQuery);
  const del = useServerFn(deleteCampaign);
  const clone = useServerFn(cloneCampaign);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [editing, setEditing] = useState<CampaignRow | null>(null);

  const counts = useMemo(() => {
    const acc: Record<string, number> = { all: campaigns.length };
    for (const c of campaigns) acc[c.status] = (acc[c.status] ?? 0) + 1;
    return acc;
  }, [campaigns]);

  const filtered = filter === "all" ? campaigns : campaigns.filter((c) => c.status === filter);

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["campaigns"] });
    router.invalidate();
  };

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
            type="button"
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
                  {c.owner_email ? <span className="text-brand-accent">{c.owner_email}</span> : null}
                  {c.owner_email ? " · " : ""}
                  {c.subject} · {c.total_recipients} destinatários ·{" "}
                  {new Date(c.created_at).toLocaleDateString("pt-BR")}
                </p>
              </Link>
              <div className="flex items-center gap-3">
                <StatusBadge status={c.status} />
                <button
                  type="button"
                  onClick={() => setEditing(c)}
                  className="text-muted-foreground hover:text-brand-accent p-1"
                  aria-label="Editar"
                  title="Editar campanha"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const { id } = await clone({ data: { id: c.id } });
                      toast.success("Campanha clonada");
                      await refresh();
                      navigate({ to: "/campaigns/$id/edit", params: { id } });
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
                      title="Excluir campanha"
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
                            await refresh();
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

      <EditCampaignDialog
        campaign={editing}
        onOpenChange={(open) => !open && setEditing(null)}
        onSaved={refresh}
      />
    </div>
  );
}

function EditCampaignDialog({
  campaign,
  onOpenChange,
  onSaved,
}: {
  campaign: CampaignRow | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void | Promise<void>;
}) {
  const update = useServerFn(updateCampaign);
  const fetchCampaign = useServerFn(getCampaign);
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [contentType, setContentType] = useState<"richtext" | "html">("html");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  const currentId = campaign?.id ?? null;

  useEffect(() => {
    if (!currentId) return;
    let cancelled = false;
    setLoading(true);
    fetchCampaign({ data: { id: currentId } })
      .then((full) => {
        if (cancelled || !full) return;
        setTitle(full.title ?? "");
        setSubject(full.subject ?? "");
        setContentType(((full.content_type as "richtext" | "html") ?? "html"));
        setBody(full.body_content ?? "");
      })
      .catch((err) => toast.error(err instanceof Error ? err.message : "Falha ao carregar"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [currentId, fetchCampaign]);

  const onSave = async () => {
    if (!campaign) return;
    setSaving(true);
    try {
      await update({
        data: { id: campaign.id, title, subject, content_type: contentType, body_content: body },
      });
      toast.success("Campanha atualizada");
      await onSaved();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!campaign} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar campanha</DialogTitle>
          <DialogDescription>Atualize título, assunto e conteúdo da campanha.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="edit-title">Título</Label>
            <Input id="edit-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
          </div>
          <div>
            <Label htmlFor="edit-subject">Assunto</Label>
            <Input id="edit-subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={300} />
          </div>
          <div>
            <Label>Tipo de conteúdo</Label>
            <div className="flex gap-3 mt-2">
              {(["html", "richtext"] as const).map((t) => (
                <label key={t} className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="edit_content_type"
                    value={t}
                    checked={contentType === t}
                    onChange={() => setContentType(t)}
                  />
                  {t === "html" ? "HTML" : "Texto formatado"}
                </label>
              ))}
            </div>
          </div>
          <div>
            <Label htmlFor="edit-body">Conteúdo</Label>
            <Textarea
              id="edit-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={14}
              className="font-mono text-xs"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button
            className="gradient-brand text-primary-foreground"
            onClick={onSave}
            disabled={saving}
          >
            {saving ? "Salvando…" : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
