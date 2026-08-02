import { extractMatches, fetchJson, type ScrapedOdds } from "./base";

export async function scrapeOdibets(): Promise<ScrapedOdds[]> {
  // Errors intentionally propagate so the health panel shows the real reason
  // (Odibets currently answers 403 behind Cloudflare bot protection) instead of
  // silently reporting a healthy scraper with zero rows.
  const url = "https://api.odibets.com/api/v2/events?sport_id=1&limit=100";
  const json = await fetchJson(url, { referer: "https://odibets.com/", timeoutMs: 8000 });
  return extractMatches(json, "odibets", "soccer");
}