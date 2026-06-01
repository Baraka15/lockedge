import { z } from "zod";
import type { RawOdds } from "../types";

// Fallback list used only if /sports discovery fails. Covers a broad range
// so something is usually in season.
const FALLBACK_SPORTS = [
  "soccer_epl",
  "soccer_uefa_champs_league",
  "soccer_spain_la_liga",
  "soccer_germany_bundesliga",
  "soccer_italy_serie_a",
  "soccer_france_ligue_one",
  "soccer_usa_mls",
  "soccer_uefa_european_championship",
  "soccer_fifa_world_cup",
  "basketball_nba",
  "basketball_euroleague",
  "baseball_mlb",
  "icehockey_nhl",
  "americanfootball_nfl",
  "tennis_atp_french_open",
  "tennis_wta_french_open",
] as const;

const sportsListSchema = z.array(
  z.object({ key: z.string(), active: z.boolean(), has_outrights: z.boolean().optional() }),
);

async function discoverActiveSports(apiKey: string, timeoutMs: number): Promise<string[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(
      `https://api.the-odds-api.com/v4/sports/?apiKey=${apiKey}`,
      { signal: ctrl.signal },
    );
    if (!res.ok) {
      console.error(`[theoddsapi] sports discovery failed: ${res.status}`);
      return [...FALLBACK_SPORTS];
    }
    const parsed = sportsListSchema.safeParse(await res.json());
    if (!parsed.success) return [...FALLBACK_SPORTS];
    const active = parsed.data
      .filter((s) => s.active && !s.has_outrights)
      .map((s) => s.key);
    console.log(`[theoddsapi] discovered ${active.length} active sports`);
    return active.length ? active : [...FALLBACK_SPORTS];
  } catch (err) {
    console.error("[theoddsapi] sports discovery error", err);
    return [...FALLBACK_SPORTS];
  } finally {
    clearTimeout(timer);
  }
}

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
  const url = `https://api.the-odds-api.com/v4/sports/${sport}/odds/?regions=eu,uk,us,au&markets=h2h&oddsFormat=decimal&apiKey=${apiKey}`;
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
    const nowMs = Date.now();
    for (const event of parsed.data) {
      // Hard-filter past/in-play events — institutional bar.
      if (new Date(event.commence_time).getTime() <= nowMs) continue;
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
  const apiKey = process.env.THEODDSAPI_KEY ?? process.env.ODDS_API_KEY;
  if (!apiKey) return [];
  const timeoutMs = process.env.HEARTBEAT_TIMEOUT_MS
    ? Number(process.env.HEARTBEAT_TIMEOUT_MS)
    : 8000;
  const sports = await discoverActiveSports(apiKey, timeoutMs);
  // Cap concurrency at 8 to stay polite on quota
  const capped = sports.slice(0, 12);
  const results = await Promise.all(capped.map((s) => fetchSport(s, apiKey, timeoutMs)));
  const flat = results.flat();
  if (flat.length) {
    console.log(
      `[theoddsapi] fetched ${flat.length} odds rows across ${capped.length} sports`,
    );
  } else {
    console.warn("[theoddsapi] returned 0 rows (check key, quota, or sport in-season)");
  }
  return flat;
}