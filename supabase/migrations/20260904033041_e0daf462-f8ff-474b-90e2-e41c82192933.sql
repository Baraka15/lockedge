CREATE TABLE public.executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  arb_id uuid REFERENCES public.arbs(id) ON DELETE SET NULL,
  dedup_key text,
  event_name text NOT NULL,
  market_type text NOT NULL,
  detected_at timestamptz NOT NULL,
  verified_at timestamptz NOT NULL DEFAULT now(),
  original_odds jsonb NOT NULL DEFAULT '[]'::jsonb,
  current_odds jsonb NOT NULL DEFAULT '[]'::jsonb,
  calculated_stakes jsonb NOT NULL DEFAULT '[]'::jsonb,
  original_arb_percent numeric NOT NULL DEFAULT 0,
  current_arb_percent numeric NOT NULL DEFAULT 0,
  current_edge_pct numeric NOT NULL DEFAULT 0,
  min_edge_pct numeric NOT NULL DEFAULT 0,
  total_stake numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'verifying',
  user_outcome text,
  error_message text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.executions TO authenticated;
GRANT ALL ON public.executions TO service_role;

ALTER TABLE public.executions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Operators read executions" ON public.executions
  FOR SELECT TO authenticated USING (public.is_operator());
CREATE POLICY "Operators insert executions" ON public.executions
  FOR INSERT TO authenticated WITH CHECK (public.is_operator() AND created_by = auth.uid());
CREATE POLICY "Operators update own executions" ON public.executions
  FOR UPDATE TO authenticated USING (public.is_operator() AND created_by = auth.uid())
  WITH CHECK (public.is_operator() AND created_by = auth.uid());

CREATE TRIGGER trg_executions_updated BEFORE UPDATE ON public.executions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_executions_created_at ON public.executions (created_at DESC);