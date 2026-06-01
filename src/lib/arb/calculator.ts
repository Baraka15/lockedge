import type { ArbOpportunity, NormalizedOdds } from "../odds/types";

/**
 * Given multiple bookmakers' odds for the SAME event + market, pick the best
 * price per outcome and compute the arbitrage percentage. If
 * sum(1 / bestOdds) < 1 there is a guaranteed profit; we return the optimal
 * stake split for a target total investment.
 */
export function calculateArb(
  oddsGroup: NormalizedOdds[],
  totalInvestment: number,
): Omit<ArbOpportunity, "id" | "detectedAt" | "expiresAt" | "isAcknowledged" | "dedupKey"> | null {
  if (oddsGroup.length < 2) return null;

  // Collect the universe of outcome names present across bookmakers
  const names = new Set<string>();
  for (const o of oddsGroup) for (const out of o.outcomes) names.add(out.name);
  if (names.size < 2) return null;

  type Best = { name: string; odds: number; bookmaker: string };
  const best: Best[] = [];
  for (const name of names) {
    let pick: Best | null = null;
    for (const o of oddsGroup) {
      const match = o.outcomes.find((x) => x.name === name);
      if (!match) continue;
      if (!pick || match.price > pick.odds) {
        pick = { name, odds: match.price, bookmaker: o.bookmaker };
      }
    }
    // If a single bookmaker doesn't cover this outcome, skip — not a real arb
    if (!pick) return null;
    best.push(pick);
  }

  // arb % = sum(1 / odds_i) * 100. <100 means risk-free profit exists.
  const inverseSum = best.reduce((acc, b) => acc + 1 / b.odds, 0);
  const arbPercent = inverseSum * 100;
  // Reject borderline values caused by rounding noise — institutional bar.
  if (!(arbPercent < 99.5)) return null;

  // Stake proportional to 1/odds so all outcomes return ~ totalInvestment / inverseSum
  const outcomes = best.map((b) => {
    const stake = totalInvestment / (b.odds * inverseSum);
    return {
      name: b.name,
      odds: b.odds,
      bookmaker: b.bookmaker,
      stake: Math.round(stake * 100) / 100,
    };
  });

  const requiredTotalStake =
    Math.round(outcomes.reduce((s, o) => s + o.stake, 0) * 100) / 100;

  const first = oddsGroup[0];
  const eventName = `${first.homeTeam} vs ${first.awayTeam}`;

  return {
    eventName,
    marketType: first.marketType,
    outcomes,
    totalArbPercent: Math.round(arbPercent * 1000) / 1000,
    requiredTotalStake,
  };
}