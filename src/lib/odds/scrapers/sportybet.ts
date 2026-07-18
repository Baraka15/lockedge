import { extractMatches, fetchJson, type ScrapedOdds } from "./base";

const REGIONS = ["ug", "ng", "ke", "gh", "tz", "zm"];

export async function scrapeSportyBet(): Promise<ScrapedOdds[]> {
  const results: ScrapedOdds[] = [];
  for (const region of REGIONS) {
    try {
      const url = `https://www.sportybet.com/api/${region}/factsCenter/popularSports?type=1`;
      const json = await fetchJson(url, {
        referer: `https://www.sportybet.com/${region}/`,
        timeoutMs: 8000,
      });
      const items = extractMatches(json, "sportybet", "soccer").map((m) => ({ ...m, region: region.toUpperCase() }));
      results.push(...items);
    } catch {
      // per-region failure is fine
    }
  }
  return results;
}