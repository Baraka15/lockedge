import { extractMatches, fetchJson, type ScrapedOdds } from "./base";

const QS = "LineFeed/Get1x2_Tmp?sportId=1&count=50&lng=en&tf=2400000&tz=1&grMode=2";
const MIRRORS = ["https://melbet-ug.com", "https://melbet.co.ke", "https://melbet.ng", "https://melbet.com"];

/** Same per-country mirror situation as 1xBet; surface the real error upstream. */
export async function scrapeMelBet(): Promise<ScrapedOdds[]> {
  let lastError = "no mirror reachable";
  for (const base of MIRRORS) {
    try {
      const json = await fetchJson(`${base}/${QS}`, { referer: `${base}/`, timeoutMs: 8000 });
      const rows = extractMatches(json, "melbet", "soccer");
      if (rows.length) return rows;
      lastError = `${base} returned no usable rows`;
    } catch (e) {
      lastError = `${base}: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  throw new Error(lastError);
}