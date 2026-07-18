import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { fetchAllAfricanOdds } from "@/lib/odds/scrapers";

/**
 * Ping TheOddsAPI and write the status to agent_status.metadata.odds_api_status
 * so the dashboard header can show a live/error badge. Returns the snapshot.
 */
export const Route = createFileRoute("/api/odds-health")({
  server: {
    handlers: {
      GET: async () => {
        const key = process.env.THEODDSAPI_KEY || process.env.ODDS_API_KEY;
        let status: "live" | "error" | "missing_key" = "missing_key";
        let detail = "";
        let remaining: number | null = null;

        if (key) {
          try {
            const res = await fetch(`https://api.the-odds-api.com/v4/sports/?apiKey=${encodeURIComponent(key)}`);
            if (res.ok) {
              status = "live";
              remaining = Number(res.headers.get("x-requests-remaining") ?? 0) || null;
            } else {
              status = "error";
              detail = `HTTP ${res.status}`;
            }
          } catch (e) {
            status = "error";
            detail = e instanceof Error ? e.message : String(e);
          }
        }

        const snapshot = { status, detail, remaining, checked_at: new Date().toISOString() };

        // Ping every African scraper in parallel and record per-bookmaker status.
        let scraperSummary: {
          live: number;
          total: number;
          results: { bookmaker: string; ok: boolean; count: number; latency_ms: number; error?: string }[];
        } = { live: 0, total: 0, results: [] };
        try {
          const s = await fetchAllAfricanOdds();
          scraperSummary = {
            live: s.liveCount,
            total: s.totalCount,
            results: s.results.map((r) => ({
              bookmaker: r.bookmaker,
              ok: r.ok,
              count: r.count,
              latency_ms: r.latencyMs,
              error: r.error,
            })),
          };
        } catch (e) {
          console.error("[odds-health] scrapers check failed", e);
        }

        // Write to agent_status so it lights up the header badge.
        try {
          const { data: existing } = await supabaseAdmin
            .from("agent_status").select("metadata, status, version").eq("agent_id", "engine").maybeSingle();
          const meta = ((existing?.metadata as Record<string, unknown> | null) ?? {});
          await supabaseAdmin.from("agent_status").upsert({
            agent_id: "engine",
            status: existing?.status ?? "online",
            last_heartbeat: new Date().toISOString(),
            version: existing?.version ?? "engine-1.0.0",
            metadata: { ...meta, odds_api_status: snapshot } as never,
          }, { onConflict: "agent_id" });
        } catch (e) {
          console.error("[odds-health] persist failed", e);
        }

        return Response.json({ ok: true, ...snapshot, scrapers: scraperSummary });
      },
    },
  },
});