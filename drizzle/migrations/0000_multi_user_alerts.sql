CREATE TABLE IF NOT EXISTS public.user_alert_settings (
  user_id uuid PRIMARY KEY,
  telegram_bot_token text,
  telegram_chat_id text,
  min_edge_pct numeric NOT NULL DEFAULT 1,
  enabled boolean NOT NULL DEFAULT true,
  setup_completed_at timestamptz,
  last_sent_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_alert_settings TO authenticated;
GRANT ALL ON public.user_alert_settings TO service_role;
ALTER TABLE public.user_alert_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own alert settings select" ON public.user_alert_settings FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Own alert settings insert" ON public.user_alert_settings FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own alert settings update" ON public.user_alert_settings FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own alert settings delete" ON public.user_alert_settings FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER trg_user_alert_settings_updated BEFORE UPDATE ON public.user_alert_settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX IF NOT EXISTS idx_user_alert_settings_enabled ON public.user_alert_settings (enabled) WHERE enabled;

GRANT SELECT ON public.arbs, public.live_events, public.engine_runs TO authenticated;
CREATE POLICY "Members read arbs" ON public.arbs FOR SELECT TO authenticated USING (true);
CREATE POLICY "Members read live events" ON public.live_events FOR SELECT TO authenticated USING (true);
CREATE POLICY "Members read engine runs" ON public.engine_runs FOR SELECT TO authenticated USING (true);

CREATE POLICY "Members read own executions" ON public.executions FOR SELECT TO authenticated USING (created_by = auth.uid());
CREATE POLICY "Members insert own executions" ON public.executions FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid());
CREATE POLICY "Members update own executions" ON public.executions FOR UPDATE TO authenticated USING (created_by = auth.uid()) WITH CHECK (created_by = auth.uid());

CREATE INDEX IF NOT EXISTS idx_arbs_expires_at ON public.arbs (expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_arbs_detected_at ON public.arbs (detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_live_events_updated_at ON public.live_events (updated_at);
CREATE INDEX IF NOT EXISTS idx_engine_runs_ran_at ON public.engine_runs (ran_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON public.notifications (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_master_fixtures_open ON public.master_fixtures (event_date) WHERE is_completed = false;