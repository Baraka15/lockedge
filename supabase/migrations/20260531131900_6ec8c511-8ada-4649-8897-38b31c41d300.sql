CREATE TABLE public.live_events (
  event_key TEXT PRIMARY KEY,
  sport TEXT NOT NULL,
  event_name TEXT NOT NULL,
  event_date TIMESTAMP WITH TIME ZONE NOT NULL,
  market_type TEXT NOT NULL,
  bookmaker_count INTEGER NOT NULL DEFAULT 0,
  outcomes JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT ON public.live_events TO authenticated;
GRANT ALL ON public.live_events TO service_role;

ALTER TABLE public.live_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read live events"
ON public.live_events
FOR SELECT
TO authenticated
USING (true);

CREATE INDEX idx_live_events_updated_at ON public.live_events (updated_at DESC);
CREATE INDEX idx_live_events_event_date ON public.live_events (event_date);
