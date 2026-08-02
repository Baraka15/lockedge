import { extractMatches, fetchJson, type ScrapedOdds } from "./base";

const QS = "LineFeed/Get1x2_Tmp?sportId=1&count=50&lng=en&tf=2400000&tz=1&grMode=2";
const MIRRORS = ["https://1xbet.ug", "https://1xbet.co.ke", "https://1xbet.ng", "https://1xbet.com"];

/**
 * 1xBet's LineFeed API is served per-country mirror and several mirrors answer a
 * geo "block" page instead of JSON. Try each mirror and, if none respond with
 * usable JSON, throw so the health panel reports the real failure rather than
 * an empty-but-"healthy" scraper.
 */
export async function scrape1xBet(): Promise<ScrapedOdds[]> {
  let lastError = "no mirror reachable";
  for (const base of MIRRORS) {
    try {
      const json = await fetchJson(`${base}/${QS}`, { referer: `${base}/`, timeoutMs: 8000 });
      const rows = extractMatches(json, "1xbet", "soccer");
      if (rows.length) return rows;
      lastError = `${base} returned no usable rows`;
    } catch (e) {
      lastError = `${base}: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  throw new Error(lastError);
}