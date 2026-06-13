/**
 * PRODUCTION STAKING ENGINE v3
 * - Advanced fractional Kelly with edge multipliers
 * - Real-time exposure tracking & multi-arb safe placement
 * - Dynamic risk adjustment based on daily performance
 * - Odds drift detection & hedge calculation
 */

import { sb, ACCOUNT_LABEL } from "./supabase.js";
import { log } from "./logger.js";

let cachedSettings = null;
let settingsCachedAt = 0;
const SETTINGS_TTL = 8000; // Refresh every 8s for real-time updates

/**
 * Fetch risk settings with intelligent caching
 */
export async function fetchRiskSettings() {
  const now = Date.now();
  if (cachedSettings && now - settingsCachedAt < SETTINGS_TTL) {
    return cachedSettings;
  }

  try {
    const { data, error } = await sb
      .from("risk_settings")
      .select("*")
      .eq("account_label", ACCOUNT_LABEL)
      .maybeSingle();

    if (error) throw error;

    cachedSettings = data || getDefaultRiskSettings();
    settingsCachedAt = now;
    return cachedSettings;
  } catch (error) {
    log.error("[fetchRiskSettings] DB failed", { error: error.message });
    return cachedSettings || getDefaultRiskSettings();
  }
}

/**
 * Production defaults for 250k UGX bankroll - OPTIMIZED FOR UGANDA MARKET
 */
export function getDefaultRiskSettings() {
  return {
    account_label: ACCOUNT_LABEL,
    bankroll: 250000, // 250k UGX starting
    session_start_bankroll: 250000,
    daily_target_growth_pct: 5.0, // 5% daily target = 12.5k UGX
    
    // STAKING
    min_stake_abs: 5000, // Min 5k UGX (practical betting)
    max_stake_abs: 80000, // Max 80k UGX per leg
    max_stake_pct: 35, // Max 35% of bankroll per leg
    
    // KELLY PARAMETERS
    kelly_fraction: 0.28, // Base 0.28 (conservative for safety)
    kelly_edge_boost: 1.5, // At 2%+ edge, multiply Kelly by 1.5
    kelly_multi_leg_bonus: 1.2, // 3+ legs gets 20% boost
    kelly_arb_strength_boost: 1.15, // 2%+ sure arb gets 15% boost
    
    // EXPOSURE & LIMITS
    max_bankroll_exposure_pct: 40, // Max 40% exposure across all open arbs
    max_open_arbs: 8, // Never run more than 8 parallel arbs
    
    // EDGE THRESHOLDS
    min_edge_pct: 0.8, // Won't place arbs with <0.8% edge
    strong_arb_threshold_pct: 1.5, // 1.5%+ = strong sure bet
    
    // PROTECTION
    odds_drift_tolerance_pct: 1.0, // Accept max 1% odds movement
    max_consecutive_failures: 3, // Autopause after 3 failures
    daily_loss_stop_pct: -8.0, // Emergency stop at -8% daily loss
    
    // AUTOMATION
    auto_stake_enabled: true,
    auto_placement_enabled: true,
    auto_hedge_enabled: true,
    
    // PARLAY
    parlay_min_legs: 3,
    parlay_max_legs: 5,
    parlay_edge_bonus_multiplier: 1.3, // Higher odds bonus for parlays
  };
}

/**
 * ADVANCED STAKE CALCULATOR
 * - Real Kelly with edge-based boost
 * - Multi-leg risk spreading
 * - Dynamic performance adjustment
 * Returns { stake, details, projectedROI, recommendation }
 */
