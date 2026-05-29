import { createFileRoute } from "@tanstack/react-router";
import { runPollCycle } from "@/lib/engine.server";

/**
 * Poll endpoint hit by pg_cron every minute. Each invocation runs several
 * scan cycles spaced by POLL_INTERVAL_MS so the dashboard sees fresh
 * opportunities at sub-minute resolution.
 */
export const Route = createFileRoute("/api/public/poll")({
  server: {
    handlers: {
      POST: async () => {
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
      GET: async () => {
        // Allow manual triggering / health probe via GET
        const result = await runPollCycle();
        return Response.json({ ok: true, ...result });
      },
    },
  },
});