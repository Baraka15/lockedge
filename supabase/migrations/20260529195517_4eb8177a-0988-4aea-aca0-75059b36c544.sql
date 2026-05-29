-- Agent heartbeat & status
CREATE TABLE public.agent_status (
  agent_id TEXT PRIMARY KEY DEFAULT 'primary',
  status TEXT NOT NULL CHECK (status IN ('online','offline','paused','error')),
  last_heartbeat TIMESTAMPTZ NOT NULL DEFAULT now(),
  version TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);
GRANT SELECT ON public.agent_status TO authenticated;
GRANT ALL ON public.agent_status TO service_role;
ALTER TABLE public.agent_status ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read_agent_status" ON public.agent_status FOR SELECT TO authenticated USING (true);

-- Command queue
CREATE TABLE public.agent_commands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  command TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','executed','failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  executed_at TIMESTAMPTZ,
  created_by UUID
);
GRANT SELECT, INSERT ON public.agent_commands TO authenticated;
GRANT ALL ON public.agent_commands TO service_role;
ALTER TABLE public.agent_commands ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read_agent_commands" ON public.agent_commands FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert_agent_commands" ON public.agent_commands FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

-- Bet logs
CREATE TABLE public.bet_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  arb_id UUID REFERENCES public.arbs(id) ON DELETE SET NULL,
  account_label TEXT NOT NULL,
  bookmaker TEXT NOT NULL,
  outcome TEXT NOT NULL,
  bet_type TEXT NOT NULL CHECK (bet_type IN ('back','lay','hedge','mug')),
  odds NUMERIC(6,3),
  stake NUMERIC(10,2),
  result TEXT CHECK (result IN ('success','partial','failed','pending')),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  logged_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.bet_logs TO authenticated;
GRANT ALL ON public.bet_logs TO service_role;
ALTER TABLE public.bet_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read_bet_logs" ON public.bet_logs FOR SELECT TO authenticated USING (true);
CREATE INDEX idx_bet_logs_logged_at ON public.bet_logs (logged_at DESC);

-- Balances
CREATE TABLE public.balances (
  bookmaker TEXT NOT NULL,
  account_label TEXT NOT NULL,
  balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  pending_returns NUMERIC(12,2) NOT NULL DEFAULT 0,
  last_updated TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (bookmaker, account_label)
);
GRANT SELECT ON public.balances TO authenticated;
GRANT ALL ON public.balances TO service_role;
ALTER TABLE public.balances ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read_balances" ON public.balances FOR SELECT TO authenticated USING (true);

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_status;
ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_commands;
ALTER PUBLICATION supabase_realtime ADD TABLE public.bet_logs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.balances;

-- Seed primary agent row so UI has something to show before bot connects
INSERT INTO public.agent_status (agent_id, status, version, metadata)
VALUES ('primary', 'offline', null, '{}'::jsonb)
ON CONFLICT (agent_id) DO NOTHING;