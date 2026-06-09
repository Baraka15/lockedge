/**
 * Periodic balance scraper. Every 30 minutes, logs into each available
 * bookmaker (reusing the existing session if fresh) and pushes the latest
 * balance to public.balances. Alerts via Telegram if balance drops below
 * the per-account min_stake_abs threshold.
 */
import { log } from "./logger.js";
import { sb, upsertBalance, fetchRiskSettings, AGENT_ID } from "./supabase.js";
import { getBookmakers, isAvailable } from "./bookmakers/index.js";
import { notify } from "./notifications.js";

const SYNC_MS = Number(process.env.BALANCE_SYNC_MS || 30 * 60 * 1000);

async function upsertScopedBalance(bookmaker, balance) {
  if (balance == null || !Number.isFinite(Number(balance))) return;
  const { error } = await sb.from("balances").upsert({
    bookmaker,
    account_label: process.env.ACCOUNT_LABEL || "primary",
    balance: Number(balance),
    pending_returns: 0,
    last_updated: new Date().toISOString(),
  }, { onConflict: "bookmaker,account_label" });
  if (error) log.warn("[balance-sync] upsert failed", { bookmaker, error: error.message });
}

export async function syncOnce() {
  const bms = getBookmakers();
  const settings = await fetchRiskSettings();
  const minStake = Number(settings?.min_stake_abs ?? 0);
  for (const id of Object.keys(bms)) {
    if (!isAvailable(id)) continue;
    try {
      const { balance } = await bms[id].login();
      await upsertScopedBalance(id, balance);
      if (minStake > 0 && balance != null && Number(balance) < minStake) {
        await notify({
          kind: "low_balance",
          title: `⚠️ ${id} balance below min stake`,
          body: `Current ${balance} < min ${minStake}. Deposit or reduce min_stake_abs.`,
          payload: { bookmaker: id, balance, minStake },
        });
      }
      log.info("[balance-sync] ok", { bookmaker: id, balance });
    } catch (e) {
      log.warn("[balance-sync] failed", { bookmaker: id, error: e.message });
    }
  }
}

export async function startBalanceSync({ shouldStop } = {}) {
  // initial run after a short delay so the bot can boot first
  setTimeout(() => syncOnce().catch(() => {}), 30_000);
  while (!(shouldStop?.() ?? false)) {
    await new Promise((r) => setTimeout(r, SYNC_MS));
    if (shouldStop?.()) return;
    await syncOnce().catch((e) => log.warn("[balance-sync] cycle error", { error: e.message }));
  }
}