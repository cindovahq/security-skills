-- Scheduled jobs

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- Nightly digest email, sent by the send-digest Edge Function
select cron.schedule(
  'nightly-digest',
  '0 3 * * *',
  $$
  select net.http_post(
    url := 'https://example-project-ref.supabase.co/functions/v1/send-digest',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer example-service-role-key'
    ),
    body := jsonb_build_object('run_at', now())
  );
  $$
);

-- Refresh billing usage snapshot
select cron.schedule('refresh-org-usage', '15 3 * * *', $$ refresh materialized view public.org_usage; $$);
