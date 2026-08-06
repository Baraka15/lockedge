ALTER TABLE public.settlements
  ADD COLUMN IF NOT EXISTS theoretical_profit numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS theoretical_stake numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS theoretical_edge_pct numeric NOT NULL DEFAULT 0;

ALTER TABLE public.arbs
  ADD COLUMN IF NOT EXISTS tier text NOT NULL DEFAULT 'sure',
  ADD COLUMN IF NOT EXISTS book_margin_pct numeric NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS arbs_tier_idx ON public.arbs (tier);
CREATE INDEX IF NOT EXISTS settlements_settled_at_idx ON public.settlements (settled_at DESC);

UPDATE public.settlements s
SET theoretical_stake = a.required_total_stake,
    theoretical_edge_pct = GREATEST(0, 100 - a.total_arb_percent),
    theoretical_profit = CASE
      WHEN a.total_arb_percent > 0 AND a.total_arb_percent < 100
      THEN (a.required_total_stake / a.total_arb_percent) * 100 - a.required_total_stake
      ELSE 0 END
FROM public.arbs a
WHERE s.arb_id = a.id AND s.theoretical_stake = 0;