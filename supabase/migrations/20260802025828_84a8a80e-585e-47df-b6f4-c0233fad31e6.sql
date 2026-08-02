-- Resilient 24/7 scan trigger: hit BOTH the preview and production endpoints so
-- the engine keeps running whether or not the app is currently published, and
-- allow up to 55s per request (the scan loop runs ~50s).
SELECT cron.unschedule('arb-engine-poll');

SELECT cron.schedule(
  'arb-engine-poll',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := u,
    headers := '{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRzeWNxenVlenhydWZ5eXhobWltIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAwNjY1MTgsImV4cCI6MjA5NTY0MjUxOH0.Nona6KB8Wl8JssTNoABzP_PdCoYSp_GVGebkoI45ZYs"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  )
  FROM unnest(ARRAY[
    'https://project--36be7395-8906-4e7c-a5c8-d2a4f10f0498-dev.lovable.app/api/public/poll',
    'https://project--36be7395-8906-4e7c-a5c8-d2a4f10f0498.lovable.app/api/public/poll'
  ]) AS u;
  $$
);

-- Keep the pg_net response log from growing unbounded (it stores every reply body).
SELECT cron.schedule(
  'net-response-cleanup',
  '*/15 * * * *',
  $$ DELETE FROM net._http_response WHERE created < now() - interval '1 hour'; $$
);