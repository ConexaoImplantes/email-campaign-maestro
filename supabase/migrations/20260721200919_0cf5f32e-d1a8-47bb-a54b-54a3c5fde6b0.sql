SELECT cron.unschedule('process-campaigns-tick');
SELECT cron.schedule(
  'process-campaigns-tick',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--2b318e50-5926-4f73-be95-2a8c367c935c-dev.lovable.app/api/public/hooks/process-campaigns',
    headers := '{"Content-Type":"application/json","apikey":"sb_publishable_9-MH1-9ZKqd8P6icqUrC3Q_nZPo1_YC"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);