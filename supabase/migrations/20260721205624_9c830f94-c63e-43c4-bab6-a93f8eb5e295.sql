
CREATE TABLE IF NOT EXISTS public.app_settings (
  id text PRIMARY KEY DEFAULT 'default' CHECK (id = 'default'),
  smtp_host text,
  smtp_port int DEFAULT 587,
  smtp_user text,
  smtp_pass_encrypted text,
  from_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.app_settings TO service_role;

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- Only accessible via service_role (server-side admin fns). No policies granted to authenticated/anon.

CREATE TRIGGER app_settings_touch_updated_at
  BEFORE UPDATE ON public.app_settings
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

INSERT INTO public.app_settings (id) VALUES ('default') ON CONFLICT DO NOTHING;
