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

export interface AfricanScrapeSummary {
  results: ScraperResult[];
  totalOdds: number;
  liveCount: number;
  totalCount: number;
}

const SCRAPERS: Array<{ id: string; run: () => Promise<ScrapedOdds[]> }> = [
  { id: "sportybet", run: scrapeSportyBet },
  { id: "betpawa", run: scrapeBetPawa },
  { id: "betika", run: scrapeBetika },
  { id: "odibets", run: scrapeOdibets },
  { id: "msport", run: scrapeMsport },
  { id: "1xbet", run: scrape1xBet },
  { id: "melbet", run: scrapeMelBet },
  { id: "bangbet", run: scrapeBangbet },
];

/**
 * Fetch odds from every African bookmaker in parallel. Each scraper has its
 * own timeout and one automatic retry on failure. Returns per-bookmaker
 * telemetry alongside the flattened odds list.
 */
export async function fetchAllAfricanOdds(): Promise<AfricanScrapeSummary> {
  const wrapped = SCRAPERS.map(async (s) => {
    await jitter(500);
    let first = await runScraper(s.id, s.run, 10_000);
    if (!first.ok || first.count === 0) {
      await new Promise((r) => setTimeout(r, 5000));
      const retry = await runScraper(s.id, s.run, 10_000);
      if (retry.ok && retry.count > first.count) first = retry;
    }
    return first;
  });
  const results = await Promise.allSettled(wrapped);
  const settled: ScraperResult[] = results.map((r, i) =>
    r.status === "fulfilled"
      ? r.value
      : { bookmaker: SCRAPERS[i].id, ok: false, count: 0, latencyMs: 0, error: String(r.reason), odds: [] },
  );
  const totalOdds = settled.reduce((n, r) => n + r.count, 0);
  const liveCount = settled.filter((r) => r.ok).length;

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
      status: existing?.status ?? "online",
      last_heartbeat: new Date().toISOString(),
      version: existing?.version ?? "engine-1.0.0",
      metadata: { ...meta, scrapers } as never,
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

export { SCRAPERS };