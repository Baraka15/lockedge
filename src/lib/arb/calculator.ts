import type { ArbOpportunity, NormalizedOdds } from "../odds/types";

/**
 * Highest inverse-sum still counted as a true sure bet. 99.7 => a minimum real
 * edge of ~0.3%. It used to be 99 (1% edge), which discarded the large majority
 * of genuine, placeable arbs on African books where edges cluster at 0.3-0.9%.
 */
const MAX_SURE_PERCENT = 99.7;
/**
 * Above 100 there is no guaranteed profit, but a book under ~101.5% is the
 * lowest-hold price in the market. These are surfaced as "value" plays: they
 * are the cheapest possible way to keep turnover and bet patterns looking
 * recreational (account longevity) between real sure bets.
 */
const MAX_VALUE_PERCENT = 101.5;
/** Anything "better" than a ~12% edge across these books is a data error. */
const MIN_ARB_PERCENT = 88;
/** Best price may not exceed the market median by more than this factor. */
const OUTLIER_RATIO = 1.35;

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

  // Distinct books only — two feeds of the same book are not an arb.
  if (new Set(oddsGroup.map((o) => o.bookmaker)).size < 2) return null;

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

  // False-positive guard: a "best" price wildly out of line with the rest of the
  // market is almost always a mis-parsed or stale quote, not a real edge.
  for (const b of best) {
    const quotes = oddsGroup
      .map((o) => o.outcomes.find((x) => x.name === b.name)?.price)
      .filter((p): p is number => typeof p === "number" && p > 1)
      .sort((x, y) => x - y);
    if (quotes.length < 2) continue;
    const median = quotes[Math.floor(quotes.length / 2)];
    if (b.odds > median * OUTLIER_RATIO) return null;
  }

  // The winning legs must come from at least two different books.
  if (new Set(best.map((b) => b.bookmaker)).size < 2) return null;

  // arb % = sum(1 / odds_i) * 100. <100 means risk-free profit exists.
  const inverseSum = best.reduce((acc, b) => acc + 1 / b.odds, 0);
  const arbPercent = inverseSum * 100;
  // Reject borderline values caused by rounding noise, and reject implausibly
  // large "edges" which in practice always trace back to bad data (wrong market,
  // wrong fixture, stale quote).
  if (!(arbPercent < MAX_VALUE_PERCENT)) return null;
  if (arbPercent < MIN_ARB_PERCENT) return null;
  const tier: "sure" | "value" = arbPercent < MAX_SURE_PERCENT ? "sure" : "value";
  const bookMarginPct = Math.max(0, Math.round((arbPercent - 100) * 1000) / 1000);

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
    tier,
    bookMarginPct,
  };
}