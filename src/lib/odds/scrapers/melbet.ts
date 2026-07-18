import { extractMatches, fetchJson, type ScrapedOdds } from "./base";

export async function scrapeMelBet(): Promise<ScrapedOdds[]> {
  try {
    const url = "https://melbet.com/LineFeed/Get1x2_Tmp?sportId=1&count=50&lng=en&tf=2400000&tz=1&grMode=2";
    const json = await fetchJson(url, { referer: "https://melbet.com/", timeoutMs: 8000 });
    return extractMatches(json, "melbet", "soccer");
  } catch {
    return [];
  }
}