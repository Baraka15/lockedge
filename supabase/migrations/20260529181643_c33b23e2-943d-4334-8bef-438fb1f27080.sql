
CREATE TABLE public.master_fixtures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sport TEXT NOT NULL,
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  event_date TIMESTAMPTZ NOT NULL,
  external_ids JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(sport, home_team, away_team, event_date)
);
GRANT SELECT ON public.master_fixtures TO authenticated;
GRANT ALL ON public.master_fixtures TO service_role;
ALTER TABLE public.master_fixtures ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read fixtures" ON public.master_fixtures
  FOR SELECT TO authenticated USING (true);

CREATE TABLE public.arbs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_name TEXT NOT NULL,
  market_type TEXT NOT NULL,
  outcomes JSONB NOT NULL,
  total_arb_percent NUMERIC(6,3) NOT NULL,
  required_total_stake NUMERIC(10,2) NOT NULL,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '10 seconds'),
  is_acknowledged BOOLEAN NOT NULL DEFAULT false,
  dedup_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(dedup_key)
);
CREATE INDEX idx_arbs_unexpired ON public.arbs (expires_at) WHERE is_acknowledged = false;
CREATE INDEX idx_arbs_detected_at ON public.arbs (detected_at DESC);
GRANT SELECT, UPDATE ON public.arbs TO authenticated;
GRANT ALL ON public.arbs TO service_role;
ALTER TABLE public.arbs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read arbs" ON public.arbs
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated ack arbs" ON public.arbs
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
ALTER PUBLICATION supabase_realtime ADD TABLE public.arbs;
ALTER TABLE public.arbs REPLICA IDENTITY FULL;

CREATE TABLE public.bookmaker_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bookmaker TEXT NOT NULL,
  label TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.bookmaker_accounts TO authenticated;
GRANT ALL ON public.bookmaker_accounts TO service_role;
ALTER TABLE public.bookmaker_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read bookmakers" ON public.bookmaker_accounts
  FOR SELECT TO authenticated USING (true);

CREATE TABLE public.engine_runs (
  id BIGSERIAL PRIMARY KEY,
  ran_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  arbs_detected INT NOT NULL DEFAULT 0,
  duration_ms INT NOT NULL DEFAULT 0,
  providers TEXT[] NOT NULL DEFAULT '{}'::text[],
  error TEXT
);
CREATE INDEX idx_engine_runs_ran_at ON public.engine_runs (ran_at DESC);
GRANT SELECT ON public.engine_runs TO authenticated;
GRANT ALL ON public.engine_runs TO service_role;
ALTER TABLE public.engine_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read runs" ON public.engine_runs
  FOR SELECT TO authenticated USING (true);
