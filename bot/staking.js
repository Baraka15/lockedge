import { sb, ACCOUNT_LABEL } from "./supabase.js";

let cached = null;
let cachedAt = 0;
const TTL_MS = 15_000;

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
    bankroll: 0,
    max_stake_pct: 2,
    max_stake_abs: 1000,
    min_stake_abs: 1,
    min_edge_pct: 1,
    kelly_fraction: 0.25,
    auto_stake_enabled: false,
  };
}

/**
 * Compute a stake for a single leg given the arb edge and the leg odds.
 * Uses fractional Kelly on the implied arbitrage edge, clamped by
 * absolute and bankroll-percentage caps. Returns 0 when the edge is
 * below the configured minimum.
 *
 *  edgePct          = (1 - sum(1/odds)) * 100   — the arb percent
 *  fairOddsForLeg   = legOdds / (1 - edgePct/100) approx
 */
export function sizeStake({ legOdds, edgePct, settings, totalLegs = 2 }) {
  if (!settings?.auto_stake_enabled) return null;
  if (!Number.isFinite(legOdds) || legOdds <= 1) return 0;
  if (!Number.isFinite(edgePct) || edgePct < (settings.min_edge_pct ?? 0)) return 0;

  const bankroll = Number(settings.bankroll) || 0;
  if (bankroll <= 0) return 0;

  // Fractional Kelly on the arb edge, spread across legs.
  const edge = edgePct / 100;
  const kelly = (edge * Number(settings.kelly_fraction || 0.25)) / Math.max(totalLegs, 1);
  const kellyStake = bankroll * kelly * legOdds; // scale by odds so each leg covers its share

  const pctCap = bankroll * (Number(settings.max_stake_pct || 0) / 100);
  let stake = Math.min(kellyStake, pctCap, Number(settings.max_stake_abs || Infinity));

  if (stake < Number(settings.min_stake_abs || 0)) return 0;
  return Math.floor(stake * 100) / 100;
}