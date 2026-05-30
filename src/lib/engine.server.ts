import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { detectArbs } from "./arb/detector";
import { matchFixtures } from "./odds/matcher";
import { normalizeOdds } from "./odds/normalizer";
import { generateMockOdds } from "./odds/providers/mock-provider.server";
import { fetchTheOddsApi } from "./odds/providers/theoddsapi-provider.server";
import type { MasterFixture, RawOdds } from "./odds/types";

export interface PollResult {
  arbsDetected: number;
  durationMs: number;
  providers: string[];
  error?: string;
}

/**
 * Runs one arbitrage scan cycle:
 *  1. Fetches raw odds from all enabled providers in parallel
 *  2. Normalizes & fuzzy-matches them against master_fixtures
 *  3. Detects arbitrage opportunities
 *  4. Upserts results to the `arbs` table (deduped per 10s window)
 *  5. Records the run in `engine_runs`
 */
export async function runPollCycle(): Promise<PollResult> {
  const started = Date.now();
  const providers: string[] = ["mock"];
  let arbsDetected = 0;
  let errorMsg: string | undefined;

  try {
    const totalInvestment = Number(process.env.TOTAL_INVESTMENT ?? 100);
    const expirySeconds = Number(process.env.ARB_EXPIRY_SECONDS ?? 10);

    const hasRealKey = !!(process.env.THEODDSAPI_KEY || process.env.ODDS_API_KEY);
    const includeMock = process.env.INCLUDE_MOCK_ODDS === "true" || !hasRealKey;
    const tasks: Promise<RawOdds[]>[] = [];
    const providerOrder: string[] = [];
    if (includeMock) {
      providerOrder.push("mock");
      tasks.push(Promise.resolve(generateMockOdds()));
    }
    if (hasRealKey) {
      providerOrder.push("theoddsapi");
      tasks.push(fetchTheOddsApi());
    }
    providers.length = 0;
    providers.push(...providerOrder);
    const results = await Promise.all(tasks);
    const raw = results.flat();
    if (hasRealKey) {
      const idx = providerOrder.indexOf("theoddsapi");
      const realCount = idx >= 0 ? results[idx].length : 0;
      console.log(`[engine] theoddsapi contributed ${realCount} raw odds rows`);
    }

    const normalized = raw.map(normalizeOdds);

    const { data: fixturesData } = await supabaseAdmin
      .from("master_fixtures")
      .select("id, sport, home_team, away_team, event_date");
    const fixtures = (fixturesData ?? []) as MasterFixture[];

    // Upsert any newly seen events into master_fixtures so future runs can fuzzy-match
    const fixturePayload = Array.from(
      new Map(
        normalized.map((n) => [
          `${n.sport}|${n.homeTeam}|${n.awayTeam}|${new Date(n.eventDate)
            .toISOString()
            .slice(0, 10)}`,
          {
            sport: n.sport,
            home_team: n.homeTeam,
            away_team: n.awayTeam,
            event_date: n.eventDate,
          },
        ]),
      ).values(),
    );
    if (fixturePayload.length) {
      await supabaseAdmin
        .from("master_fixtures")
        .upsert(fixturePayload, {
          onConflict: "sport,home_team,away_team,event_date",
          ignoreDuplicates: true,
        });
    }

    const groups = matchFixtures(normalized, fixtures);
    const arbs = detectArbs(groups, totalInvestment);
    arbsDetected = arbs.length;

    if (arbs.length) {
      const now = new Date();
      const expires = new Date(now.getTime() + expirySeconds * 1000);
      const rows = arbs.map((a) => ({
        event_name: a.eventName,
        market_type: a.marketType,
        outcomes: a.outcomes,
        total_arb_percent: a.totalArbPercent,
        required_total_stake: a.requiredTotalStake,
        detected_at: now.toISOString(),
        expires_at: expires.toISOString(),
        dedup_key: a.dedupKey,
        is_acknowledged: false,
      }));
      const { error } = await supabaseAdmin
        .from("arbs")
        .upsert(rows, { onConflict: "dedup_key", ignoreDuplicates: true });
      if (error) console.error("[engine] arb upsert failed", error);
    }
  } catch (err) {
    errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[engine] ${new Date().toISOString()} poll cycle failed`, err);
  }

  const durationMs = Date.now() - started;
  try {
    await supabaseAdmin.from("engine_runs").insert({
      arbs_detected: arbsDetected,
      duration_ms: durationMs,
      providers,
      error: errorMsg ?? null,
    });
  } catch (err) {
    console.error("[engine] failed to record run", err);
  }

  return { arbsDetected, durationMs, providers, error: errorMsg };
}