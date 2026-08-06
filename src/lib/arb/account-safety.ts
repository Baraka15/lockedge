/**
 * ACCOUNT LONGEVITY LAYER
 *
 * Bookmakers limit or close accounts on pattern, not on profit alone. The
 * strongest tells are: perfectly-computed stakes (e.g. 137.42), always taking
 * the top price seconds after it appears, betting only obscure markets, and a
 * one-sided turnover profile on a single book. This module shapes placement so
 * the account reads recreational while keeping the edge intact.
 */

export interface StakeShapeInput {
  stake: number;
  /** Smallest currency unit the operator actually types (e.g. 500 UGX). */
  roundTo?: number;
  /** Odds of the leg — used to keep the return balanced after rounding. */
  odds: number;
}

export interface StakeShapeResult {
  original: number;
  camouflaged: number;
  /** Profit given up (currency) to look human. */
  costOfCamouflage: number;
}

/**
 * Round a computed stake to something a human would type, avoiding suspiciously
 * exact figures AND suspiciously round ones (a wall of 10,000s is its own tell).
 */
export function camouflageStake({ stake, odds, roundTo = 100 }: StakeShapeInput): StakeShapeResult {
  if (!Number.isFinite(stake) || stake <= 0) {
    return { original: stake, camouflaged: 0, costOfCamouflage: 0 };
  }
  let value = Math.round(stake / roundTo) * roundTo;
  // Nudge perfectly round "banker" numbers off the grid by one increment so the
  // bet history isn't a column of identical figures.
  const isTooRound = value % (roundTo * 10) === 0;
  if (isTooRound && value > roundTo * 2) {
    value -= roundTo * (1 + (Math.floor(stake) % 3));
  }
  const cost = Math.abs((stake - value) * (odds - 1));
  return {
    original: Math.round(stake * 100) / 100,
    camouflaged: value,
    costOfCamouflage: Math.round(cost * 100) / 100,
  };
}

export interface BookExposure {
  bookmaker: string;
  /** Total staked on this book in the tracked window. */
  turnover: number;
  /** Number of bets placed. */
  bets: number;
  /** Share of those bets that were arb legs (vs recreational/mug bets). */
  arbShare: number;
}

export type RiskLevel = "safe" | "watch" | "hot";

export interface AccountRisk {
  bookmaker: string;
  level: RiskLevel;
  turnoverShare: number;
  arbShare: number;
  reasons: string[];
  advice: string;
}

/** Above this share of total turnover a single book sees too much of the action. */
const CONCENTRATION_LIMIT = 0.45;
/** Above this arb-only share the betting profile stops looking recreational. */
const ARB_SHARE_LIMIT = 0.8;

/**
 * Score each bookmaker on how likely it is to flag the account, and say what to
 * do about it. Deliberately conservative: survival beats one extra arb.
 */
export function assessAccountRisk(exposures: BookExposure[]): AccountRisk[] {
  const total = exposures.reduce((s, e) => s + e.turnover, 0) || 1;
  return exposures
    .map((e) => {
      const turnoverShare = e.turnover / total;
      const reasons: string[] = [];
      if (turnoverShare > CONCENTRATION_LIMIT) {
        reasons.push(`${(turnoverShare * 100).toFixed(0)}% of all turnover sits on this book`);
      }
      if (e.arbShare > ARB_SHARE_LIMIT && e.bets >= 5) {
        reasons.push(`${(e.arbShare * 100).toFixed(0)}% of bets are arb legs — no recreational cover`);
      }
      const level: RiskLevel =
        reasons.length >= 2 ? "hot" : reasons.length === 1 ? "watch" : "safe";
      const advice =
        level === "hot"
          ? "Pause new arb legs here for 24-48h; place 2-3 mainstream mug bets instead."
          : level === "watch"
            ? "Route the next few legs to another book and mix in a recreational bet."
            : "Profile looks healthy — keep stakes irregular.";
      return { bookmaker: e.bookmaker, level, turnoverShare, arbShare: e.arbShare, reasons, advice };
    })
    .sort((a, b) => b.turnoverShare - a.turnoverShare);
}

/**
 * How many recreational ("mug") bets are needed to dilute the arb share on a
 * book back below the safe threshold.
 */
export function mugBetsNeeded(bets: number, arbShare: number, target = 0.65): number {
  if (bets <= 0 || arbShare <= target) return 0;
  const arbBets = arbShare * bets;
  return Math.max(0, Math.ceil(arbBets / target - bets));
}

/**
 * Pick which leg to place first. Placing the leg most likely to move or be
 * rejected first minimises the chance of ending up half-hedged, which is both
 * the main source of slippage and the main source of "chasing" patterns that
 * get accounts flagged.
 */
export function placementOrder<T extends { bookmaker: string; odds: number }>(
  legs: T[],
  reliability: Record<string, number> = {},
): T[] {
  return [...legs].sort((a, b) => {
    const ra = reliability[a.bookmaker.toLowerCase()] ?? 0.7;
    const rb = reliability[b.bookmaker.toLowerCase()] ?? 0.7;
    // Least reliable book first, then longest odds (they move fastest).
    if (ra !== rb) return ra - rb;
    return b.odds - a.odds;
  });
}