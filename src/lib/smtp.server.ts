// SMTP sending via nodemailer.
// Server-only: imported dynamically from server functions/routes.
import nodemailer from "nodemailer";

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  fromName?: string | null;
}

export interface SendResult {
  ok: boolean;
  error?: string;
}

function getSmtpErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/invalid login|authentication failed|username and password not accepted|535/i.test(message)) {
    return "Usuário ou senha SMTP inválidos. Para Gmail, use uma senha de app de 16 caracteres.";
  }
  if (/certificate|self signed|tls/i.test(message)) {
    return "Falha de TLS/segurança na conexão SMTP. Verifique host, porta e configuração de STARTTLS.";
  }
  if (/timeout|timed out|etimedout/i.test(message)) {
    return "Tempo esgotado ao conectar ao SMTP. Verifique host e porta.";
  }
  if (/econnrefused|enotfound|getaddrinfo|dns/i.test(message)) {
    return "Não foi possível conectar ao servidor SMTP. Verifique host e porta.";
  }
  return message || "Falha na conexão SMTP";
}

function formatAddress(email: string, name?: string | null): string {
  if (!name?.trim()) return email;
  const safeName = name.trim().replace(/"/g, "'");
  return `"${safeName}" <${email}>`;
}

function createTransport(cfg: SmtpConfig) {
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.port === 465,
    requireTLS: cfg.port === 587,
    auth: {
      user: cfg.user,
      pass: cfg.pass,
    },
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
    socketTimeout: 30_000,
  });
}

export async function verifySmtp(cfg: SmtpConfig): Promise<SendResult> {
  const transporter = createTransport(cfg);
  try {
    await transporter.verify();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: getSmtpErrorMessage(e) };
  } finally {
    transporter.close();
  }
}

export async function sendMail(
  cfg: SmtpConfig,
  to: { email: string; name?: string | null },
  subject: string,
  html: string,
): Promise<SendResult> {
  const transporter = createTransport(cfg);
  try {
    await transporter.sendMail({
      from: formatAddress(cfg.user, cfg.fromName),
      to: formatAddress(to.email, to.name),
      subject,
      html,
      text: html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(),
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: getSmtpErrorMessage(e) };
  } finally {
    transporter.close();
  }
}

export function injectTrackingPixel(
  html: string,
  trackUrl: string,
  recipientId: string,
): string {
  const pixel = `<img src="${trackUrl}?rid=${encodeURIComponent(recipientId)}" width="1" height="1" alt="" style="display:none;border:0;width:1px;height:1px;" />`;
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${pixel}</body>`);
  return html + pixel;
}
