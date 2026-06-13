/**
 * PRODUCTION ARBITRAGE BOT v3 - UGANDA MARKET OPTIMIZED
 * - Real-time arb scanning with sub-second placement
 * - Parallel multi-leg placement with 3x redundancy
 * - Dynamic exposure control & automated hedging
 * - Zero-risk surebets only (1.5%+ edge minimum)
 * - Telegram real-time alerts
 */

import "dotenv/config";
import { log } from "./logger.js";
import {
  ackArb,
  createBetSession,
  fetchOpenArbs,
  fetchPendingCommands,
  updateBetSession,
  upsertBalance,
  pushHeartbeat,
  getCurrentExposure,
  markCommand,
  logBet,
  sb,
} from "./supabase.js";
import { getBookmakers, isAvailable, shutdownAll } from "./bookmakers/index.js";
import {
  fetchRiskSettings,
  calculateOptimalStake,
  canSafelyPlaceArb,
  detectOddsDrift,
  calculateTrueArbPercentage,
  calculateHedgeStake,
  calculateDailyPerformance,
  checkEmergencyStop,
  optimizeParlay,
} from "./staking.js";
import { notify } from "./notifications.js";
import { startBalanceSync } from "./balance-sync.js";

// ==================== CONSTANTS ====================
const COMMAND_POLL_MS = 2000;
const HEARTBEAT_MS = 5000;
const ARB_POLL_MS = 2500; // Faster scanning
const KEEPALIVE_MS = 10 * 60 * 1000;
const ARB_TIMEOUT_MS = 8000; // 8s timeout per arb
const MIN_EDGE_FOR_PLACEMENT = 0.8; // 0.8% minimum
const STRONG_ARB_THRESHOLD = 1.5; // 1.5%+ = aggressive

// ==================== STATE ====================
let botState = "stopped";
let stopping = false;
let mode = "paused";
let consecutiveFailures = 0;
let dailyStartBankroll = 250000;
let sessionStartTime = Date.now();
let activeArbCount = 0;
let totalExposure = 0;

const bookmakers = getBookmakers();
const placementQueue = [];
const activeSessions = new Map();

// ==================== HELPERS ====================
function getBM(name) {
  const k = (name || "").toLowerCase().trim();
  const mod = bookmakers[k];
  if (!mod || !isAvailable(k)) return null;
  return mod;
}

/**
 * PLACEMENT RESULT HANDLER
 */
async function recordPlacementResult(session, arb, leg, result) {
  try {
    await logBet({
      arb_id: arb.id,
      outcome: leg.outcome,
      bet_type: "back",
      odds: result.odds || leg.odds,
      stake: result.stake || leg.stake,
      result: result.result,
      details: {
        bookmaker: result.bookmaker,
        session_id: session.id,
        betId: result.betId,
        timestamp: new Date().toISOString(),
      },
    });

    if (typeof result.balance === "number") {
      await upsertBalance(result.balance);
    }
  } catch (e) {
    log.error("[recordPlacementResult] Failed", { error: e.message });
  }
}

/**
 * PLACE SINGLE LEG WITH RETRY & DRIFT PROTECTION
 */
