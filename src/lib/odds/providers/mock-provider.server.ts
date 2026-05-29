import { z } from "zod";
import type { RawOdds } from "../types";

const rawSchema = z.object({
  provider: z.string(),
  eventId: z.string(),
  sport: z.string(),
  homeTeam: z.string(),
  awayTeam: z.string(),
  eventDate: z.string(),
  marketType: z.enum(["h2h", "spreads", "totals"]),
  outcomes: z
    .array(z.object({ name: z.string(), price: z.number().positive() }))
    .min(2),
  fetchedAt: z.number(),
});

interface Fixture {
  sport: string;
  homeTeam: string;
  awayTeam: string;
  daysAhead: number;
  /** When true, the mock will deliberately emit prices that form an arb. */
  forceArb?: boolean;
}

const FIXTURES: Fixture[] = [
  { sport: "soccer", homeTeam: "Arsenal", awayTeam: "Chelsea", daysAhead: 1, forceArb: true },
  { sport: "soccer", homeTeam: "Man City", awayTeam: "Liverpool", daysAhead: 2 },
  { sport: "basketball", homeTeam: "Lakers", awayTeam: "Celtics", daysAhead: 1, forceArb: true },
  { sport: "basketball", homeTeam: "Warriors", awayTeam: "Heat", daysAhead: 3 },
  { sport: "tennis", homeTeam: "Alcaraz", awayTeam: "Sinner", daysAhead: 1 },
];

const BOOKMAKERS = ["bet365", "pinnacle", "betfair", "williamhill"];

function jitter(base: number, pct: number): number {
  const delta = base * pct * (Math.random() * 2 - 1);
  return Math.round((base + delta) * 100) / 100;
}

function arbPair(): [number, number] {
  // Two prices whose inverses sum to <1, e.g. 2.10 / 2.10
  const a = 2.05 + Math.random() * 0.2;
  const b = 2.05 + Math.random() * 0.2;
  return [Math.round(a * 100) / 100, Math.round(b * 100) / 100];
}

/**
 * Synthesizes raw odds for the configured fixtures. Each bookmaker gets a
 * slightly different price for the same outcome; some fixtures intentionally
 * produce an arbitrage so the engine has work to do without a live API key.
 */
export function generateMockOdds(): RawOdds[] {
  const now = Date.now();
  const out: RawOdds[] = [];

  for (const fx of FIXTURES) {
    const eventDate = new Date(now + fx.daysAhead * 86_400_000).toISOString();

    // Base prices for h2h (home/away). Tennis & basketball: 2-way, soccer: 3-way.
    const has3Way = fx.sport === "soccer";
    const baseHome = 1.9 + Math.random() * 0.6;
    const baseAway = 1.9 + Math.random() * 0.6;
    const baseDraw = 3.0 + Math.random() * 0.5;

    for (const bm of BOOKMAKERS) {
      // Deliberately spike one bookmaker's price for forceArb fixtures
      const spike = fx.forceArb && bm === "pinnacle";
      const [arbHome, arbAway] = spike ? arbPair() : [0, 0];

      const outcomes = has3Way
        ? [
            { name: fx.homeTeam, price: spike ? arbHome : jitter(baseHome, 0.04) },
            { name: "Draw", price: jitter(baseDraw, 0.04) },
            { name: fx.awayTeam, price: spike ? arbAway : jitter(baseAway, 0.04) },
          ]
        : [
            { name: fx.homeTeam, price: spike ? arbHome : jitter(baseHome, 0.04) },
            { name: fx.awayTeam, price: spike ? arbAway : jitter(baseAway, 0.04) },
          ];

      const candidate: RawOdds = {
        provider: bm,
        eventId: `${bm}-${fx.homeTeam}-${fx.awayTeam}`.replace(/\s+/g, "_"),
        sport: fx.sport,
        homeTeam: fx.homeTeam,
        awayTeam: fx.awayTeam,
        eventDate,
        marketType: "h2h",
        outcomes,
        fetchedAt: now,
      };
      const parsed = rawSchema.safeParse(candidate);
      if (parsed.success) out.push(parsed.data);
      else console.error("[mock] invalid payload", parsed.error.flatten());
    }
  }
  return out;
}