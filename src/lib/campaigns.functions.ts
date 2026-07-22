import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ---------- Admin helpers ----------

async function isAdminUser(supabase: any, userId: string): Promise<boolean> {
  const { data } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  return Boolean(data);
}

/**
 * Returns a supabase client to use for the request. Admins get the service-role
 * client so they can CRUD any user's data; regular users keep their RLS-scoped
 * client.
 */
async function resolveDb(supabase: any, userId: string): Promise<{ db: any; admin: boolean }> {
  const admin = await isAdminUser(supabase, userId);
  if (admin) {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return { db: supabaseAdmin, admin: true };
  }
  return { db: supabase, admin: false };
}

// ---------- Profile / SMTP ----------

export const getProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("profiles")
      .select(
        "id, email, smtp_host, smtp_port, smtp_user, from_name, daily_limit, emails_sent_today, last_reset_date, smtp_pass_encrypted, status",
      )
      .eq("id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);

    const userConfigured = Boolean(data?.smtp_pass_encrypted);
    let defaultConfigured = false;
    if (!userConfigured) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: def } = await supabaseAdmin
        .from("app_settings")
        .select("smtp_host, smtp_user, smtp_pass_encrypted")
        .eq("id", "default")
        .maybeSingle();
      defaultConfigured = Boolean(def?.smtp_pass_encrypted && def?.smtp_host && def?.smtp_user);
    }

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
      smtp_configured: userConfigured || defaultConfigured,
      smtp_source: userConfigured ? ("user" as const) : defaultConfigured ? ("default" as const) : ("none" as const),
      status: (data?.status ?? "pending") as "pending" | "approved" | "rejected",
    };
  });

async function assertApproved(supabase: any, userId: string) {
  const { data } = await supabase.from("profiles").select("status").eq("id", userId).maybeSingle();
  const status = data?.status ?? "pending";
  if (status !== "approved") {
    throw new Error(
      status === "rejected"
        ? "Seu acesso foi rejeitado pelo Super Admin."
        : "Sua conta está aguardando aprovação do Super Admin.",
    );
  }
}

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
  owner_user_id: z.string().uuid().optional(),
});

export const createCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) => createCampaignInput.parse(v))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { db, admin } = await resolveDb(supabase, userId);
    // Admin can create on behalf of another user
    const ownerId = admin && data.owner_user_id ? data.owner_user_id : userId;
    if (!admin) await assertApproved(supabase, userId);
    const { data: camp, error } = await db
      .from("campaigns")
      .insert({
        user_id: ownerId,
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
      for (let i = 0; i < rows.length; i += 500) {
        const chunk = rows.slice(i, i + 500);
        const { error: e2 } = await db.from("recipients").insert(chunk);
        if (e2) throw new Error(e2.message);
      }
      await db
        .from("campaigns")
        .update({ total_recipients: rows.length })
        .eq("id", camp.id);
    }
    return { id: camp.id };
  });

const updateCampaignInput = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(200),
  subject: z.string().min(1).max(300),
  content_type: z.enum(["richtext", "html"]),
  body_content: z.string().max(500_000),
});

export const updateCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) => updateCampaignInput.parse(v))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { db, admin } = await resolveDb(supabase, userId);
    let q = db
      .from("campaigns")
      .update({
        title: data.title,
        subject: data.subject,
        content_type: data.content_type,
        body_content: data.body_content,
      })
      .eq("id", data.id);
    if (!admin) q = q.eq("user_id", userId);
    const { error } = await q;
    if (error) throw new Error(error.message);
    return { ok: true };
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
    const { db, admin } = await resolveDb(supabase, userId);
    if (!admin && data.status === "processing") await assertApproved(supabase, userId);
    let q = db.from("campaigns").update({ status: data.status }).eq("id", data.id);
    if (!admin) q = q.eq("user_id", userId);
    const { error } = await q;
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listCampaigns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { db, admin } = await resolveDb(supabase, userId);
    let q = db
      .from("campaigns")
      .select("id, title, subject, status, total_recipients, created_at, user_id")
      .order("created_at", { ascending: false })
      .limit(500);
    if (!admin) q = q.eq("user_id", userId);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    let ownerMap: Record<string, string | null> = {};
    if (admin && rows.length > 0) {
      const ids = Array.from(new Set(rows.map((r: any) => r.user_id)));
      const { data: profs } = await db.from("profiles").select("id, email").in("id", ids);
      for (const p of profs ?? []) ownerMap[p.id] = p.email;
    }
    return rows.map((r: any) => ({
      id: r.id,
      title: r.title,
      subject: r.subject,
      status: r.status,
      total_recipients: r.total_recipients,
      created_at: r.created_at,
      owner_email: admin ? ownerMap[r.user_id] ?? null : null,
    }));
  });

