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
} from "./supabase.js";
import { getBookmakers, isAvailable, shutdownAll } from "./bookmakers/index.js";
import { sizeStake } from "./staking.js";
import { notify } from "./notifications.js";

const COMMAND_POLL_MS = 2000;
const HEARTBEAT_MS = 5000;
const ARB_POLL_MS = 4000;
const KEEPALIVE_MS = 10 * 60 * 1000; // 10min
const AUTOPAUSE_THRESHOLD = 3;

let mode = "paused"; // online | paused | error
let stopping = false;
let consecutiveFailures = 0;
const bookmakers = getBookmakers();

// --------- helpers ---------
function getBM(name) {
  const k = (name || "").toLowerCase();
  const mod = bookmakers[k];
  if (!mod) return null;
  if (!isAvailable(k)) return null;
  return mod;
}

async function bumpFailureAndMaybePause(reason) {
  consecutiveFailures++;
  if (consecutiveFailures >= AUTOPAUSE_THRESHOLD) {
    mode = "paused";
    log.error(`Auto-paused after ${AUTOPAUSE_THRESHOLD} consecutive failures`, { reason });
    await pushHeartbeat("paused", { reason: "auto_pause", failures: consecutiveFailures });
    await notify({ kind: "auto_pause", title: "Bot auto-paused",
      body: `${AUTOPAUSE_THRESHOLD} consecutive failures. Reason: ${reason}` });
  }
}

async function placeLeg(session, bm, leg) {
  const { arb_id, outcome, stake, odds, event_url, outcome_selector, outcome_label, settings } = leg;
  // 1) Odds drift verification
  const driftPct = Number(settings?.max_odds_drift_pct ?? 0.5);
  if (driftPct > 0 && event_url) {
    try {
      const { liveOdds, found } = await bm.verifyOdds({ event_url, outcome_selector, outcome_label });
      if (found && liveOdds) {
        const diffPct = Math.abs(liveOdds - Number(odds)) / Number(odds) * 100;
        if (diffPct > driftPct) {
          await logBet({ arb_id, outcome, bet_type: "back", odds: liveOdds, stake,
            result: "odds_drifted", details: { expected: odds, live: liveOdds, diffPct } });
          await notify({ kind: "odds_drift", title: "Odds drifted — leg aborted",
            body: `${outcome}: expected ${odds}, live ${liveOdds} (${diffPct.toFixed(2)}%)`, payload: { arb_id } });
          return { result: "odds_drifted", odds: liveOdds };
        }
      }
    } catch (e) {
      log.warn("verifyOdds failed (continuing)", { error: e.message });
    }
  }

  // 2) Place with one retry
  let lastErr = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await bm.placeBet({ arb_id, outcome, stake, odds, event_url, outcome_selector, outcome_label });
      await logBet({ arb_id, outcome, bet_type: "back", odds: res.odds ?? odds, stake,
        result: res.result, details: { attempt, bookmaker: bm.id, session_id: session?.id } });
      if (typeof res.balance === "number") await upsertBalance(res.balance);
      return res;
    } catch (e) {
      lastErr = e;
      log.error(`Bet attempt ${attempt} failed`, { error: e.message, outcome });
    }
  }
  await logBet({ arb_id, outcome, bet_type: "back", odds, stake, result: "failed",
    details: { error: lastErr?.message ?? "unknown", bookmaker: bm.id, session_id: session?.id } });
  return { result: "failed" };
}

async function placeHedge(session, placedLegs, settings) {
  // Find the placed leg and place a rescue hedge: bet the OPPOSITE outcome on
  // the same bookmaker at the same stake to neutralize exposure.
  if (!placedLegs.length) return;
  const placed = placedLegs[0];
  const bm = getBM(placed.bookmaker);
  if (!bm) {
    log.warn("Cannot hedge — bookmaker unavailable", { bookmaker: placed.bookmaker });
    return;
  }
  log.warn("Placing RESCUE HEDGE", { leg: placed.outcome, stake: placed.stake });
  try {
    const res = await bm.placeBet({
      arb_id: placed.arb_id, outcome: `HEDGE:${placed.outcome}`, stake: placed.stake, odds: placed.odds,
      event_url: placed.event_url, outcome_label: placed.hedge_label, outcome_selector: placed.hedge_selector,
    });
    await logBet({ arb_id: placed.arb_id, outcome: placed.outcome, bet_type: "hedge",
      odds: res.odds ?? placed.odds, stake: placed.stake, result: res.result,
      details: { rescue: true, session_id: session?.id, bookmaker: placed.bookmaker } });
    await notify({ kind: "rescue_hedge", title: "Rescue hedge placed",
      body: `Hedged ${placed.outcome} @ ${placed.stake} on ${placed.bookmaker}.`,
      payload: { arb_id: placed.arb_id } });
    if (session) await updateBetSession(session.id, { status: "hedged",
      hedge_details: { hedged_leg: placed.outcome, stake: placed.stake } });
  } catch (e) {
    log.error("Hedge placement FAILED — manual intervention required", { error: e.message });
    await notify({ kind: "hedge_failed", title: "🚨 Hedge FAILED — manual action needed",
      body: `Leg ${placed.outcome} was placed but hedge failed: ${e.message}`,
      payload: { arb_id: placed.arb_id, leg: placed } });
    if (session) await updateBetSession(session.id, { status: "partial",
      notes: `Hedge failed: ${e.message}` });
  }
}

