import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in bot/.env");
}

export const sb = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export const AGENT_ID = process.env.AGENT_ID || "primary";
export const ACCOUNT_LABEL = process.env.ACCOUNT_LABEL || "primary";
export const BOOKMAKER = "betpawa";

export async function pushHeartbeat(status, metadata = {}) {
  const { error } = await sb.from("agent_status").upsert(
    {
      agent_id: AGENT_ID,
      status,
      last_heartbeat: new Date().toISOString(),
      version: "1.0.0",
      metadata,
    },
    { onConflict: "agent_id" },
  );
  if (error) console.error("[heartbeat]", error.message);
}

export async function fetchPendingCommands() {
  const { data, error } = await sb
    .from("agent_commands")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(10);
  if (error) {
    console.error("[commands]", error.message);
    return [];
  }
  return data || [];
}

export async function markCommand(id, status) {
  await sb
    .from("agent_commands")
    .update({ status, executed_at: new Date().toISOString() })
    .eq("id", id);
}

export async function logBet(row) {
  const { error } = await sb.from("bet_logs").insert({
    arb_id: row.arb_id ?? null,
    account_label: ACCOUNT_LABEL,
    bookmaker: BOOKMAKER,
    outcome: row.outcome,
    bet_type: row.bet_type ?? "back",
    odds: row.odds ?? null,
    stake: row.stake ?? null,
    result: row.result ?? null,
    details: row.details ?? {},
  });
  if (error) console.error("[logBet]", error.message);
}

export async function upsertBalance(balance, pending = 0) {
  const { error } = await sb.from("balances").upsert(
    {
      bookmaker: BOOKMAKER,
      account_label: ACCOUNT_LABEL,
      balance,
      pending_returns: pending,
      last_updated: new Date().toISOString(),
    },
    { onConflict: "bookmaker,account_label" },
  );
  if (error) console.error("[upsertBalance]", error.message);
}

export async function fetchOpenArbs() {
  const nowIso = new Date().toISOString();
  const { data, error } = await sb
    .from("arbs")
    .select("*")
    .eq("is_acknowledged", false)
    .gt("expires_at", nowIso)
    .order("detected_at", { ascending: true })
    .limit(5);
  if (error) {
    console.error("[fetchOpenArbs]", error.message);
    return [];
  }
  return data || [];
}

export async function ackArb(id) {
  await sb.from("arbs").update({ is_acknowledged: true }).eq("id", id);
}