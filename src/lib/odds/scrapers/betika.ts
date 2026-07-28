import { canonKey, fetchJson, type ScrapedOdds } from "./base";

/**
 * Dedicated Betika parser. Their public API returns rows with `home_team`,
 * `away_team`, `home_odd`, `neutral_odd`, `away_odd`, `start_time`. We call
 * both the "upcoming" and "today" tabs across the main soccer sub_type_id=1
 * (1X2) market, dedupe by (home, away, day), and skip Simulated Reality
 * League fixtures (is_srl / provider "sr") — those are RNG matches, never
 * real, and cannot arb across bookmakers.
 */
interface BetikaRow {
  home_team?: string;
  away_team?: string;
  start_time?: string;
  home_odd?: string | number;
  neutral_odd?: string | number;
  away_odd?: string | number;
  is_srl?: boolean;
  provider?: string;
  sport_name?: string;
}

const TABS = ["upcoming", "today", "tomorrow"];

function parseBetikaTime(s: string): Date | null {
  // "2026-07-28 10:00:00" is treated as EAT (UTC+3) by Betika's API.
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(s);
  if (!m) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }
  // Interpret as UTC+3, convert to UTC.
  const [, Y, M, D, h, mi, se] = m;
  const utc = Date.UTC(+Y, +M - 1, +D, +h - 3, +mi, +se);
  return new Date(utc);
}

export async function scrapeBetika(): Promise<ScrapedOdds[]> {
  const out: ScrapedOdds[] = [];
  const seen = new Set<string>();
  for (const tab of TABS) {
    const url =
      `https://api.betika.com/v1/uo/matches?tab=${tab}` +
      `&sub_type_id=1&sport_id=14&limit=100&page=1`;
    let json: unknown;
    try {
      json = await fetchJson(url, {
        referer: "https://www.betika.com/",
        timeoutMs: 8000,
      });
    } catch {
      continue;
    }
    const rows = (json as { data?: BetikaRow[] })?.data ?? [];
    for (const r of rows) {
      if (!r?.home_team || !r?.away_team || !r?.start_time) continue;
      if (r.is_srl || r.provider === "sr") continue;
      const start = parseBetikaTime(r.start_time);
      if (!start || start.getTime() <= Date.now()) continue;
      const h = Number(r.home_odd);
      const d = Number(r.neutral_odd);
      const a = Number(r.away_odd);
      if (!(h > 1) || !(a > 1)) continue;
      const key = `${r.home_team.toLowerCase()}|${r.away_team.toLowerCase()}|${start
        .toISOString()
        .slice(0, 10)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        bookmaker: "betika",
        fixtureKey: canonKey(r.home_team, r.away_team),
        homeTeam: r.home_team,
        awayTeam: r.away_team,
        commenceTime: start,
        markets: { home: h, away: a, ...(d > 1 ? { draw: d } : {}) },
        sport: "soccer",
      });
    }
  }
  return out;
}