async function processArb(arb) {
  log.info("Processing arb", { id: arb.id, event: arb.event_name });
  const outcomes = Array.isArray(arb.outcomes) ? arb.outcomes : [];
  const settings = await fetchRiskSettings();
  const edgePct = Number(arb.total_arb_percent) || 0;

  if (settings?.auto_stake_enabled && edgePct < Number(settings.min_edge_pct ?? 0)) {
    log.info("Skipping arb below min edge", { edgePct, min: settings.min_edge_pct });
    await ackArb(arb.id); return;
  }

  // Notify on big arbs
  if (settings?.notify_enabled && edgePct >= Number(settings.notify_min_edge_pct ?? 2)) {
    await notify({ kind: "arb_detected", title: `Arb detected (${edgePct.toFixed(2)}%)`,
      body: `${arb.event_name} • ${arb.market_type}`, payload: { arb_id: arb.id } });
  }

  // Pre-flight: every leg must have an available bookmaker
  const legs = outcomes.map((o) => {
    const bm = getBM(o.bookmaker);
    return { o, bm };
  });
  const unsupported = legs.filter((l) => !l.bm);
  if (unsupported.length) {
    log.warn("Skipping arb — unsupported bookmaker(s)", {
      arb_id: arb.id, bookmakers: unsupported.map((l) => l.o.bookmaker) });
    await ackArb(arb.id); return;
  }

  // Pre-flight: confirm balance >= sum(stakes)
  const stakes = legs.map(({ o }) => {
    const legOdds = Number(o.price ?? o.odds);
    const autoStake = sizeStake({ legOdds, edgePct, settings, totalLegs: outcomes.length });
    const stake = autoStake != null ? autoStake : Number(o.stake ?? o.recommended_stake ?? 0);
    return { leg: o, stake, legOdds };
  });
  if (stakes.some((s) => s.stake <= 0)) {
    log.info("One leg sized to zero — skipping arb"); await ackArb(arb.id); return;
  }

  // Create session
  const session = await createBetSession({ arb_id: arb.id, total_legs: legs.length });

  // Execute legs sequentially. On the first failure → hedge what we already placed.
  const placed = [];
  let failed = false;
  for (let i = 0; i < legs.length; i++) {
    if (stopping || mode !== "online") { failed = true; break; }
    const { bm } = legs[i];
    const { leg, stake, legOdds } = stakes[i];
    const res = await placeLeg(session, bm, {
      arb_id: arb.id, outcome: leg.outcome, stake, odds: legOdds,
      event_url: leg.event_url, outcome_selector: leg.outcome_selector,
      outcome_label: leg.outcome_label ?? leg.outcome, settings,
    });
    if (res.result === "success" || res.result === "partial") {
      placed.push({ ...leg, arb_id: arb.id, stake, odds: legOdds, bookmaker: bm.id,
        hedge_label: leg.hedge_label, hedge_selector: leg.hedge_selector });
      if (session) await updateBetSession(session.id, { placed_legs: placed.length });
      consecutiveFailures = 0;
      await notify({ kind: "bet_placed", title: `Leg placed: ${leg.outcome}`,
        body: `${leg.outcome} @ ${legOdds} stake ${stake} on ${bm.id}`,
        payload: { arb_id: arb.id, session_id: session?.id } });
    } else {
      failed = true;
      if (session) await updateBetSession(session.id, { failed_legs: 1 });
      await bumpFailureAndMaybePause(`leg ${leg.outcome} ${res.result}`);
      break;
    }
  }

  if (failed && placed.length > 0) {
    // PARTIAL FILL — hedge the placed legs
    await placeHedge(session, placed, settings);
  } else if (failed) {
    if (session) await updateBetSession(session.id, { status: "failed" });
  } else {
    if (session) await updateBetSession(session.id, { status: "complete", placed_legs: placed.length });
  }

  await ackArb(arb.id);
}

