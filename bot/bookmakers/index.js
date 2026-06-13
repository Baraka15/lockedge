/**
 * BOOKMAKER REGISTRY
 * Uganda market: BetPawa, 22Bet, SportPesa, Betway
 * Each module must export: id, name, isConfigured, placeBet, verifyOdds, getBalance, shutdown
 */

import * as betpawa from "./betpawa.js";
import * as bet22 from "./bet22.js";
import * as sportpesa from "./sportpesa.js";
import * as betway from "./betway.js";

const all = [betpawa, bet22, sportpesa, betway];

/**
 * Get all bookmakers keyed by lowercase id
 * Only modules with env vars configured are "available" (non-null)
 * Returns map: { betpawa: {...}, bet22: {...}, sportpesa: {...}, betway: {...} }
 */
export function getBookmakers() {
  const map = {};
  for (const m of all) {
    if (m.isConfigured?.()) {
      map[m.id.toLowerCase()] = m;
    }
  }
  // Aliases
  if (map.bet22) map["22bet"] = map.bet22;
  return map;
}

/**
 * Check if a bookmaker is available (credentials present)
 */
export function isAvailable(bookmakerId) {
  const k = (bookmakerId || "").toLowerCase();
  const aliases = { "22bet": "bet22" };
  const normalized = aliases[k] || k;

  const bm = all.find((m) => m.id.toLowerCase() === normalized);
  return bm && bm.isConfigured?.() ? true : false;
}

/**
 * Shutdown all bookmakers
 */
export async function shutdownAll() {
  for (const m of all) {
    try {
      if (m.shutdown) await m.shutdown();
    } catch (e) {
      console.error(`[shutdownAll] ${m.id} shutdown error:`, e.message);
    }
  }
}

/**
 * Get active bookmakers list
 */
export function getActiveBookmakers() {
  return all
    .filter((m) => m.isConfigured?.())
    .map((m) => ({ id: m.id, name: m.name }));
}

export default {
  getBookmakers,
  isAvailable,
  shutdownAll,
  getActiveBookmakers,
};