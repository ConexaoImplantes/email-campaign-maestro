import { createFileRoute, notFound, useNavigate } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { getCampaign, updateCampaign } from "@/lib/campaigns.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { ArrowLeft, Save } from "lucide-react";

const campaignQuery = (id: string) =>
  queryOptions({
    queryKey: ["campaign", id],
    queryFn: () => getCampaign({ data: { id } }),
  });

export const Route = createFileRoute("/_authenticated/campaigns/$id/edit")({
  head: () => ({
    meta: [
      { title: "Editar campanha — Conexão Implantes" },
      { name: "description", content: "Editar título, assunto e conteúdo da campanha." },
      { property: "og:title", content: "Editar campanha — Conexão Implantes" },
      { property: "og:description", content: "Editar título, assunto e conteúdo da campanha." },
    ],
  }),
  loader: async ({ context, params }) => {
    const c = await context.queryClient.ensureQueryData(campaignQuery(params.id));
    if (!c) throw notFound();
    return c;
  },
  errorComponent: ({ error, reset }) => (
    <div>
      <p className="text-destructive">Erro: {error.message}</p>
      <Button onClick={reset} className="mt-3">Tentar novamente</Button>
    </div>
  ),
  notFoundComponent: () => <p className="text-muted-foreground">Campanha não encontrada.</p>,
  component: EditCampaign,
});

function EditCampaign() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const { data: c } = useSuspenseQuery(campaignQuery(id));
  const update = useServerFn(updateCampaign);

  const [title, setTitle] = useState(c?.title ?? "");
  const [subject, setSubject] = useState(c?.subject ?? "");
  const [contentType, setContentType] = useState<"richtext" | "html">(
    ((c?.content_type as "richtext" | "html") ?? "html"),
  );
  const [body, setBody] = useState(c?.body_content ?? "");
  const [saving, setSaving] = useState(false);

  if (!c) return null;

  const onSave = async () => {
    setSaving(true);
    try {
      await update({
        data: { id, title, subject, content_type: contentType, body_content: body },
      });
      toast.success("Campanha atualizada");
      navigate({ to: "/campaigns/$id", params: { id } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <button
            onClick={() => navigate({ to: "/campaigns/$id", params: { id } })}
            className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-2"
          >
            <ArrowLeft className="h-4 w-4" /> Voltar
          </button>
          <h1 className="text-3xl font-semibold">Editar campanha</h1>
          {(c as { owner_email?: string | null }).owner_email && (
            <p className="text-sm text-brand-accent mt-1">
              Proprietário: {(c as { owner_email?: string | null }).owner_email}
            </p>
          )}
        </div>
        <Button className="gradient-brand text-primary-foreground" onClick={onSave} disabled={saving}>
          <Save className="h-4 w-4 mr-1" /> {saving ? "Salvando…" : "Salvar"}
        </Button>
      </div>

      <div className="rounded-xl bg-brand-surface p-6 space-y-4">
        <div>
          <Label htmlFor="title">Título</Label>
          <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
        </div>
        <div>
          <Label htmlFor="subject">Assunto</Label>
          <Input id="subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={300} />
        </div>
        <div>
          <Label>Tipo de conteúdo</Label>
          <div className="flex gap-3 mt-2">
            {(["html", "richtext"] as const).map((t) => (
              <label key={t} className="inline-flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="content_type"
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
          <Label htmlFor="body">Conteúdo</Label>
          <Textarea
            id="body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={18}
            className="font-mono text-xs"
          />
        </div>
      </div>
    </div>
  );
}
