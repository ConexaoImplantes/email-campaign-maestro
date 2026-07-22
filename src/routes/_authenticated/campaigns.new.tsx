import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import Papa from "papaparse";
import { useServerFn } from "@tanstack/react-start";
import { createCampaign, setCampaignStatus, getProfile, addAttachment } from "@/lib/campaigns.functions";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Upload, X, Download, Paperclip } from "lucide-react";

const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const MAX_ATTACHMENTS = 2;

const profileQuery = queryOptions({ queryKey: ["profile"], queryFn: () => getProfile() });

export const Route = createFileRoute("/_authenticated/campaigns/new")({
  head: () => ({
    meta: [
      { title: "Nova campanha — Conexão Implantes" },
      { name: "description", content: "Crie uma nova campanha de email com destinatários importados por CSV." },
      { property: "og:title", content: "Nova campanha — Conexão Implantes" },
      { property: "og:description", content: "Crie uma nova campanha de email com destinatários importados por CSV." },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(profileQuery),
  errorComponent: ({ error, reset }) => (
    <div>
      <p className="text-destructive">Erro: {error.message}</p>
      <Button onClick={reset} className="mt-3">Tentar novamente</Button>
    </div>
  ),
  component: NewCampaign,
});

interface Recipient {
  name: string | null;
  email: string;
}

function NewCampaign() {
  const { data: profile } = useSuspenseQuery(profileQuery);
  const navigate = useNavigate();
  const create = useServerFn(createCampaign);
  const setStatus = useServerFn(setCampaignStatus);
  const addAtt = useServerFn(addAttachment);

  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [contentType, setContentType] = useState<"richtext" | "html">("richtext");
  const [body, setBody] = useState("");
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [manualName, setManualName] = useState("");
  const [manualEmail, setManualEmail] = useState("");
  const [busy, setBusy] = useState(false);

  function handleAttachmentPick(files: FileList | null) {
    if (!files) return;
    const picked = Array.from(files);
    const next = [...attachments];
    for (const f of picked) {
      if (next.length >= MAX_ATTACHMENTS) {
        toast.error(`Máximo de ${MAX_ATTACHMENTS} anexos`);
        break;
      }
      if (f.size > MAX_ATTACHMENT_BYTES) {
        toast.error(`"${f.name}" excede 5MB`);
        continue;
      }
      next.push(f);
    }
    setAttachments(next);
  }

  function handleCsv(file: File) {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        const list: Recipient[] = [];
        for (const row of res.data) {
          const keys = Object.keys(row);
          const emailKey = keys.find((k) => /email/i.test(k));
          const nameKey = keys.find((k) => /name|nome/i.test(k));
          if (!emailKey) continue;
          const email = (row[emailKey] ?? "").trim();
          if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue;
          list.push({ email, name: nameKey ? (row[nameKey] ?? "").trim() || null : null });
        }
        if (list.length === 0) {
          toast.error("Nenhum email válido encontrado no CSV");
          return;
        }
        setRecipients((prev) => dedupe([...prev, ...list]));
        toast.success(`${list.length} destinatários importados`);
      },
      error: (err) => toast.error("Erro ao ler CSV", { description: err.message }),
    });
  }

  async function submit(startNow: boolean) {
    if (!profile.smtp_configured) {
      toast.error("Configure o SMTP antes de enviar");
      return;
    }
    if (!title.trim() || !subject.trim() || !body.trim()) {
      toast.error("Preencha título, assunto e conteúdo");
      return;
    }
    if (startNow && recipients.length === 0) {
      toast.error("Adicione ao menos um destinatário");
      return;
    }
    setBusy(true);
    try {
      const { id } = await create({
        data: {
          title,
          subject,
          content_type: contentType,
          body_content: body,
          recipients,
        },
      });
      // Upload attachments (if any)
      for (const file of attachments) {
        const base64 = await fileToBase64(file);
        await addAtt({
          data: {
            campaign_id: id,
            filename: file.name,
            mime_type: file.type || "application/octet-stream",
            size_bytes: file.size,
            content_base64: base64,
          },
        });
      }
      if (startNow) {
        await setStatus({ data: { id, status: "processing" } });
        toast.success("Campanha iniciada! O envio roda em segundo plano.");
      } else {
        toast.success("Rascunho salvo");
      }
      navigate({ to: "/campaigns/$id", params: { id } });
    } catch (err) {
      toast.error("Erro ao salvar", { description: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-semibold">Nova campanha</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Cota diária: {profile.daily_limit} emails · Enviados hoje: {profile.emails_sent_today}
        </p>
      </div>

      <div className="rounded-xl bg-brand-surface p-6 space-y-5">
        <div>
          <Label htmlFor="title">Título interno</Label>
          <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Newsletter Junho" />
        </div>
        <div>
          <Label htmlFor="subject">Assunto do email</Label>
          <Input id="subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Ex.: Novidades da Conexão Implantes" />
        </div>
        <div>
          <Label>Conteúdo</Label>
          <Tabs value={contentType} onValueChange={(v) => setContentType(v as "richtext" | "html")}>
            <TabsList>
              <TabsTrigger value="richtext">Texto rico</TabsTrigger>
              <TabsTrigger value="html">HTML</TabsTrigger>
            </TabsList>
            <TabsContent value="richtext" className="pt-3">
              <Textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={10}
                placeholder="Escreva sua mensagem. Você pode usar HTML simples: <p>, <a>, <strong>, <img> etc."
              />
              <p className="text-xs text-muted-foreground mt-1">
                O texto será enviado como HTML. Suporta tags básicas.
              </p>
            </TabsContent>
            <TabsContent value="html" className="pt-3">
              <div className="grid gap-3 md:grid-cols-2">
                <Textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={14}
                  className="font-mono text-xs"
                  placeholder="<html><body>...</body></html>"
                />
                <div className="rounded-md border border-brand-surface-hover/40 overflow-hidden flex flex-col">
                  <div className="px-3 py-1.5 text-xs text-muted-foreground bg-brand-surface border-b border-brand-surface-hover/40">
                    Preview
                  </div>
                  <iframe
                    title="Preview HTML"
                    srcDoc={body || "<p style='font-family:sans-serif;color:#999;padding:12px'>Preview aparecerá aqui…</p>"}
                    sandbox=""
                    className="w-full flex-1 min-h-[320px] bg-white"
                  />
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>

      <div className="rounded-xl bg-brand-surface p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold">Destinatários</h2>
            <p className="text-xs text-muted-foreground">
              {recipients.length} contatos {recipients.length > 0 && `· ${estimatedDays(recipients.length, profile.daily_limit)}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={downloadCsvTemplate}
            >
              <Download className="h-4 w-4 mr-1.5" />
              Modelo CSV
            </Button>
            <label className="inline-flex items-center gap-2 cursor-pointer rounded-md gradient-brand px-3 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90">
              <Upload className="h-4 w-4" />
              Importar CSV
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleCsv(f);
                  e.target.value = "";
                }}
              />
            </label>
          </div>
        </div>

        <div className="flex gap-2">
          <Input placeholder="Nome (opcional)" value={manualName} onChange={(e) => setManualName(e.target.value)} />
          <Input placeholder="email@dominio.com" type="email" value={manualEmail} onChange={(e) => setManualEmail(e.target.value)} />
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              const e = manualEmail.trim();
              if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
                toast.error("Email inválido");
                return;
              }
              setRecipients((prev) => dedupe([...prev, { name: manualName.trim() || null, email: e }]));
              setManualName("");
              setManualEmail("");
            }}
          >
            Adicionar
          </Button>
        </div>

        {recipients.length > 0 && (
          <div className="max-h-60 overflow-auto rounded-md border border-brand-surface-hover/40 divide-y divide-brand-surface-hover/40">
            {recipients.map((r, i) => (
              <div key={r.email} className="flex items-center justify-between px-3 py-1.5 text-sm">
                <span className="truncate">
                  {r.name && <span className="text-muted-foreground mr-2">{r.name}</span>}
                  {r.email}
                </span>
                <button
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => setRecipients((prev) => prev.filter((_, j) => j !== i))}
                  aria-label="Remover"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          CSV com colunas <code>name,email</code> ou apenas <code>email</code>. Duplicatas são removidas automaticamente.
        </p>
      </div>

      <div className="rounded-xl bg-brand-surface p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold flex items-center gap-2"><Paperclip className="h-4 w-4" /> Anexos</h2>
            <p className="text-xs text-muted-foreground">
              Até {MAX_ATTACHMENTS} arquivos, máx. 5MB cada · {attachments.length}/{MAX_ATTACHMENTS} adicionados
            </p>
          </div>
          <label className={`inline-flex items-center gap-2 cursor-pointer rounded-md border border-brand-surface-hover px-3 py-2 text-sm font-medium hover:bg-brand-surface-hover/30 ${attachments.length >= MAX_ATTACHMENTS ? "opacity-50 pointer-events-none" : ""}`}>
            <Upload className="h-4 w-4" />
            Adicionar anexo
            <input
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                handleAttachmentPick(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
        </div>
        {attachments.length > 0 && (
          <div className="divide-y divide-brand-surface-hover/40 rounded-md border border-brand-surface-hover/40">
            {attachments.map((f, i) => (
              <div key={`${f.name}-${i}`} className="flex items-center justify-between px-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="truncate">{f.name}</p>
                  <p className="text-xs text-muted-foreground">{formatSize(f.size)} · {f.type || "arquivo"}</p>
                </div>
                <button
                  className="text-muted-foreground hover:text-destructive ml-3"
                  onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                  aria-label="Remover anexo"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex justify-end gap-3">
        <Button variant="secondary" disabled={busy} onClick={() => submit(false)}>Salvar rascunho</Button>
        <Button disabled={busy} className="gradient-brand text-primary-foreground" onClick={() => submit(true)}>
          {busy ? "Iniciando..." : "Iniciar envio"}
        </Button>
      </div>
    </div>
  );
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Falha ao ler arquivo"));
    reader.readAsDataURL(file);
  });
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function downloadCsvTemplate() {
  const rows = [
    ["name", "email"],
    ["João Silva", "joao.silva@email.com"],
    ["Maria Souza", "maria.souza@email.com"],
    ["Clínica Odonto", "contato@clinicaodonto.com"],
  ];
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "modelo-destinatarios-conexao-implantes.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function dedupe(arr: Recipient[]): Recipient[] {
  const seen = new Set<string>();
  return arr.filter((r) => {
    const k = r.email.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function estimatedDays(total: number, perDay: number): string {
  if (perDay <= 0) return "";
  const days = Math.ceil(total / perDay);
  return days <= 1 ? "envio em 1 dia" : `envio estimado em ~${days} dias`;
}