export function calculateOptimalStake({
  legOdds,
  edgePct,
  settings,
  totalLegs = 2,
  isStrongArb = false,
  currentDailyPerformancePct = 0,
}) {
  // INPUT VALIDATION
  if (!settings?.auto_stake_enabled) {
    return { stake: 0, reason: "auto_stake_disabled" };
  }

  const odds = Number(legOdds);
  if (!Number.isFinite(odds) || odds <= 1) {
    return { stake: 0, reason: "invalid_odds", odds };
  }

  const edge = Number(edgePct) || 0;
  const minEdge = Number(settings.min_edge_pct || 0.8);
  if (!Number.isFinite(edge) || edge < minEdge) {
    return { stake: 0, reason: "below_min_edge", minEdge, edge };
  }

  const bankroll = Number(settings.bankroll) || 250000;
  if (bankroll <= 0) {
    return { stake: 0, reason: "invalid_bankroll" };
  }

  // ============ KELLY CALCULATION ============
  let baseKelly = Number(settings.kelly_fraction || 0.28);

  // BOOST 1: Higher edge = more aggressive (capped at 2x)
  const edgeBoost = Math.min(
    2.0,
    1 + Math.pow(edge / 3, 1.1) // Smooth curve, peaks at ~3% edge
  );

  // BOOST 2: Multi-leg bonus (3+ legs = safer)
  const legBoost = totalLegs >= 3 ? Number(settings.kelly_multi_leg_bonus || 1.2) : 1.0;

  // BOOST 3: Strong arb detection
  const strongArbBoost = isStrongArb ? Number(settings.kelly_arb_strength_boost || 1.15) : 1.0;

  // BOOST 4: Performance-based adjustment (if winning, be slightly more aggressive)
  const performanceBoost = Math.max(0.8, Math.min(1.2, 1 + currentDailyPerformancePct / 500));

  // Composite Kelly
  const adjustedKelly = (baseKelly * edgeBoost * legBoost * strongArbBoost * performanceBoost) / Math.max(totalLegs, 1);

  // Sizing formula: stake = bankroll * kelly * odds (for balanced return across legs)
  let stake = bankroll * adjustedKelly * odds;

  // ============ APPLY CAPS ============
  const pctCap = bankroll * (Number(settings.max_stake_pct || 35) / 100);
  const absCap = Number(settings.max_stake_abs || 80000);
  stake = Math.min(stake, pctCap, absCap);

  // ============ MINIMUM ENFORCEMENT ============
  const minStake = Number(settings.min_stake_abs || 5000);
  if (stake < minStake) {
    return { stake: 0, reason: "below_minimum_stake", calculated: stake, minimum: minStake };
  }

  // ============ ROUND FOR BETTING ============
  const finalStake = Math.round(stake / 100) * 100; // Round to nearest 100 UGX

  // ============ CALCULATE PROJECTIONS ============
  const projectedProfit = finalStake * (odds - 1) * (edge / 100);
  const projectedROI = ((projectedProfit / finalStake) * 100).toFixed(2);
  const riskExposure = finalStake;
  const maxReturn = finalStake * odds;

  return {
    stake: finalStake,
    reason: "calculated",
    details: {
      odds: odds.toFixed(2),
      edge: edge.toFixed(2),
      totalLegs,
      baseKelly: baseKelly.toFixed(3),
      edgeBoost: edgeBoost.toFixed(2),
      legBoost: legBoost.toFixed(2),
      strongArbBoost: strongArbBoost.toFixed(2),
      performanceBoost: performanceBoost.toFixed(2),
      adjustedKelly: adjustedKelly.toFixed(3),
      bankroll,
      pctCap,
      absCap,
    },
    projectedProfit: Math.round(projectedProfit),
    projectedROI: Number(projectedROI),
    maxReturn: Math.round(maxReturn),
    riskExposure,
    recommendation:
      edge >= 2.0 ? "AGGRESSIVE" : edge >= 1.5 ? "STANDARD" : edge >= 0.8 ? "CONSERVATIVE" : "SKIP",
  };
}

/**
 * CHECK SAFE PLACEMENT
 * Ensure adding this arb won't breach exposure limits
 */
export async function canSafelyPlaceArb(
  proposedStakeTotalPerArb,
  currentOpenExposure,
  settings,
  currentOpenArbCount = 0
) {
  const maxExposurePct = Number(settings.max_bankroll_exposure_pct || 40);
  const maxOpenArbs = Number(settings.max_open_arbs || 8);
  const bankroll = Number(settings.bankroll) || 250000;

  const maxExposureAllowed = (bankroll * maxExposurePct) / 100;
  const totalExposureAfter = currentOpenExposure + proposedStakeTotalPerArb;

  const canPlaceByExposure = totalExposureAfter <= maxExposureAllowed;
  const canPlaceByCount = currentOpenArbCount < maxOpenArbs;

  return {
    canPlace: canPlaceByExposure && canPlaceByCount,
    reason:
      !canPlaceByExposure
        ? "exposure_limit_exceeded"
        : !canPlaceByCount
          ? "too_many_open_arbs"
          : "ok",
    currentExposure: currentOpenExposure,
    proposedAddition: proposedStakeTotalPerArb,
    totalExposureAfter,
    maxExposureAllowed,
    currentArbCount: currentOpenArbCount,
    maxArbsAllowed: maxOpenArbs,
    remainingExposureCapacity: Math.max(0, maxExposureAllowed - currentOpenExposure),
  };
}

/**
 * ODDS DRIFT DETECTION
 * Alert if live odds diverge too much from expected
 */
export function detectOddsDrift(originalOdds, liveOdds, tolerancePct = 1.0) {
  const original = Number(originalOdds);
  const live = Number(liveOdds);

  if (!Number.isFinite(original) || !Number.isFinite(live)) {
    return {
      drifted: true,
      reason: "invalid_odds_provided",
      originalOdds: original,
      liveOdds: live,
    };
  }

  const driftPct = Math.abs(live - original) / original * 100;
  const drifted = driftPct > tolerancePct;
  const improved = live > original;

  return {
    drifted,
    originalOdds: original.toFixed(2),
    liveOdds: live.toFixed(2),
    driftPct: driftPct.toFixed(2),
    tolerancePct,
    direction: improved ? "improved" : "worsened",
    shouldAbort: drifted,
  };
}

/**
 * CALCULATE TRUE ARBITRAGE PERCENTAGE
 * Sum of inverse odds tells you the real edge
 */
