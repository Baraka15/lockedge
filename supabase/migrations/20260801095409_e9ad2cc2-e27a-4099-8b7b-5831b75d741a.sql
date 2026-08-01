select cron.unschedule('arbs-cleanup-stale');
select cron.schedule('arbs-cleanup-stale','*/5 * * * *', $$ DELETE FROM public.arbs WHERE detected_at < now() - interval '24 hours'; $$);