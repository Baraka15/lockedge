import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

// New tables aren't in generated types yet — use a loose client cast.
const sb = supabase as unknown as {
  from: (t: string) => any;
  channel: (n: string) => any;
  removeChannel: (c: any) => void;
  auth: typeof supabase.auth;
};

export interface AgentStatus {
  agent_id: string;
  status: "online" | "offline" | "paused" | "error";
  last_heartbeat: string;
  version: string | null;
  metadata: Record<string, unknown>;
}
export interface AgentCommand {
  id: string;
  command: string;
  payload: Record<string, unknown>;
  status: "pending" | "executed" | "failed";
  created_at: string;
  executed_at: string | null;
}
export interface BetLog {
  id: string;
  arb_id: string | null;
  account_label: string;
  bookmaker: string;
  outcome: string;
  bet_type: "back" | "lay" | "hedge" | "mug";
  odds: number | null;
  stake: number | null;
  result: "success" | "partial" | "failed" | "pending" | null;
  details: Record<string, unknown>;
  logged_at: string;
}
export interface Balance {
  bookmaker: string;
  account_label: string;
  balance: number;
  pending_returns: number;
  last_updated: string;
}

export function useAgentStatus() {
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [nowTick, setNowTick] = useState(Date.now());

  useEffect(() => {
    let mounted = true;
    sb.from("agent_status")
      .select("*")
      .eq("agent_id", "primary")
      .maybeSingle()
      .then(({ data }: any) => {
        if (mounted && data) setStatus(data as AgentStatus);
      });

    const ch = sb
      .channel("agent_status_rt")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "agent_status" },
        (payload: any) => {
          if (payload.new) setStatus(payload.new as AgentStatus);
        },
      )
      .subscribe();

    const tick = setInterval(() => setNowTick(Date.now()), 1000);
    return () => {
      mounted = false;
      sb.removeChannel(ch);
      clearInterval(tick);
    };
  }, []);

  const secondsSinceHeartbeat = status
    ? Math.floor((nowTick - new Date(status.last_heartbeat).getTime()) / 1000)
    : null;

  // Derive "stale" if no heartbeat in 30s
  const derivedStatus: AgentStatus["status"] | "stale" | "unknown" = !status
    ? "unknown"
    : status.status === "online" && (secondsSinceHeartbeat ?? 0) > 30
      ? "stale"
      : status.status;

  return { status, derivedStatus, secondsSinceHeartbeat };
}

export function useAgentCommands(limit = 25) {
  const [commands, setCommands] = useState<AgentCommand[]>([]);

  useEffect(() => {
    let mounted = true;
    sb.from("agent_commands")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit)
      .then(({ data }: any) => {
        if (mounted && data) setCommands(data as AgentCommand[]);
      });

    const ch = sb
      .channel("agent_commands_rt")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "agent_commands" },
        (payload: any) => {
          setCommands((prev) => {
            const next = [...prev];
            const incoming = payload.new as AgentCommand | undefined;
            if (payload.eventType === "INSERT" && incoming) {
              return [incoming, ...next].slice(0, limit);
            }
            if (payload.eventType === "UPDATE" && incoming) {
              const idx = next.findIndex((c) => c.id === incoming.id);
              if (idx >= 0) next[idx] = incoming;
              else next.unshift(incoming);
              return next.slice(0, limit);
            }
            if (payload.eventType === "DELETE" && payload.old) {
              return next.filter((c) => c.id !== (payload.old as AgentCommand).id);
            }
            return next;
          });
        },
      )
      .subscribe();

    return () => {
      mounted = false;
      sb.removeChannel(ch);
    };
  }, [limit]);

  const sendCommand = useCallback(
    async (command: string, payload: Record<string, unknown> = {}) => {
      const { data: userData } = await supabase.auth.getUser();
      const { data, error } = await sb
        .from("agent_commands")
        .insert({ command, payload, created_by: userData.user?.id ?? null })
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data as AgentCommand;
    },
    [],
  );

  return { commands, sendCommand };
}

export function useBetLogs(limit = 50) {
  const [logs, setLogs] = useState<BetLog[]>([]);

  useEffect(() => {
    let mounted = true;
    sb.from("bet_logs")
      .select("*")
      .order("logged_at", { ascending: false })
      .limit(limit)
      .then(({ data }: any) => {
        if (mounted && data) setLogs(data as BetLog[]);
      });

    const ch = sb
      .channel("bet_logs_rt")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "bet_logs" },
        (payload: any) => {
          if (payload.new) {
            setLogs((prev) => [payload.new as BetLog, ...prev].slice(0, limit));
          }
        },
      )
      .subscribe();

    return () => {
      mounted = false;
      sb.removeChannel(ch);
    };
  }, [limit]);

  return logs;
}

export function useBalances() {
  const [balances, setBalances] = useState<Balance[]>([]);

  useEffect(() => {
    let mounted = true;
    sb.from("balances")
      .select("*")
      .order("bookmaker", { ascending: true })
      .then(({ data }: any) => {
        if (mounted && data) setBalances(data as Balance[]);
      });

    const ch = sb
      .channel("balances_rt")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "balances" },
        (payload: any) => {
          setBalances((prev) => {
            const next = [...prev];
            const row = (payload.new ?? payload.old) as Balance | undefined;
            if (!row) return next;
            const key = (b: Balance) =>
              `${b.bookmaker}::${b.account_label}`;
            if (payload.eventType === "DELETE") {
              return next.filter((b) => key(b) !== key(row));
            }
            const idx = next.findIndex((b) => key(b) === key(row));
            if (idx >= 0) next[idx] = row;
            else next.push(row);
            return next.sort((a, b) =>
              a.bookmaker.localeCompare(b.bookmaker),
            );
          });
        },
      )
      .subscribe();

    return () => {
      mounted = false;
      sb.removeChannel(ch);
    };
  }, []);

  const totals = balances.reduce(
    (acc, b) => {
      acc.balance += Number(b.balance);
      acc.pending += Number(b.pending_returns);
      return acc;
    },
    { balance: 0, pending: 0 },
  );

  return { balances, totals };
}