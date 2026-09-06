# SureBet Scanner

Build a complete, production‑grade web application for real‑time sports arbitrage (sure bets) detection. This is a mission‑critical high‑frequency system that must identify mathematically risk‑free betting opportunities across multiple bookmakers before they vanish (typically in seconds). The user will manually place bets based on live alerts – no automatic bet execution is required for this version, but the architecture must support adding it later.

─────────────────────────────────────────────────────────
TECH STACK (do not deviate)
─────────────────────────────────────────────────────────
- Frontend & Backend: TanStack Start (React, TypeScript, Vite, file‑based routing, server functions)
- Database & Real‑time: Supabase (PostgreSQL, auth, real‑time subscriptions)
- Styling: Tailwind CSS v4 + Radix UI primitives
- State Management: TanStack Query
- Validation: Zod + react‑hook‑form
- Event handling on server: Node.js EventEmitter (no external message queue)
- Fuzzy matching: fuse.js
- HTTP client: native fetch (no axios)

─────────────────────────────────────────────────────────
PROJECT STRUCTURE (must follow this layout exactly)
─────────────────────────────────────────────────────────
/
├── .env.example
├── schema.sql (all DB migrations)
├── app.config.ts (server entry, engine startup)
├── src/
│   ├── routes/
│   │   ├── index.tsx (public landing)
│   │   ├── login.tsx
│   │   ├── signup.tsx
│   │   ├── _protected/
│   │   │   └── dashboard.tsx
│   │   └── api/
│   │       ├── engine-status.ts
│   │       └── stats.ts
│   ├── lib/
│   │   ├── supabase-client.ts (browser client)
│   │   ├── supabase-admin.ts (server client with service_role)
│   │   ├── engine.ts (main arb engine lifecycle)
│   │   ├── odds/
│   │   │   ├── types.ts
│   │   │   ├── providers/
│   │   │   │   ├── mock-provider.ts
│   │   │   │   └── theoddsapi-provider.ts
│   │   │   ├── normalizer.ts
│   │   │   └── matcher.ts
│   │   └── arb/
│   │       ├── detector.ts
│   │       └── calculator.ts
│   ├── hooks/
│   │   └── useLiveArbs.ts
│   └── components/
│       └── ArbCard.tsx
└── tailwind.config.ts

─────────────────────────────────────────────────────────
1. ENVIRONMENT VARIABLES (.env.example)
─────────────────────────────────────────────────────────
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
THEODDSAPI_KEY=
TOTAL_INVESTMENT=100
HEARTBEAT_TIMEOUT_MS=1500
ARB_EXPIRY_SECONDS=10
POLL_INTERVAL_MS=2000

─────────────────────────────────────────────────────────
2. DATABASE SCHEMA (schema.sql)
─────────────────────────────────────────────────────────
-- Normalized events table (populated automatically)
CREATE TABLE public.master_fixtures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sport TEXT NOT NULL,
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  event_date TIMESTAMPTZ NOT NULL,
  external_ids JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(sport, home_team, away_team, event_date)
);

-- Live arbitrage opportunities
CREATE TABLE public.arbs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_name TEXT NOT NULL,
  market_type TEXT NOT NULL,
  outcomes JSONB NOT NULL,
  total_arb_percent NUMERIC(5,2) NOT NULL,
  required_total_stake NUMERIC(10,2) NOT NULL,
  detected_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ DEFAULT (now() + interval '10 seconds'),
  is_acknowledged BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_arbs_unexpired ON arbs (expires_at) WHERE is_acknowledged = false;

-- For future multi‑account management
CREATE TABLE public.bookmaker_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bookmaker TEXT NOT NULL,
  label TEXT,
  is_active BOOLEAN DEFAULT true
);

-- Enable real‑time for arbs table (required for Supabase subscriptions)
ALTER PUBLICATION supabase_realtime ADD TABLE arbs;

-- RLS: only authenticated users can read arbs
ALTER TABLE arbs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read arbs"
  ON arbs FOR SELECT
  USING (auth.role() = 'authenticated');

─────────────────────────────────────────────────────────
3. ODDS TYPES (src/lib/odds/types.ts)
─────────────────────────────────────────────────────────
export interface RawOdds {
  provider: string;
  eventId: string;
  sport: string;
  homeTeam: string;
  awayTeam: string;
  eventDate: string; // ISO 8601
  marketType: 'h2h' | 'spreads' | 'totals';
  outcomes: { name: string; price: number }[];
  fetchedAt: number; // Date.now()
}

export interface NormalizedOdds {
  eventKey: string; // sport|homeTeam|awayTeam|date
  bookmaker: string;
  marketType: string;
  outcomes: { name: string; price: number }[];
  fetchedAt: number;
}

export interface ArbOpportunity {
  id: string;
  eventName: string;
  marketType: string;
  outcomes: {
    name: string;
    odds: number;
    bookmaker: string;
    stake: number;
  }[];
  totalArbPercent: number;
  requiredTotalStake: number;
  detectedAt: string;
  expiresAt: string;
  isAcknowledged: boolean;
}

─────────────────────────────────────────────────────────
4. PROVIDERS
─────────────────────────────────────────────────────────

4a. mock-provider.ts
- Exports startMockProvider(emitter: EventEmitter): void
- Every POLL_INTERVAL_MS emits 'odds' events with realistic fake data for 3–5 events across soccer, basketball, tennis.
- Some events deliberately have arb opportunities (sum of 1/odds < 1).
- Validates each payload with a Zod schema before emitting.

