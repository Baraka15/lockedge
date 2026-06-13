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
const ARB_POLL_MS = 3500;           // Faster polling
const KEEPALIVE_MS = 10 * 60 * 1000;

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
  if (consecutiveFailures >= 3) {
    mode = "paused";
    log.error(`Auto-paused after 3 failures`, { reason });
    await pushHeartbeat("paused", { reason: "auto_pause", failures: consecutiveFailures });
    await notify({ kind: "auto_pause", title: "Bot Auto-Paused", body: reason });
  }
}

// ==================== MAIN ARB PROCESSOR ====================
async function processArb(arb) {
  log.info("Processing", { arbId: arb.id, event: arb.event_name, edge: arb.total_arb_percent });

  const settings = await fetchRiskSettings();
  const edgePct = Number(arb.total_arb_percent || 0);

  if (!settings?.auto_stake_enabled) return;
  if (edgePct < Number(settings.min_edge_pct ?? 0.8)) {
    await ackArb(arb.id);
    return;
  }

  // Exposure check
  const proposedTotal = arb.outcomes?.reduce((sum, o) => sum + (Number(o.stake) || 0), 0) || 0;
  if (!canPlaceArb(settings, proposedTotal)) {
    log.warn("Exposure limit reached, skipping", { arbId: arb.id });
    await ackArb(arb.id);
    return;
  }

  const outcomes = Array.isArray(arb.outcomes) ? arb.outcomes : [];
  const legs = outcomes.map(o => ({
    ...o,
    bm: getBM(o.bookmaker),
    legOdds: Number(o.price ?? o.odds)
  }));

  // Skip if any bookmaker not supported
  if (legs.some(l => !l.bm)) {
    log.warn("Unsupported bookmaker(s)", { arbId: arb.id });
    await ackArb(arb.id);
    return;
  }

  const session = await createBetSession({ arb_id: arb.id, total_legs: legs.length });

  const placed = [];
  let failedCount = 0;

  // Place legs (parallel with timeout)
  const tasks = legs.map((leg, i) => {
    const stake = sizeStake({
      legOdds: leg.legOdds,
      edgePct,
      settings,
      totalLegs: legs.length
    }) || Number(leg.stake || 0);

    if (stake <= 0) return Promise.resolve({ failed: true });

    return placeLeg(session, leg.bm, {
      arb_id: arb.id,
      outcome: leg.outcome,
      stake,
      odds: leg.legOdds,
      event_url: leg.event_url,
      outcome_selector: leg.outcome_selector,
      outcome_label: leg.outcome_label,
      settings
    }).then(res => ({ i, res, leg, stake }))
      .catch(err => ({ i, res: { result: "failed" }, leg, stake }));
  });

  const results = await Promise.allSettled(tasks);

  for (const r of results) {
    const v = r.status === "fulfilled" ? r.value : null;
    if (!v || v.res.result !== "success") {
      failedCount++;
      continue;
    }
    placed.push({ ...v.leg, stake: v.stake });
    consecutiveFailures = 0;
  }

  // Update session & hedge if partial
  if (failedCount > 0 && placed.length > 0) {
    await placeHedge(session, placed, settings);
  }

  await updateBetSession(session.id, {
    status: failedCount === 0 ? "complete" : "partial",
    placed_legs: placed.length,
    failed_legs: failedCount
  });

  await ackArb(arb.id);
  log.info(`Arb ${arb.id} finished`, { placed: placed.length, failed: failedCount });
}

// Keep the rest of your original functions (placeLeg, placeHedge, command handling, loops, etc.)
// ... (you can keep them as they are, or I can optimize them next)

async function main() {
  log.info("🚀 Lockedge Bot v2 - Advanced Staking Active");
  await pushHeartbeat(mode);

  // ... keep your existing loops and signal handlers
  await Promise.all([
    commandLoop(),
    heartbeatLoop(),
    arbLoop(),
    keepAliveLoop(),
    startBalanceSync({ shouldStop: () => stopping })
  ]);
}

main().catch(e => {
  log.error("Fatal error", e);
  process.exit(1);
});
