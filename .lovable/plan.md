## Email Campaign Manager — Conexão Implantes

App SaaS para criar, disparar e monitorar campanhas de email via SMTP do próprio usuário (Gmail App Password), com cota diária de 300 envios, pixel de rastreamento e dashboard em tempo real — **totalmente vestido no design system Conexão Implantes** (dark navy + dourado metálico).

### Identidade visual
- **Favicon** (`public/favicon.png`) = `user-uploads://favicon.png`; substitui o padrão Lovable no `head().links`.
- **Logo horizontal branca** (`Logo_Conexão_horizontal_texto_branco.png`) usada no header autenticado, na landing e na tela de auth. Publicada via `lovable-assets` (evita commit de binário no repo).
- **Fontes**: Inter (corpo) + display refinada para títulos (via Google Fonts no `<link>` do `__root.tsx`).
- **Tokens de cor** (aplicados em `src/styles.css` como CSS custom properties + `@theme inline`, convertidos para oklch onde aplicável, mantendo os hex do DS via `--brand-*` para gradientes exatos):
  - Base: bg `#0f172a`, surface `#1e293b`, surface-hover `#334155`, card `#1e293b`.
  - Tipografia: `#f8fafc` / muted `#94a3b8` / inverted `#0f172a`.
  - Bordas: transparente / subtle `#1e293b`.
  - **Accent dourado**: `#c9a655` (hover `#d4b366`, fg `#0f172a`, muted 12%).
  - **Gradiente-assinatura**: `linear-gradient(135deg, #c9a655 0%, #e8d48b 40%, #a8873a 70%, #c9a655 100%)` — usado em CTAs primários, barra da cota diária e destaques de KPI.
  - Feedback: success `#22c55e`, warning `#eab308`, error `#ef4444` (+ variantes `-bg` a ~8-15%).
  - Componentes: input bg `#0f172a`, border `#334155`, focus/ring `#c9a655` (ring 50%).
  - Efeitos: overlay `#00000080`, shadow `#00000040`, glass `#ffffff10`, scrollbar thumb dourada, hover border/shadow dourados translúcidos.
- shadcn/ui reconfigurado para consumir esses tokens (Button variant `primary` = gradiente + texto `#0f172a`; `secondary` = surface; `ghost` = hover-bg). Sem cor hardcoded em componentes — só semantic tokens.
- Micro-interações: `hover:scale-[1.02]` + sombra dourada suave nos cards de KPI e botões CTA. Scrollbar customizada global.

### Stack
- TanStack Start + React + Tailwind v4 + shadcn/ui.
- Lovable Cloud (Supabase) para auth email/senha, DB, RLS e Edge Functions.
- Envio SMTP real via **Supabase Edge Function em Deno + denomailer** (o worker do TanStack não suporta SMTP TCP). Loop assíncrono acionado por `pg_cron` + `pg_net` a cada 1 min.
- TipTap (rich text) + `<textarea>` HTML puro. PapaParse para CSV.

### Autenticação
- Email + senha via Lovable Cloud (sem provedores sociais nesta v1).
- Layout gated em `src/routes/_authenticated/`.
- `/` = landing pública com hero (logo horizontal + gradiente dourado) e CTA "Entrar".
- `/auth` = login/cadastro estilizado no DS.
- Após login → `/dashboard`.

### Modelo de dados (migrations)
- **profiles** (`id`, `smtp_host`, `smtp_port`, `smtp_user`, `smtp_pass_encrypted`, `from_name`, `daily_limit=300`, `emails_sent_today`, `last_reset_date`) — RLS dono; senha cifrada com `pgcrypto`/`pgp_sym_encrypt` via RPC security-definer usando `APP_ENCRYPTION_KEY` (gerado por `generate_secret`).
- **campaigns** (`id`, `user_id`, `title`, `subject`, `content_type`, `body_content`, `status`, `total_recipients`, `created_at`) — RLS dono.
- **recipients** (`id`, `campaign_id`, `name`, `email`, `status`, `error_message`, `opened_at`, `sent_at`) — RLS via join com campaign; índice `(status, campaign_id)`.
- GRANTs `authenticated`/`service_role` conforme padrão. Trigger `on_auth_user_created` cria profile.

