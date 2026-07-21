import { createFileRoute, Link } from "@tanstack/react-router";
import { Mail, Gauge, Eye } from "lucide-react";
import logoAsset from "@/assets/logo-conexao-horizontal.png.asset.json";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Conexão Implantes — Email Campaign Manager" },
      {
        name: "description",
        content:
          "Dispare campanhas de email com o SMTP da sua marca. Cota diária, rastreamento de abertura e dashboard em tempo real.",
      },
      { property: "og:title", content: "Conexão Implantes — Email Campaign Manager" },
      {
        property: "og:description",
        content:
          "Dispare campanhas com SMTP próprio, cota diária de 300 envios e métricas em tempo real.",
      },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-brand-surface">
        <div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between">
          <img src={logoAsset.url} alt="Conexão Implantes" className="h-9 w-auto" />
          <Link
            to="/auth"
            className="inline-flex items-center rounded-md gradient-brand px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity"
          >
            Entrar
          </Link>
        </div>
      </header>

      <main className="flex-1">
        <section className="mx-auto max-w-4xl px-6 pt-24 pb-16 text-center">
          <p className="text-sm uppercase tracking-widest text-brand-accent font-medium">
            Email Campaign Manager
          </p>
          <h1 className="mt-6 text-5xl md:text-6xl font-semibold leading-tight">
            Campanhas de email <span className="text-gradient-brand">com precisão</span> e
            controle total.
          </h1>
          <p className="mt-6 text-lg text-muted-foreground max-w-2xl mx-auto">
            Use o seu próprio servidor SMTP, respeite a cota diária de 300 envios e
            acompanhe cada abertura em tempo real. Feito sob medida para a marca
            Conexão Implantes.
          </p>
          <div className="mt-10 flex items-center justify-center gap-3">
            <Link
              to="/auth"
              className="inline-flex items-center rounded-md gradient-brand px-6 py-3 text-base font-semibold text-primary-foreground hover:opacity-90 transition-opacity shadow-lg shadow-black/40"
            >
              Começar agora
            </Link>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-6 pb-24 grid gap-6 md:grid-cols-3">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="rounded-2xl bg-brand-surface p-6 card-hover-glow border border-transparent"
            >
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg gradient-brand text-primary-foreground">
                <f.icon className="h-5 w-5" />
              </div>
              <h3 className="mt-4 text-xl font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{f.body}</p>
            </div>
          ))}
        </section>
      </main>

      <footer className="border-t border-brand-surface">
        <div className="mx-auto max-w-6xl px-6 py-6 text-xs text-muted-foreground flex items-center justify-between">
          <span>© {new Date().getFullYear()} Conexão Implantes</span>
          <span className="text-brand-accent">Feito para performar</span>
        </div>
      </footer>
    </div>
  );
}

const FEATURES = [
  {
    icon: Gauge,
    title: "Cota diária inteligente",
    body: "Respeite os limites do Gmail: 300 envios/dia por padrão, contador atualizado em tempo real.",
  },
  {
    icon: Eye,
    title: "Rastreamento de abertura",
    body: "Pixel invisível registra cada abertura. Veja a taxa de sucesso em tempo real no dashboard.",
  },
  {
    icon: Mail,
    title: "SMTP próprio",
    body: "Use Gmail (App Password) ou qualquer servidor SMTP. Sua senha fica criptografada com AES-GCM.",
  },
];
