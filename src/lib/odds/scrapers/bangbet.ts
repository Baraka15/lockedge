import { extractMatches, fetchJson, type ScrapedOdds } from "./base";

/**
 * Bangbet currently serves its SPA shell (HTML) on the documented JSON path, so
 * this scraper is expected to fail until a working endpoint is found. The error
 * propagates on purpose so the health panel shows it as offline rather than
 * reporting a healthy source with zero matches.
 */
export async function scrapeBangbet(): Promise<ScrapedOdds[]> {
  const url = "https://www.bangbet.com/api/v1/sports/matches?sport_id=1&market_id=1&count=50";
  const json = await fetchJson(url, { referer: "https://www.bangbet.com/", timeoutMs: 8000 });
  return extractMatches(json, "bangbet", "soccer");
}