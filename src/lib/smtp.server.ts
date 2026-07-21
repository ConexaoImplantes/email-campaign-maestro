// SMTP sending via worker-mailer (Cloudflare Workers TCP sockets).
// Server-only: never import from client bundles.
import { WorkerMailer } from "worker-mailer";

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

export async function verifySmtp(cfg: SmtpConfig): Promise<SendResult> {
  try {
    const mailer = await WorkerMailer.connect({
      credentials: { username: cfg.user, password: cfg.pass },
      authType: "plain",
      host: cfg.host,
      port: cfg.port,
      secure: cfg.port === 465,
      startTls: cfg.port === 587,
    });
    await mailer.close();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message || "SMTP connection failed" };
  }
}

export async function sendMail(
  cfg: SmtpConfig,
  to: { email: string; name?: string | null },
  subject: string,
  html: string,
): Promise<SendResult> {
  let mailer: WorkerMailer | null = null;
  try {
    mailer = await WorkerMailer.connect({
      credentials: { username: cfg.user, password: cfg.pass },
      authType: "plain",
      host: cfg.host,
      port: cfg.port,
      secure: cfg.port === 465,
      startTls: cfg.port === 587,
    });
    await mailer.send({
      from: cfg.fromName ? { name: cfg.fromName, email: cfg.user } : cfg.user,
      to: to.name ? { name: to.name, email: to.email } : to.email,
      subject,
      html,
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message || "Send failed" };
  } finally {
    try {
      await mailer?.close();
    } catch {
      /* noop */
    }
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
