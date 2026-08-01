import { canonKey, fetchJson, type ScrapedOdds } from "./base";

/**
 * SportyBet scraper.
 *
 * `factsCenter/popularSports` returns an empty payload now, and the Uganda
 * storefront is offline ("we're coming soon"), so we use the pcUpcomingEvents
 * endpoint against the regions that are actually live. Odds live in
 * markets[] where id === "1" (1X2) with outcome descriptions Home/Draw/Away.
 */

const REGIONS = ["ng", "ke", "gh", "tz", "zm"];
const TIMELINES = ["24", "48"];

interface SbOutcome { id?: string; desc?: string; odds?: string | number; isActive?: number }
interface SbMarket { id?: string; desc?: string; outcomes?: SbOutcome[] }
interface SbEvent {
  eventId?: string;
  estimateStartTime?: number;
  homeTeamName?: string;
  awayTeamName?: string;
  markets?: SbMarket[];
  sport?: { category?: { tournament?: { name?: string } } };
}

function extractSb(ev: SbEvent, region: string): ScrapedOdds | null {
  const home = ev.homeTeamName ?? "";
  const away = ev.awayTeamName ?? "";
  if (!home || !away) return null;
  const ts = Number(ev.estimateStartTime ?? 0);
  if (!ts) return null;
  const start = new Date(ts < 1e12 ? ts * 1000 : ts);
  if (isNaN(start.getTime()) || start.getTime() <= Date.now()) return null;

  const market = (ev.markets ?? []).find(
    (m) => String(m.id) === "1" || /^1x2$/i.test(m.desc ?? ""),
  );
  let h = 0;
  let d = 0;
  let a = 0;
  for (const o of market?.outcomes ?? []) {
    const odds = Number(o.odds ?? 0);
    if (!(odds > 1)) continue;
    const desc = (o.desc ?? "").toLowerCase();
    if (desc === "home" || o.id === "1") h = odds;
    else if (desc === "draw" || o.id === "2") d = odds;
    else if (desc === "away" || o.id === "3") a = odds;
  }
  if (!(h > 1) || !(a > 1)) return null;

  return {
    bookmaker: "sportybet",
    fixtureKey: canonKey(home, away),
    homeTeam: home,
    awayTeam: away,
    commenceTime: start,
    markets: { home: h, away: a, ...(d > 1 ? { draw: d } : {}) },
    sport: "soccer",
    league: ev.sport?.category?.tournament?.name,
    region: region.toUpperCase(),
  };
}

function readEvents(json: unknown): SbEvent[] {
  const data = (json as { data?: { tournaments?: Array<{ events?: SbEvent[] }> } })?.data;
  return (data?.tournaments ?? []).flatMap((t) => t?.events ?? []);
}

export async function scrapeSportyBet(): Promise<ScrapedOdds[]> {
  const out: ScrapedOdds[] = [];
  const seen = new Set<string>();
  const errors: string[] = [];

  for (const region of REGIONS) {
    let regionRows = 0;
    for (const timeline of TIMELINES) {
      const url =
        `https://www.sportybet.com/api/${region}/factsCenter/pcUpcomingEvents` +
        `?sportId=sr%3Asport%3A1&marketId=1&pageSize=100&pageNum=1&option=1&timeline=${timeline}`;
      try {
        const json = await fetchJson(url, {
          referer: `https://www.sportybet.com/${region}/sport/football`,
          timeoutMs: 9000,
          headers: { operid: "2", platform: "web", clientid: "web" },
        });
        for (const ev of readEvents(json)) {
          const s = extractSb(ev, region);
          if (!s) continue;
          const key = `${s.homeTeam.toLowerCase()}|${s.awayTeam.toLowerCase()}|${s.commenceTime
            .toISOString()
            .slice(0, 10)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push(s);
          regionRows++;
        }
      } catch (e) {
        errors.push(`${region}/${timeline}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    // A single live region already gives full football coverage.
    if (regionRows > 40) break;
  }

  if (!out.length) throw new Error(`sportybet: no rows (${errors.join("; ") || "empty response"})`);
  return out;
}
