import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useBookmakerHealth } from "@/hooks/useBookmakerHealth";
import { useBetLogs } from "@/hooks/useAgent";
import { useState } from "react";
import { Activity, RefreshCw, Terminal } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const sb = supabase as unknown as { from: (t: string) => any; auth: typeof supabase.auth };

function fmtAge(iso: string | null): string {
  if (!iso) return "—";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

export function BotHealthPanel() {
  const health = useBookmakerHealth();
  const logs = useBetLogs(100);
  const [filter, setFilter] = useState<{ bm?: string; level?: string }>({});

  const forceRelogin = async (bm: string) => {
    const { data: userData } = await supabase.auth.getUser();
    const { error } = await sb.from("agent_commands").insert({
      command: "refresh_balances", payload: { bookmaker: bm },
      created_by: userData.user?.id ?? null,
    });
    if (error) toast.error(error.message); else toast.success(`Re-login queued for ${bm}`);
  };

  const filtered = logs.filter((l) => {
    if (filter.bm && l.bookmaker !== filter.bm) return false;
    if (filter.level === "failed" && l.result !== "failed") return false;
    if (filter.level === "success" && l.result !== "success") return false;
    return true;
  });

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {health.length === 0 ? (
          <Card className="p-8 text-center text-sm text-muted-foreground sm:col-span-2 lg:col-span-3">
            No bookmaker activity yet. Health populates after first bet.
          </Card>
        ) : health.map((b) => (
          <Card key={b.bookmaker} className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Bookmaker</div>
                <div className="text-lg font-semibold capitalize">{b.bookmaker}</div>
              </div>
              <Badge variant="outline"
                className={b.reliability > 0.8 ? "border-emerald-500/40 text-emerald-400"
                  : b.reliability > 0.5 ? "border-amber-500/40 text-amber-400"
                  : "border-rose-500/40 text-rose-400"}>
                {(b.reliability * 100).toFixed(0)}% rel.
              </Badge>
            </div>
            <dl className="mt-3 space-y-1.5 text-xs">
              <div className="flex justify-between"><dt className="text-muted-foreground">Balance</dt>
                <dd className="font-mono">{b.balance != null ? b.balance.toFixed(2) : "—"}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Session age</dt>
                <dd>{fmtAge(b.sessionStartedAt)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Last bet</dt>
                <dd>{fmtAge(b.lastBetAt)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">7d success</dt>
                <dd>{b.totalBets ? `${b.successes}/${b.totalBets} (${(b.successRate * 100).toFixed(0)}%)` : "—"}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Avg drift</dt>
                <dd>{b.avgDriftPct != null ? `${b.avgDriftPct.toFixed(2)}%` : "—"}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Captcha hits</dt>
                <dd className={b.captchaCount > 0 ? "text-rose-400" : ""}>{b.captchaCount}</dd></div>
            </dl>
            <div className="mt-3">
              <Button size="sm" variant="outline" className="w-full" onClick={() => forceRelogin(b.bookmaker)}>
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Force re-login
              </Button>
            </div>
          </Card>
        ))}
      </div>

      <Card>
        <div className="flex items-center justify-between border-b border-border/60 px-5 py-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Terminal className="h-4 w-4" /> Live bet log stream
          </div>
          <div className="flex gap-1">
            <select value={filter.bm ?? ""} onChange={(e) => setFilter({ ...filter, bm: e.target.value || undefined })}
              className="rounded-md border border-input bg-background px-2 py-1 text-xs">
              <option value="">All bookmakers</option>
              {health.map((h) => <option key={h.bookmaker} value={h.bookmaker}>{h.bookmaker}</option>)}
            </select>
            <select value={filter.level ?? ""} onChange={(e) => setFilter({ ...filter, level: e.target.value || undefined })}
              className="rounded-md border border-input bg-background px-2 py-1 text-xs">
              <option value="">All results</option>
              <option value="success">Success only</option>
              <option value="failed">Failed only</option>
            </select>
          </div>
        </div>
        <div className="max-h-96 overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>BM</TableHead>
                <TableHead>Outcome</TableHead>
                <TableHead className="text-right">Stake</TableHead>
                <TableHead>Result</TableHead>
                <TableHead>Phase</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="font-mono text-[11px] text-muted-foreground">
                    {new Date(l.logged_at).toLocaleTimeString()}
                  </TableCell>
                  <TableCell className="capitalize">{l.bookmaker}</TableCell>
                  <TableCell className="max-w-[200px] truncate">{l.outcome}</TableCell>
                  <TableCell className="text-right font-mono">{l.stake != null ? Number(l.stake).toFixed(2) : "—"}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={
                      l.result === "success" ? "border-emerald-500/40 text-emerald-400"
                      : l.result === "failed" ? "border-rose-500/40 text-rose-400"
                      : "border-zinc-500/40 text-zinc-400"
                    }>{l.result ?? "—"}</Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{(l.details as any)?.phase ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>

      <Card className="p-4">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
          <Activity className="h-3.5 w-3.5" /> Session timeline (24h)
        </div>
        <div className="mt-3 space-y-2">
          {health.map((b) => {
            const startedMs = b.sessionStartedAt ? new Date(b.sessionStartedAt).getTime() : null;
            const ageH = startedMs ? Math.min(24, (Date.now() - startedMs) / 3600_000) : 0;
            const pct = (ageH / 24) * 100;
            return (
              <div key={b.bookmaker} className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="capitalize">{b.bookmaker}</span>
                  <span className="text-muted-foreground">{b.sessionStartedAt ? `${ageH.toFixed(1)}h ago` : "—"}</span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}