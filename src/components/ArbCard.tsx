import { Check, Clock, Copy, TrendingUp } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
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
  const urgent = remaining <= 3;

  const copyStake = async (value: number, label: string) => {
    await navigator.clipboard.writeText(value.toFixed(2));
    toast.success(`Copied ${label} stake: ${value.toFixed(2)}`);
  };

  return (
    <div className="group relative overflow-hidden rounded-xl border border-border bg-card p-5 shadow-sm transition-all hover:shadow-md">
      <div
        aria-hidden
        className={`absolute inset-x-0 top-0 h-1 transition-colors ${
          urgent ? "bg-destructive" : "bg-emerald-500"
        }`}
      />

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="truncate text-lg font-semibold text-foreground">{arb.eventName}</h3>
          <p className="mt-0.5 text-xs uppercase tracking-wide text-muted-foreground">
            {arb.marketType}
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
        <Button size="sm" onClick={() => onAcknowledge(arb.id)}>
          <Check className="h-4 w-4" />
          I've placed these bets
        </Button>
      </div>
    </div>
  );
}