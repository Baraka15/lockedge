import { extractMatches, fetchJson, type ScrapedOdds } from "./base";

export async function scrape1xBet(): Promise<ScrapedOdds[]> {
  try {
    const url = "https://1xbet.com/LineFeed/Get1x2_Tmp?sportId=1&count=50&lng=en&tf=2400000&tz=1&grMode=2";
    const json = await fetchJson(url, { referer: "https://1xbet.com/", timeoutMs: 8000 });
    return extractMatches(json, "1xbet", "soccer");
  } catch {
    return [];
  }
}