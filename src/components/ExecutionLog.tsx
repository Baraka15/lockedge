import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

interface ExecutionRow {
  id: string;
  event_name: string;
  market_type: string;
  detected_at: string;
  verified_at: string;
  original_arb_percent: number | string;
  current_arb_percent: number | string;
  current_edge_pct: number | string;
  min_edge_pct: number | string;
  total_stake: number | string;
  status: string;
  user_outcome: string | null;
  error_message: string | null;
}

const STATUS_CLS: Record<string, string> = {
  verified: "bg-emerald-500/15 text-emerald-500",
  placed_manually: "bg-emerald-500/15 text-emerald-500",
  invalid: "bg-rose-500/15 text-rose-500",
  rejected: "bg-amber-500/15 text-amber-500",
  aborted: "bg-muted text-muted-foreground",
};

/**
 * Audit trail of every verification attempt: what was detected, what the odds
 * were at re-check time, the recalculated stakes and what the operator did.
 * Read-only — nothing here places a bet.
 */
export function ExecutionLog() {
  const [rows, setRows] = useState<ExecutionRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const { data, error } = await supabase
        .from("executions")
        .select(
          "id, event_name, market_type, detected_at, verified_at, original_arb_percent, current_arb_percent, current_edge_pct, min_edge_pct, total_stake, status, user_outcome, error_message",
        )
        .order("created_at", { ascending: false })
        .limit(25);
      if (cancelled) return;
      if (error) {
        console.error("[ExecutionLog] load failed", error);
        return;
      }
      setRows((data ?? []) as unknown as ExecutionRow[]);
    };
    load();
    const channel = supabase
      .channel("executions-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "executions" },
        () => void load(),
      )
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, []);

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      {rows.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          No verification attempts yet. Press PLACE BET on an opportunity to re-check its
          odds and record an execution.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm">
              <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                {r.event_name}
              </span>
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                {r.market_type}
              </span>
              <span className="text-xs tabular-nums text-muted-foreground">
                {Number(r.original_arb_percent).toFixed(2)}% →{" "}
                {Number(r.current_arb_percent).toFixed(2)}% (edge{" "}
                {Number(r.current_edge_pct).toFixed(2)}% / min{" "}
                {Number(r.min_edge_pct).toFixed(2)}%)
              </span>
              <span className="text-xs tabular-nums text-muted-foreground">
                stake {Number(r.total_stake).toFixed(2)}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                  STATUS_CLS[r.status] ?? "bg-muted text-muted-foreground"
                }`}
              >
                {r.user_outcome ?? r.status}
              </span>
              <span className="text-xs tabular-nums text-muted-foreground">
                {new Date(r.verified_at).toLocaleTimeString()}
              </span>
              {r.error_message && (
                <span className="w-full text-xs text-muted-foreground">{r.error_message}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
