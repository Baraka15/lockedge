import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { RawOdds } from "../types";
import { jitter, runScraper, toRawOdds, type ScrapedOdds, type ScraperResult } from "./base";
import { scrapeBetPawa } from "./betpawa";
import { scrapeBetika } from "./betika";
import { scrapeMsport } from "./msport";
import { scrapeOdibets } from "./odibets";
import { scrape1xBet } from "./onexbet";
import { scrapeMelBet } from "./melbet";
import { scrapeBangbet } from "./bangbet";
import { scrapeSportyBet } from "./sportybet";
import { scrape22Bet } from "./bet22";
import { scrape1win } from "./onewin";

export interface AfricanScrapeSummary {
  results: ScraperResult[];
  totalOdds: number;
  liveCount: number;
  totalCount: number;
}

/**
 * Source registry, ordered by how reliably each book produces real, priced
 * arbs for a Uganda-based operator.
 *
 *  tier 1 — proven live, deep prematch coverage, accounts usable in UG.
 *  tier 2 — reachable but thinner/in-play-only coverage.
 *  tier 3 — usually blocked (Cloudflare / bot protection); kept so they
 *           recover automatically if they ever open up.
 *
 * `enabled: false` sources are not scraped at all. SportyBet and Msport are
 * disabled because they are not usable from Uganda for this account, so
 * scraping them only burns cycle time and pollutes health telemetry.
 */
export interface ScraperEntry {
  id: string;
  run: () => Promise<ScrapedOdds[]>;
  tier: 1 | 2 | 3;
  enabled: boolean;
  note?: string;
}

const ALL_SCRAPERS: ScraperEntry[] = [
  { id: "betpawa", run: scrapeBetPawa, tier: 1, enabled: true },
  { id: "betika", run: scrapeBetika, tier: 1, enabled: true },
  { id: "22bet", run: scrape22Bet, tier: 2, enabled: true, note: "in-play feed only" },
  { id: "odibets", run: scrapeOdibets, tier: 2, enabled: true },
  { id: "1win", run: scrape1win, tier: 2, enabled: true, note: "mirrors often geo-blocked" },
  { id: "1xbet", run: scrape1xBet, tier: 3, enabled: true },
  { id: "melbet", run: scrapeMelBet, tier: 3, enabled: true },
  { id: "bangbet", run: scrapeBangbet, tier: 3, enabled: true },
  { id: "sportybet", run: scrapeSportyBet, tier: 3, enabled: false, note: "not available in Uganda" },
  { id: "msport", run: scrapeMsport, tier: 3, enabled: false, note: "not available in Uganda" },
];

const SCRAPERS: ScraperEntry[] = ALL_SCRAPERS.filter((s) => s.enabled).sort(
  (a, b) => a.tier - b.tier,
);

// Consecutive-failure counter, kept per worker invocation. A source that keeps
// failing is still attempted once per cycle (so it recovers automatically) but we
// stop paying the retry penalty for it, which used to add ~5s to every cycle.
const failStreak = new Map<string, number>();

/**
 * Fetch odds from every African bookmaker in parallel. Each scraper has its
 * own timeout and one automatic retry on failure. Returns per-bookmaker
 * telemetry alongside the flattened odds list.
 */
export async function fetchAllAfricanOdds(): Promise<AfricanScrapeSummary> {
  const wrapped = SCRAPERS.map(async (s) => {
    await jitter(300);
    let result = await runScraper(s.id, s.run, 10_000);
    const streak = failStreak.get(s.id) ?? 0;
    // Retry once with a short backoff, but only for sources that are usually
    // healthy — persistently blocked ones would otherwise stall every cycle.
    if (!result.ok && streak < 3) {
      await new Promise((r) => setTimeout(r, 1200));
      const retry = await runScraper(s.id, s.run, 10_000);
      if (retry.count > result.count) result = retry;
    }
    failStreak.set(s.id, result.ok ? 0 : streak + 1);
    return result;
  });
  const results = await Promise.allSettled(wrapped);
  const settled: ScraperResult[] = results.map((r, i) =>
    r.status === "fulfilled"
      ? r.value
      : { bookmaker: SCRAPERS[i].id, ok: false, count: 0, latencyMs: 0, error: String(r.reason), odds: [] },
  );
  const totalOdds = settled.reduce((n, r) => n + r.count, 0);
  const liveCount = settled.filter((r) => r.ok).length;
  console.log(
    `[scrapers] ${liveCount}/${SCRAPERS.length} live, ${totalOdds} odds rows — ` +
      settled.map((r) => `${r.bookmaker}:${r.ok ? r.count : "FAIL"}`).join(" "),
  );

  // Persist per-scraper telemetry so the dashboard can render statuses.
  try {
    const { data: existing } = await supabaseAdmin
      .from("agent_status").select("metadata, status, version").eq("agent_id", "engine").maybeSingle();
    const meta = ((existing?.metadata as Record<string, unknown> | null) ?? {});
    const scrapers = Object.fromEntries(
      settled.map((r) => [r.bookmaker, {
        ok: r.ok,
        count: r.count,
        latency_ms: r.latencyMs,
        error: r.error ?? null,
        checked_at: new Date().toISOString(),
      }]),
    );
    await supabaseAdmin.from("agent_status").upsert({
      agent_id: "engine",
      status: liveCount > 0 ? "online" : "degraded",
      last_heartbeat: new Date().toISOString(),
      version: existing?.version ?? "engine-1.0.0",
      metadata: {
        ...meta,
        scrapers,
        scrapers_live: liveCount,
        scrapers_total: SCRAPERS.length,
        scrapers_disabled: ALL_SCRAPERS.filter((s) => !s.enabled).map((s) => ({
          id: s.id,
          reason: s.note ?? "disabled",
        })),
        scrapers_priority: SCRAPERS.map((s) => `${s.id}:t${s.tier}`),
        last_cycle_at: new Date().toISOString(),
      } as never,
    }, { onConflict: "agent_id" });
  } catch (e) {
    console.error("[scrapers] telemetry persist failed", e);
  }

  return { results: settled, totalOdds, liveCount, totalCount: SCRAPERS.length };
}

export async function fetchAllAfricanOddsAsRaw(): Promise<{ raw: RawOdds[]; summary: AfricanScrapeSummary }> {
  const summary = await fetchAllAfricanOdds();
  const flat = summary.results.flatMap((r) => r.odds);
  return { raw: toRawOdds(flat), summary };
}

export { SCRAPERS, ALL_SCRAPERS };