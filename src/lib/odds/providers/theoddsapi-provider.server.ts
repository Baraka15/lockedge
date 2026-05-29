import { z } from "zod";
import type { RawOdds } from "../types";

const SPORTS = ["soccer_epl", "basketball_nba"] as const;

const apiSchema = z.array(
  z.object({
    id: z.string(),
    sport_key: z.string(),
    home_team: z.string(),
    away_team: z.string(),
    commence_time: z.string(),
    bookmakers: z.array(
      z.object({
        key: z.string(),
        markets: z.array(
          z.object({
            key: z.string(),
            outcomes: z.array(
              z.object({ name: z.string(), price: z.number().positive() }),
            ),
          }),
        ),
      }),
    ),
  }),
);

async function fetchSport(
  sport: string,
  apiKey: string,
  timeoutMs: number,
): Promise<RawOdds[]> {
  const url = `https://api.the-odds-api.com/v4/sports/${sport}/odds/?regions=eu,uk&markets=h2h&oddsFormat=decimal&apiKey=${apiKey}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const started = Date.now();
    const res = await fetch(url, { signal: ctrl.signal });
    const took = Date.now() - started;
    if (took > timeoutMs) {
      console.error(`[theoddsapi] discarding stale fetch for ${sport} (${took}ms)`);
      return [];
    }
    const remaining = res.headers.get("x-requests-remaining");
    if (remaining) console.log(`[theoddsapi] quota remaining: ${remaining}`);
    if (!res.ok) {
      console.error(`[theoddsapi] ${sport} -> ${res.status}`);
      return [];
    }
    const json = await res.json();
    const parsed = apiSchema.safeParse(json);
    if (!parsed.success) {
      console.error("[theoddsapi] schema mismatch", parsed.error.flatten());
      return [];
    }
    const out: RawOdds[] = [];
    const fetchedAt = Date.now();
    for (const event of parsed.data) {
      for (const bm of event.bookmakers) {
        for (const market of bm.markets) {
          if (market.key !== "h2h") continue;
          out.push({
            provider: bm.key,
            eventId: event.id,
            sport: event.sport_key,
            homeTeam: event.home_team,
            awayTeam: event.away_team,
            eventDate: event.commence_time,
            marketType: "h2h",
            outcomes: market.outcomes.map((o) => ({ name: o.name, price: o.price })),
            fetchedAt,
          });
        }
      }
    }
    return out;
  } catch (err) {
    console.error(`[theoddsapi] ${sport} failed`, err);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchTheOddsApi(): Promise<RawOdds[]> {
  const apiKey = process.env.THEODDSAPI_KEY;
  if (!apiKey) return [];
  const timeoutMs = Number(process.env.HEARTBEAT_TIMEOUT_MS ?? 1500);
  const results = await Promise.all(SPORTS.map((s) => fetchSport(s, apiKey, timeoutMs)));
  return results.flat();
}