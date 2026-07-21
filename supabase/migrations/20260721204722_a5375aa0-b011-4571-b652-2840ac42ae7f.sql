
CREATE TABLE public.campaign_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  filename text NOT NULL,
  mime_type text NOT NULL DEFAULT 'application/octet-stream',
  size_bytes integer NOT NULL,
  content_base64 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX campaign_attachments_campaign_id_idx ON public.campaign_attachments(campaign_id);

GRANT SELECT, INSERT, DELETE ON public.campaign_attachments TO authenticated;
GRANT ALL ON public.campaign_attachments TO service_role;

ALTER TABLE public.campaign_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own attachments" ON public.campaign_attachments
FOR SELECT USING (EXISTS (SELECT 1 FROM public.campaigns c WHERE c.id = campaign_id AND c.user_id = auth.uid()));

CREATE POLICY "Users insert own attachments" ON public.campaign_attachments
FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM public.campaigns c WHERE c.id = campaign_id AND c.user_id = auth.uid()));

CREATE POLICY "Users delete own attachments" ON public.campaign_attachments
FOR DELETE USING (EXISTS (SELECT 1 FROM public.campaigns c WHERE c.id = campaign_id AND c.user_id = auth.uid()));

-- Prevent more than 2 attachments per campaign
CREATE OR REPLACE FUNCTION public.enforce_attachment_limit()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF (SELECT count(*) FROM public.campaign_attachments WHERE campaign_id = NEW.campaign_id) >= 2 THEN
    RAISE EXCEPTION 'Máximo de 2 anexos por campanha';
  END IF;
  IF NEW.size_bytes > 5242880 THEN
    RAISE EXCEPTION 'Anexo maior que 5MB';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enforce_attachment_limit
BEFORE INSERT ON public.campaign_attachments
FOR EACH ROW EXECUTE FUNCTION public.enforce_attachment_limit();
