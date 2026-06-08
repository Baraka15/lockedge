
-- 1) bet_sessions
CREATE TABLE IF NOT EXISTS public.bet_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  arb_id UUID REFERENCES public.arbs(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','complete','partial','failed','hedged')),
  total_legs INT NOT NULL DEFAULT 0,
  placed_legs INT NOT NULL DEFAULT 0,
  failed_legs INT NOT NULL DEFAULT 0,
  hedge_details JSONB DEFAULT '{}'::jsonb,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bet_sessions TO authenticated;
GRANT ALL ON public.bet_sessions TO service_role;
ALTER TABLE public.bet_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth users read bet_sessions" ON public.bet_sessions FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth users write bet_sessions" ON public.bet_sessions FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 2) settlements
CREATE TABLE IF NOT EXISTS public.settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  arb_id UUID REFERENCES public.arbs(id) ON DELETE SET NULL,
  event_name TEXT,
  match_date TIMESTAMPTZ,
  home_score INT,
  away_score INT,
  winning_outcome TEXT,
  total_staked NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_returned NUMERIC(14,2) NOT NULL DEFAULT 0,
  profit NUMERIC(14,2) NOT NULL DEFAULT 0,
  settled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.settlements TO authenticated;
GRANT ALL ON public.settlements TO service_role;
ALTER TABLE public.settlements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth users read settlements" ON public.settlements FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth users write settlements" ON public.settlements FOR ALL TO authenticated USING (true) WITH CHECK (true);
ALTER PUBLICATION supabase_realtime ADD TABLE public.settlements;

-- 3) notifications
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel TEXT NOT NULL DEFAULT 'telegram',
  kind TEXT NOT NULL,
  title TEXT,
  body TEXT,
  payload JSONB DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','skipped')),
  error TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth users read notifications" ON public.notifications FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth users write notifications" ON public.notifications FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 4) risk_settings extra fields
ALTER TABLE public.risk_settings
  ADD COLUMN IF NOT EXISTS max_odds_drift_pct NUMERIC(5,2) NOT NULL DEFAULT 0.5,
  ADD COLUMN IF NOT EXISTS notify_min_edge_pct NUMERIC(5,2) NOT NULL DEFAULT 2.0,
  ADD COLUMN IF NOT EXISTS telegram_chat_id TEXT,
  ADD COLUMN IF NOT EXISTS notify_enabled BOOLEAN NOT NULL DEFAULT true;

-- 5) updated_at triggers
CREATE OR REPLACE FUNCTION public.update_updated_at_column() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public;
DROP TRIGGER IF EXISTS trg_bet_sessions_updated ON public.bet_sessions;
CREATE TRIGGER trg_bet_sessions_updated BEFORE UPDATE ON public.bet_sessions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 6) indexes
CREATE INDEX IF NOT EXISTS idx_bet_sessions_arb ON public.bet_sessions(arb_id);
CREATE INDEX IF NOT EXISTS idx_bet_sessions_status ON public.bet_sessions(status);
CREATE INDEX IF NOT EXISTS idx_settlements_arb ON public.settlements(arb_id);
CREATE INDEX IF NOT EXISTS idx_settlements_settled_at ON public.settlements(settled_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_status ON public.notifications(status);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON public.notifications(created_at DESC);
