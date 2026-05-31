import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const Route = createFileRoute("/api/live-events")({
  server: {
    handlers: {
      GET: async () => {
        const { data, error } = await supabaseAdmin
          .from("live_events")
          .select(
            "event_key, sport, event_name, event_date, market_type, bookmaker_count, outcomes, updated_at",
          )
          .order("event_date", { ascending: true })
          .limit(200);
        if (error) {
          return Response.json({ ok: false, error: error.message }, { status: 500 });
        }
        return Response.json({ ok: true, events: data ?? [] });
      },
    },
  },
});