import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";
import { useBetLogs } from "@/hooks/useAgent";
import { assessAccountRisk, mugBetsNeeded, type BookExposure } from "@/lib/arb/account-safety";

/**
 * Account-longevity view: how concentrated turnover is per bookmaker, how much
 * of each book's action is arb legs, and what to do before the book notices.
 */
export function AccountSafetyPanel() {
  const logs = useBetLogs(200);

  const { risks, betsByBook } = useMemo(() => {
    const map = new Map<string, { turnover: number; bets: number; arbBets: number }>();
    for (const l of logs) {
      const key = (l.bookmaker ?? "unknown").toLowerCase();
      const e = map.get(key) ?? { turnover: 0, bets: 0, arbBets: 0 };
      e.turnover += Number(l.stake ?? 0);
      e.bets += 1;
      if ((l.bet_type ?? "arb") !== "mug") e.arbBets += 1;
      map.set(key, e);
    }
    const exposures: BookExposure[] = Array.from(map.entries()).map(([bookmaker, e]) => ({
      bookmaker,
      turnover: e.turnover,
      bets: e.bets,
      arbShare: e.bets ? e.arbBets / e.bets : 0,
    }));
    const betsByBook = new Map(Array.from(map.entries()).map(([k, v]) => [k, v.bets]));
    return { risks: assessAccountRisk(exposures), betsByBook };
  }, [logs]);

  return (
    <Card className="p-4">
      <div className="mb-3">
        <div className="text-sm font-medium">Account safety</div>
        <div className="text-xs text-muted-foreground">
          Turnover concentration and arb-vs-recreational mix per bookmaker
        </div>
      </div>
      {risks.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
          No placed bets logged yet.
        </div>
      ) : (
        <div className="space-y-2">
          {risks.map((r) => {
            const Icon =
              r.level === "hot" ? ShieldAlert : r.level === "watch" ? ShieldQuestion : ShieldCheck;
            const tone =
              r.level === "hot"
                ? "text-rose-500"
                : r.level === "watch"
                  ? "text-amber-500"
                  : "text-emerald-500";
            const mugs = mugBetsNeeded(betsByBook.get(r.bookmaker) ?? 0, r.arbShare);
            return (
              <div key={r.bookmaker} className="rounded-lg border border-border bg-background/40 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Icon className={`h-4 w-4 ${tone}`} />
                    <span className="text-sm font-medium capitalize">{r.bookmaker}</span>
                  </div>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {(r.turnoverShare * 100).toFixed(0)}% turnover · {(r.arbShare * 100).toFixed(0)}% arb legs
                  </span>
                </div>
                <div className={`mt-1 text-xs ${tone}`}>{r.advice}</div>
                {mugs > 0 && (
                  <div className="text-[11px] text-muted-foreground">
                    ~{mugs} recreational bet{mugs === 1 ? "" : "s"} would restore a healthy mix.
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}