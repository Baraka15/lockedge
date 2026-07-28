import { canonKey, fetchJson, type ScrapedOdds } from "./base";

/**
 * BetPawa's Next.js frontend calls internal endpoints that require dynamic
 * brand tokens & pass a serialized query object. Endpoint shapes change per
 * region and per release. To stay resilient, this scraper walks a list of
 * known-good historical endpoints for each region, keeps whichever returns
 * usable JSON, and parses it with a dedicated shape reader plus a permissive
 * fallback. If nothing works we surface an error so the health panel shows
 * it, but the engine keeps running on the other African books.
 */

const REGIONS: Array<{ domain: string; brand: string; ref: string }> = [
  { domain: "betpawa.ug", brand: "betpawa-uganda", ref: "https://www.betpawa.ug/" },
  { domain: "betpawa.co.ke", brand: "betpawa-kenya", ref: "https://www.betpawa.co.ke/" },
  { domain: "betpawa.co.tz", brand: "betpawa-tanzania", ref: "https://www.betpawa.co.tz/" },
  { domain: "betpawa.rw", brand: "betpawa-rwanda", ref: "https://www.betpawa.rw/" },
];

const CANDIDATE_PATHS = [
  // Legacy v1 (still live on some regions)
  "/api/v1/bookmaker/events?marketId=1X2&categoryId=2&onlyMain=true&take=40",
  // v2 shape
  "/api/sportsbook/v2/events?categoryId=2&marketId=1X2&onlyMain=true&take=40",
  // v3/v4 with query
  "/api/sportsbook/v3/events/list/by-queries?queries=upcoming&marketId=_1X2&categoryId=2&take=40",
  "/api/sportsbook/v4/events/lists/by-queries?queries=upcoming&marketId=_1X2&categoryId=2&take=40",
];

interface BpEventShape {
  id?: string | number;
  name?: string;
  startTime?: string | number;
  startsAt?: string | number;
  participants?: Array<{ name?: string; type?: string; order?: number }>;
  competitors?: Array<{ name?: string; type?: string }>;
  markets?: Array<{
    id?: string;
    marketType?: { name?: string; id?: string };
    selections?: Array<{ name?: string; price?: number | string; odds?: number | string }>;
  }>;
}

function parseBpTime(v: unknown): Date | null {
  if (v == null) return null;
  if (typeof v === "number") {
    const ms = v < 1e12 ? v * 1000 : v;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof v === "string") {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function readBpEvents(json: unknown): BpEventShape[] {
  if (!json) return [];
  const j = json as Record<string, unknown>;
  const candidates = [j.events, j.data, (j.payload as Record<string, unknown>)?.events, j];
  for (const c of candidates) {
    if (Array.isArray(c)) return c as BpEventShape[];
  }
  return [];
}

function extractBp(ev: BpEventShape): ScrapedOdds | null {
  const parts = ev.participants ?? ev.competitors ?? [];
  let home = "";
  let away = "";
  if (parts.length >= 2) {
    const h = parts.find((p) => (p.type ?? "").toLowerCase().includes("home"));
    const a = parts.find((p) => (p.type ?? "").toLowerCase().includes("away"));
    home = h?.name ?? parts[0]?.name ?? "";
    away = a?.name ?? parts[1]?.name ?? "";
  } else if (ev.name && ev.name.includes(" v ")) {
    [home, away] = ev.name.split(/\s+v\s+/, 2);
  } else if (ev.name && ev.name.includes(" - ")) {
    [home, away] = ev.name.split(/\s+-\s+/, 2);
  }
  if (!home || !away) return null;
  const start = parseBpTime(ev.startTime ?? ev.startsAt);
  if (!start || start.getTime() <= Date.now()) return null;
  const market = (ev.markets ?? []).find((m) => {
    const n = (m.marketType?.name ?? m.marketType?.id ?? "").toString().toLowerCase();
    return n.includes("1x2") || n.includes("match result") || n === "" || n.includes("winner");
  });
  if (!market?.selections?.length) return null;
  let h = 0, d = 0, a = 0;
  for (const s of market.selections) {
    const price = Number(s.price ?? s.odds ?? 0);
    if (!(price > 1)) continue;
    const n = (s.name ?? "").toString().toLowerCase();
    if (n === "1" || n === "home" || n === home.toLowerCase()) h = price;
    else if (n === "x" || n === "draw" || n === "tie") d = price;
    else if (n === "2" || n === "away" || n === away.toLowerCase()) a = price;
  }
  if (!(h > 1) || !(a > 1)) return null;
  return {
    bookmaker: "betpawa",
    fixtureKey: canonKey(home, away),
    homeTeam: home,
    awayTeam: away,
    commenceTime: start,
    markets: { home: h, away: a, ...(d > 1 ? { draw: d } : {}) },
    sport: "soccer",
  };
}

export async function scrapeBetPawa(): Promise<ScrapedOdds[]> {
  const seen = new Set<string>();
  const out: ScrapedOdds[] = [];
  let lastError: string | null = null;
  for (const region of REGIONS) {
    for (const path of CANDIDATE_PATHS) {
      const url = `https://www.${region.domain}${path}`;
      let json: unknown;
      try {
        json = await fetchJson(url, {
          referer: region.ref,
          timeoutMs: 6000,
          headers: {
            "X-Pawa-Language": "en",
            "X-Pawa-Brand": region.brand,
            devicetype: "web",
          },
        });
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
        continue;
      }
      const events = readBpEvents(json);
      if (!events.length) continue;
      let hit = 0;
      for (const ev of events) {
        const s = extractBp(ev);
        if (!s) continue;
        const key = `${s.homeTeam.toLowerCase()}|${s.awayTeam.toLowerCase()}|${s.commenceTime
          .toISOString()
          .slice(0, 10)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        s.region = region.domain.split(".").pop()?.toUpperCase();
        out.push(s);
        hit++;
      }
      // If this path worked for this region, skip the rest of the paths.
      if (hit) break;
    }
  }
  if (!out.length && lastError) {
    // Surface the error so the health panel is honest about the outage.
    throw new Error(`betpawa: no live endpoint (${lastError})`);
  }
  return out;
}