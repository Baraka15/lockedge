import { canonKey, fetchJson, type ScrapedOdds } from "./base";

/**
 * BetPawa scraper.
 *
 * Their public REST API is reachable without auth, but the endpoint shape is
 * non-obvious: the events list lives at
 *   GET /api/sportsbook/v4/events/lists/by-queries?q=<urlencoded JSON>
 * and prices are ONLY returned when `view.marketTypes` contains the numeric
 * market-type id (3743 = "1X2 - FT"). Passing "1X2" or "_1X2" silently returns
 * events with no markets, which is why earlier revisions saw zero rows.
 *
 * Required headers: x-pawa-brand (per country), x-pawa-language, devicetype.
 */

const MARKET_1X2_FT = "3743";
const CATEGORY_FOOTBALL = "2";
const PAGE_SIZE = 100;
const MAX_PAGES = 4;

const REGIONS: Array<{ domain: string; brand: string; code: string }> = [
  { domain: "betpawa.ug", brand: "betpawa-uganda", code: "UG" },
  { domain: "betpawa.co.ke", brand: "betpawa-kenya", code: "KE" },
];

interface BpPrice { name?: string; odds?: number | string }
interface BpMarket {
  marketType?: { id?: string; name?: string };
  row?: Array<{ prices?: BpPrice[] }>;
}
interface BpEvent {
  id?: string;
  name?: string;
  startTime?: string;
  participants?: Array<{ name?: string; position?: number }>;
  markets?: BpMarket[];
  competition?: { name?: string };
}

function buildQuery(skip: number): string {
  return JSON.stringify({
    queries: [
      {
        query: {
          eventType: "UPCOMING",
          categories: [CATEGORY_FOOTBALL],
          zones: {},
          hasOdds: true,
        },
        view: { marketTypes: [MARKET_1X2_FT] },
        skip,
        take: PAGE_SIZE,
        sort: { startTime: "ASC" },
      },
    ],
  });
}

function readEvents(json: unknown): BpEvent[] {
  const outer = (json as { responses?: Array<{ responses?: BpEvent[] }> })?.responses ?? [];
  return outer.flatMap((r) => r?.responses ?? []);
}

function extractBp(ev: BpEvent, regionCode: string): ScrapedOdds | null {
  const parts = [...(ev.participants ?? [])].sort(
    (a, b) => (a.position ?? 99) - (b.position ?? 99),
  );
  let home = parts[0]?.name ?? "";
  let away = parts[1]?.name ?? "";
  if ((!home || !away) && ev.name?.includes(" - ")) {
    const [h, a] = ev.name.split(" - ", 2);
    home = home || (h ?? "");
    away = away || (a ?? "");
  }
  if (!home || !away) return null;

  const start = ev.startTime ? new Date(ev.startTime) : null;
  if (!start || isNaN(start.getTime()) || start.getTime() <= Date.now()) return null;

  const market = (ev.markets ?? []).find(
    (m) => m.marketType?.id === MARKET_1X2_FT || /1x2/i.test(m.marketType?.name ?? ""),
  );
  const prices = market?.row?.[0]?.prices ?? [];
  let h = 0;
  let d = 0;
  let a = 0;
  for (const p of prices) {
    const odds = Number(p.odds ?? 0);
    if (!(odds > 1)) continue;
    const n = (p.name ?? "").trim().toUpperCase();
    if (n === "1") h = odds;
    else if (n === "X") d = odds;
    else if (n === "2") a = odds;
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
    league: ev.competition?.name,
    region: regionCode,
  };
}

async function scrapeRegion(region: (typeof REGIONS)[number]): Promise<ScrapedOdds[]> {
  const out: ScrapedOdds[] = [];
  const seen = new Set<string>();
  for (let page = 0; page < MAX_PAGES; page++) {
    const url =
      `https://www.${region.domain}/api/sportsbook/v4/events/lists/by-queries` +
      `?q=${encodeURIComponent(buildQuery(page * PAGE_SIZE))}`;
    const json = await fetchJson(url, {
      referer: `https://www.${region.domain}/`,
      timeoutMs: 9000,
      headers: {
        "x-pawa-brand": region.brand,
        "x-pawa-language": "en",
        devicetype: "web",
        Accept: "application/json",
      },
    });
    const events = readEvents(json);
    if (!events.length) break;
    for (const ev of events) {
      const s = extractBp(ev, region.code);
      if (!s) continue;
      const key = `${s.homeTeam.toLowerCase()}|${s.awayTeam.toLowerCase()}|${s.commenceTime
        .toISOString()
        .slice(0, 10)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(s);
    }
    if (events.length < PAGE_SIZE) break;
  }
  return out;
}

export async function scrapeBetPawa(): Promise<ScrapedOdds[]> {
  const errors: string[] = [];
  const out: ScrapedOdds[] = [];
  const seen = new Set<string>();
  for (const region of REGIONS) {
    try {
      const rows = await scrapeRegion(region);
      for (const r of rows) {
        const key = `${r.homeTeam.toLowerCase()}|${r.awayTeam.toLowerCase()}|${r.commenceTime
          .toISOString()
          .slice(0, 10)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(r);
      }
      // One healthy region is enough volume; stop to keep the poll cycle fast.
      if (out.length >= 60) break;
    } catch (e) {
      errors.push(`${region.code}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (!out.length) throw new Error(`betpawa: no rows (${errors.join("; ") || "empty response"})`);
  return out;
}