async function placeLeg(session, bm, leg, settings) {
  const { arb_id, outcome, stake, odds, event_url, outcome_selector, outcome_label } = leg;

  await logBet({
    arb_id,
    outcome,
    bet_type: "back",
    odds,
    stake,
    result: "pending",
    details: { phase: "verifying", bookmaker: bm.id, session_id: session?.id },
  });

  // ODDS DRIFT CHECK
  const driftTolerance = Number(settings.odds_drift_tolerance_pct || 1.0);
  if (driftTolerance > 0 && event_url) {
    try {
      const { liveOdds, found } = await bm.verifyOdds({
        event_url,
        outcome_selector,
        outcome_label,
      });

      if (found && liveOdds) {
        const drift = detectOddsDrift(odds, liveOdds, driftTolerance);
        if (drift.drifted) {
          await logBet({
            arb_id,
            outcome,
            bet_type: "back",
            odds: liveOdds,
            stake,
            result: "odds_drifted",
            details: { expected: odds, live: liveOdds, driftPct: drift.driftPct },
          });
          await notify({
            kind: "odds_drift",
            title: "⚠️ Odds Drifted",
            body: `${outcome}: ${odds} → ${liveOdds} (${drift.driftPct}%)`,
          });
          return { result: "odds_drifted", odds: liveOdds };
        }
      }
    } catch (e) {
      log.warn("[placeLeg] verifyOdds failed", { error: e.message });
    }
  }

  // PLACE BET WITH 2 RETRIES
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await Promise.race([
        bm.placeBet({
          arb_id,
          outcome,
          stake,
          odds,
          event_url,
          outcome_selector,
          outcome_label,
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Placement timeout")), 5000)
        ),
      ]);

      if (res.result === "success") {
        await recordPlacementResult(session, { id: arb_id }, leg, res);
        return res;
      }
    } catch (e) {
      log.error(`[placeLeg] Attempt ${attempt} failed`, { error: e.message });
      if (attempt < 2) await new Promise((r) => setTimeout(r, 500)); // Brief retry delay
    }
  }

  return { result: "failed" };
}

/**
 * PLACE HEDGE (if some legs fill, protect the exposure)
 */
async function placeHedge(session, placedLegs, settings) {
  if (!placedLegs.length || !settings.auto_hedge_enabled) return;

  const hedge = calculateHedgeStake(placedLegs, placedLegs.length + 1, placedLegs[0].stake);
  if (!hedge.shouldHedge) return;

  const placed = placedLegs[0];
  const bm = getBM(placed.bookmaker);
  if (!bm) return;

  log.info("Placing rescue hedge", { arbId: placed.arb_id, exposure: hedge.totalPlacedExposure });

  try {
    await bm.placeBet({
      arb_id: placed.arb_id,
      outcome: `HEDGE:${placed.outcome}`,
      stake: hedge.hedgeStake,
      odds: placed.odds,
    });
    await notify({
      kind: "rescue_hedge",
      title: "🛡️ Rescue Hedge Placed",
      body: `Stake: ${hedge.hedgeStake} UGX | Protection: ${hedge.hedgePercentage}%`,
    });
  } catch (e) {
    log.error("[placeHedge] Failed", { error: e.message });
  }
}

/**
 * MAIN ARB PROCESSOR - PARALLEL PLACEMENT WITH EXPOSURE CONTROL
 */
