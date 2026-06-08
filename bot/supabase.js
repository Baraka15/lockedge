import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

// Auto-detect Supabase credentials.
// Priority: explicit server vars → Lovable-injected VITE_* vars → service role (optional).
const url =
  process.env.SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL;
const key =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  throw new Error(
    "Missing Supabase credentials. Set SUPABASE_URL + SUPABASE_ANON_KEY " +
      "(or rely on Lovable-injected VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).",
  );
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

// ---------- bet sessions ----------
export async function createBetSession({ arb_id, total_legs, notes }) {
  const { data, error } = await sb
    .from("bet_sessions")
    .insert({ arb_id, total_legs, placed_legs: 0, failed_legs: 0, status: "pending", notes: notes ?? null })
    .select()
    .single();
  if (error) { console.error("[createBetSession]", error.message); return null; }
  return data;
}

export async function updateBetSession(id, patch) {
  const { error } = await sb.from("bet_sessions").update(patch).eq("id", id);
  if (error) console.error("[updateBetSession]", error.message);
}

// ---------- settlement helpers ----------
export async function fetchBetLogsForArb(arb_id) {
  const { data, error } = await sb.from("bet_logs").select("*").eq("arb_id", arb_id);
  if (error) { console.error("[fetchBetLogsForArb]", error.message); return []; }
  return data ?? [];
}

export async function recordSettlement(row) {
  const { error } = await sb.from("settlements").insert(row);
  if (error) console.error("[recordSettlement]", error.message);
}

// ---------- session cookie persistence (resume after crash) ----------
export async function saveSessionCookies(bookmaker, cookies) {
  const { data: existing } = await sb
    .from("agent_status").select("metadata").eq("agent_id", AGENT_ID).maybeSingle();
  const meta = (existing?.metadata ?? {});
  const sessions = { ...(meta.sessions ?? {}), [bookmaker]: { cookies, saved_at: new Date().toISOString() } };
  await sb.from("agent_status").upsert({
    agent_id: AGENT_ID,
    status: meta.status ?? "online",
    last_heartbeat: new Date().toISOString(),
    metadata: { ...meta, sessions },
  }, { onConflict: "agent_id" });
}

export async function loadSessionCookies(bookmaker) {
  const { data } = await sb
    .from("agent_status").select("metadata").eq("agent_id", AGENT_ID).maybeSingle();
  return data?.metadata?.sessions?.[bookmaker]?.cookies ?? null;
}

// ---------- risk settings ----------
export async function fetchRiskSettings() {
  const { data, error } = await sb
    .from("risk_settings").select("*").eq("account_label", ACCOUNT_LABEL).maybeSingle();
  if (error) { console.error("[fetchRiskSettings]", error.message); return null; }
  return data;
}