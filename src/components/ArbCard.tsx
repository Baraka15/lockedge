import { Check, Clock, Copy, TrendingUp, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useBookmakerHealth, confidenceScore } from "@/hooks/useBookmakerHealth";
import type { ArbOpportunity } from "@/lib/odds/types";

interface Props {
  arb: ArbOpportunity;
  onAcknowledge: (id: string) => void;
}

function useCountdown(expiresAt: string): number {
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 1000)),
  );
  useEffect(() => {
    const i = setInterval(() => {
      setRemaining(Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 1000)));
    }, 250);
    return () => clearInterval(i);
  }, [expiresAt]);
  return remaining;
}

export function ArbCard({ arb, onAcknowledge }: Props) {
  const remaining = useCountdown(arb.expiresAt);
  const profit = (arb.requiredTotalStake / arb.totalArbPercent) * 100 - arb.requiredTotalStake;
  const profitPct = ((100 - arb.totalArbPercent) / arb.totalArbPercent) * 100;
  const health = useBookmakerHealth();

  // pulse tier based on time remaining: red <30s, yellow 30-120s, green >120s
  const tier = remaining < 30 ? "red" : remaining < 120 ? "yellow" : "green";
  const urgent = remaining <= 3;

  const reliabilities = arb.outcomes.map((o) => {
    const h = health.find((x) => x.bookmaker === o.bookmaker.toLowerCase());
    return h?.reliability ?? 0.7;
  });
  const confidence = confidenceScore({
    edgePct: profitPct, secondsRemaining: remaining, bookmakerReliability: reliabilities,
  });

  const copyStake = async (value: number, label: string) => {
    await navigator.clipboard.writeText(value.toFixed(2));
    toast.success(`Copied ${label} stake: ${value.toFixed(2)}`);
  };

  const manualPlace = async () => {
    try {
      const { data: userData } = await supabase.auth.getUser();
      const { error } = await (supabase as any).from("agent_commands").insert({
        command: "place_arb", payload: { arb_id: arb.id, force: true },
        created_by: userData.user?.id ?? null,
      });
      if (error) throw error;
      toast.success("Manual place queued — bot will execute immediately");
    } catch (e) {
      toast.error(`Queue failed: ${(e as Error).message}`);
    }
  };

  const stripeCls = tier === "red"
    ? "bg-rose-500 animate-pulse"
    : tier === "yellow" ? "bg-amber-500" : "bg-emerald-500";

  return (
    <div className="group relative overflow-hidden rounded-xl border border-border bg-card p-5 shadow-sm transition-all hover:shadow-md">
      <div aria-hidden className={`absolute inset-x-0 top-0 h-1 transition-colors ${stripeCls}`} />

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="truncate text-lg font-semibold text-foreground">{arb.eventName}</h3>
          <p className="mt-0.5 flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
            <span>{arb.marketType}</span>
            <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
              confidence >= 70 ? "bg-emerald-500/15 text-emerald-400"
              : confidence >= 40 ? "bg-amber-500/15 text-amber-400"
              : "bg-rose-500/15 text-rose-400"
            }`}>conf {confidence}</span>
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
            <TrendingUp className="h-3.5 w-3.5" />
            +{profitPct.toFixed(2)}%
          </div>
          <div
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums ${
              urgent
                ? "bg-destructive/10 text-destructive"
                : "bg-muted text-muted-foreground"
            }`}
          >
            <Clock className="h-3.5 w-3.5" />
            {remaining}s
          </div>
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Outcome</th>
              <th className="px-3 py-2 text-left font-medium">Bookmaker</th>
              <th className="px-3 py-2 text-right font-medium">Odds</th>
              <th className="px-3 py-2 text-right font-medium">Stake</th>
              <th className="px-3 py-2 text-right font-medium sr-only">Copy</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {arb.outcomes.map((o) => (
              <tr key={`${o.name}-${o.bookmaker}`}>
                <td className="px-3 py-2 capitalize text-foreground">{o.name}</td>
                <td className="px-3 py-2 capitalize text-muted-foreground">{o.bookmaker}</td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                  {o.odds.toFixed(2)}
                </td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums text-foreground">
                  {o.stake.toFixed(2)}
                </td>
                <td className="px-2 py-1 text-right">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => copyStake(o.stake, o.name)}
                    aria-label={`Copy stake for ${o.name}`}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <div className="text-xs text-muted-foreground tabular-nums">
          Total stake <span className="font-semibold text-foreground">{arb.requiredTotalStake.toFixed(2)}</span>
          {" • "}
          Guaranteed profit <span className="font-semibold text-emerald-600 dark:text-emerald-400">+{profit.toFixed(2)}</span>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={manualPlace}>
            <Zap className="mr-1 h-4 w-4" />
            Place now
          </Button>
          <Button size="sm" onClick={() => onAcknowledge(arb.id)}>
            <Check className="h-4 w-4" />
            Placed
          </Button>
        </div>
      </div>
    </div>
  );
}