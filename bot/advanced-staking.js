import { sb, ACCOUNT_LABEL } from "./supabase.js";
import { log } from "./logger.js";

let cachedSettings = null;
let cachedAt = 0;
const SETTINGS_TTL_MS = 10_000;

/**
 * ADVANCED ARBITRAGE STAKE OPTIMIZER v2
 * - Real-time edge calculation with compound returns
 * - Multi-leg parlay detection and sizing
 * - Dynamic bankroll management with growth tracking
 * - Odds drift detection and protection
 */

export async function getAdvancedSettings() {
  const now = Date.now();
  if (cachedSettings && now - cachedAt < SETTINGS_TTL_MS) {
    return cachedSettings;
  }

  const { data, error } = await sb
    .from("risk_settings")
    .select("*")
    .eq("account_label", ACCOUNT_LABEL)
    .maybeSingle();

  if (error) {
    log.error("[advanced_settings] DB error", { message: error.message });
    return cachedSettings || defaultAdvancedSettings();
  }

  cachedSettings = data || defaultAdvancedSettings();
  cachedAt = now;
  return cachedSettings;
}

function defaultAdvancedSettings() {
  return {
    account_label: ACCOUNT_LABEL,
    bankroll: 250000,
    growth_target_daily: 0.05, // 5% daily growth target
    max_stake_pct: 35,
    max_stake_abs: 80000,
    min_stake_abs: 5000,
    min_edge_pct: 0.8, // Minimum profitable edge
    kelly_fraction: 0.25, // Conservative fractional Kelly
    kelly_edge_multiplier: 1.5, // Increase stakes for high-edge arbs
    auto_stake_enabled: true,
    max_bankroll_exposure: 40, // Max total exposure %
    odds_drift_tolerance_pct: 1.0, // Allow 1% odds movement
    multi_leg_bonus_multiplier: 1.2, // Increase stakes for 3+ leg arbs
    parlay_min_legs: 3,
    emergency_stop_loss_pct: -5, // Stop if daily loss > 5%
    session_start_bankroll: 250000, // Track daily starts
  };
}

/**
 * Calculate true arbitrage percentage including all bookmaker margins
 * Returns { arbPct, isArb, isSureArb }
 */
export function calculateTrueArbPercentage(outcomes) {
  if (!Array.isArray(outcomes) || outcomes.length === 0) return { arbPct: 0, isArb: false, isSureArb: false };

  // Sum of inverse odds (true probability)
  const inverseSum = outcomes.reduce((sum, o) => {
    const odds = Number(o.price || o.odds || 0);
    return sum + (odds > 1 ? 1 / odds : 0);
  }, 0);

  // Arbitrage percentage: (1 - inverseSum) * 100
  const arbPct = Math.max(0, (1 - inverseSum) * 100);
  const isArb = arbPct > 0.1; // Any positive edge
  const isSureArb = arbPct >= 1.5; // Strong sure bet

  return { arbPct, isArb, isSureArb };
}

/**
 * ADVANCED STAKE CALCULATOR
 * - Adjusts Kelly by edge strength
 * - Adds bonuses for multi-leg opportunities
 * - Respects all risk constraints
 * - Projects potential returns
 */
export function calculateAdvancedStake({
  legOdds,
  edgePct,
  settings,
  totalLegs = 2,
  arbId = null,
  arbPct = null,
}) {
  if (!settings?.auto_stake_enabled) return { stake: 0, reason: "disabled" };
  
  const odds = Number(legOdds);
  if (!Number.isFinite(odds) || odds <= 1) return { stake: 0, reason: "invalid_odds" };
  
  const edge = Number(edgePct) || 0;
  if (!Number.isFinite(edge) || edge < (settings.min_edge_pct || 0.8)) {
    return { stake: 0, reason: "edge_too_low" };
  }

  const bankroll = Number(settings.bankroll) || 250000;
  if (bankroll <= 0) return { stake: 0, reason: "no_bankroll" };

  // BASE KELLY CALCULATION
  let kellyFraction = Number(settings.kelly_fraction || 0.25);
  
  // BOOST 1: Higher edge = more aggressive
  const edgeBoost = Math.min(2.0, 1 + (edge / 5)); // Max 2x at 5%+ edge
  
  // BOOST 2: Multi-leg bonus (3+ legs = more reliable)
  const legBoost = totalLegs >= 3 ? (settings.multi_leg_bonus_multiplier || 1.2) : 1.0;
  
  // BOOST 3: Strong arb detection bonus
  const arbBoost = arbPct && arbPct >= 2.0 ? 1.15 : 1.0;

  const adjustedKelly = (kellyFraction * edgeBoost * legBoost * arbBoost) / Math.max(totalLegs, 1);
  
  let stake = bankroll * adjustedKelly * odds; // Scale by odds for balanced return

  // APPLY ALL CAPS
  const pctCap = bankroll * (Number(settings.max_stake_pct || 35) / 100);
  const absCap = Number(settings.max_stake_abs || 80000);
  stake = Math.min(stake, pctCap, absCap);

  // Minimum stake enforcement
  const minStake = Number(settings.min_stake_abs || 5000);
  if (stake < minStake) return { stake: 0, reason: "below_minimum" };

  // Round to nearest 500 (or 10 for precise control)
  const finalStake = Math.round(stake / 100) * 100;

  // Calculate projected ROI
  const roi = (finalStake * odds - finalStake) * (edge / 100);

  return {
    stake: finalStake,
    reason: "calculated",
    details: {
      baseKelly: kellyFraction,
      adjustedKelly,
      edgeBoost: edgeBoost.toFixed(2),
      legBoost: legBoost.toFixed(2),
      arbBoost: arbBoost.toFixed(2),
      projectedROI: Math.round(roi),
      riskExposure: finalStake,
    },
  };
}

