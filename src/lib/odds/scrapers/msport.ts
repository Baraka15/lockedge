import { extractMatches, fetchJson, type ScrapedOdds } from "./base";

export async function scrapeMsport(): Promise<ScrapedOdds[]> {
  try {
    const url = "https://sports.msport.com/api/match/getMatchList?status=0&sportType=1&pageNum=1&pageSize=50";
    const json = await fetchJson(url, { referer: "https://www.msport.com/", timeoutMs: 8000 });
    return extractMatches(json, "msport", "soccer");
  } catch {
    return [];
  }
}