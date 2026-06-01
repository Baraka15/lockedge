ALTER TABLE public.master_fixtures ADD COLUMN IF NOT EXISTS is_completed BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.master_fixtures ADD COLUMN IF NOT EXISTS commenced_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_fixtures_active ON public.master_fixtures (event_date) WHERE is_completed = false;

-- Allow service_role to delete from arbs (used by cron cleanup)
DO $$ BEGIN
  CREATE POLICY "service_role manages arbs" ON public.arbs FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Cron job for cleanup
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$ BEGIN
  PERFORM cron.unschedule('arbs-cleanup-stale');
EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule(
  'arbs-cleanup-stale',
  '* * * * *',
  $$ DELETE FROM public.arbs WHERE expires_at < now() OR detected_at < now() - interval '30 minutes'; $$
);

DO $$ BEGIN
  PERFORM cron.unschedule('fixtures-mark-completed');
EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule(
  'fixtures-mark-completed',
  '*/5 * * * *',
  $$ UPDATE public.master_fixtures SET is_completed = true WHERE is_completed = false AND event_date < now() - interval '3 hours'; $$
);