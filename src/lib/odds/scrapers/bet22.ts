import { fetchJson, type ScrapedOdds } from "./base";

/**
 * 22Bet. Their prematch LineFeed endpoints 404 on every reachable mirror; the
 * only feed that answers with JSON from outside their app is the in-play
 * LiveFeed, so that is what we consume (in-play prices are still actionable and
 * the engine keeps a short in-play window open for them).
 *
 * Shape: { Value: [ { O1, O2, S (unix seconds), LE/L (league),
 *          E: [ { T: 1|2|3, C: coefficient } ] } ] }
 * T=1 home, T=2 draw, T=3 away for the 1X2 market.
 */
const MIRRORS = ["https://22bet.ug", "https://22bet.co.ke", "https://22bet.ng", "https://22bet.com"];
const SPORTS: Array<{ id: number; name: string }> = [
  { id: 1, name: "soccer" },
  { id: 3, name: "basketball" },
  { id: 2, name: "tennis" },
];

interface Ev { T?: number; C?: number; G?: number }
interface Row { O1?: string; O2?: string; S?: number; L?: string; LE?: string; E?: Ev[] }

function parse(json: unknown, sport: string): ScrapedOdds[] {
  const value = (json as { Value?: unknown } | null)?.Value;
  if (!Array.isArray(value)) return [];
  const out: ScrapedOdds[] = [];
  for (const raw of value as Row[]) {
    const home = typeof raw.O1 === "string" ? raw.O1.trim() : "";
    const away = typeof raw.O2 === "string" ? raw.O2.trim() : "";
    if (!home || !away) continue;
    const startSec = Number(raw.S);
    if (!Number.isFinite(startSec) || startSec <= 0) continue;
    let h = 0, d = 0, a = 0;
    for (const e of raw.E ?? []) {
      const c = Number(e?.C);
      if (!Number.isFinite(c) || c <= 1) continue;
      if (e.G !== undefined && Number(e.G) !== 1) continue; // 1X2 group only
      if (e.T === 1) h = c;
      else if (e.T === 2) d = c;
      else if (e.T === 3) a = c;
    }
    if (!(h > 1 && a > 1)) continue;
    out.push({
      bookmaker: "22bet",
      fixtureKey: `${home} vs ${away}`.toLowerCase(),
      homeTeam: home,
      awayTeam: away,
      commenceTime: new Date(startSec * 1000),
      markets: { home: h, away: a, ...(d > 1 ? { draw: d } : {}) },
      sport,
      league: raw.LE ?? raw.L,
      region: "UG",
    });
  }
  return out;
}

export async function scrape22Bet(): Promise<ScrapedOdds[]> {
  let lastError = "no mirror reachable";
  for (const base of MIRRORS) {
    const out: ScrapedOdds[] = [];
    let rawRows = 0;
    try {
      for (const s of SPORTS) {
        const url = `${base}/LiveFeed/Get1x2_VZip?sports=${s.id}&count=200&lng=en&mode=4&country=232`;
        const json = await fetchJson(url, { referer: `${base}/`, timeoutMs: 8000 });
        const value = (json as { Value?: unknown } | null)?.Value;
        rawRows += Array.isArray(value) ? value.length : 0;
        out.push(...parse(json, s.name));
      }
      if (out.length) return out;
      lastError = rawRows === 0
        ? `${base} returned an empty feed (server IP likely filtered)`
        : `${base} returned ${rawRows} rows but none with a 1X2 price`;
    } catch (e) {
      lastError = `${base}: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  throw new Error(lastError);
}
