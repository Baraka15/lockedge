# Architecture rules

- Live opportunities use authenticated browser reads with Realtime invalidation and polling fallback; this recovers missed events and refreshed expired rows without weakening RLS.
- Hourly metrics derive from deduplicated latest arb snapshots and role-authorized settlements; potential quotes are never presented as confirmed earnings or historical scan totals.
- Countdown rendering uses one shared wall clock; expiry remains an estimate of quote freshness, not a promise that odds remain available.