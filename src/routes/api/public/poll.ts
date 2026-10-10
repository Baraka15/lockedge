import { createFileRoute } from "@tanstack/react-router";
import { runPollCycle } from "@/lib/engine.server";

/**
 * Poll endpoint hit by a user-operated scheduler (pg_cron via pg_net, a
 * Supabase scheduled Edge Function, or any external cron) every minute.
 * Each invocation runs several scan cycles spaced by POLL_INTERVAL_MS so
 * the dashboard sees fresh opportunities at sub-minute resolution.
 *
 * When POLL_SECRET is set, callers must send `Authorization: Bearer <secret>`.
 * Leaving it unset keeps the endpoint open (dev / initial setup only).
 */
async function unauthorized(request: Request): Promise<Response | null> {
  const secret = process.env.POLL_SECRET;
  if (!secret) return null;
  const header = request.headers.get("authorization") ?? "";
  if (header === `Bearer ${secret}`) return null;
  // Signed-in dashboard users may trigger a scan with their session token.
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (token) {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data, error } = await supabaseAdmin.auth.getUser(token);
      if (!error && data.user) return null;
    } catch (e) {
      console.error("[poll] token check failed", e);
    }
  }
  return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
}

export const Route = createFileRoute("/api/public/poll")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = unauthorized(request);
        if (denied) return denied;
        const intervalMs = Number(process.env.POLL_INTERVAL_MS ?? 2000);

        const maxRuntimeMs = 50_000; // stay under the 60s cron window
        const started = Date.now();
        const runs: Awaited<ReturnType<typeof runPollCycle>>[] = [];

        // Always do at least one cycle; loop until close to the deadline.
        do {
          const result = await runPollCycle();
          runs.push(result);
          const elapsed = Date.now() - started;
          if (elapsed + intervalMs >= maxRuntimeMs) break;
          await new Promise((r) => setTimeout(r, intervalMs));
        } while (Date.now() - started < maxRuntimeMs);

        const totalArbs = runs.reduce((s, r) => s + r.arbsDetected, 0);
        return Response.json({
          ok: true,
          cycles: runs.length,
          totalArbsDetected: totalArbs,
          totalDurationMs: Date.now() - started,
        });
      },
      GET: async ({ request }) => {
        const denied = unauthorized(request);
        if (denied) return denied;
        // Allow manual triggering / health probe via GET
        const result = await runPollCycle();
        return Response.json({ ok: true, ...result });
      },

    },
  },
});