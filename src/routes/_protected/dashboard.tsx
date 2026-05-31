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

interface LiveEventOutcome {
  name: string;
  bestPrice: number;
  bookmaker: string;
  bookmakerCount: number;
}
interface LiveEvent {
  event_key: string;
  sport: string;
  event_name: string;
  event_date: string;
  market_type: string;
  bookmaker_count: number;
  outcomes: LiveEventOutcome[];
  updated_at: string;
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

  const liveEventsQuery = useQuery<{ ok: boolean; events: LiveEvent[] }>({
    queryKey: ["live-events"],
    queryFn: async () => {
      const res = await fetch("/api/live-events");
      return res.json();
    },
    refetchInterval: 5000,
  });
  const liveEvents = liveEventsQuery.data?.events ?? [];

  const runNow = async () => {
    await fetch("/api/public/poll");
    statusQuery.refetch();
    statsQuery.refetch();
    liveEventsQuery.refetch();
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

        <section className="mt-10">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-base font-semibold text-foreground">Live events</h2>
            <span className="text-xs text-muted-foreground">
              {liveEvents.length} match{liveEvents.length === 1 ? "" : "es"} scanned
            </span>
          </div>
          {liveEvents.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-card/50 py-10 text-center text-sm text-muted-foreground">
              No live events yet. Run a scan to populate the feed.
            </div>
          ) : (
            <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
              {liveEvents.map((ev) => (
                <LiveEventRow key={ev.event_key} ev={ev} />
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function LiveEventRow({ ev }: { ev: LiveEvent }) {
  const when = new Date(ev.event_date);
  const whenLabel = when.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  // Implied book = sum(1/bestPrice). <1 means a guaranteed-profit arb exists.
  const impliedSum = ev.outcomes.reduce(
    (s, o) => (o.bestPrice > 0 ? s + 1 / o.bestPrice : s),
    0,
  );
  const hasArb = impliedSum > 0 && impliedSum < 1;
  const profitPct = hasArb ? (1 - impliedSum) * 100 : 0;
  const marginPct = !hasArb && impliedSum > 0 ? (impliedSum - 1) * 100 : 0;
  return (
    <div className="px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="text-sm font-medium capitalize text-foreground">
            {ev.event_name}
          </div>
          <div className="text-xs text-muted-foreground">
            {ev.sport.replace(/_/g, " ")} · {whenLabel} · {ev.bookmaker_count} bookmaker
            {ev.bookmaker_count === 1 ? "" : "s"}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {hasArb ? (
            <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
              Sure bet +{profitPct.toFixed(2)}%
            </span>
          ) : (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
              Margin {marginPct.toFixed(2)}%
            </span>
          )}
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            {ev.market_type}
          </span>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {ev.outcomes.map((o) => (
          <div
            key={o.name}
            className="rounded-md border border-border bg-background/40 px-2 py-1.5"
          >
            <div className="truncate text-xs capitalize text-muted-foreground">
              {o.name}
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-semibold tabular-nums text-foreground">
                {o.bestPrice.toFixed(2)}
              </span>
              <span className="truncate text-[10px] text-muted-foreground">
                {o.bookmaker}
              </span>
            </div>
          </div>
        ))}
      </div>
      {hasArb && (
        <div className="mt-2 text-[11px] text-emerald-600 dark:text-emerald-400">
          Implied book {(impliedSum * 100).toFixed(2)}% — guaranteed profit if all
          legs are staked proportionally.
        </div>
      )}
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