import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Execution assistant — VERIFICATION ONLY.
 *
 * This module re-checks an opportunity against the freshest odds snapshot the
 * scanner has captured, recalculates the edge and stakes, and writes an audit
 * record. It NEVER logs into a bookmaker, prepares a bet slip, enters a stake
 * or submits a wager. Placement is always done by hand by the operator on the
 * official bookmaker site.
 */

export const INVALID_MESSAGE = "ARB INVALID — ODDS CHANGED.";

/** A snapshot older than this cannot be trusted to represent current prices. */
const MAX_SNAPSHOT_AGE_SECONDS = 120;

export interface RevalidatedLeg {
  name: string;
  bookmaker: string;
  originalOdds: number;
  currentOdds: number | null;
  /** ok = unchanged or better, drifted = worse but present, missing = gone */
  status: "ok" | "improved" | "drifted" | "missing";
  stake: number;
}

export interface RevalidateResult {
  ok: boolean;
  executionId: string | null;
  message: string | null;
  legs: RevalidatedLeg[];
  currentArbPercent: number;
  currentEdgePct: number;
  minEdgePct: number;
  totalStake: number;
  verifiedAt: string;
  snapshotAgeSeconds: number | null;
}

type SnapshotOutcome = { name: string; bestPrice: number; bookmaker: string };

export const revalidateArb = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ arbId: z.string().uuid() }).parse(data),
  )
  .handler(async ({ data, context }): Promise<RevalidateResult> => {
    const { supabase, userId } = context;
    const verifiedAt = new Date().toISOString();

    const { data: arb, error: arbErr } = await supabase
      .from("arbs")
      .select(
        "id, event_name, market_type, outcomes, total_arb_percent, required_total_stake, detected_at, dedup_key",
      )
      .eq("id", data.arbId)
      .maybeSingle();

    if (arbErr || !arb) {
      return {
        ok: false,
        executionId: null,
        message: INVALID_MESSAGE,
        legs: [],
        currentArbPercent: 0,
        currentEdgePct: 0,
        minEdgePct: 0,
        totalStake: 0,
        verifiedAt,
        snapshotAgeSeconds: null,
      };
    }

    const originalLegs = (arb.outcomes ?? []) as {
      name: string;
      odds: number;
      bookmaker: string;
      stake: number;
    }[];

    // Minimum edge the operator is willing to place at.
    const { data: rs } = await supabase
      .from("risk_settings")
      .select("min_edge_pct, bankroll, max_stake_abs, max_stake_pct")
      .eq("account_label", "primary")
      .maybeSingle();
    const minEdgePct = Number(rs?.min_edge_pct ?? 0.3);

    // Freshest prices the scanner captured for this exact event + market.
    const { data: snap } = await supabase
      .from("live_events")
      .select("outcomes, updated_at")
      .eq("event_key", arb.dedup_key)
      .maybeSingle();

    const snapshotAgeSeconds = snap?.updated_at
      ? Math.round((Date.now() - new Date(snap.updated_at).getTime()) / 1000)
      : null;
    const snapOutcomes = (snap?.outcomes ?? []) as SnapshotOutcome[];

    const legs: RevalidatedLeg[] = originalLegs.map((leg) => {
      const found = snapOutcomes.find(
        (o) => o.name === leg.name && o.bookmaker === leg.bookmaker,
      );
      const currentOdds = found ? Number(found.bestPrice) : null;
      let status: RevalidatedLeg["status"] = "missing";
      if (currentOdds && currentOdds > 1) {
        if (currentOdds > leg.odds) status = "improved";
        else if (currentOdds === leg.odds) status = "ok";
        else status = "drifted";
      }
      return {
        name: leg.name,
        bookmaker: leg.bookmaker,
        originalOdds: Number(leg.odds),
        currentOdds,
        status,
        stake: Number(leg.stake),
      };
    });

    const stale =
      snapshotAgeSeconds === null || snapshotAgeSeconds > MAX_SNAPSHOT_AGE_SECONDS;
    const anyMissing = legs.some((l) => l.status === "missing");

    // Recalculate the edge on CURRENT prices and re-split the stakes.
    let currentArbPercent = 0;
    let totalStake = Number(arb.required_total_stake);
    if (!anyMissing) {
      const inverseSum = legs.reduce((acc, l) => acc + 1 / (l.currentOdds as number), 0);
      currentArbPercent = Math.round(inverseSum * 100 * 1000) / 1000;
      const target = Number(arb.required_total_stake);
      let sum = 0;
      for (const l of legs) {
        l.stake = Math.round((target / ((l.currentOdds as number) * inverseSum)) * 100) / 100;
        sum += l.stake;
      }
      totalStake = Math.round(sum * 100) / 100;
    }
    const currentEdgePct = anyMissing ? 0 : Math.round((100 - currentArbPercent) * 1000) / 1000;

    const blocked = stale || anyMissing || currentEdgePct < minEdgePct;
    const errorMessage = blocked
      ? stale
        ? "Odds snapshot is stale — waiting for a fresh scan."
        : anyMissing
          ? "A leg is no longer priced at that bookmaker."
          : `Edge fell to ${currentEdgePct.toFixed(2)}% (minimum ${minEdgePct.toFixed(2)}%).`
      : null;

    const { data: exec } = await supabase
      .from("executions")
      .insert({
        arb_id: arb.id,
        dedup_key: arb.dedup_key,
        event_name: arb.event_name,
        market_type: arb.market_type,
        detected_at: arb.detected_at,
        verified_at: verifiedAt,
        original_odds: originalLegs,
        current_odds: legs.map((l) => ({ ...l })),
        calculated_stakes: legs.map((l) => ({
          name: l.name,
          bookmaker: l.bookmaker,
          stake: l.stake,
        })),
        original_arb_percent: Number(arb.total_arb_percent),
        current_arb_percent: currentArbPercent,
        current_edge_pct: currentEdgePct,
        min_edge_pct: minEdgePct,
        total_stake: totalStake,
        status: blocked ? "invalid" : "verified",
        error_message: errorMessage,
        created_by: userId,
      })
      .select("id")
      .maybeSingle();

    return {
      ok: !blocked,
      executionId: exec?.id ?? null,
      message: blocked ? INVALID_MESSAGE : null,
      legs,
      currentArbPercent,
      currentEdgePct,
      minEdgePct,
      totalStake,
      verifiedAt,
      snapshotAgeSeconds,
    };
  });

export const recordExecutionOutcome = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        executionId: z.string().uuid(),
        outcome: z.enum(["accepted", "rejected", "aborted"]),
        note: z.string().max(500).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("executions")
      .update({
        user_outcome: data.outcome,
        status: data.outcome === "accepted" ? "placed_manually" : data.outcome,
        error_message: data.note ?? null,
      })
      .eq("id", data.executionId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
