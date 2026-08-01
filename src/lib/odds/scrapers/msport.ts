import { canonKey, fetchJson, type ScrapedOdds } from "./base";

/**
 * Msport scraper.
 *
 * sports.msport.com no longer resolves; the live gateway is
 * www.msport.com/api/<region>/facts-center/query/frontend/*, and every request
 * needs an `operId` header (2 is the web operator) or the API answers
 * bizCode 19000. 1X2 odds come back as markets[] with id === 1 and outcome
 * descriptions Home/Draw/Away.
 */

const REGIONS = ["ng", "gh", "ke", "tz"];
const PAGES = [1, 2, 3];

interface MsOutcome { id?: string; description?: string; odds?: string | number; isActive?: number }
interface MsMarket { id?: number | string; name?: string; outcomes?: MsOutcome[] }
interface MsEvent {
  eventId?: string;
  homeTeam?: string;
  awayTeam?: string;
  startTime?: number;
  tournament?: string;
  markets?: MsMarket[];
}

function extractMs(ev: MsEvent, region: string): ScrapedOdds | null {
  const home = ev.homeTeam ?? "";
  const away = ev.awayTeam ?? "";
  if (!home || !away) return null;
  const ts = Number(ev.startTime ?? 0);
  if (!ts) return null;
  const start = new Date(ts < 1e12 ? ts * 1000 : ts);
  if (isNaN(start.getTime()) || start.getTime() <= Date.now()) return null;

  const market = (ev.markets ?? []).find(
    (m) => String(m.id) === "1" || /^1x2$/i.test(m.name ?? ""),
  );
  let h = 0;
  let d = 0;
  let a = 0;
  for (const o of market?.outcomes ?? []) {
    const odds = Number(o.odds ?? 0);
    if (!(odds > 1)) continue;
    const desc = (o.description ?? "").toLowerCase();
    if (desc === "home" || o.id === "1") h = odds;
    else if (desc === "draw" || o.id === "2") d = odds;
    else if (desc === "away" || o.id === "3") a = odds;
  }
  if (!(h > 1) || !(a > 1)) return null;

  return {
    bookmaker: "msport",
    fixtureKey: canonKey(home, away),
    homeTeam: home,
    awayTeam: away,
    commenceTime: start,
    markets: { home: h, away: a, ...(d > 1 ? { draw: d } : {}) },
    sport: "soccer",
    league: ev.tournament,
    region: region.toUpperCase(),
  };
}

export async function scrapeMsport(): Promise<ScrapedOdds[]> {
  const out: ScrapedOdds[] = [];
  const seen = new Set<string>();
  const errors: string[] = [];

  for (const region of REGIONS) {
    let regionRows = 0;
    for (const page of PAGES) {
      const url =
        `https://www.msport.com/api/${region}/facts-center/query/frontend/all-matches/next-7-days` +
        `?sportId=sr%3Asport%3A1&pageNum=${page}&pageSize=50`;
      try {
        const json = await fetchJson(url, {
          referer: `https://www.msport.com/${region}/web`,
          timeoutMs: 9000,
          headers: { operId: "2", Accept: "application/json" },
        });
        const events = ((json as { data?: { events?: MsEvent[] } })?.data?.events ?? []);
        if (!events.length) break;
        for (const ev of events) {
          const s = extractMs(ev, region);
          if (!s) continue;
          const key = `${s.homeTeam.toLowerCase()}|${s.awayTeam.toLowerCase()}|${s.commenceTime
            .toISOString()
            .slice(0, 10)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push(s);
          regionRows++;
        }
        if (events.length < 50) break;
      } catch (e) {
        errors.push(`${region}/p${page}: ${e instanceof Error ? e.message : String(e)}`);
        break;
      }
    }
    if (regionRows > 40) break;
  }

  if (!out.length) throw new Error(`msport: no rows (${errors.join("; ") || "empty response"})`);
  return out;
}
