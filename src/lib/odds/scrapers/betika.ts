import { extractMatches, fetchJson, type ScrapedOdds } from "./base";

export async function scrapeBetika(): Promise<ScrapedOdds[]> {
  const results: ScrapedOdds[] = [];
  const endpoints = [
    "https://api.betika.com/v1/uo/matches?sport_id=1&sub_type_id=1&period=1&limit=50&offset=0",
    "https://api.betika.com/v1/uo/live-matches?sport_id=1&limit=50",
  ];
  for (const url of endpoints) {
    try {
      const json = await fetchJson(url, { referer: "https://www.betika.com/", timeoutMs: 8000 });
      results.push(...extractMatches(json, "betika", "soccer"));
    } catch {
      // ignore
    }
  }
  return results;
}