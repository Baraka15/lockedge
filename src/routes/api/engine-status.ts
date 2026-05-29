import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const Route = createFileRoute("/api/engine-status")({
  server: {
    handlers: {
      GET: async () => {
        const { data: latest } = await supabaseAdmin
          .from("engine_runs")
          .select("ran_at, arbs_detected, duration_ms, providers, error")
          .order("ran_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        const oneHourAgo = new Date(Date.now() - 3_600_000).toISOString();
        const { count: arbsDetectedTotal } = await supabaseAdmin
          .from("arbs")
          .select("*", { count: "exact", head: true })
          .gte("detected_at", oneHourAgo);

        const lastRunAt = latest?.ran_at ?? null;
        const running = lastRunAt
          ? Date.now() - new Date(lastRunAt).getTime() < 5 * 60_000
          : false;

        return Response.json({
          running,
          lastPollAt: lastRunAt,
          arbsDetectedTotal: arbsDetectedTotal ?? 0,
          lastRun: latest ?? null,
        });
      },
    },
  },
});