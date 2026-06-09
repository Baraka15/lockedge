import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Bar, BarChart, CartesianGrid, Cell, Line, LineChart,
  ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis,
} from "recharts";
import { useSettlements } from "@/hooks/usePerformance";
import { useBookmakerHealth } from "@/hooks/useBookmakerHealth";

type Bucket = "day" | "week" | "month";

function bucketKey(d: Date, b: Bucket): string {
  if (b === "day") return d.toISOString().slice(0, 10);
  if (b === "week") {
    const onejan = new Date(d.getFullYear(), 0, 1);
    const week = Math.ceil((((d.getTime() - onejan.getTime()) / 86_400_000) + onejan.getDay() + 1) / 7);
    return `${d.getFullYear()}-W${String(week).padStart(2, "0")}`;
  }
  return d.toISOString().slice(0, 7);
}

export function PerformanceAnalytics() {
  const { items } = useSettlements(500);
  const health = useBookmakerHealth();
  const [bucket, setBucket] = useState<Bucket>("day");

  const roiSeries = useMemo(() => {
    const buckets = new Map<string, { key: string; profit: number; staked: number }>();
    for (const s of items) {
      const k = bucketKey(new Date(s.settled_at), bucket);
      const e = buckets.get(k) ?? { key: k, profit: 0, staked: 0 };
      e.profit += Number(s.profit); e.staked += Number(s.total_staked);
      buckets.set(k, e);
    }
    return Array.from(buckets.values())
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((x) => ({ key: x.key, roi: x.staked > 0 ? (x.profit / x.staked) * 100 : 0, profit: x.profit }));
  }, [items, bucket]);

  const edgeHistogram = useMemo(() => {
    const buckets: Record<string, number> = { "<1%": 0, "1-2%": 0, "2-3%": 0, "3-5%": 0, "5%+": 0 };
    for (const s of items) {
      const e = s.total_staked > 0 ? (Number(s.profit) / Number(s.total_staked)) * 100 : 0;
      if (e < 1) buckets["<1%"]++;
      else if (e < 2) buckets["1-2%"]++;
      else if (e < 3) buckets["2-3%"]++;
      else if (e < 5) buckets["3-5%"]++;
      else buckets["5%+"]++;
    }
    return Object.entries(buckets).map(([k, v]) => ({ bin: k, count: v }));
  }, [items]);

  const totals = items.reduce((acc, s) => {
    acc.profit += Number(s.profit); acc.staked += Number(s.total_staked); acc.count++;
    if (Number(s.profit) > 0) acc.wins++;
    return acc;
  }, { profit: 0, staked: 0, count: 0, wins: 0 });
  const winRate = totals.count ? totals.wins / totals.count : 0;
  const daysActive = new Set(items.map((s) => s.settled_at.slice(0, 10))).size || 1;
  const dailyAvg = totals.profit / daysActive;
  const projectedMonthly = dailyAvg * 30;

  const bookmakerRank = [...health].sort((a, b) => b.reliability - a.reliability);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Daily avg profit</div>
          <div className="mt-1 text-2xl font-semibold">{dailyAvg.toFixed(2)}</div>
          <div className="text-[11px] text-muted-foreground">over {daysActive} active day(s)</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Projected monthly</div>
          <div className={`mt-1 text-2xl font-semibold ${projectedMonthly >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
            {projectedMonthly >= 0 ? "+" : ""}{projectedMonthly.toFixed(2)}
          </div>
          <div className="text-[11px] text-muted-foreground">@ current win rate {(winRate * 100).toFixed(1)}%</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Arbs / day</div>
          <div className="mt-1 text-2xl font-semibold">{(totals.count / daysActive).toFixed(1)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Lifetime ROI</div>
          <div className="mt-1 text-2xl font-semibold">{totals.staked > 0 ? ((totals.profit / totals.staked) * 100).toFixed(2) : "0"}%</div>
        </Card>
      </div>

      <Card className="p-4">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-sm font-medium">ROI over time</div>
          <div className="flex gap-1">
            {(["day", "week", "month"] as const).map((b) => (
              <Button key={b} size="sm" variant={bucket === b ? "default" : "outline"} onClick={() => setBucket(b)}>
                {b}
              </Button>
            ))}
          </div>
        </div>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={roiSeries}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
              <XAxis dataKey="key" fontSize={11} />
              <YAxis fontSize={11} unit="%" />
              <ChartTooltip />
              <Line type="monotone" dataKey="roi" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <div className="mb-2 text-sm font-medium">Edge distribution</div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={edgeHistogram}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                <XAxis dataKey="bin" fontSize={11} />
                <YAxis fontSize={11} allowDecimals={false} />
                <ChartTooltip />
                <Bar dataKey="count" fill="hsl(var(--primary))">
                  {edgeHistogram.map((_, i) => <Cell key={i} fill="hsl(var(--primary))" />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card className="p-4">
          <div className="mb-2 text-sm font-medium">Bookmaker ranking</div>
          <div className="space-y-2">
            {bookmakerRank.length === 0 ? (
              <div className="text-sm text-muted-foreground">No data yet.</div>
            ) : bookmakerRank.map((b, i) => (
              <div key={b.bookmaker} className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-muted-foreground">#{i + 1}</span>
                  <span className="capitalize font-medium">{b.bookmaker}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {(b.reliability * 100).toFixed(0)}% reliable · {b.successes}/{b.totalBets} bets
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}