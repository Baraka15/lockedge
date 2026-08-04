import { extractMatches, fetchJson, type ScrapedOdds } from "./base";

/**
 * 22Bet. Their prematch LineFeed endpoints 404 on every reachable mirror; the
 * only feed that answers with JSON from outside their app is the in-play
 * LiveFeed, so that is what we consume (in-play arbs are still actionable and
 * the engine keeps a short in-play window open for them).
 */
const MIRRORS = ["https://22bet.ug", "https://22bet.co.ke", "https://22bet.ng", "https://22bet.com"];
const SPORT_IDS = [1, 3, 2]; // soccer, basketball, tennis
const SPORT_NAMES: Record<number, string> = { 1: "soccer", 3: "basketball", 2: "tennis" };

export async function scrape22Bet(): Promise<ScrapedOdds[]> {
  let lastError = "no mirror reachable";
  for (const base of MIRRORS) {
    const out: ScrapedOdds[] = [];
    try {
      for (const sportId of SPORT_IDS) {
        const url =
          `${base}/LiveFeed/Get1x2_VZip?sports=${sportId}&count=200&lng=en&mode=4&country=232`;
        const json = await fetchJson(url, { referer: `${base}/`, timeoutMs: 8000 });
        out.push(...extractMatches(json, "22bet", SPORT_NAMES[sportId] ?? "soccer"));
      }
      if (out.length) return out;
      lastError = `${base} returned no usable rows`;
    } catch (e) {
      lastError = `${base}: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  throw new Error(lastError);
}
