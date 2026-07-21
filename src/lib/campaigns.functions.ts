import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ---------- Profile / SMTP ----------

export const getProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("profiles")
      .select(
        "id, email, smtp_host, smtp_port, smtp_user, from_name, daily_limit, emails_sent_today, last_reset_date, smtp_pass_encrypted",
      )
      .eq("id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return {
      id: data?.id ?? userId,
      email: data?.email ?? null,
      smtp_host: data?.smtp_host ?? "smtp.gmail.com",
      smtp_port: data?.smtp_port ?? 587,
      smtp_user: data?.smtp_user ?? null,
      from_name: data?.from_name ?? null,
      daily_limit: data?.daily_limit ?? 300,
      emails_sent_today: data?.emails_sent_today ?? 0,
      last_reset_date: data?.last_reset_date ?? null,
      smtp_configured: Boolean(data?.smtp_pass_encrypted),
    };
  });

const smtpInput = z.object({
  smtp_host: z.string().min(1).max(200),
  smtp_port: z.number().int().min(1).max(65535),
  smtp_user: z.string().email().max(200),
  smtp_pass: z.string().min(1).max(500).optional(),
  from_name: z.string().max(120).optional().nullable(),
});

export const saveSmtp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) => smtpInput.parse(v))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const patch: Record<string, unknown> = {
      smtp_host: data.smtp_host,
      smtp_port: data.smtp_port,
      smtp_user: data.smtp_user,
      from_name: data.from_name ?? null,
    };
    if (data.smtp_pass && data.smtp_pass.length > 0) {
      const { encryptSecret } = await import("@/lib/crypto.server");
      patch.smtp_pass_encrypted = await encryptSecret(data.smtp_pass);
    }
    const { error } = await supabase.from("profiles").update(patch).eq("id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const testSmtpInput = z.object({
  smtp_host: z.string().min(1),
  smtp_port: z.number().int().min(1).max(65535),
  smtp_user: z.string().email(),
  smtp_pass: z.string().min(1).optional(),
});

export const testSmtp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) => testSmtpInput.parse(v))
  .handler(async ({ data, context }) => {
    const { verifySmtp } = await import("@/lib/smtp.server");
    let pass = data.smtp_pass;
    if (!pass) {
      const { supabase, userId } = context;
      const { data: row } = await supabase
        .from("profiles")
        .select("smtp_pass_encrypted")
        .eq("id", userId)
        .maybeSingle();
      if (!row?.smtp_pass_encrypted) {
        return { ok: false, error: "Nenhuma senha SMTP salva." };
      }
      const { decryptSecret } = await import("@/lib/crypto.server");
      pass = await decryptSecret(row.smtp_pass_encrypted as string);
    }
    return verifySmtp({
      host: data.smtp_host,
      port: data.smtp_port,
      user: data.smtp_user,
      pass: pass!,
    });
  });

// ---------- Campaigns ----------

const createCampaignInput = z.object({
  title: z.string().min(1).max(200),
  subject: z.string().min(1).max(300),
  content_type: z.enum(["richtext", "html"]),
  body_content: z.string().max(500_000),
  recipients: z
    .array(
      z.object({
        name: z.string().max(200).nullable().optional(),
        email: z.string().email().max(320),
      }),
    )
    .max(20_000)
    .default([]),
});

export const createCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) => createCampaignInput.parse(v))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: camp, error } = await supabase
      .from("campaigns")
      .insert({
        user_id: userId,
        title: data.title,
        subject: data.subject,
        content_type: data.content_type,
        body_content: data.body_content,
        total_recipients: data.recipients.length,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    if (data.recipients.length > 0) {
      // Dedupe by email
      const seen = new Set<string>();
      const rows = data.recipients
        .filter((r) => {
          const key = r.email.toLowerCase();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .map((r) => ({
          campaign_id: camp.id,
          email: r.email,
          name: r.name ?? null,
        }));
      // Insert in chunks of 500
      for (let i = 0; i < rows.length; i += 500) {
        const chunk = rows.slice(i, i + 500);
        const { error: e2 } = await supabase.from("recipients").insert(chunk);
        if (e2) throw new Error(e2.message);
      }
      await supabase
        .from("campaigns")
        .update({ total_recipients: rows.length })
        .eq("id", camp.id);
    }
    return { id: camp.id };
  });

export const setCampaignStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) =>
    z
      .object({
        id: z.string().uuid(),
        status: z.enum(["draft", "processing", "paused"]),
      })
      .parse(v),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("campaigns")
      .update({ status: data.status })
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listCampaigns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("campaigns")
      .select("id, title, subject, status, total_recipients, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const getCampaign = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) => z.object({ id: z.string().uuid() }).parse(v))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: c, error } = await supabase
      .from("campaigns")
      .select("*")
      .eq("id", data.id)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return c;
  });

export const getRecipients = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) => z.object({ campaign_id: z.string().uuid() }).parse(v))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: rows, error } = await supabase
      .from("recipients")
      .select("id, name, email, status, error_message, sent_at, opened_at")
      .eq("campaign_id", data.campaign_id)
      .order("created_at", { ascending: true })
      .limit(5000);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const getDashboardStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: profile } = await supabase
      .from("profiles")
      .select("daily_limit, emails_sent_today, last_reset_date")
      .eq("id", userId)
      .maybeSingle();

    // Aggregate via RPC would be nicer; we do quick counts here.
    const { data: campaignIds } = await supabase
      .from("campaigns")
      .select("id")
      .eq("user_id", userId);
    const ids = (campaignIds ?? []).map((c) => c.id);
    let sent = 0,
      failed = 0,
      opened = 0,
      totalWithSent = 0;
    if (ids.length > 0) {
      const q = (col: string, val: string) =>
        supabase
          .from("recipients")
          .select("*", { count: "exact", head: true })
          .in("campaign_id", ids)
          .eq(col, val);
      const [{ count: s }, { count: f }] = await Promise.all([
        q("status", "sent"),
        q("status", "failed"),
      ]);
      sent = s ?? 0;
      failed = f ?? 0;
      totalWithSent = sent;
      const { count: o } = await supabase
        .from("recipients")
        .select("*", { count: "exact", head: true })
        .in("campaign_id", ids)
        .not("opened_at", "is", null);
      opened = o ?? 0;
    }
    const openRate = totalWithSent > 0 ? (opened / totalWithSent) * 100 : 0;
    const today = new Date().toISOString().slice(0, 10);
    const usedToday =
      profile?.last_reset_date === today ? profile.emails_sent_today : 0;
    return {
      sent,
      failed,
      opened,
      openRate,
      dailyLimit: profile?.daily_limit ?? 300,
      usedToday,
    };
  });

export const deleteCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) => z.object({ id: z.string().uuid() }).parse(v))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("campaigns")
      .delete()
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
