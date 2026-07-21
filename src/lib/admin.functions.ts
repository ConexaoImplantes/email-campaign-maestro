import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Acesso negado — somente super admin.");
}

export const isAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "admin")
      .maybeSingle();
    return { isAdmin: Boolean(data) };
  });

export const adminListUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: profiles, error } = await supabaseAdmin
      .from("profiles")
      .select(
        "id, email, smtp_host, smtp_port, smtp_user, smtp_pass_encrypted, from_name, daily_limit, emails_sent_today, last_reset_date, created_at, status",
      )
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    const { data: roles } = await supabaseAdmin.from("user_roles").select("user_id, role");
    const adminSet = new Set((roles ?? []).filter((r) => r.role === "admin").map((r) => r.user_id));

    // Per-user campaign + recipient stats
    const ids = (profiles ?? []).map((p) => p.id);
    const stats: Record<string, { campaigns: number; sent: number; failed: number; opened: number }> = {};
    if (ids.length > 0) {
      const { data: camps } = await supabaseAdmin
        .from("campaigns")
        .select("id, user_id")
        .in("user_id", ids);
      const byUser = new Map<string, string[]>();
      for (const c of camps ?? []) {
        const arr = byUser.get(c.user_id) ?? [];
        arr.push(c.id);
        byUser.set(c.user_id, arr);
      }
      for (const uid of ids) {
        const campIds = byUser.get(uid) ?? [];
        stats[uid] = { campaigns: campIds.length, sent: 0, failed: 0, opened: 0 };
        if (campIds.length === 0) continue;
        const [s, f, o] = await Promise.all([
          supabaseAdmin.from("recipients").select("*", { count: "exact", head: true }).in("campaign_id", campIds).eq("status", "sent"),
          supabaseAdmin.from("recipients").select("*", { count: "exact", head: true }).in("campaign_id", campIds).eq("status", "failed"),
          supabaseAdmin.from("recipients").select("*", { count: "exact", head: true }).in("campaign_id", campIds).not("opened_at", "is", null),
        ]);
        stats[uid].sent = s.count ?? 0;
        stats[uid].failed = f.count ?? 0;
        stats[uid].opened = o.count ?? 0;
      }
    }

    return (profiles ?? []).map((p) => ({
      id: p.id,
      email: p.email,
      smtp_host: p.smtp_host,
      smtp_port: p.smtp_port,
      smtp_user: p.smtp_user,
      smtp_configured: Boolean(p.smtp_pass_encrypted),
      from_name: p.from_name,
      daily_limit: p.daily_limit,
      emails_sent_today: p.emails_sent_today,
      last_reset_date: p.last_reset_date,
      created_at: p.created_at,
      status: (p.status ?? "pending") as "pending" | "approved" | "rejected",
      is_admin: adminSet.has(p.id),
      stats: stats[p.id] ?? { campaigns: 0, sent: 0, failed: 0, opened: 0 },
    }));
  });

export const adminApproveUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) =>
    z.object({ user_id: z.string().uuid(), daily_limit: z.number().int().min(1).max(100000) }).parse(v),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ status: "approved", daily_limit: data.daily_limit })
      .eq("id", data.user_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminRejectUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) => z.object({ user_id: z.string().uuid() }).parse(v))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ status: "rejected" })
      .eq("id", data.user_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminUpdateLimits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) =>
    z.object({ user_id: z.string().uuid(), daily_limit: z.number().int().min(0).max(100000) }).parse(v),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ daily_limit: data.daily_limit })
      .eq("id", data.user_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminSaveUserSmtp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) =>
    z
      .object({
        user_id: z.string().uuid(),
        smtp_host: z.string().min(1).max(200),
        smtp_port: z.number().int().min(1).max(65535),
        smtp_user: z.string().email().max(200),
        smtp_pass: z.string().min(1).max(500).optional(),
        from_name: z.string().max(120).nullable().optional(),
      })
      .parse(v),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let encrypted: string | undefined;
    if (data.smtp_pass && data.smtp_pass.length > 0) {
      const { encryptSecret } = await import("@/lib/crypto.server");
      encrypted = await encryptSecret(data.smtp_pass);
    }
    const patch = {
      smtp_host: data.smtp_host,
      smtp_port: data.smtp_port,
      smtp_user: data.smtp_user,
      from_name: data.from_name ?? null,
      ...(encrypted ? { smtp_pass_encrypted: encrypted } : {}),
    };
    const { error } = await supabaseAdmin.from("profiles").update(patch).eq("id", data.user_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- Default (global) SMTP ----------

export const getDefaultSmtp = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("app_settings")
      .select("smtp_host, smtp_port, smtp_user, smtp_pass_encrypted, from_name, updated_at")
      .eq("id", "default")
      .maybeSingle();
    return {
      smtp_host: data?.smtp_host ?? "smtp.gmail.com",
      smtp_port: data?.smtp_port ?? 587,
      smtp_user: data?.smtp_user ?? "",
      from_name: data?.from_name ?? "",
      configured: Boolean(data?.smtp_pass_encrypted && data?.smtp_host && data?.smtp_user),
      updated_at: data?.updated_at ?? null,
    };
  });

