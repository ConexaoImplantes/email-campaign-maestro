import { createFileRoute, notFound, useRouter, useNavigate } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef } from "react";
import { getCampaign, getRecipients, setCampaignStatus, cloneCampaign, listAttachments } from "@/lib/campaigns.functions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { Play, Pause, Copy, Paperclip } from "lucide-react";

const campaignQuery = (id: string) =>
  queryOptions({
    queryKey: ["campaign", id],
    queryFn: () => getCampaign({ data: { id } }),
    refetchInterval: 2000,
  });
const recipientsQuery = (id: string) =>
  queryOptions({
    queryKey: ["recipients", id],
    queryFn: () => getRecipients({ data: { campaign_id: id } }),
    refetchInterval: 2000,
  });
const attachmentsQuery = (id: string) =>
  queryOptions({
    queryKey: ["attachments", id],
    queryFn: () => listAttachments({ data: { campaign_id: id } }),
  });

export const Route = createFileRoute("/_authenticated/campaigns/$id")({
  head: ({ loaderData }) => {
    const title = (loaderData as { title?: string } | undefined)?.title ?? "Campanha";
    return {
      meta: [
        { title: `${title} — Conexão Implantes` },
        { name: "description", content: "Detalhes, progresso e destinatários da campanha." },
        { property: "og:title", content: `${title} — Conexão Implantes` },
        { property: "og:description", content: "Detalhes, progresso e destinatários da campanha." },
      ],
    };
  },
  loader: async ({ context, params }) => {
    const c = await context.queryClient.ensureQueryData(campaignQuery(params.id));
    if (!c) throw notFound();
    await context.queryClient.ensureQueryData(recipientsQuery(params.id));
    return c;
  },
  errorComponent: ({ error, reset }) => (
    <div>
      <p className="text-destructive">Erro: {error.message}</p>
      <Button onClick={reset} className="mt-3">Tentar novamente</Button>
    </div>
  ),
  notFoundComponent: () => <p className="text-muted-foreground">Campanha não encontrada.</p>,
  component: CampaignDetail,
});

function CampaignDetail() {
  const { id } = Route.useParams();
  const router = useRouter();
  const qc = useQueryClient();
  const { data: c } = useSuspenseQuery(campaignQuery(id));
  const { data: recipients } = useSuspenseQuery(recipientsQuery(id));
  const setStatus = useServerFn(setCampaignStatus);
  const prevStatusRef = useRef<string | null>(null);

  // Realtime updates via Supabase channels
  useEffect(() => {
    const channel = supabase
      .channel(`campaign-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "recipients", filter: `campaign_id=eq.${id}` }, () => {
        qc.invalidateQueries({ queryKey: ["recipients", id] });
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "campaigns", filter: `id=eq.${id}` }, () => {
        qc.invalidateQueries({ queryKey: ["campaign", id] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [id, qc]);

  // Aviso sonoro quando a campanha finaliza
  useEffect(() => {
    const prev = prevStatusRef.current;
    const curr = c?.status as string | undefined;
    if (prev && prev !== curr && (curr === "completed" || curr === "failed")) {
      playCompletionSound();
      toast.success(curr === "completed" ? "Campanha concluída!" : "Campanha finalizada com falhas");
    }
    if (curr) prevStatusRef.current = curr;
  }, [c?.status]);

  if (!c) return null;

  const sent = recipients.filter((r) => r.status === "sent").length;
  const failed = recipients.filter((r) => r.status === "failed").length;
  const opened = recipients.filter((r) => r.opened_at).length;
  const pending = recipients.filter((r) => r.status === "pending").length;
  const total = recipients.length || 1;
  const progressPct = Math.round(((sent + failed) / total) * 100);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">{c.title}</h1>
          <p className="text-sm text-muted-foreground mt-1">{c.subject}</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={c.status as string} />
          {c.status === "draft" || c.status === "paused" ? (
            <Button
              size="sm"
              className="gradient-brand text-primary-foreground"
              onClick={async () => {
                await setStatus({ data: { id, status: "processing" } });
                toast.success("Envio iniciado");
                router.invalidate();
              }}
            >
              <Play className="h-4 w-4 mr-1" /> Iniciar
            </Button>
          ) : c.status === "processing" ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={async () => {
                await setStatus({ data: { id, status: "paused" } });
                toast.success("Campanha pausada");
                router.invalidate();
              }}
            >
              <Pause className="h-4 w-4 mr-1" /> Pausar
            </Button>
          ) : null}
        </div>
      </div>

      <section className="rounded-xl bg-brand-surface p-6">
        <div className="flex justify-between text-sm mb-2">
          <span className="text-muted-foreground">Progresso</span>
          <span className="font-medium">{sent + failed} / {recipients.length}</span>
        </div>
        <Progress value={progressPct} className="h-2" />
        <div className="grid grid-cols-4 gap-4 mt-6 text-center">
          <div><p className="text-2xl font-semibold">{sent}</p><p className="text-xs text-muted-foreground">Enviados</p></div>
          <div><p className="text-2xl font-semibold text-brand-success">{opened}</p><p className="text-xs text-muted-foreground">Abertos</p></div>
          <div><p className="text-2xl font-semibold text-brand-error">{failed}</p><p className="text-xs text-muted-foreground">Falhas</p></div>
          <div><p className="text-2xl font-semibold text-brand-warning">{pending}</p><p className="text-xs text-muted-foreground">Pendentes</p></div>
        </div>
      </section>

      <section className="rounded-xl bg-brand-surface overflow-hidden">
        <div className="max-h-[500px] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-brand-surface z-10">
              <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Nome</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Aberto</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-surface-hover/40">
              {recipients.map((r) => (
                <tr key={r.id} className="hover:bg-brand-surface-hover/20">
                  <td className="px-4 py-2">{r.email}</td>
                  <td className="px-4 py-2 text-muted-foreground">{r.name ?? "—"}</td>
                  <td className="px-4 py-2"><RecipientStatus status={r.status} error={r.error_message} /></td>
                  <td className="px-4 py-2 text-muted-foreground">{r.opened_at ? "Sim" : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
function RecipientStatus({ status, error }: { status: string; error: string | null }) {
  const map: Record<string, string> = {
    pending: "bg-brand-badge-bg text-muted-foreground",
    sent: "bg-brand-success/20 text-brand-success",
    failed: "bg-brand-error/20 text-brand-error",
  };
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-md ${map[status] ?? map.pending}`} title={error ?? undefined}>
      {status === "pending" ? "Pendente" : status === "sent" ? "Enviado" : "Falhou"}
    </span>
  );
}

function playCompletionSound() {
  try {
    const AC = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
    const ctx = new AC();
    const now = ctx.currentTime;
    const notes = [880, 1108.73, 1318.51]; // A5, C#6, E6
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const start = now + i * 0.18;
      const end = start + 0.28;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.25, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(end + 0.02);
    });
    setTimeout(() => ctx.close(), 1500);
  } catch {
    // ignore audio errors
  }
}
