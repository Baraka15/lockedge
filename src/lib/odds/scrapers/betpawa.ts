import { extractMatches, fetchJson, type ScrapedOdds } from "./base";

const DOMAINS = ["betpawa.ug", "betpawa.gh", "betpawa.rw", "betpawa.tz", "betpawa.ke"];

export async function scrapeBetPawa(): Promise<ScrapedOdds[]> {
  const results: ScrapedOdds[] = [];
  for (const dom of DOMAINS) {
    try {
      const url = `https://www.${dom}/api/v1/events?sportId=1&marketTypeId=1&count=50&offset=0`;
      const json = await fetchJson(url, {
        referer: `https://www.${dom}/`,
        timeoutMs: 8000,
      });
      const items = extractMatches(json, "betpawa", "soccer").map((m) => ({ ...m, region: dom.split(".").pop()?.toUpperCase() }));
      results.push(...items);
    } catch {
      // ignore
    }
  }
  return results;
}