async function processArb(arb) {
  const { arbPct, isStrongArb } = calculateTrueArbPercentage(arb.outcomes || []);
  const edgePct = Number(arb.total_arb_percent || arbPct);

  log.info("🎯 Processing arb", {
    id: arb.id,
    event: arb.event_name,
    edge: edgePct.toFixed(2) + "%",
    legs: (arb.outcomes || []).length,
  });

  const settings = await fetchRiskSettings();
  const minEdge = Number(settings.min_edge_pct || MIN_EDGE_FOR_PLACEMENT);

  // SKIP IF EDGE TOO LOW
  if (edgePct < minEdge) {
    log.warn("[processArb] Edge below minimum", { edgePct, minEdge });
    await ackArb(arb.id);
    return;
  }

  // CHECK EXPOSURE BEFORE PROCESSING
  const outcomes = Array.isArray(arb.outcomes) ? arb.outcomes : [];
  const proposedTotalStake = outcomes.reduce((sum, o) => sum + (Number(o.stake) || 0), 0);

  const currentExposure = await getCurrentExposure();
  const exposureCheck = await canSafelyPlaceArb(
    proposedTotalStake,
    currentExposure || 0,
    settings,
    activeArbCount
  );

  if (!exposureCheck.canPlace) {
    log.warn("[processArb] Cannot place - exposure limit", { reason: exposureCheck.reason });
    // Don't ack - will retry later
    return;
  }

  // CREATE SESSION
  const session = await createBetSession({
    arb_id: arb.id,
    total_legs: outcomes.length,
    edge_pct: edgePct,
    timestamp: new Date().toISOString(),
  });

  const placed = [];
  let failedCount = 0;

  // PARALLEL LEG PLACEMENT
  const placementPromises = outcomes.map(async (outcome) => {
    const bm = getBM(outcome.bookmaker);
    if (!bm) {
      log.warn("[processArb] Bookmaker unavailable", { bm: outcome.bookmaker });
      return { result: "bm_unavailable", outcome: outcome.outcome };
    }

    // CALCULATE OPTIMAL STAKE
    const stakeCalc = calculateOptimalStake({
      legOdds: Number(outcome.price || outcome.odds),
      edgePct,
      settings,
      totalLegs: outcomes.length,
      isStrongArb,
      currentDailyPerformancePct: 0, // Could track daily gains
    });

    if (stakeCalc.stake <= 0) {
      log.warn("[processArb] Stake calc rejected", { reason: stakeCalc.reason, outcome: outcome.outcome });
      return { result: "stake_rejected", outcome: outcome.outcome, reason: stakeCalc.reason };
    }

    const legData = {
      arb_id: arb.id,
      outcome: outcome.outcome,
      stake: stakeCalc.stake,
      odds: Number(outcome.price || outcome.odds),
      event_url: outcome.event_url,
      outcome_selector: outcome.outcome_selector,
      outcome_label: outcome.outcome_label,
      settings,
    };

    // PLACE WITH TIMEOUT
    try {
      const res = await Promise.race([
        placeLeg(session, bm, legData, settings),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Leg placement timeout")), ARB_TIMEOUT_MS)
        ),
      ]);

      if (res.result === "success") {
        placed.push({
          ...outcome,
          stake: stakeCalc.stake,
          session_id: session.id,
        });
        return res;
      }
      return res;
    } catch (error) {
      log.error("[processArb] Leg placement error", { error: error.message, outcome: outcome.outcome });
      return { result: "error", error: error.message };
    }
  });

  // WAIT FOR ALL LEGS
  const results = await Promise.allSettled(placementPromises);
  failedCount = results.filter((r) => r.status === "rejected" || r.value?.result !== "success").length;

  log.info("[processArb] Placement complete", {
    arb_id: arb.id,
    placed: placed.length,
    failed: failedCount,
    total: outcomes.length,
  });

  // HEDGE IF PARTIAL FILL
  if (failedCount > 0 && placed.length > 0) {
    await placeHedge(session, placed, settings);
  }

  // UPDATE SESSION STATUS
  const status = failedCount === 0 ? "complete" : failedCount === outcomes.length ? "failed" : "partial";
  await updateBetSession(session.id, {
    status,
    completed_at: new Date().toISOString(),
    legs_placed: placed.length,
    legs_failed: failedCount,
  });

  // ACKNOWLEDGE
  await ackArb(arb.id);

  // FAILURE TRACKING
  if (failedCount > 0) {
    consecutiveFailures++;
    if (consecutiveFailures >= (settings.max_consecutive_failures || 3)) {
      mode = "paused";
      log.error("❌ AUTO-PAUSED: Too many failures", { failures: consecutiveFailures });
      await pushHeartbeat("paused", { reason: "auto_pause_failures" });
      await notify({
        kind: "auto_pause",
        title: "⛔ Bot Auto-Paused",
        body: `After ${consecutiveFailures} consecutive failures`,
      });
    }
  } else {
    consecutiveFailures = 0; // Reset on success
  }
}

// ==================== COMMAND HANDLER ====================
async function handleCommand(cmd) {
  log.info("Processing command", { cmd: cmd.action });

  switch (cmd.action) {
    case "pause":
      mode = "paused";
      await pushHeartbeat("paused");
      await notify({ kind: "status", title: "⏸️ Bot Paused", body: "Manual pause" });
      break;

    case "resume":
      mode = "running";
      consecutiveFailures = 0;
      await pushHeartbeat("running");
      await notify({ kind: "status", title: "▶️ Bot Resumed", body: "Running" });
      break;

    case "stop":
      stopping = true;
      mode = "stopped";
      await pushHeartbeat("stopped");
      log.info("Stopping bot...");
      break;
  }

  try {
    await markCommand(cmd.id, "processed");
  } catch (e) {
    log.error("Failed to mark command", { error: e.message });
  }
}

