import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  isAdmin,
  getDefaultSmtp,
  saveDefaultSmtp,
  testDefaultSmtp,
} from "@/lib/admin.functions";
import { useSuspenseQuery, queryOptions, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Globe } from "lucide-react";

const defaultSmtpQuery = queryOptions({
  queryKey: ["default-smtp"],
  queryFn: () => getDefaultSmtp(),
});

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "SMTP Padrão — Conexão Implantes" },
      { name: "description", content: "Configure o servidor SMTP padrão usado por todos os usuários da plataforma." },
      { property: "og:title", content: "SMTP Padrão — Conexão Implantes" },
      { property: "og:description", content: "Configure o servidor SMTP padrão usado por todos os usuários da plataforma." },
    ],
  }),
  beforeLoad: async () => {
    const result = await isAdmin();
    if (!result?.isAdmin) throw redirect({ to: "/dashboard" });
  },
  loader: ({ context }) => context.queryClient.ensureQueryData(defaultSmtpQuery),
  errorComponent: ({ error, reset }) => (
    <div>
      <p className="text-destructive">Erro: {error.message}</p>
      <Button onClick={reset} className="mt-3">Tentar novamente</Button>
    </div>
  ),
  component: Settings,
});

function Settings() {
  const { data: profile } = useSuspenseQuery(defaultSmtpQuery);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const save = useServerFn(saveDefaultSmtp);
  const test = useServerFn(testDefaultSmtp);

  const [form, setForm] = useState({
    smtp_host: profile.smtp_host,
    smtp_port: profile.smtp_port,
    smtp_user: profile.smtp_user ?? "",
    smtp_pass: "",
    from_name: profile.from_name ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg gradient-brand text-primary-foreground flex items-center justify-center">
            <Globe className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-3xl font-semibold">SMTP Padrão da plataforma</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Este servidor SMTP é usado por <span className="text-brand-accent">todos os usuários</span>. O Super Admin pode
              configurar exceções individuais no painel administrativo.
            </p>
          </div>
        </div>
      </div>

      <form
        className="space-y-5 rounded-xl bg-brand-surface p-6"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await save({
              data: {
                smtp_host: form.smtp_host,
                smtp_port: Number(form.smtp_port),
                smtp_user: form.smtp_user,
                smtp_pass: form.smtp_pass || undefined,
                from_name: form.from_name || null,
              },
            });
            toast.success("SMTP padrão salvo");
            await qc.invalidateQueries({ queryKey: ["default-smtp"] });
            await qc.invalidateQueries({ queryKey: ["profile"] });
            navigate({ to: "/admin" });
          } catch (err) {
            toast.error("Falha ao salvar", { description: (err as Error).message });
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="grid grid-cols-3 gap-4">
          <div className="col-span-2">
            <Label htmlFor="host">Servidor</Label>
            <Input id="host" value={form.smtp_host} onChange={(e) => setForm({ ...form, smtp_host: e.target.value })} required />
          </div>
          <div>
            <Label htmlFor="port">Porta</Label>
            <Input id="port" type="number" value={form.smtp_port} onChange={(e) => setForm({ ...form, smtp_port: Number(e.target.value) })} required />
          </div>
        </div>
        <div>
          <Label htmlFor="user">Usuário / Email de envio</Label>
          <Input id="user" type="email" value={form.smtp_user} onChange={(e) => setForm({ ...form, smtp_user: e.target.value })} required autoComplete="off" />
        </div>
        <div>
          <Label htmlFor="pass">Senha (App Password)</Label>
          <Input
            id="pass"
            type="password"
            value={form.smtp_pass}
            onChange={(e) => setForm({ ...form, smtp_pass: e.target.value })}
            placeholder={profile.configured ? "•••••••• (manter atual)" : "senha SMTP"}
            autoComplete="new-password"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Para Gmail, gere uma <span className="text-brand-accent">App Password</span> em myaccount.google.com/apppasswords.
          </p>
        </div>
        <div>
          <Label htmlFor="fromName">Nome do remetente (opcional)</Label>
          <Input id="fromName" value={form.from_name} onChange={(e) => setForm({ ...form, from_name: e.target.value })} placeholder="Conexão Implantes" />
        </div>

        <div className="flex gap-3">
          <Button type="submit" disabled={busy} className="gradient-brand text-primary-foreground">
            {busy ? "Salvando..." : "Salvar SMTP padrão"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={testing || !form.smtp_host || !form.smtp_user || (!form.smtp_pass && !profile.configured)}
            onClick={async () => {
              setTesting(true);
              try {
                const res = await test({
                  data: {
                    smtp_host: form.smtp_host,
                    smtp_port: Number(form.smtp_port),
                    smtp_user: form.smtp_user,
                    smtp_pass: form.smtp_pass || undefined,
                  },
                });
                if (res.ok) toast.success("Conexão SMTP funcionando");
                else toast.error("Falha SMTP", { description: res.error });
              } finally {
                setTesting(false);
              }
            }}
          >
            {testing ? "Testando..." : "Testar conexão"}
          </Button>
        </div>
      </form>
    </div>
  );
}
