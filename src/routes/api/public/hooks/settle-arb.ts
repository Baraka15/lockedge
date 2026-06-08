import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Settle an arb: compute P&L from bet_logs and write a settlements row.
 * Body: { arb_id: string, winning_outcome: string, home_score?: number, away_score?: number }
 */
export const Route = createFileRoute("/api/public/hooks/settle-arb")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let payload: { arb_id?: string; winning_outcome?: string; home_score?: number; away_score?: number } = {};
        try { payload = await request.json(); } catch {}
        const { arb_id, winning_outcome, home_score, away_score } = payload;
        if (!arb_id || !winning_outcome) {
          return Response.json({ ok: false, error: "arb_id and winning_outcome are required" }, { status: 400 });
        }

        const { data: arb } = await supabaseAdmin
          .from("arbs")
          .select("id, event_name, market_type, outcomes")
          .eq("id", arb_id)
          .maybeSingle();
        if (!arb) {
          return Response.json({ ok: false, error: "arb not found" }, { status: 404 });
        }

        const { data: logs } = await supabaseAdmin
          .from("bet_logs")
          .select("outcome, stake, odds, result, bet_type")
          .eq("arb_id", arb_id);

        let total_staked = 0;
        let total_returned = 0;
        for (const l of logs ?? []) {
          if (l.result !== "success" && l.result !== "partial") continue;
          const stake = Number(l.stake ?? 0);
          const odds = Number(l.odds ?? 0);
          total_staked += stake;
          // Winner: the leg matching winning_outcome (case-insensitive substring).
          const isWinner = (l.outcome ?? "").toLowerCase().includes(winning_outcome.toLowerCase());
          if (isWinner && odds > 0) total_returned += stake * odds;
        }
        const profit = total_returned - total_staked;

        const { error } = await supabaseAdmin.from("settlements").insert({
          arb_id,
          event_name: arb.event_name,
          match_date: null,
          home_score: home_score ?? null,
          away_score: away_score ?? null,
          winning_outcome,
          total_staked,
          total_returned,
          profit,
        });
        if (error) {
          return Response.json({ ok: false, error: error.message }, { status: 500 });
        }
        return Response.json({ ok: true, total_staked, total_returned, profit });
      },
    },
  },
});