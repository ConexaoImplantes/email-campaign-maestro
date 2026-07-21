import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import logoAsset from "@/assets/logo-conexao-horizontal.png.asset.json";

const searchSchema = z.object({
  redirect: z.string().optional(),
});

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Entrar — Conexão Implantes" },
      {
        name: "description",
        content: "Acesse sua conta para gerenciar campanhas de email da Conexão Implantes.",
      },
      { property: "og:title", content: "Entrar — Conexão Implantes" },
      {
        property: "og:description",
        content: "Acesse sua conta para gerenciar campanhas de email da Conexão Implantes.",
      },
    ],
  }),
  validateSearch: (s) => searchSchema.parse(s),
  ssr: false,
  beforeLoad: async ({ search }) => {
    const { data } = await supabase.auth.getSession();
    if (data.session) throw redirect({ to: search.redirect ?? "/dashboard" });
  },
  component: AuthPage,
});

function AuthPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const dest = (search.redirect as string | undefined) ?? "/dashboard";

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4 py-12">
      <Link to="/" className="mb-8">
        <img src={logoAsset.url} alt="Conexão Implantes" className="h-10 w-auto" />
      </Link>
      <div className="w-full max-w-md rounded-2xl bg-brand-surface p-8 shadow-xl border border-brand-surface-hover/30">
        <Tabs defaultValue="signin">
          <TabsList className="w-full">
            <TabsTrigger value="signin" className="flex-1">Entrar</TabsTrigger>
            <TabsTrigger value="signup" className="flex-1">Criar conta</TabsTrigger>
          </TabsList>
          <TabsContent value="signin" className="pt-6">
            <SignInForm onSuccess={() => navigate({ to: dest })} />
          </TabsContent>
          <TabsContent value="signup" className="pt-6">
            <SignUpForm onSuccess={() => navigate({ to: dest })} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function SignInForm({ onSuccess }: { onSuccess: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        setBusy(false);
        if (error) {
          toast.error("Falha no login", { description: error.message });
          return;
        }
        toast.success("Bem-vindo de volta!");
        onSuccess();
      }}
    >
      <div>
        <Label htmlFor="signin-email">Email</Label>
        <Input id="signin-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
      </div>
      <div>
        <Label htmlFor="signin-pw">Senha</Label>
        <Input id="signin-pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
      </div>
      <Button type="submit" disabled={busy} className="w-full gradient-brand text-primary-foreground hover:opacity-90">
        {busy ? "Entrando..." : "Entrar"}
      </Button>
    </form>
  );
}

function SignUpForm({ onSuccess }: { onSuccess: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (password.length < 8) {
          toast.error("Senha deve ter no mínimo 8 caracteres");
          return;
        }
        setBusy(true);
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/dashboard` },
        });
        setBusy(false);
        if (error) {
          toast.error("Falha ao criar conta", { description: error.message });
          return;
        }
        toast.success("Conta criada! Verifique seu email caso a confirmação seja exigida.");
        onSuccess();
      }}
    >
      <div>
        <Label htmlFor="signup-email">Email</Label>
        <Input id="signup-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
      </div>
      <div>
        <Label htmlFor="signup-pw">Senha</Label>
        <Input id="signup-pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="new-password" minLength={8} />
        <p className="text-xs text-muted-foreground mt-1">Mínimo de 8 caracteres.</p>
      </div>
      <Button type="submit" disabled={busy} className="w-full gradient-brand text-primary-foreground hover:opacity-90">
        {busy ? "Criando..." : "Criar conta"}
      </Button>
    </form>
  );
}