export const getCampaign = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) => z.object({ id: z.string().uuid() }).parse(v))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { db, admin } = await resolveDb(supabase, userId);
    let q = db.from("campaigns").select("*").eq("id", data.id);
    if (!admin) q = q.eq("user_id", userId);
    const { data: c, error } = await q.maybeSingle();
    if (error) throw new Error(error.message);
    if (!c) return null;
    let owner_email: string | null = null;
    if (admin) {
      const { data: p } = await db.from("profiles").select("email").eq("id", c.user_id).maybeSingle();
      owner_email = p?.email ?? null;
    }
    return { ...c, owner_email };
  });

export const getRecipients = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) => z.object({ campaign_id: z.string().uuid() }).parse(v))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { db } = await resolveDb(supabase, userId);
    const { data: rows, error } = await db
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
    const { db, admin } = await resolveDb(supabase, userId);
    let q = db.from("campaigns").delete().eq("id", data.id);
    if (!admin) q = q.eq("user_id", userId);
    const { error } = await q;
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- Attachments ----------

const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

const addAttachmentInput = z.object({
  campaign_id: z.string().uuid(),
  filename: z.string().min(1).max(200),
  mime_type: z.string().max(120).default("application/octet-stream"),
  size_bytes: z.number().int().min(1).max(MAX_ATTACHMENT_BYTES),
  content_base64: z.string().min(1).max(8_000_000),
});

export const addAttachment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) => addAttachmentInput.parse(v))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { db, admin } = await resolveDb(supabase, userId);
    let cq = db.from("campaigns").select("id").eq("id", data.campaign_id);
    if (!admin) cq = cq.eq("user_id", userId);
    const { data: camp } = await cq.maybeSingle();
    if (!camp) throw new Error("Campanha não encontrada");
    const { data: row, error } = await db
      .from("campaign_attachments")
      .insert({
        campaign_id: data.campaign_id,
        filename: data.filename,
        mime_type: data.mime_type,
        size_bytes: data.size_bytes,
        content_base64: data.content_base64,
      })
      .select("id, filename, mime_type, size_bytes")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const listAttachments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) => z.object({ campaign_id: z.string().uuid() }).parse(v))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { db } = await resolveDb(supabase, userId);
    const { data: rows, error } = await db
      .from("campaign_attachments")
      .select("id, filename, mime_type, size_bytes, created_at")
      .eq("campaign_id", data.campaign_id)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const removeAttachment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) => z.object({ id: z.string().uuid() }).parse(v))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { db } = await resolveDb(supabase, userId);
    const { error } = await db.from("campaign_attachments").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- Clone ----------

export const cloneCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) => z.object({ id: z.string().uuid() }).parse(v))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { db, admin } = await resolveDb(supabase, userId);
    let srcQ = db
      .from("campaigns")
      .select("title, subject, content_type, body_content, user_id")
      .eq("id", data.id);
    if (!admin) srcQ = srcQ.eq("user_id", userId);
    const { data: src, error: e1 } = await srcQ.maybeSingle();
    if (e1) throw new Error(e1.message);
    if (!src) throw new Error("Campanha não encontrada");

    // Admin clones preserve original owner; regular users own their clones.
    const ownerId = admin ? src.user_id : userId;

    const { data: clone, error: e2 } = await db
      .from("campaigns")
      .insert({
        user_id: ownerId,
        title: `${src.title} (cópia)`,
        subject: src.subject,
        content_type: src.content_type,
        body_content: src.body_content,
        status: "draft",
        total_recipients: 0,
      })
      .select("id")
      .single();
    if (e2) throw new Error(e2.message);

    const { data: rec } = await db
      .from("recipients")
      .select("email, name")
      .eq("campaign_id", data.id);
    const rows = (rec ?? []).map((r: any) => ({
      campaign_id: clone.id,
      email: r.email,
      name: r.name ?? null,
    }));
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      if (chunk.length === 0) break;
      const { error: e3 } = await db.from("recipients").insert(chunk);
      if (e3) throw new Error(e3.message);
    }
    if (rows.length > 0) {
      await db.from("campaigns").update({ total_recipients: rows.length }).eq("id", clone.id);
    }

    const { data: atts } = await db
      .from("campaign_attachments")
      .select("filename, mime_type, size_bytes, content_base64")
      .eq("campaign_id", data.id);
    for (const a of atts ?? []) {
      await db.from("campaign_attachments").insert({
        campaign_id: clone.id,
        filename: a.filename,
        mime_type: a.mime_type,
        size_bytes: a.size_bytes,
        content_base64: a.content_base64,
      });
    }

    return { id: clone.id };
  });
