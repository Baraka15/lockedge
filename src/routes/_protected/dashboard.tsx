import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Activity, LogOut, RefreshCw, Shield, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ArbCard } from "@/components/ArbCard";
import { useLiveArbs } from "@/hooks/useLiveArbs";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_protected/dashboard")({
  head: () => ({ meta: [{ title: "Live Sure Bets — Dashboard" }] }),
  component: Dashboard,
});

interface EngineStatus {
  running: boolean;
  lastPollAt: string | null;
  arbsDetectedTotal: number;
}
interface Stats {
  arbsDetected: number;
  totalPotentialProfit: number;
}

function Dashboard() {
  const { arbs, acknowledgeArb } = useLiveArbs();

  const statusQuery = useQuery<EngineStatus>({
    queryKey: ["engine-status"],
    queryFn: async () => {
      const res = await fetch("/api/engine-status");
      return res.json();
    },
    refetchInterval: 5000,
  });

  const statsQuery = useQuery<Stats>({
    queryKey: ["stats"],
    queryFn: async () => {
      const res = await fetch("/api/stats");
      return res.json();
    },
    refetchInterval: 15000,
  });

  const runNow = async () => {
    await fetch("/api/public/poll");
    statusQuery.refetch();
    statsQuery.refetch();
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const lastPollSeconds = statusQuery.data?.lastPollAt
    ? Math.round((Date.now() - new Date(statusQuery.data.lastPollAt).getTime()) / 1000)
    : null;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-emerald-500" />
            <h1 className="text-lg font-semibold text-foreground">Sure Bets</h1>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to="/agent">
                <Shield className="h-4 w-4" />
                Agent
              </Link>
            </Button>
            <Button variant="outline" size="sm" onClick={runNow}>
              <RefreshCw className="h-4 w-4" />
              Scan now
            </Button>
            <Button variant="ghost" size="sm" onClick={signOut}>
              <LogOut className="h-4 w-4" />
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <StatTile
            label="Engine"
            value={statusQuery.data?.running ? "Running" : "Idle"}
            tone={statusQuery.data?.running ? "ok" : "warn"}
            icon={<Activity className="h-4 w-4" />}
          />
          <StatTile
            label="Last poll"
            value={lastPollSeconds !== null ? `${lastPollSeconds}s ago` : "—"}
          />
          <StatTile
            label="Arbs (1h)"
            value={String(statsQuery.data?.arbsDetected ?? statusQuery.data?.arbsDetectedTotal ?? 0)}
          />
          <StatTile
            label="Potential profit (1h)"
            value={
              statsQuery.data
                ? `+${statsQuery.data.totalPotentialProfit.toFixed(2)}`
                : "—"
            }
            tone="ok"
          />
        </div>

        <section className="mt-6 space-y-3">
          {arbs.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-card/50 py-16">
              <span className="relative flex h-3 w-3">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500" />
              </span>
              <p className="text-sm text-muted-foreground">Scanning for sure bets...</p>
            </div>
          ) : (
            arbs.map((arb) => <ArbCard key={arb.id} arb={arb} onAcknowledge={acknowledgeArb} />)
          )}
        </section>
      </main>
    </div>
  );
}

function StatTile({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: string;
  tone?: "ok" | "warn";
  icon?: React.ReactNode;
}) {
  const toneClass =
    tone === "ok"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "warn"
        ? "text-amber-600 dark:text-amber-400"
        : "text-foreground";
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${toneClass}`}>{value}</div>
    </div>
  );
}