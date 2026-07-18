import { extractMatches, fetchJson, type ScrapedOdds } from "./base";

export async function scrapeOdibets(): Promise<ScrapedOdds[]> {
  try {
    const url = "https://api.odibets.com/api/v2/events?sport_id=1&limit=100";
    const json = await fetchJson(url, { referer: "https://odibets.com/", timeoutMs: 8000 });
    return extractMatches(json, "odibets", "soccer");
  } catch {
    return [];
  }
}