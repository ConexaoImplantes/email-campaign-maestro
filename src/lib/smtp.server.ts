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

export interface MailAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
  cid?: string;
}

export async function sendMail(
  cfg: SmtpConfig,
  to: { email: string; name?: string | null },
  subject: string,
  html: string,
  attachments?: MailAttachment[],
): Promise<SendResult> {
  const transporter = createTransport(cfg);
  try {
    await transporter.sendMail({
      from: formatAddress(cfg.user, cfg.fromName),
      to: formatAddress(to.email, to.name),
      subject,
      html,
      text: html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(),
      attachments: attachments?.map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
        cid: a.cid,
      })),
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

/**
 * Converts inline data:image URIs into CID attachments and rewrites
 * relative <img src="/..."> paths into absolute URLs. Email clients
 * (Gmail/Outlook) frequently strip data: URIs — CIDs render reliably.
 */
export function extractInlineImages(
  html: string,
  baseUrl?: string,
): { html: string; attachments: MailAttachment[] } {
  const attachments: MailAttachment[] = [];
  let counter = 0;

  let out = html.replace(
    /src\s*=\s*(['"])data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)\1/g,
    (_m, _q, mime: string, b64: string) => {
      const cleaned = b64.replace(/\s+/g, "");
      let content: Buffer;
      try {
        content = Buffer.from(cleaned, "base64");
      } catch {
        return _m as string;
      }
      const ext = (mime.split("/")[1] ?? "png").split("+")[0];
      const cid = `inline-${Date.now()}-${counter++}@conexao`;
      attachments.push({
        filename: `image-${counter}.${ext}`,
        content,
        contentType: mime,
        cid,
      });
      return `src="cid:${cid}"`;
    },
  );

  if (baseUrl) {
    const origin = baseUrl.replace(/\/$/, "");
    out = out.replace(
      /(<img\b[^>]*\bsrc\s*=\s*)(['"])(\/[^'"]*)\2/gi,
      (_m, pre: string, q: string, path: string) => `${pre}${q}${origin}${path}${q}`,
    );
  }

  return { html: out, attachments };
}

