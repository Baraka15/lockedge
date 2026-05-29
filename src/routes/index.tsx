import { createFileRoute, Link } from "@tanstack/react-router";
import { Activity, Clock, ShieldCheck, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Sure Bets — Real-time sports arbitrage" },
      {
        name: "description",
        content:
          "Detect risk-free betting opportunities across bookmakers in real time. Sub-second alerts, exact stake splits, manual execution.",
      },
      { property: "og:title", content: "Sure Bets — Real-time sports arbitrage" },
      {
        property: "og:description",
        content: "Detect risk-free betting opportunities across bookmakers in real time.",
      },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen bg-background">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
        <div className="flex items-center gap-2">
          <Zap className="h-5 w-5 text-emerald-500" />
          <span className="font-semibold text-foreground">Sure Bets</span>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link to="/login">Sign in</Link>
          </Button>
          <Button asChild size="sm">
            <Link to="/signup">Get started</Link>
          </Button>
        </div>
      </nav>

      <main className="mx-auto max-w-3xl px-4 py-24 text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          Live engine running
        </span>
        <h1 className="mt-6 text-balance text-5xl font-bold tracking-tight text-foreground">
          Risk-free bets, detected in seconds.
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-balance text-lg text-muted-foreground">
          Continuously scans bookmaker odds, finds mathematically guaranteed
          arbitrage opportunities, and pushes them to your dashboard with the
          exact stake split.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Button asChild size="lg">
            <Link to="/signup">Start scanning</Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link to="/login">I have an account</Link>
          </Button>
        </div>

        <div className="mt-20 grid grid-cols-1 gap-4 text-left sm:grid-cols-3">
          <Feature
            icon={<Activity className="h-5 w-5 text-emerald-500" />}
            title="Real-time"
            body="Realtime push from server to dashboard the instant an arb is detected."
          />
          <Feature
            icon={<Clock className="h-5 w-5 text-emerald-500" />}
            title="Heartbeat-validated"
            body="Stale odds are discarded so you never act on prices that vanished seconds ago."
          />
          <Feature
            icon={<ShieldCheck className="h-5 w-5 text-emerald-500" />}
            title="Manual execution"
            body="You place the bets. No bookmaker bans, no autopilot risk."
          />
        </div>
      </main>
    </div>
  );
}

function Feature({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center gap-2">
        {icon}
        <h3 className="font-semibold text-foreground">{title}</h3>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{body}</p>
    </div>
  );
}
