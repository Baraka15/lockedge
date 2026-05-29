import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

interface ArbOutcomeRow {
  name: string;
  odds: number;
  bookmaker: string;
  stake: number;
}

export const Route = createFileRoute("/api/stats")({
  server: {
    handlers: {
      GET: async () => {
        const oneHourAgo = new Date(Date.now() - 3_600_000).toISOString();
        const { data, error } = await supabaseAdmin
          .from("arbs")
          .select("total_arb_percent, required_total_stake, outcomes")
          .gte("detected_at", oneHourAgo);
        if (error) {
          return Response.json({ ok: false, error: error.message }, { status: 500 });
        }

        // Simulated profit assumes you stake `required_total_stake` and your
        // guaranteed return is stake / arbPercent — true for a well-formed arb.
        let totalPotentialProfit = 0;
        for (const row of data ?? []) {
          const arbPct = Number(row.total_arb_percent);
          const stake = Number(row.required_total_stake);
          if (arbPct > 0 && arbPct < 100) {
            const guaranteedReturn = (stake / arbPct) * 100;
            totalPotentialProfit += guaranteedReturn - stake;
          }
        }
        const outcomeCount =
          data?.reduce((s, r) => s + ((r.outcomes as ArbOutcomeRow[]) ?? []).length, 0) ??
          0;

        return Response.json({
          ok: true,
          windowHours: 1,
          arbsDetected: data?.length ?? 0,
          outcomeCount,
          totalPotentialProfit: Math.round(totalPotentialProfit * 100) / 100,
        });
      },
    },
  },
});