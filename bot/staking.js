import { sb, ACCOUNT_LABEL } from "./supabase.js";

let cached = null;
let cachedAt = 0;
const TTL_MS = 12_000; // Refresh risk settings frequently

export async function getRiskSettings() {
  const now = Date.now();
  if (cached && now - cachedAt < TTL_MS) return cached;

  const { data, error } = await sb
    .from("risk_settings")
    .select("*")
    .eq("account_label", ACCOUNT_LABEL)
    .maybeSingle();

  if (error) {
    console.error("[risk_settings]", error.message);
    return cached ?? defaults();
  }

  cached = data ?? defaults();
  cachedAt = now;
  return cached;
}

function defaults() {
  return {
    account_label: ACCOUNT_LABEL,
    bankroll: 250000,           // ← Your current bankroll
    max_stake_pct: 35,          // Max % of bankroll per leg
    max_stake_abs: 80000,       // Hard cap per leg
    min_stake_abs: 5000,        // Minimum practical stake
    min_edge_pct: 0.8,          // Lower threshold = more volume
    kelly_fraction: 0.28,       // Balanced fractional Kelly (safe but aggressive)
    auto_stake_enabled: true,
    max_bankroll_exposure: 40,  // Max total exposure across all open arbs (%)
  };
}

/**
 * Advanced Dynamic Stake Calculator
 * - Uses fractional Kelly adjusted by edge strength
 * - Respects all risk limits
 * - Optimized for zero-risk surebets
 */
export function sizeStake({ legOdds, edgePct, settings, totalLegs = 2, arbId = null }) {
  if (!settings?.auto_stake_enabled) return null;
  if (!Number.isFinite(legOdds) || legOdds <= 1) return 0;
  if (!Number.isFinite(edgePct) || edgePct < (settings.min_edge_pct ?? 0.8)) return 0;

  const bankroll = Number(settings.bankroll) || 250000;
  if (bankroll <= 0) return 0;

  const edge = edgePct / 100;
  // Kelly adjusted by edge + spread across legs
  const kelly = (edge * Number(settings.kelly_fraction || 0.28)) / Math.max(totalLegs, 1);
  let stake = bankroll * kelly * legOdds;   // Scale by odds for balanced return

  // Apply caps
  const pctCap = bankroll * (Number(settings.max_stake_pct || 35) / 100);
  const absCap = Number(settings.max_stake_abs || 80000);
  stake = Math.min(stake, pctCap, absCap);

  // Minimum stake check
  if (stake < Number(settings.min_stake_abs || 5000)) return 0;

  // Round to nearest 10 UGX (practical for betting)
  return Math.round(stake / 10) * 10;
}

/**
 * Check if we can safely place this arb without exceeding total exposure
 */
export function canPlaceArb(settings, proposedTotalStake) {
  const exposureLimit = Number(settings.max_bankroll_exposure || 40) / 100;
  const bankroll = Number(settings.bankroll) || 250000;
  // TODO: In future, query current open exposure from DB
  return proposedTotalStake <= (bankroll * exposureLimit);
}
