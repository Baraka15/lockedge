import * as betpawa from "./betpawa.js";
import * as betway from "./betway.js";
import * as sportybet from "./sportybet.js";

const all = [betpawa, betway, sportybet];

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
  if (k === "betway") return !!process.env.BETWAY_USERNAME && !!process.env.BETWAY_PASSWORD;
  if (k === "sportybet") return !!process.env.SPORTYBET_PHONE && !!process.env.SPORTYBET_PASSWORD;
  return false;
}

export async function shutdownAll() {
  for (const m of all) {
    try { await m.shutdown(); } catch {}
  }
}