export function calculateTrueArbPercentage(outcomes) {
  if (!Array.isArray(outcomes) || outcomes.length === 0) {
    return { arbPct: 0, isArb: false, isStrongArb: false };
  }

  const inverseSum = outcomes.reduce((sum, outcome) => {
    const odds = Number(outcome.price || outcome.odds || 0);
    return sum + (odds > 1 ? 1 / odds : 0);
  }, 0);

  // True arb percentage
  const arbPct = Math.max(0, (1 - inverseSum) * 100);
  const isArb = arbPct > 0.1;
  const isStrongArb = arbPct >= 1.5; // 1.5%+ is very profitable

  return { arbPct, isArb, isStrongArb };
}

/**
 * HEDGE CALCULATION
 * If some legs fill and others don't, calculate protection hedge
 */
export function calculateHedgeStake(placedLegs, totalExpectedLegs, totalStakePerLeg) {
  if (placedLegs.length === 0) {
    return { shouldHedge: false, hedgeStake: 0 };
  }

  const fillPercentage = (placedLegs.length / totalExpectedLegs) * 100;
  const shouldHedge = placedLegs.length > 0 && placedLegs.length < totalExpectedLegs;

  if (!shouldHedge) {
    return { shouldHedge: false, hedgeStake: 0 };
  }

  // Hedge 50% of placement value to reduce risk
  const totalPlaced = placedLegs.reduce((sum, leg) => sum + Number(leg.stake || 0), 0);
  const hedgeStake = Math.round(totalPlaced * 0.5);

  return {
    shouldHedge: true,
    hedgePercentage: fillPercentage.toFixed(1),
    hedgeStake,
    reason: `${placedLegs.length}/${totalExpectedLegs} legs placed`,
    totalPlacedExposure: totalPlaced,
  };
}

/**
 * DAILY PERFORMANCE CALCULATOR
 * Track progress vs 5% daily growth target
 */
export function calculateDailyPerformance(startBankroll, currentBankroll, targetGrowthPct = 5.0) {
  const dailyGain = currentBankroll - startBankroll;
  const dailyGainPct = (dailyGain / startBankroll) * 100;
  const targetAmount = (startBankroll * targetGrowthPct) / 100;

  const onTrack = dailyGainPct >= targetGrowthPct;
  const achievement = (dailyGainPct / targetGrowthPct) * 100;

  return {
    startBankroll,
    currentBankroll,
    dailyGain: Math.round(dailyGain),
    dailyGainPct: dailyGainPct.toFixed(2),
    targetAmount: Math.round(targetAmount),
    targetGrowthPct,
    achievementPct: achievement.toFixed(1),
    onTrack,
    status: achievement > 150 ? "EXCEEDING" : achievement > 100 ? "ON_TRACK" : "BEHIND",
  };
}

/**
 * EMERGENCY STOP CHECK
 * Pause if daily losses exceed threshold
 */
export function checkEmergencyStop(startBankroll, currentBankroll, stopLossPct = -8.0) {
  const dailyLossPct = ((currentBankroll - startBankroll) / startBankroll) * 100;
  const triggered = dailyLossPct <= stopLossPct;

  return {
    triggered,
    dailyLossPct: dailyLossPct.toFixed(2),
    stopLossPct,
    message: triggered
      ? `EMERGENCY STOP: Daily loss ${dailyLossPct.toFixed(2)}% exceeds limit ${stopLossPct}%`
      : "Operating normally",
  };
}

/**
 * PARLAY OPTIMIZER
 * Identify 3+ leg high-value combinations
 */
export function optimizeParlay(outcomes, settings) {
  if (!Array.isArray(outcomes) || outcomes.length < 3) {
    return { isParlay: false, reason: "insufficient_legs" };
  }

  const minLegs = Number(settings.parlay_min_legs || 3);
  const maxLegs = Number(settings.parlay_max_legs || 5);

  if (outcomes.length < minLegs || outcomes.length > maxLegs) {
    return { isParlay: false, reason: "outside_leg_range" };
  }

  const { arbPct, isStrongArb } = calculateTrueArbPercentage(outcomes);

  if (arbPct < 0.8) {
    return { isParlay: false, reason: "insufficient_edge" };
  }

  const combinedOdds = outcomes.reduce((prod, o) => prod * Number(o.odds || o.price || 1), 1);
  const parlayBonus = Math.pow(1.12, outcomes.length - 2); // Exponential bonus

  return {
    isParlay: true,
    legs: outcomes.length,
    combinedOdds: combinedOdds.toFixed(2),
    arbPct: arbPct.toFixed(2),
    isStrongArb,
    parlayBonus: parlayBonus.toFixed(2),
    recommendation: arbPct >= 2.0 ? "HIGH_VALUE" : arbPct >= 1.5 ? "STRONG" : "STANDARD",
  };
}

export default {
  fetchRiskSettings,
  getDefaultRiskSettings,
  calculateOptimalStake,
  canSafelyPlaceArb,
  detectOddsDrift,
  calculateTrueArbPercentage,
  calculateHedgeStake,
  calculateDailyPerformance,
  checkEmergencyStop,
  optimizeParlay,
};