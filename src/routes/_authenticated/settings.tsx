import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getProfile, saveSmtp, testSmtp } from "@/lib/campaigns.functions";
import { useSuspenseQuery, queryOptions, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

const profileQuery = queryOptions({ queryKey: ["profile"], queryFn: () => getProfile() });

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "SMTP — Conexão Implantes" },
      { name: "description", content: "Configure seu servidor SMTP e o remetente das campanhas." },
      { property: "og:title", content: "SMTP — Conexão Implantes" },
      { property: "og:description", content: "Configure seu servidor SMTP e o remetente das campanhas." },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(profileQuery),
  errorComponent: ({ error, reset }) => (
    <div>
      <p className="text-destructive">Erro: {error.message}</p>
      <Button onClick={reset} className="mt-3">Tentar novamente</Button>
    </div>
  ),
  component: Settings,
});

function Settings() {
  const { data: profile } = useSuspenseQuery(profileQuery);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const save = useServerFn(saveSmtp);
  const test = useServerFn(testSmtp);

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
        <h1 className="text-3xl font-semibold">Configuração SMTP</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Sua senha é criptografada com AES-GCM antes de ir para o banco.
        </p>
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
            toast.success("Configuração salva");
            await qc.invalidateQueries({ queryKey: ["profile"] });
            navigate({ to: "/dashboard" });
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
            placeholder={profile.smtp_configured ? "•••••••• (manter atual)" : "sua senha SMTP"}
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
            {busy ? "Salvando..." : "Salvar configuração"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={testing || !form.smtp_host || !form.smtp_user || (!form.smtp_pass && !profile.smtp_configured)}
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
