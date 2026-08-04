import { extractMatches, fetchJson, type ScrapedOdds } from "./base";

/**
 * 1win. Their sportsbook data sits behind an internal API on the main app
 * domain, which geo-blocks datacentre IPs (403) — so we walk the reachable
 * regional mirrors and surface the real error when every one is blocked
 * instead of pretending the source is healthy with zero rows.
 */
const BASES = [
  "https://1winbet.co.ke",
  "https://win.1winbet.co.ke",
  "https://1win-bet.co.ke",
  "https://1win.pro",
];

const PATHS = [
  "/incoming-api/sport/v1/prematch/lines?limit=200&lang=en",
  "/incoming-api/sport/line?lang=en&limit=200",
  "/api/sport/prematch?lang=en&limit=200",
];

export async function scrape1win(): Promise<ScrapedOdds[]> {
  let lastError = "no mirror reachable";
  for (const base of BASES) {
    for (const path of PATHS) {
      try {
        const json = await fetchJson(`${base}${path}`, {
          referer: `${base}/`,
          timeoutMs: 8000,
          headers: { "X-Requested-With": "XMLHttpRequest" },
        });
        const rows = extractMatches(json, "1win", "soccer");
        if (rows.length) return rows;
        lastError = `${base}${path} returned no usable rows`;
      } catch (e) {
        lastError = `${base}${path}: ${e instanceof Error ? e.message : String(e)}`;
      }
    }
  }
  throw new Error(lastError);
}
