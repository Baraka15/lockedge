import { useMemo } from "react";
import { useSettlements, type Settlement } from "./usePerformance";

export type GapWindow = 7 | 30 | 90;

export interface GapBucket {
  key: string;
  theoretical: number;
  actual: number;
  slippage: number;
  count: number;
}

export interface GapSummary {
  window: GapWindow;
  theoretical: number;
  actual: number;
  slippage: number;
  /** Realised profit as a share of theoretical profit (1 = perfect capture). */
  captureRate: number;
  staked: number;
  theoreticalEdgePct: number;
  actualEdgePct: number;
  count: number;
  /** Settlements where realised profit came in under theoretical. */
  underDelivered: number;
  worst: { event: string; gap: number } | null;
}

function theoreticalOf(s: Settlement): number {
  const stored = Number(s.theoretical_profit ?? 0);
  if (stored) return stored;
  // Fallback for legacy rows: derive from the stored edge, else assume the
  // realised number was the target.
  const edge = Number(s.theoretical_edge_pct ?? 0);
  const stake = Number(s.theoretical_stake ?? s.total_staked ?? 0);
  if (edge > 0 && stake > 0) return (stake * edge) / (100 - edge);
  return Number(s.profit);
}

/**
 * Rolling "actual vs theoretical" tracker: compares the edge shown on the arb
 * card at detection time with the P&L that actually landed after placement.
 * The gap is real-world slippage — odds moving mid-placement, a rejected or
 * partially filled leg, stake rounding, or a limit on one book.
 */
export function useProfitGap(windowDays: GapWindow = 30) {
  const { items } = useSettlements(500);

  return useMemo(() => {
    const cutoff = Date.now() - windowDays * 86_400_000;
    const scoped = items.filter((s) => new Date(s.settled_at).getTime() >= cutoff);

    const byDay = new Map<string, GapBucket>();
    let theoretical = 0;
    let actual = 0;
    let staked = 0;
    let underDelivered = 0;
    let worst: GapSummary["worst"] = null;

    for (const s of scoped) {
      const t = theoreticalOf(s);
      const a = Number(s.profit);
      theoretical += t;
      actual += a;
      staked += Number(s.total_staked);
      if (a < t - 0.005) underDelivered += 1;
      const gap = t - a;
      if (!worst || gap > worst.gap) worst = { event: s.event_name ?? "—", gap };

      const key = s.settled_at.slice(0, 10);
      const b = byDay.get(key) ?? { key, theoretical: 0, actual: 0, slippage: 0, count: 0 };
      b.theoretical += t;
      b.actual += a;
      b.slippage = b.theoretical - b.actual;
      b.count += 1;
      byDay.set(key, b);
    }

    const series = Array.from(byDay.values()).sort((x, y) => x.key.localeCompare(y.key));
    let cumT = 0;
    let cumA = 0;
    const cumulative = series.map((b) => {
      cumT += b.theoretical;
      cumA += b.actual;
      return { key: b.key, theoretical: cumT, actual: cumA, slippage: cumT - cumA };
    });

    const summary: GapSummary = {
      window: windowDays,
      theoretical,
      actual,
      slippage: theoretical - actual,
      captureRate: theoretical !== 0 ? actual / theoretical : 0,
      staked,
      theoreticalEdgePct: staked > 0 ? (theoretical / staked) * 100 : 0,
      actualEdgePct: staked > 0 ? (actual / staked) * 100 : 0,
      count: scoped.length,
      underDelivered,
      worst,
    };

    return { summary, series, cumulative, settlements: scoped };
  }, [items, windowDays]);
}