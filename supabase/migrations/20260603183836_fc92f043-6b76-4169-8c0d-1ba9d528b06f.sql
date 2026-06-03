CREATE TABLE IF NOT EXISTS public.risk_settings (
  account_label TEXT PRIMARY KEY,
  bankroll NUMERIC(12,2) NOT NULL DEFAULT 0,
  max_stake_pct NUMERIC(5,2) NOT NULL DEFAULT 2.0,
  max_stake_abs NUMERIC(12,2) NOT NULL DEFAULT 1000,
  min_stake_abs NUMERIC(12,2) NOT NULL DEFAULT 1,
  min_edge_pct NUMERIC(5,2) NOT NULL DEFAULT 1.0,
  kelly_fraction NUMERIC(4,3) NOT NULL DEFAULT 0.25,
  auto_stake_enabled BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.risk_settings TO authenticated;
GRANT ALL ON public.risk_settings TO service_role;
ALTER TABLE public.risk_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read risk_settings" ON public.risk_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth write risk_settings" ON public.risk_settings FOR ALL TO authenticated USING (true) WITH CHECK (true);
INSERT INTO public.risk_settings (account_label) VALUES ('primary') ON CONFLICT DO NOTHING;