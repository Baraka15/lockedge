import "dotenv/config";
import { log } from "./logger.js";
import {
  ackArb,
  createBetSession,
  fetchOpenArbs,
  fetchPendingCommands,
  fetchRiskSettings,
  logBet,
  markCommand,
  pushHeartbeat,
  updateBetSession,
  upsertBalance,
  sb,
} from "./supabase.js";
import { getBookmakers, isAvailable, shutdownAll } from "./bookmakers/index.js";
import { sizeStake, canPlaceArb } from "./staking.js";
import { notify } from "./notifications.js";
import { startBalanceSync } from "./balance-sync.js";

const COMMAND_POLL_MS = 2000;
const HEARTBEAT_MS = 5000;
const ARB_POLL_MS = 3500;
const KEEPALIVE_MS = 10 * 60 * 1000;
const AUTOPAUSE_THRESHOLD = 3;

let mode = "paused";
let stopping = false;
let consecutiveFailures = 0;
const bookmakers = getBookmakers();

function getBM(name) {
  const k = (name || "").toLowerCase().trim();
  const mod = bookmakers[k];
  if (!mod || !isAvailable(k)) return null;
  return mod;
}

async function bumpFailureAndMaybePause(reason) {
  consecutiveFailures++;
  if (consecutiveFailures >= AUTOPAUSE_THRESHOLD) {
    mode = "paused";
    log.error(`Auto-paused after ${AUTOPAUSE_THRESHOLD} consecutive failures`, { reason });
    await pushHeartbeat("paused", { reason: "auto_pause", failures: consecutiveFailures });
    await notify({ kind: "auto_pause", title: "Bot auto-paused", body: reason });
  }
}

async function placeLeg(session, bm, leg) {
  const { arb_id, outcome, stake, odds, event_url, outcome_selector, outcome_label, settings } = leg;
  
  await logBet({ arb_id, outcome, bet_type: "back", odds, stake, result: "pending",
    details: { phase: "verifying", bookmaker: bm.id, session_id: session?.id } });

  // Odds drift check
  const driftPct = Number(settings?.max_odds_drift_pct ?? 0.5);
  if (driftPct > 0 && event_url) {
    try {
      const { liveOdds, found } = await bm.verifyOdds({ event_url, outcome_selector, outcome_label });
      if (found && liveOdds) {
        const diffPct = Math.abs(liveOdds - Number(odds)) / Number(odds) * 100;
        if (diffPct > driftPct) {
          await logBet({ arb_id, outcome, bet_type: "back", odds: liveOdds, stake, result: "odds_drifted", details: { expected: odds, live: liveOdds, diffPct } });
          await notify({ kind: "odds_drift", title: "Odds drifted", body: `${outcome}: expected ${odds}, live ${liveOdds}` });
          return { result: "odds_drifted", odds: liveOdds };
        }
      }
    } catch (e) {
      log.warn("verifyOdds failed", { error: e.message });
    }
  }

  // Place bet with retry
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await bm.placeBet({ arb_id, outcome, stake, odds, event_url, outcome_selector, outcome_label });
      await logBet({ arb_id, outcome, bet_type: "back", odds: res.odds ?? odds, stake, result: res.result,
        details: { attempt, bookmaker: bm.id, session_id: session?.id, betId: res.betId } });
      if (typeof res.balance === "number") await upsertBalance(res.balance);
      return res;
    } catch (e) {
      log.error(`Bet attempt ${attempt} failed`, { error: e.message });
    }
  }
  return { result: "failed" };
}

async function placeHedge(session, placedLegs, settings) {
  if (!placedLegs.length) return;
  const placed = placedLegs[0];
  const bm = getBM(placed.bookmaker);
  if (!bm) return;
  log.warn("Placing rescue hedge", { outcome: placed.outcome });
  try {
    await bm.placeBet({ arb_id: placed.arb_id, outcome: `HEDGE:${placed.outcome}`, stake: placed.stake, odds: placed.odds });
    await notify({ kind: "rescue_hedge", title: "Rescue hedge placed" });
  } catch (e) {
    log.error("Hedge failed", e);
  }
}

// ==================== MAIN PROCESSOR ====================
async function processArb(arb) {
  log.info("Processing arb", { id: arb.id, event: arb.event_name, edge: arb.total_arb_percent });

  const settings = await fetchRiskSettings();
  const edgePct = Number(arb.total_arb_percent || 0);

  if (!settings?.auto_stake_enabled || edgePct < Number(settings.min_edge_pct ?? 0.8)) {
    await ackArb(arb.id);
    return;
  }

  const outcomes = Array.isArray(arb.outcomes) ? arb.outcomes : [];
  const proposedTotal = outcomes.reduce((sum, o) => sum + (Number(o.stake) || 0), 0);

  if (!canPlaceArb(settings, proposedTotal)) {
    log.warn("Exposure limit reached");
    await ackArb(arb.id);
    return;
  }

  const session = await createBetSession({ arb_id: arb.id, total_legs: outcomes.length });

  const placed = [];
  let failedCount = 0;

  for (const o of outcomes) {
    const bm = getBM(o.bookmaker);
    if (!bm) continue;

    const stake = sizeStake({
      legOdds: Number(o.price ?? o.odds),
      edgePct,
      settings,
      totalLegs: outcomes.length
    }) || Number(o.stake || 0);

    if (stake <= 0) continue;

    const res = await placeLeg(session, bm, {
      arb_id: arb.id,
      outcome: o.outcome,
      stake,
      odds: Number(o.price ?? o.odds),
      event_url: o.event_url,
      outcome_selector: o.outcome_selector,
      outcome_label: o.outcome_label,
      settings
    });

    if (res.result === "success") {
      placed.push({ ...o, stake });
    } else {
      failedCount++;
    }
  }

  if (failedCount > 0 && placed.length > 0) {
    await placeHedge(session, placed, settings);
  }

  await updateBetSession(session.id, { status: failedCount === 0 ? "complete" : "partial" });
  await ackArb(arb.id);
}

// Keep your original commandLoop, heartbeatLoop, arbLoop, keepAliveLoop, main() etc.
async function commandLoop() {
  while (!stopping) {
    try {
      const cmds = await fetchPendingCommands();
      for (const c of cmds) await handleCommand(c);   // Keep your original handleCommand
    } catch (e) {}
    await new Promise(r => setTimeout(r, COMMAND_POLL_MS));
  }
}

// ... (Copy your original handleCommand, heartbeatLoop, arbLoop, keepAliveLoop, main() from the file you have)

async function main() {
  log.info("🚀 Lockedge Bot Started - Advanced Staking v2");
  await pushHeartbeat(mode);
  // ... rest of your original main() function
}

main().catch(e => {
  log.error("Fatal", e);
});
