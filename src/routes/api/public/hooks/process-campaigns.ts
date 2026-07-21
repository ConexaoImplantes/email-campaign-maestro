// Cron worker: process pending recipients respecting daily limit.
// Called by pg_cron every minute. Uses supabaseAdmin.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/process-campaigns")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Verify caller with Supabase anon key (pg_cron sets `apikey` header).
        const apikey = request.headers.get("apikey");
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!expected || apikey !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { decryptSecret } = await import("@/lib/crypto.server");
        const { sendMail, injectTrackingPixel, extractInlineImages } = await import("@/lib/smtp.server");

        // Find active campaigns (processing)
        const { data: campaigns, error: cErr } = await supabaseAdmin
          .from("campaigns")
          .select("id, user_id, subject, body_content, content_type, total_recipients")
          .eq("status", "processing")
          .limit(20);
        if (cErr) return new Response(cErr.message, { status: 500 });

        const trackBase = deriveOrigin(request) + "/api/public/hooks/track-open";
        const summary: Record<string, { sent: number; failed: number }> = {};

        // Load default SMTP once (fallback for users without their own)
        const { data: defaultSmtp } = await supabaseAdmin
          .from("app_settings")
          .select("smtp_host, smtp_port, smtp_user, smtp_pass_encrypted, from_name")
          .eq("id", "default")
          .maybeSingle();

        for (const camp of campaigns ?? []) {
          const { data: profile } = await supabaseAdmin
            .from("profiles")
            .select("smtp_host, smtp_port, smtp_user, smtp_pass_encrypted, from_name, daily_limit, emails_sent_today, last_reset_date")
            .eq("id", camp.user_id)
            .maybeSingle();

          // Resolve SMTP: prefer per-user override, otherwise fall back to global default.
          const userHasOwnSmtp = Boolean(
            profile?.smtp_pass_encrypted && profile?.smtp_host && profile?.smtp_user,
          );
          const smtpSource = userHasOwnSmtp ? profile! : defaultSmtp;
          if (
            !smtpSource?.smtp_pass_encrypted ||
            !smtpSource.smtp_host ||
            !smtpSource.smtp_user
          ) {
            continue;
          }

          // Daily reset check
          const today = new Date().toISOString().slice(0, 10);
          let used = profile?.emails_sent_today ?? 0;
          if (profile?.last_reset_date !== today) {
            used = 0;
            await supabaseAdmin
              .from("profiles")
              .update({ emails_sent_today: 0, last_reset_date: today })
              .eq("id", camp.user_id);
          }
          const remaining = Math.max(0, (profile?.daily_limit ?? 300) - used);
          if (remaining <= 0) continue;

          // Batch size per tick — send up to 15/minute to spread evenly
          const batch = Math.min(15, remaining);
          const { data: pending } = await supabaseAdmin
            .from("recipients")
            .select("id, email, name")
            .eq("campaign_id", camp.id)
            .eq("status", "pending")
            .order("created_at", { ascending: true })
            .limit(batch);

          if (!pending || pending.length === 0) {
            // Nothing pending — check if all done → mark completed
            const { count: pendingCount } = await supabaseAdmin
              .from("recipients")
              .select("*", { count: "exact", head: true })
              .eq("campaign_id", camp.id)
              .eq("status", "pending");
            if ((pendingCount ?? 0) === 0) {
              await supabaseAdmin.from("campaigns").update({ status: "completed" }).eq("id", camp.id);
            }
            continue;
          }

          const password = await decryptSecret(smtpSource.smtp_pass_encrypted as string);
          const cfg = {
            host: smtpSource.smtp_host as string,
            port: (smtpSource.smtp_port as number | null) ?? 587,
            user: smtpSource.smtp_user as string,
            pass: password,
            fromName: (profile?.from_name ?? smtpSource.from_name) as string | null,
          };

          // Load attachments once per campaign
          const { data: attRows } = await supabaseAdmin
            .from("campaign_attachments")
            .select("filename, mime_type, content_base64")
            .eq("campaign_id", camp.id);
          const attachments = (attRows ?? []).map((a) => ({
            filename: a.filename as string,
            content: Buffer.from(a.content_base64 as string, "base64"),
            contentType: a.mime_type as string,
          }));

          let sentInBatch = 0;
          for (const r of pending) {
            // Re-check status in case user paused mid-batch
            const { data: stateRow } = await supabaseAdmin
              .from("campaigns")
              .select("status")
              .eq("id", camp.id)
              .maybeSingle();
            if (stateRow?.status !== "processing") break;

            const originBase = deriveOrigin(request);
            const inline = extractInlineImages(camp.body_content ?? "", originBase);
            const html = injectTrackingPixel(inline.html, trackBase, r.id);
            const mailAttachments = [...attachments, ...inline.attachments];
            const res = await sendMail(cfg, { email: r.email, name: r.name }, camp.subject, html, mailAttachments);
            const now = new Date().toISOString();
            if (res.ok) {
              await supabaseAdmin
                .from("recipients")
                .update({ status: "sent", sent_at: now, error_message: null })
                .eq("id", r.id);
              sentInBatch++;
            } else {
              await supabaseAdmin
                .from("recipients")
                .update({ status: "failed", error_message: res.error ?? "unknown" })
                .eq("id", r.id);
            }
            summary[camp.id] ??= { sent: 0, failed: 0 };
            if (res.ok) summary[camp.id].sent++;
            else summary[camp.id].failed++;
          }

          if (sentInBatch > 0) {
            await supabaseAdmin
              .from("profiles")
              .update({
                emails_sent_today: used + sentInBatch,
                last_reset_date: today,
              })
              .eq("id", camp.user_id);
          }
        }

        return new Response(JSON.stringify({ ok: true, summary }), {
          headers: { "content-type": "application/json" },
        });
      },
    },
  },
});

function deriveOrigin(request: Request): string {
  try {
    const u = new URL(request.url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return "";
  }
}
