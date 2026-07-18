import { extractMatches, fetchJson, type ScrapedOdds } from "./base";

export async function scrapeBangbet(): Promise<ScrapedOdds[]> {
  try {
    const url = "https://www.bangbet.com/api/v1/sports/matches?sport_id=1&market_id=1&count=50";
    const json = await fetchJson(url, { referer: "https://www.bangbet.com/", timeoutMs: 8000 });
    return extractMatches(json, "bangbet", "soccer");
  } catch {
    return [];
  }
}