### Telas

**`/` (público)** — hero dark com logo horizontal Conexão, headline em display, CTA gradiente dourado "Entrar", grid de 3 features (Cota diária inteligente / Rastreamento de abertura / SMTP próprio).

**`/auth`** — card centralizado surface, logo no topo, tabs Entrar/Cadastrar, inputs com focus ring dourado.

**`/_authenticated/*` layout** — Header fixo com `headerBg` + logo horizontal (esquerda), nav (Dashboard / Nova campanha / Configurações), avatar/menu com sair. Sidebar não necessária.

**`/dashboard`** — 5 KPI cards (Enviados, Taxa de Abertura, Sucessos, Falhas, Cota Diária com barra em gradiente dourado 0/300). Lista de campanhas recentes (status badges coloridos). Tabela de recipients da campanha selecionada com filtros e atualização **realtime** via Supabase channel.

**`/campaigns/new`** — 4 blocos em cards surface:
1. Mensagem: título, assunto, tabs RichText (TipTap) / HTML.
2. Destinatários: tab manual + tab CSV drag&drop; contador "X carregados · Y enviados hoje · Z pendentes".
3. SMTP: from name, email, App Password (mascarada), host, porta, botão "Testar conexão" + link ajuda Google.
4. Ações: "Salvar rascunho" (secondary) + "Iniciar campanha" (primary gradiente).

**`/campaigns/$id`** — detalhes + tabela recipients + pause/resume.

**`/settings`** — edita SMTP salvo no profile.

### Backend

**Server functions TanStack** (`src/lib/*.functions.ts`, todas com `requireSupabaseAuth`)
- `saveProfileSmtp`, `testSmtp` (chama Edge Function), `createCampaign`, `updateCampaign`, `startCampaign`, `pauseCampaign`, `addRecipientsManual`, `addRecipientsBulk`, `getDashboardStats`, `listCampaigns`, `getCampaignRecipients`.

**Edge Functions Supabase (Deno)**
- `smtp-test`: conecta via denomailer e retorna ok/erro.
- `process-campaign` (cron 1min): reset diário se vencido → busca campanhas `processing` do usuário → pega até `min(cota_restante, 15)` recipients `pending` → descriptografa SMTP → injeta pixel `<img src="{PROJECT_URL}/functions/v1/track-open?rid={id}" width="1" height="1" style="display:none">` no HTML → envia → atualiza status/`sent_at`/`error_message` → incrementa `emails_sent_today` atômico → marca campanha `completed` quando esgota `pending`.
- `track-open`: GET com `rid` UUID; update `opened_at` se null; retorna PNG 1x1 transparente com `Cache-Control: no-store`.
- `daily-reset` (cron 00:00): zera `emails_sent_today` de todos os profiles.

**Secrets**
- `LOVABLE_API_KEY` (auto).
- `APP_ENCRYPTION_KEY` — via `generate_secret`, 64 chars.
- `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` (auto).

### Segurança
- Senha SMTP nunca retorna ao cliente (só flag "configurado").
- RLS estrita em todas as tabelas; recipients acessíveis apenas via campaign do dono.
- Descriptografia exclusivamente dentro da Edge Function (service role).
- Validação Zod em toda server function (formato email, tamanhos, limites, UUIDs).
- Pixel endpoint público mas idempotente e restrito ao update do próprio `rid`.

### Entregáveis desta iteração
1. Tokens do DS Conexão aplicados em `src/styles.css` + shadcn adaptado + fontes Google.
2. Favicon Conexão + logo horizontal em `__root.tsx`, landing, /auth e header.
3. Migrations (schema + RLS + grants + pgcrypto + pg_cron jobs).
4. Auth email/senha + rotas gated.
5. UI completa: landing, /auth, /dashboard, /campaigns/new, /campaigns/$id, /settings.
6. Server functions + 4 Edge Functions Deno.
7. Realtime no dashboard.

### Limitações conhecidas
- Gmail App Password requer 2FA — link de ajuda no formulário.
- Cota real Gmail ~500/dia; default 300 conservador e configurável.
- Taxa de abertura depende de imagens habilitadas no cliente do destinatário.
