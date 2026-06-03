import "dotenv/config";
import { log } from "./logger.js";
import {
  ackArb,
  fetchOpenArbs,
  fetchPendingCommands,
  logBet,
  markCommand,
  pushHeartbeat,
  upsertBalance,
} from "./supabase.js";
import { login, placeBet, readBalance, shutdown } from "./betpawa.js";
import { getRiskSettings, sizeStake } from "./staking.js";

const COMMAND_POLL_MS = 2000;
const HEARTBEAT_MS = 5000;
const ARB_POLL_MS = 4000;

let mode = "paused"; // online | paused | error
let stopping = false;

async function executeBet({ arb_id, outcome, stake, odds, event_url, outcome_selector, outcome_label }) {
  let attempt = 0;
  let lastErr = null;
  while (attempt < 2) {
    attempt++;
    try {
      const res = await placeBet({ arb_id, outcome, stake, odds, event_url, outcome_selector, outcome_label });
      await logBet({
        arb_id,
        outcome,
        bet_type: "back",
        odds: res.odds ?? odds ?? null,
        stake,
        result: res.result,
        details: { attempt, event_url },
      });
      if (typeof res.balance === "number") await upsertBalance(res.balance);
      return res.result;
    } catch (e) {
      lastErr = e;
      log.error(`Bet attempt ${attempt} failed`, { error: e.message, outcome, stake });
    }
  }
  await logBet({
    arb_id,
    outcome,
    bet_type: "back",
    odds: odds ?? null,
    stake,
    result: "failed",
    details: { error: lastErr?.message ?? "unknown" },
  });
  return "failed";
}

async function processArb(arb) {
  log.info("Processing arb", { id: arb.id, event: arb.event_name });
  const outcomes = Array.isArray(arb.outcomes) ? arb.outcomes : [];
  const settings = await getRiskSettings();
  const edgePct = Number(arb.total_arb_percent) || 0;
  if (settings.auto_stake_enabled && edgePct < (settings.min_edge_pct ?? 0)) {
    log.info("Skipping arb below min edge", { id: arb.id, edgePct, min: settings.min_edge_pct });
    await ackArb(arb.id);
    return;
  }
  for (const o of outcomes) {
    if (stopping || mode !== "online") return;
    // expect outcomes shape: { outcome, bookmaker, price, stake, event_url? }
    if ((o.bookmaker || "").toLowerCase() !== "betpawa") {
      log.info("Skipping non-betpawa leg", { bookmaker: o.bookmaker, outcome: o.outcome });
      continue;
    }
    const legOdds = Number(o.price ?? o.odds);
    const autoStake = sizeStake({
      legOdds,
      edgePct,
      settings,
      totalLegs: outcomes.length,
    });
    const stake = autoStake != null ? autoStake : Number(o.stake ?? o.recommended_stake ?? 0);
    if (stake <= 0) {
      log.info("Stake sized to zero — skipping leg", { outcome: o.outcome, legOdds, edgePct });
      continue;
    }
    await executeBet({
      arb_id: arb.id,
      outcome: o.outcome,
      stake,
      odds: legOdds,
      event_url: o.event_url,
      outcome_selector: o.outcome_selector,
      outcome_label: o.outcome_label ?? o.outcome,
    });
  }
  await ackArb(arb.id);
}

async function handleCommand(cmd) {
  log.info("Handling command", { command: cmd.command, id: cmd.id });
  try {
    switch (cmd.command) {
      case "start":
        mode = "online";
        await pushHeartbeat("online", { reason: "start command" });
        break;
      case "pause":
        mode = "paused";
        await pushHeartbeat("paused", { reason: "pause command" });
        break;
      case "resume":
        mode = "online";
        await pushHeartbeat("online", { reason: "resume command" });
        break;
      case "stop":
        mode = "paused";
        await pushHeartbeat("paused", { reason: "stop command" });
        break;
      case "refresh_balances": {
        await login();
        const bal = await readBalance();
        await upsertBalance(bal);
        break;
      }
      case "place_bet":
      case "manual":
      case "mug_bet":
      case "hedge":
        await executeBet({
          arb_id: cmd.payload?.arb_id ?? null,
          outcome: cmd.payload?.outcome ?? "manual",
          stake: Number(cmd.payload?.stake ?? 0),
          odds: cmd.payload?.odds ? Number(cmd.payload.odds) : null,
          event_url: cmd.payload?.event_url,
          outcome_selector: cmd.payload?.outcome_selector,
          outcome_label: cmd.payload?.outcome_label,
        });
        break;
      default:
        log.warn("Unknown command", { command: cmd.command });
    }
    await markCommand(cmd.id, "executed");
  } catch (e) {
    log.error("Command failed", { id: cmd.id, error: e.message });
    await markCommand(cmd.id, "failed");
  }
}

async function commandLoop() {
  while (!stopping) {
    try {
      const cmds = await fetchPendingCommands();
      for (const c of cmds) await handleCommand(c);
    } catch (e) {
      log.error("commandLoop error", { error: e.message });
    }
    await new Promise((r) => setTimeout(r, COMMAND_POLL_MS));
  }
}

async function heartbeatLoop() {
  while (!stopping) {
    try {
      await pushHeartbeat(mode);
    } catch (e) {
      log.error("heartbeatLoop error", { error: e.message });
    }
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
    } catch (e) {
      log.error("arbLoop error", { error: e.message });
    }
    await new Promise((r) => setTimeout(r, ARB_POLL_MS));
  }
}

async function main() {
  log.info("BetPawa bot starting", {
    agent_id: process.env.AGENT_ID || "primary",
    bankroll: process.env.TOTAL_INVESTMENT,
  });
  await pushHeartbeat(mode, { boot: true });

  const shutdownHandler = async () => {
    log.info("Shutdown signal received");
    stopping = true;
    await pushHeartbeat("offline", { reason: "shutdown" });
    await shutdown();
    process.exit(0);
  };
  process.on("SIGINT", shutdownHandler);
  process.on("SIGTERM", shutdownHandler);

  await Promise.all([commandLoop(), heartbeatLoop(), arbLoop()]);
}

main().catch(async (e) => {
  log.error("Fatal", { error: e.message, stack: e.stack });
  try { await pushHeartbeat("error", { error: e.message }); } catch {}
  process.exit(1);
});