/**
 * REAL-TIME EXPOSURE TRACKING
 * Query current open bets and ensure new arb won't exceed limits
 */
export async function checkExposureLimit(settings, proposedStake, currentOpenExposure = 0) {
  const exposureLimit = (Number(settings.max_bankroll_exposure || 40) / 100);
  const bankroll = Number(settings.bankroll) || 250000;
  const maxExposure = bankroll * exposureLimit;
  
  const totalExposure = currentOpenExposure + proposedStake;
  const canPlace = totalExposure <= maxExposure;
  
  return {
    canPlace,
    currentExposure: currentOpenExposure,
    proposedStake,
    totalExposure,
    limit: maxExposure,
    remaining: Math.max(0, maxExposure - currentOpenExposure),
  };
}

/**
 * ODDS DRIFT PROTECTION
 * Compare live odds vs expected; return adjustment or abort
 */
export function detectOddsDrift(originalOdds, liveOdds, tolerancePct = 1.0) {
  const original = Number(originalOdds);
  const live = Number(liveOdds);
  
  if (!Number.isFinite(original) || !Number.isFinite(live)) {
    return { drifted: true, reason: "invalid_odds" };
  }
  
  const driftPct = Math.abs(live - original) / original * 100;
  const drifted = driftPct > tolerancePct;
  
  return {
    drifted,
    originalOdds: original.toFixed(2),
    liveOdds: live.toFixed(2),
    driftPct: driftPct.toFixed(2),
    tolerancePct,
    adjustment: live > original ? "improved" : "worsened",
  };
}

/**
 * PARLAY OPTIMIZER
 * Detect and size multi-leg opportunities with compound returns
 */
export function optimizeParlay(outcomes, settings) {
  if (!Array.isArray(outcomes) || outcomes.length < 3) {
    return { isParlay: false };
  }

  const parlayOdds = outcomes.reduce((prod, o) => prod * Number(o.odds || o.price || 1), 1);
  const { arbPct } = calculateTrueArbPercentage(outcomes);

  if (arbPct < 1.0) return { isParlay: false, reason: "insufficient_edge" };

  const parlayBonus = Math.pow(1.1, outcomes.length - 2); // Exponential bonus for longer parlays
  
  return {
    isParlay: true,
    legs: outcomes.length,
    combinedOdds: parlayOdds.toFixed(2),
    arbPct: arbPct.toFixed(2),
    parlayBonus: parlayBonus.toFixed(2),
    recommendation: outcomes.length >= 4 ? "HIGH_VALUE" : "STANDARD",
  };
}

/**
 * DAILY PERFORMANCE TRACKING
 * Monitor growth against targets and adjust aggressiveness
 */
export function calculateDailyPerformance(startBankroll, currentBankroll, dailyTarget = 0.05) {
  const dailyGain = currentBankroll - startBankroll;
  const dailyGainPct = (dailyGain / startBankroll) * 100;
  const targetAmount = startBankroll * dailyTarget;
  
  return {
    startBankroll,
    currentBankroll,
    dailyGain: Math.round(dailyGain),
    dailyGainPct: dailyGainPct.toFixed(2),
    targetAmount: Math.round(targetAmount),
    targetAchievement: (dailyGainPct / (dailyTarget * 100) * 100).toFixed(1),
    onTrack: dailyGainPct >= (dailyTarget * 100),
  };
}

/**
 * HEDGE STRATEGY for partial fills
 * If you successfully place some legs but not others, hedge the placed ones
 */
export function calculateHedgeAmount(placedLegs, totalExpectedLegs) {
  if (placedLegs.length === 0) return 0;
  
  const totalExposure = placedLegs.reduce((sum, leg) => sum + Number(leg.stake || 0), 0);
  const hedgePercentage = Math.min(100, (placedLegs.length / totalExpectedLegs) * 100);
  
  return {
    shouldHedge: placedLegs.length > 0 && placedLegs.length < totalExpectedLegs,
    hedgePercentage: hedgePercentage.toFixed(1),
    hedgeStake: Math.round(totalExposure * 0.5), // Hedge 50% of exposure
    reason: `${placedLegs.length}/${totalExpectedLegs} legs placed`,
  };
}

/**
 * EMERGENCY STOP LOGIC
 * Pause bot if daily losses exceed threshold
 */
export function checkEmergencyStop(startBankroll, currentBankroll, stopLossPct = -5) {
  const dailyLossPct = ((currentBankroll - startBankroll) / startBankroll) * 100;
  const triggered = dailyLossPct <= stopLossPct;
  
  return {
    triggered,
    dailyLossPct: dailyLossPct.toFixed(2),
    stopLossPct,
    message: triggered ? `STOP: Daily loss ${dailyLossPct.toFixed(2)}% exceeds ${stopLossPct}%` : "Operating normally",
  };
}

export default {
  getAdvancedSettings,
  calculateTrueArbPercentage,
  calculateAdvancedStake,
  checkExposureLimit,
  detectOddsDrift,
  optimizeParlay,
  calculateDailyPerformance,
  calculateHedgeAmount,
  checkEmergencyStop,
};