const defaultSmtpInput = z.object({
  smtp_host: z.string().min(1).max(200),
  smtp_port: z.number().int().min(1).max(65535),
  smtp_user: z.string().email().max(200),
  smtp_pass: z.string().min(1).max(500).optional(),
  from_name: z.string().max(120).nullable().optional(),
});

export const saveDefaultSmtp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) => defaultSmtpInput.parse(v))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let encrypted: string | undefined;
    if (data.smtp_pass && data.smtp_pass.length > 0) {
      const { encryptSecret } = await import("@/lib/crypto.server");
      encrypted = await encryptSecret(data.smtp_pass);
    }
    const patch = {
      smtp_host: data.smtp_host,
      smtp_port: data.smtp_port,
      smtp_user: data.smtp_user,
      from_name: data.from_name ?? null,
      ...(encrypted ? { smtp_pass_encrypted: encrypted } : {}),
    };
    const { error } = await supabaseAdmin.from("app_settings").update(patch).eq("id", "default");
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const testDefaultSmtp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) =>
    z
      .object({
        smtp_host: z.string().min(1),
        smtp_port: z.number().int().min(1).max(65535),
        smtp_user: z.string().email(),
        smtp_pass: z.string().min(1).optional(),
      })
      .parse(v),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { verifySmtp } = await import("@/lib/smtp.server");
    let pass = data.smtp_pass;
    if (!pass) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: row } = await supabaseAdmin
        .from("app_settings")
        .select("smtp_pass_encrypted")
        .eq("id", "default")
        .maybeSingle();
      if (!row?.smtp_pass_encrypted) {
        return { ok: false, error: "Nenhuma senha SMTP padrão salva." };
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

export const adminGlobalStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [users, campaigns, sent, failed, opened, pending, processing] = await Promise.all([
      supabaseAdmin.from("profiles").select("*", { count: "exact", head: true }),
      supabaseAdmin.from("campaigns").select("*", { count: "exact", head: true }),
      supabaseAdmin.from("recipients").select("*", { count: "exact", head: true }).eq("status", "sent"),
      supabaseAdmin.from("recipients").select("*", { count: "exact", head: true }).eq("status", "failed"),
      supabaseAdmin.from("recipients").select("*", { count: "exact", head: true }).not("opened_at", "is", null),
      supabaseAdmin.from("recipients").select("*", { count: "exact", head: true }).eq("status", "pending"),
      supabaseAdmin.from("campaigns").select("*", { count: "exact", head: true }).eq("status", "processing"),
    ]);

    // Sum daily usage
    const today = new Date().toISOString().slice(0, 10);
    const { data: profs } = await supabaseAdmin
      .from("profiles")
      .select("daily_limit, emails_sent_today, last_reset_date");
    let usedToday = 0;
    let totalLimit = 0;
    for (const p of profs ?? []) {
      totalLimit += p.daily_limit ?? 0;
      if (p.last_reset_date === today) usedToday += p.emails_sent_today ?? 0;
    }

    // Recent campaigns
    const { data: recent } = await supabaseAdmin
      .from("campaigns")
      .select("id, title, subject, status, total_recipients, created_at, user_id")
      .order("created_at", { ascending: false })
      .limit(15);

    // Map user_id -> email
    const uids = Array.from(new Set((recent ?? []).map((r) => r.user_id)));
    const emailMap: Record<string, string | null> = {};
    if (uids.length > 0) {
      const { data: ps } = await supabaseAdmin.from("profiles").select("id, email").in("id", uids);
      for (const p of ps ?? []) emailMap[p.id] = p.email;
    }

    return {
      users: users.count ?? 0,
      campaigns: campaigns.count ?? 0,
      sent: sent.count ?? 0,
      failed: failed.count ?? 0,
      opened: opened.count ?? 0,
      pending: pending.count ?? 0,
      processing: processing.count ?? 0,
      usedToday,
      totalLimit,
      openRate: (sent.count ?? 0) > 0 ? ((opened.count ?? 0) / (sent.count ?? 1)) * 100 : 0,
      recentCampaigns: (recent ?? []).map((r) => ({ ...r, email: emailMap[r.user_id] ?? null })),
    };
  });