// --------- commands ---------
async function handleCommand(cmd) {
  log.info("Command", { command: cmd.command, id: cmd.id });
  try {
    switch (cmd.command) {
      case "start": case "resume":
        mode = "online"; await pushHeartbeat("online", { reason: cmd.command }); break;
      case "pause": case "stop":
        mode = "paused"; await pushHeartbeat("paused", { reason: cmd.command }); break;
      case "refresh_balances": {
        for (const id of Object.keys(bookmakers)) {
          if (!isAvailable(id)) continue;
          const bm = bookmakers[id];
          try { const { balance } = await bm.login(); if (balance != null) await upsertBalance(balance); }
          catch (e) { log.warn(`refresh_balances ${id} failed`, { error: e.message }); }
        }
        break;
      }
      case "place_bet": case "manual": case "mug_bet": case "hedge": {
        const p = cmd.payload || {};
        const bm = getBM(p.bookmaker || "betpawa");
        if (!bm) { log.warn("Manual cmd skipped — bookmaker unavailable"); break; }
        try {
          const res = await bm.placeBet({
            arb_id: p.arb_id ?? null, outcome: p.outcome ?? "manual",
            stake: Number(p.stake || 0), odds: p.odds ? Number(p.odds) : null,
            event_url: p.event_url, outcome_selector: p.outcome_selector, outcome_label: p.outcome_label,
          });
          await logBet({ arb_id: p.arb_id ?? null, outcome: p.outcome ?? "manual",
            bet_type: cmd.command === "hedge" ? "hedge" : "back",
            odds: res.odds, stake: Number(p.stake || 0), result: res.result,
            details: { manual: true, bookmaker: bm.id } });
          if (typeof res.balance === "number") await upsertBalance(res.balance);
        } catch (e) {
          await logBet({ arb_id: p.arb_id ?? null, outcome: p.outcome ?? "manual",
            bet_type: "back", odds: null, stake: Number(p.stake || 0), result: "failed",
            details: { manual: true, error: e.message } });
        }
        break;
      }
      default: log.warn("Unknown command", { command: cmd.command });
    }
    await markCommand(cmd.id, "executed");
  } catch (e) {
    log.error("Command failed", { id: cmd.id, error: e.message });
    await markCommand(cmd.id, "failed");
  }
}

// --------- loops ---------
async function commandLoop() {
  while (!stopping) {
    try {
      const cmds = await fetchPendingCommands();
      for (const c of cmds) await handleCommand(c);
    } catch (e) { log.error("commandLoop error", { error: e.message }); }
    await new Promise((r) => setTimeout(r, COMMAND_POLL_MS));
  }
}
async function heartbeatLoop() {
  while (!stopping) {
    try { await pushHeartbeat(mode, { consecutiveFailures }); }
    catch (e) { log.error("heartbeatLoop error", { error: e.message }); }
    await new Promise((r) => setTimeout(r, HEARTBEAT_MS));
  }
}
async function arbLoop() {
  while (!stopping) {
    try {
      if (mode === "online") {
        const arbs = await fetchOpenArbs();
        for (const a of arbs) {
          if (stopping || mode !== "online") break;
          await processArb(a);
        }
      }
    } catch (e) { log.error("arbLoop error", { error: e.message }); }
    await new Promise((r) => setTimeout(r, ARB_POLL_MS));
  }
}
async function keepAliveLoop() {
  while (!stopping) {
    await new Promise((r) => setTimeout(r, KEEPALIVE_MS));
    if (stopping) return;
    for (const id of Object.keys(bookmakers)) {
      if (!isAvailable(id)) continue;
      const bm = bookmakers[id];
      if (typeof bm.keepAlive === "function") {
        try { await bm.keepAlive(); } catch (e) { log.warn(`keepAlive ${id}`, { error: e.message }); }
      }
    }
  }
}

async function main() {
  log.info("BetPawa bot starting", { agent_id: process.env.AGENT_ID || "primary" });
  await pushHeartbeat(mode, { boot: true });

  const handler = async () => {
    log.info("Shutdown signal");
    stopping = true;
    try { await pushHeartbeat("offline", { reason: "shutdown" }); } catch {}
    await shutdownAll();
    process.exit(0);
  };
  process.on("SIGINT", handler);
  process.on("SIGTERM", handler);

  await Promise.all([commandLoop(), heartbeatLoop(), arbLoop(), keepAliveLoop()]);
}

main().catch(async (e) => {
  log.error("Fatal", { error: e.message, stack: e.stack });
  try { await pushHeartbeat("error", { error: e.message }); } catch {}
  process.exit(1);
});