4b. theoddsapi-provider.ts
- Exports startTheOddsApiProvider(emitter: EventEmitter): void
- Polls https://api.the-odds-api.com/v4/sports/{sport}/odds/ for soccer_epl, basketball_nba
- Uses THEODDSAPI_KEY env variable; skips if not set.
- Applies HEARTBEAT_TIMEOUT_MS: if a fetch takes longer, the result is discarded.
- Validates each response with Zod.
- Logs remaining API quota from response headers.

─────────────────────────────────────────────────────────
5. NORMALIZER (src/lib/odds/normalizer.ts)
─────────────────────────────────────────────────────────
- Exports normalizeOdds(raw: RawOdds): NormalizedOdds
- Lowercases and trims team names.
- Constructs eventKey as `${sport}|${homeTeam}|${awayTeam}|${dateStr}` where dateStr is YYYY-MM-DD.
- Removes duplicate outcome names within the same event/bookmaker.

─────────────────────────────────────────────────────────
6. MATCHER (src/lib/odds/matcher.ts)
─────────────────────────────────────────────────────────
- Exports matchFixtures(normalized: NormalizedOdds[], fixtures: MasterFixture[]): Map<string, NormalizedOdds[]>
- Groups NormalizedOdds by eventKey using fuzzy matching (fuse.js) against master_fixtures.
- Returns Map<eventKey, NormalizedOdds[]> — each group has odds from multiple bookmakers.

─────────────────────────────────────────────────────────
7. ARB DETECTION & CALCULATION
─────────────────────────────────────────────────────────

7a. detector.ts
- Exports detectArbs(groups: Map<string, NormalizedOdds[]>): ArbOpportunity[]
- For each event group, calls calculator.calculateArb(oddsGroup).
- Filters results where totalArbPercent < 100 (genuine arb).

7b. calculator.ts
- Exports calculateArb(oddsGroup: NormalizedOdds[]): ArbOpportunity | null
- For h2h markets: picks best odds for each outcome across all bookmakers.
- Computes arb% = sum(1 / bestOdds for each outcome) * 100.
- If arb% < 100, computes optimal stake per outcome using Kelly formula: stake_i = (TOTAL_INVESTMENT / arb%) / odds_i.
- Returns null if no arb exists.

─────────────────────────────────────────────────────────
8. ENGINE & HOOKS & COMPONENTS
─────────────────────────────────────────────────────────

8a. engine.ts
- Exports startEngine(): void and stopEngine(): void.
- Creates a single Node.js EventEmitter.
- Starts mock provider always; starts TheOddsAPI provider if THEODDSAPI_KEY is set.
- Listens for 'odds' events, normalizes them, groups them by eventKey using matcher.
- Runs detector every POLL_INTERVAL_MS and persists new arbs to Supabase via service_role client.
- Uses upsert with conflict on (event_name, market_type, detected_at::date) to prevent duplicates.
- Exports engineStatus: { running: boolean; lastPollAt: string | null; arbsDetectedTotal: number }.

8b. app.config.ts
- TanStack Start config that also calls startEngine() on server startup.

8c. GET /api/engine-status
- Returns engineStatus JSON.

─────────────────────────────────────────────────────────
8.3 useLiveArbs hook (src/hooks/useLiveArbs.ts)
─────────────────────────────────────────────────────────
- Uses supabase.realtime.channel to subscribe to INSERT on arbs where expires_at > now() and is_acknowledged = false.
- Also listens for UPDATE to is_acknowledged to remove cards.
- Maintains a local list of active arbs with a countdown timer.
- Each arb card auto‑removes after expiry (client‑side timer).
- Returns { arbs: ArbOpportunity[], acknowledgeArb(id) }.

─────────────────────────────────────────────────────────
8.4 ArbCard component (src/components/ArbCard.tsx)
─────────────────────────────────────────────────────────
- Displays:
  - Event name, market type, arb % (e.g., 3.45%)
  - Countdown timer (10 → 0)
  - Table of outcomes: outcome, odds (green highlight), bookmaker logo/name, exact stake
  - Copy stake button for each outcome.
  - "I've Placed These Bets" button that calls acknowledgeArb(id), which sets is_acknowledged = true in Supabase.
- Styling: Tailwind card, dark mode compatible, subtle animations.
- Empty state: "Scanning for sure bets..." with a pulsing indicator.

─────────────────────────────────────────────────────────
9. CLEANUP & MONITORING
─────────────────────────────────────────────────────────
- GET /api/stats returns number of arbs detected in the last hour and total potential profit if all were placed (simulated).
- All server errors are logged with console.error and a timestamp; critical failures should be caught to prevent engine crash.

─────────────────────────────────────────────────────────
10. SECRET SAUCE – WHY THIS WORKS
─────────────────────────────────────────────────────────
- Heartbeat validation ensures you don't act on stale odds.
- Master fixture matching prevents mixing different events.
- In‑memory normalization + EventEmitter gives sub‑second arb detection.
- Automatic expiry and deduplication keep the dashboard clean.
- Manual execution avoids immediate bookmaker bans while giving you real, actionable sure bets.

─────────────────────────────────────────────────────────
DELIVERABLE
─────────────────────────────────────────────────────────
Generate the entire application with all files fully implemented. No placeholders, no TODOs. The code must be TypeScript strict, production‑ready, and ready to run after setting .env variables. The system must start scanning automatically on npm run dev and display live arbs on the dashboard.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://lockedge.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/36be7395-8906-4e7c-a5c8-d2a4f10f0498).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
