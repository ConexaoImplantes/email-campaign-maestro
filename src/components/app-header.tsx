import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { LogOut, Shield } from "lucide-react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { isAdmin } from "@/lib/admin.functions";
import logoAsset from "@/assets/logo-conexao-horizontal.png.asset.json";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/campaigns/new", label: "Nova campanha" },
  { to: "/settings", label: "SMTP" },
] as const;

export function AppHeader() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  async function handleSignOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <header className="border-b border-brand-surface bg-brand-surface/60 backdrop-blur">
      <div className="mx-auto max-w-6xl px-6 py-3 flex items-center justify-between gap-4">
        <Link to="/dashboard" className="shrink-0">
          <img src={logoAsset.url} alt="Conexão Implantes" className="h-8 w-auto" />
        </Link>
        <nav className="hidden md:flex items-center gap-1">
          {NAV.map((n) => {
            const active = pathname === n.to || pathname.startsWith(n.to + "/");
            return (
              <Link
                key={n.to}
                to={n.to}
                className={cn(
                  "px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                  active
                    ? "text-brand-accent bg-brand-accent/10"
                    : "text-muted-foreground hover:text-foreground hover:bg-brand-surface-hover/50",
                )}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>
        <button
          onClick={handleSignOut}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <LogOut className="h-4 w-4" /> Sair
        </button>
      </div>
    </header>
  );
}