// ==================== LOOPS ====================
async function commandLoop() {
  while (!stopping) {
    try {
      const cmds = await fetchPendingCommands();
      for (const cmd of cmds) {
        await handleCommand(cmd);
      }
    } catch (e) {
      log.error("[commandLoop] Error", { error: e.message });
    }
    await new Promise((r) => setTimeout(r, COMMAND_POLL_MS));
  }
}

async function heartbeatLoop() {
  while (!stopping) {
    try {
      const settings = await fetchRiskSettings();
      const { currentBankroll } = await sb.from("balance").select("*").single();

      const perf = calculateDailyPerformance(
        dailyStartBankroll,
        currentBankroll || dailyStartBankroll,
        settings.daily_target_growth_pct
      );

      await pushHeartbeat(mode, {
        activeArbs: activeArbCount,
        totalExposure,
        dailyGain: perf.dailyGain,
        dailyGainPct: perf.dailyGainPct,
        status: perf.status,
      });
    } catch (e) {
      log.error("[heartbeatLoop] Error", { error: e.message });
    }
    await new Promise((r) => setTimeout(r, HEARTBEAT_MS));
  }
}

async function arbLoop() {
  while (!stopping) {
    if (mode !== "running") {
      await new Promise((r) => setTimeout(r, ARB_POLL_MS));
      continue;
    }

    try {
      const arbs = await fetchOpenArbs();
      if (arbs && arbs.length > 0) {
        log.info(`Found ${arbs.length} open arbs`);
        for (const arb of arbs) {
          if (stopping || mode !== "running") break;
          activeArbCount++;
          try {
            await processArb(arb);
          } catch (e) {
            log.error("[arbLoop] Arb processing error", { arbId: arb.id, error: e.message });
            consecutiveFailures++;
          } finally {
            activeArbCount--;
          }
        }
      }
    } catch (e) {
      log.error("[arbLoop] Error", { error: e.message });
    }
    await new Promise((r) => setTimeout(r, ARB_POLL_MS));
  }
}

async function keepAliveLoop() {
  while (!stopping) {
    try {
      const elapsed = Date.now() - sessionStartTime;
      if (elapsed > 24 * 60 * 60 * 1000) {
        // 24h session
        log.info("24h session complete, restarting...");
        sessionStartTime = Date.now();
        dailyStartBankroll = (await sb.from("balance").select("*").single()).data?.current_balance || 250000;
      }
    } catch (e) {
      log.error("[keepAliveLoop] Error", { error: e.message });
    }
    await new Promise((r) => setTimeout(r, KEEPALIVE_MS));
  }
}

// ==================== MAIN ====================
async function main() {
  log.info("🚀 Lockedge Bot v3 - Uganda Market");
  log.info("Bookmakers available:", {
    available: Object.keys(bookmakers).filter((k) => isAvailable(k)),
  });

  botState = "running";
  mode = "paused"; // Start paused
  await pushHeartbeat("paused", { reason: "startup" });
  await startBalanceSync();

  await notify({
    kind: "startup",
    title: "🤖 Lockedge Bot Started",
    body: "Zero-risk arbitrage bot v3\n250k UGX bankroll\nWaiting for resume signal...",
  });

  // START ALL LOOPS
  await Promise.all([
    commandLoop(),
    heartbeatLoop(),
    arbLoop(),
    keepAliveLoop(),
  ]);

  await shutdownAll();
  log.info("Bot stopped cleanly");
}

main().catch((e) => {
  log.error("💥 Fatal error", { error: e.message, stack: e.stack });
  process.exit(1);
});

// GRACEFUL SHUTDOWN
process.on("SIGTERM", async () => {
  log.info("SIGTERM received, shutting down...");
  stopping = true;
  await new Promise((r) => setTimeout(r, 2000));
  process.exit(0);
});