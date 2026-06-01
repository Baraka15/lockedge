import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Settlement feed: acknowledged arbs and arbs that have expired (i.e. the
 * window for placing them is closed). Useful for auditing past opportunities.
 */
export const Route = createFileRoute("/api/settlement")({
  server: {
    handlers: {
      GET: async () => {
        const { data, error } = await supabaseAdmin
          .from("arbs")
          .select(
            "id, event_name, market_type, outcomes, total_arb_percent, required_total_stake, detected_at, expires_at, is_acknowledged",
          )
          .or(`is_acknowledged.eq.true,expires_at.lt.${new Date().toISOString()}`)
          .order("detected_at", { ascending: false })
          .limit(100);
        if (error) {
          return Response.json({ ok: false, error: error.message }, { status: 500 });
        }
        return Response.json({ ok: true, arbs: data ?? [] });
      },
    },
  },
});