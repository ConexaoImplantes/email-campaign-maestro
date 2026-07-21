
-- Extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ============ PROFILES ============
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  smtp_host TEXT NOT NULL DEFAULT 'smtp.gmail.com',
  smtp_port INT NOT NULL DEFAULT 587,
  smtp_user TEXT,
  smtp_pass_encrypted BYTEA,
  from_name TEXT,
  daily_limit INT NOT NULL DEFAULT 300,
  emails_sent_today INT NOT NULL DEFAULT 0,
  last_reset_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- ============ CAMPAIGNS ============
CREATE TABLE public.campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  subject TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'richtext' CHECK (content_type IN ('richtext', 'html')),
  body_content TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'processing', 'paused', 'completed', 'failed')),
  total_recipients INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX campaigns_user_idx ON public.campaigns(user_id);
CREATE INDEX campaigns_status_idx ON public.campaigns(status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaigns TO authenticated;
GRANT ALL ON public.campaigns TO service_role;

ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own campaigns"
  ON public.campaigns FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============ RECIPIENTS ============
CREATE TABLE public.recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  name TEXT,
  email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'bounced')),
  error_message TEXT,
  opened_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX recipients_campaign_idx ON public.recipients(campaign_id);
CREATE INDEX recipients_status_campaign_idx ON public.recipients(status, campaign_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.recipients TO authenticated;
GRANT ALL ON public.recipients TO service_role;

ALTER TABLE public.recipients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own recipients"
  ON public.recipients FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.campaigns c
    WHERE c.id = recipients.campaign_id AND c.user_id = auth.uid()
  ));

CREATE POLICY "Users insert into own campaigns"
  ON public.recipients FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.campaigns c
    WHERE c.id = recipients.campaign_id AND c.user_id = auth.uid()
  ));

CREATE POLICY "Users update own recipients"
  ON public.recipients FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM public.campaigns c
    WHERE c.id = recipients.campaign_id AND c.user_id = auth.uid()
  ));

CREATE POLICY "Users delete own recipients"
  ON public.recipients FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM public.campaigns c
    WHERE c.id = recipients.campaign_id AND c.user_id = auth.uid()
  ));

-- ============ TIMESTAMP TRIGGERS ============
CREATE OR REPLACE FUNCTION public.tg_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER profiles_touch BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
CREATE TRIGGER campaigns_touch BEFORE UPDATE ON public.campaigns
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- ============ AUTO-CREATE PROFILE ON SIGNUP ============
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email)
  VALUES (NEW.id, NEW.email);
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============ SMTP PASSWORD ENCRYPTION HELPERS ============
-- Uses APP_ENCRYPTION_KEY set at DB level (see below).
CREATE OR REPLACE FUNCTION public.encrypt_smtp_pass(_plain TEXT)
RETURNS BYTEA
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  _key TEXT;
BEGIN
  _key := current_setting('app.encryption_key', true);
  IF _key IS NULL OR _key = '' THEN
    RAISE EXCEPTION 'Encryption key not configured';
  END IF;
  RETURN pgp_sym_encrypt(_plain, _key);
END;
$$;

CREATE OR REPLACE FUNCTION public.decrypt_smtp_pass(_cipher BYTEA)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  _key TEXT;
BEGIN
  _key := current_setting('app.encryption_key', true);
  IF _key IS NULL OR _key = '' THEN
    RAISE EXCEPTION 'Encryption key not configured';
  END IF;
  RETURN pgp_sym_decrypt(_cipher, _key);
END;
$$;

REVOKE ALL ON FUNCTION public.encrypt_smtp_pass(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.decrypt_smtp_pass(BYTEA) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.encrypt_smtp_pass(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.decrypt_smtp_pass(BYTEA) TO service_role;

-- Save the user's SMTP password by encrypting server-side.
CREATE OR REPLACE FUNCTION public.set_smtp_password(_plain TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  UPDATE public.profiles
    SET smtp_pass_encrypted = public.encrypt_smtp_pass(_plain)
    WHERE id = auth.uid();
END;
$$;
REVOKE ALL ON FUNCTION public.set_smtp_password(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_smtp_password(TEXT) TO authenticated;

-- Atomic increment used by the send worker.
CREATE OR REPLACE FUNCTION public.increment_emails_sent(_user_id UUID, _amount INT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles
    SET emails_sent_today = CASE
      WHEN last_reset_date < CURRENT_DATE THEN _amount
      ELSE emails_sent_today + _amount
    END,
    last_reset_date = CURRENT_DATE
    WHERE id = _user_id;
END;
$$;
REVOKE ALL ON FUNCTION public.increment_emails_sent(UUID, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_emails_sent(UUID, INT) TO service_role;

-- ============ REALTIME ============
ALTER PUBLICATION supabase_realtime ADD TABLE public.recipients;
ALTER PUBLICATION supabase_realtime ADD TABLE public.campaigns;
