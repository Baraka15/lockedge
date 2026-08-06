import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  CartesianGrid, Legend, Line, LineChart, ResponsiveContainer,
  Tooltip as ChartTooltip, XAxis, YAxis,
} from "recharts";
import { useProfitGap, type GapWindow } from "@/hooks/useProfitGap";

const WINDOWS: GapWindow[] = [7, 30, 90];

function fmt(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}`;
}

/**
 * Rolling actual-vs-theoretical profit tracker. Theoretical = the edge the arb
 * card promised at detection; actual = the P&L that landed after placement.
 */
export function ProfitGapTracker() {
  const [windowDays, setWindowDays] = useState<GapWindow>(30);
  const { summary, cumulative } = useProfitGap(windowDays);

  const capture = summary.count ? summary.captureRate * 100 : 0;
  const captureTone =
    capture >= 90 ? "text-emerald-500" : capture >= 70 ? "text-amber-500" : "text-rose-500";

  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-medium">Actual vs theoretical profit</div>
          <div className="text-xs text-muted-foreground">
            Gap between on-screen arb edges and what actually landed
          </div>
        </div>
        <div className="flex gap-1">
          {WINDOWS.map((w) => (
            <Button
              key={w}
              size="sm"
              variant={windowDays === w ? "default" : "outline"}
              onClick={() => setWindowDays(w)}
            >
              {w}d
            </Button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Theoretical" value={fmt(summary.theoretical)}
          sub={`${summary.theoreticalEdgePct.toFixed(2)}% of turnover`} />
        <Tile label="Actual" value={fmt(summary.actual)}
          sub={`${summary.actualEdgePct.toFixed(2)}% of turnover`}
          tone={summary.actual >= 0 ? "text-emerald-500" : "text-rose-500"} />
        <Tile label="Slippage" value={fmt(-summary.slippage)}
          sub={`${summary.underDelivered}/${summary.count} settled under target`}
          tone={summary.slippage <= 0 ? "text-emerald-500" : "text-rose-500"} />
        <Tile label="Capture rate" value={`${capture.toFixed(1)}%`}
          sub={summary.worst ? `Worst: ${summary.worst.event}` : "No settlements yet"}
          tone={captureTone} />
      </div>

      <div className="mt-4 h-56">
        {cumulative.length === 0 ? (
          <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
            Settle an arb to start tracking the gap.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={cumulative}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
              <XAxis dataKey="key" fontSize={11} />
              <YAxis fontSize={11} />
              <ChartTooltip />
              <Legend />
              <Line type="monotone" dataKey="theoretical" name="Theoretical"
                stroke="hsl(var(--muted-foreground))" strokeDasharray="4 3" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="actual" name="Actual"
                stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="slippage" name="Slippage"
                stroke="hsl(var(--destructive))" strokeWidth={1.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-border bg-background/40 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-0.5 text-xl font-semibold tabular-nums ${tone ?? "text-foreground"}`}>{value}</div>
      {sub && <div className="truncate text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}