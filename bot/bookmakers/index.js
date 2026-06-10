import * as betpawa from "./betpawa.js";
import * as bet22 from "./bet22.js";

// Uganda market: only Betpawa and 22Bet are active. Betway/Sportybet
// modules remain in the repo for reference but are not registered.
const all = [betpawa, bet22];

/**
 * Returns implementation modules keyed by lowercase id. Only modules whose
 * required env vars are present are considered "available" — others are
 * registered but their methods throw, so processArb skips them with a warning.
 */
export function getBookmakers() {
  const map = {};
  for (const m of all) map[m.id.toLowerCase()] = m;
  return map;
}

export function isAvailable(bookmakerId) {
  const k = (bookmakerId || "").toLowerCase();
  if (k === "betpawa") {
    return !!(process.env.BETPAWA_PHONE || process.env.BETPAWA_EMAIL) && !!process.env.BETPAWA_PASSWORD;
  }
  if (k === "bet22" || k === "22bet") {
    return !!process.env.BET22_USERNAME && !!process.env.BET22_PASSWORD;
  }
  return false;
}

export async function shutdownAll() {
  for (const m of all) {
    try { await m.shutdown(); } catch {}
  }
}