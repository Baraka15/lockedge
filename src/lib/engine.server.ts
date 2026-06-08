import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { detectArbs } from "./arb/detector";
import { matchFixtures } from "./odds/matcher";
import { normalizeOdds } from "./odds/normalizer";
import { generateMockOdds } from "./odds/providers/mock-provider.server";
import { fetchTheOddsApi } from "./odds/providers/theoddsapi-provider.server";
import { notify } from "./notifications.server";
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

    // Drop any odds whose event has already started — institutional bar.
    const nowMs = Date.now();
    const upcoming = normalized.filter(
      (n) => new Date(n.eventDate).getTime() > nowMs,
    );

    // Dedupe per (bookmaker, event, market, outcome) — keep latest fetch.
    const dedupMap = new Map<string, typeof upcoming[number]>();
    for (const n of upcoming) {
      const key = `${n.bookmaker}|${n.eventKey}|${n.marketType}`;
      const prev = dedupMap.get(key);
      if (!prev || n.fetchedAt > prev.fetchedAt) dedupMap.set(key, n);
    }
    const deduped = Array.from(dedupMap.values());

    const { data: fixturesData } = await supabaseAdmin
      .from("master_fixtures")
      .select("id, sport, home_team, away_team, event_date, is_completed")
      .eq("is_completed", false);
    const fixtures = (fixturesData ?? []) as MasterFixture[];

    // Upsert any newly seen events into master_fixtures so future runs can fuzzy-match
    const fixturePayload = Array.from(
      new Map(
        deduped.map((n) => [
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

    // Mark stale fixtures completed (defence-in-depth alongside the pg_cron job).
    const staleCutoff = new Date(nowMs - 3 * 60 * 60 * 1000).toISOString();
    await supabaseAdmin
      .from("master_fixtures")
      .update({ is_completed: true })
      .lt("event_date", staleCutoff)
      .eq("is_completed", false);

    const groups = matchFixtures(deduped, fixtures);
    const arbs = detectArbs(groups, totalInvestment);
    arbsDetected = arbs.length;

    for (const a of arbs) {
      console.log(
        `[engine] ARB ${a.eventName} (${a.marketType}) arb%=${a.totalArbPercent} ` +
          a.outcomes
            .map((o) => `${o.name}@${o.odds}[${o.bookmaker}]`)
            .join(" / "),
      );
    }

    // Upsert a snapshot of every scanned event so the dashboard can show
    // live odds, not just confirmed arbs. Best price per outcome across
    // bookmakers, plus a count of distinct bookmakers per event.
    const liveRows: {
      event_key: string;
      sport: string;
      event_name: string;
      event_date: string;
      market_type: string;
      bookmaker_count: number;
      outcomes: { name: string; bestPrice: number; bookmaker: string; bookmakerCount: number }[];
      updated_at: string;
    }[] = [];
    const nowIso = new Date().toISOString();
    for (const [groupKey, list] of groups) {
      if (!list.length) continue;
      const first = list[0];
      const bestByOutcome = new Map<
        string,
        { name: string; bestPrice: number; bookmaker: string; bookmakerCount: number }
      >();
      for (const odds of list) {
        for (const o of odds.outcomes) {
          const ex = bestByOutcome.get(o.name);
          if (!ex) {
            bestByOutcome.set(o.name, {
              name: o.name,
              bestPrice: o.price,
              bookmaker: odds.bookmaker,
              bookmakerCount: 1,
            });
          } else {
            ex.bookmakerCount += 1;
            if (o.price > ex.bestPrice) {
              ex.bestPrice = o.price;
              ex.bookmaker = odds.bookmaker;
            }
          }
        }
      }
      const distinctBookmakers = new Set(list.map((l) => l.bookmaker)).size;
      const eventName = `${first.homeTeam} vs ${first.awayTeam}`;
      liveRows.push({
        event_key: groupKey,
        sport: first.sport,
        event_name: eventName,
        event_date: first.eventDate,
        market_type: first.marketType,
        bookmaker_count: distinctBookmakers,
        outcomes: Array.from(bestByOutcome.values()),
        updated_at: nowIso,
      });
    }
    if (liveRows.length) {
      const { error: liveErr } = await supabaseAdmin
        .from("live_events")
        .upsert(liveRows, { onConflict: "event_key" });
      if (liveErr) console.error("[engine] live_events upsert failed", liveErr);
    }
    // Prune snapshots not seen in the last 5 minutes so stale matches drop off.
    const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    await supabaseAdmin.from("live_events").delete().lt("updated_at", cutoff);

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

      // Notify on big arbs (threshold from risk_settings)
      try {
        const { data: rs } = await supabaseAdmin
          .from("risk_settings").select("notify_enabled, notify_min_edge_pct")
          .eq("account_label", "primary").maybeSingle();
        const enabled = (rs as { notify_enabled?: boolean } | null)?.notify_enabled ?? true;
        const minEdge = Number((rs as { notify_min_edge_pct?: number } | null)?.notify_min_edge_pct ?? 2);
        if (enabled) {
          for (const a of arbs) {
            if (a.totalArbPercent >= minEdge) {
              await notify({
                kind: "arb_detected",
                title: `Arb ${a.totalArbPercent.toFixed(2)}%`,
                body: `${a.eventName} • ${a.marketType}`,
                payload: { dedupKey: a.dedupKey },
              });
            }
          }
        }
      } catch (e) {
        console.error("[engine] notify failed", e);
      }
    }

    // Note: a pg_cron job ('arbs-cleanup-stale') prunes expired arbs and
    // anything older than 30min, so we keep recently-expired rows around
    // long enough for the Settlement tab to surface them.
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