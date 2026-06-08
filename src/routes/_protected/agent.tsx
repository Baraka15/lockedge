import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  CircleDot,
  Copy,
  Terminal,
  Pause,
  Play,
  Power,
  Send,
  Shield,
  SlidersHorizontal,
  TrendingUp,
  Wallet,
  Wifi,
  WifiOff,
} from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  useAgentCommands,
  useAgentStatus,
  useBalances,
  useBetLogs,
} from "@/hooks/useAgent";
import { useOddsApiHealth, useSettlements } from "@/hooks/usePerformance";

export const Route = createFileRoute("/_protected/agent")({
  head: () => ({ meta: [{ title: "Agent Command Center" }] }),
  component: AgentCommandCenter,
});

const statusColor: Record<string, string> = {
  online: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  offline: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
  paused: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  error: "bg-rose-500/15 text-rose-400 border-rose-500/30",
  stale: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  unknown: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
};

const resultColor: Record<string, string> = {
  success: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  partial: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  failed: "bg-rose-500/15 text-rose-400 border-rose-500/30",
  pending: "bg-sky-500/15 text-sky-400 border-sky-500/30",
};

function AgentCommandCenter() {
  const { status, derivedStatus, secondsSinceHeartbeat } = useAgentStatus();
  const { commands, sendCommand } = useAgentCommands();
  const logs = useBetLogs();
  const { balances, totals } = useBalances();

  const [sending, setSending] = useState<string | null>(null);

  const dispatch = async (
    command: string,
    payload: Record<string, unknown> = {},
  ) => {
    try {
      setSending(command);
      await sendCommand(command, payload);
      toast.success(`Command "${command}" queued`);
    } catch (e) {
      toast.error(`Failed to send command: ${(e as Error).message}`);
    } finally {
      setSending(null);
    }
  };

  const isControllable = derivedStatus !== "unknown";

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/60 bg-card/40 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <Shield className="h-5 w-5 text-primary" />
            <div>
              <h1 className="text-lg font-semibold tracking-tight">
                Agent Command Center
              </h1>
              <p className="text-xs text-muted-foreground">
                Remote control & telemetry for the execution bot
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <OddsApiBadge />
            <Button asChild variant="ghost" size="sm">
              <Link to="/dashboard">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Dashboard
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        <ConnectBotCard online={derivedStatus === "online"} />
        <RiskSettingsCard />
        {/* Status + control row */}
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="p-5 lg:col-span-2">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
                  <Activity className="h-3.5 w-3.5" />
                  Agent status
                </div>
                <div className="flex items-center gap-3">
                  <CircleDot
                    className={`h-5 w-5 ${
                      derivedStatus === "online"
                        ? "text-emerald-400 animate-pulse"
                        : derivedStatus === "error"
                          ? "text-rose-400"
                          : derivedStatus === "paused"
                            ? "text-amber-400"
                            : "text-zinc-500"
                    }`}
                  />
                  <span className="text-2xl font-semibold capitalize">
                    {derivedStatus}
                  </span>
                  <Badge
                    variant="outline"
                    className={statusColor[derivedStatus] ?? statusColor.unknown}
                  >
                    primary
                  </Badge>
                </div>
                <div className="text-sm text-muted-foreground">
                  {status ? (
                    <>
                      Last heartbeat{" "}
                      <span className="font-mono text-foreground">
                        {secondsSinceHeartbeat}s
                      </span>{" "}
                      ago
                      {status.version && (
                        <>
                          {" "}
                          · v
                          <span className="font-mono">{status.version}</span>
                        </>
                      )}
                    </>
                  ) : (
                    "Waiting for first heartbeat from local bot…"
                  )}
                </div>
                {derivedStatus === "stale" && (
                  <div className="flex items-center gap-2 rounded-md border border-orange-500/30 bg-orange-500/10 px-3 py-2 text-xs text-orange-300">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    No heartbeat for over 30s — the bot may have disconnected.
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!isControllable || sending !== null}
                  onClick={() => dispatch("start")}
                >
                  <Play className="mr-1.5 h-3.5 w-3.5" />
                  Start
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!isControllable || sending !== null}
                  onClick={() => dispatch("pause")}
                >
                  <Pause className="mr-1.5 h-3.5 w-3.5" />
                  Pause
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!isControllable || sending !== null}
                  onClick={() => dispatch("resume")}
                >
                  <Play className="mr-1.5 h-3.5 w-3.5" />
                  Resume
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={!isControllable || sending !== null}
                    >
                      <Power className="mr-1.5 h-3.5 w-3.5" />
                      Stop
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Stop the agent?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will queue a stop command. Any in-flight bets will
                        complete, but no new bets will be placed.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => dispatch("stop")}>
                        Stop agent
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          </Card>

          <Card className="p-5">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
              <Wallet className="h-3.5 w-3.5" />
              Total liquidity
            </div>
            <div className="mt-3 text-3xl font-semibold tracking-tight">
              {totals.balance.toLocaleString(undefined, {
                style: "currency",
                currency: "USD",
                maximumFractionDigits: 0,
              })}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              Pending returns{" "}
              <span className="font-mono text-foreground">
                {totals.pending.toLocaleString(undefined, {
                  style: "currency",
                  currency: "USD",
                  maximumFractionDigits: 0,
                })}
              </span>{" "}
              · {balances.length} accounts
            </div>
          </Card>
        </div>

        <Tabs defaultValue="actions" className="space-y-4">
          <TabsList>
            <TabsTrigger value="actions">Quick actions</TabsTrigger>
            <TabsTrigger value="performance">Performance</TabsTrigger>
            <TabsTrigger value="logs">Bet logs</TabsTrigger>
            <TabsTrigger value="balances">Balances</TabsTrigger>
            <TabsTrigger value="commands">Command history</TabsTrigger>
          </TabsList>

          <TabsContent value="actions">
            <ManualCommandPanel
              onSend={dispatch}
              disabled={!isControllable || sending !== null}
            />
          </TabsContent>

          <TabsContent value="performance">
            <PerformancePanel />
          </TabsContent>

          <TabsContent value="logs">
            <Card className="overflow-hidden">
              <div className="border-b border-border/60 px-5 py-3 text-sm font-medium">
                Recent bet executions
              </div>
              {logs.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  No bets logged yet. They'll appear here in real time as the
                  agent executes.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>When</TableHead>
                      <TableHead>Bookmaker</TableHead>
                      <TableHead>Account</TableHead>
                      <TableHead>Outcome</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Odds</TableHead>
                      <TableHead className="text-right">Stake</TableHead>
                      <TableHead>Result</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {logs.map((l) => (
                      <TableRow key={l.id}>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {new Date(l.logged_at).toLocaleTimeString()}
                        </TableCell>
                        <TableCell className="font-medium">
                          {l.bookmaker}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {l.account_label}
                        </TableCell>
                        <TableCell>{l.outcome}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="capitalize">
                            {l.bet_type}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {l.odds ?? "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {l.stake != null
                            ? Number(l.stake).toFixed(2)
                            : "—"}
                        </TableCell>
                        <TableCell>
                          {l.result ? (
                            <Badge
                              variant="outline"
                              className={resultColor[l.result] ?? ""}
                            >
                              {l.result}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Card>
          </TabsContent>

          <TabsContent value="balances">
            <Card className="overflow-hidden">
              <div className="border-b border-border/60 px-5 py-3 text-sm font-medium">
                Bookmaker balances
              </div>
              {balances.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  No balances reported. The agent will push them on each sync.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Bookmaker</TableHead>
                      <TableHead>Account</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                      <TableHead className="text-right">Pending</TableHead>
                      <TableHead className="text-right">Updated</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {balances.map((b) => (
                      <TableRow key={`${b.bookmaker}-${b.account_label}`}>
                        <TableCell className="font-medium">
                          {b.bookmaker}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {b.account_label}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {Number(b.balance).toFixed(2)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-muted-foreground">
                          {Number(b.pending_returns).toFixed(2)}
                        </TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground">
                          {new Date(b.last_updated).toLocaleTimeString()}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Card>
          </TabsContent>

          <TabsContent value="commands">
            <Card className="overflow-hidden">
              <div className="border-b border-border/60 px-5 py-3 text-sm font-medium">
                Command history
              </div>
              {commands.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  No commands sent yet.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Created</TableHead>
                      <TableHead>Command</TableHead>
                      <TableHead>Payload</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Executed</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {commands.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {new Date(c.created_at).toLocaleTimeString()}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="font-mono">
                            {c.command}
                          </Badge>
                        </TableCell>
                        <TableCell className="max-w-md truncate font-mono text-xs text-muted-foreground">
                          {Object.keys(c.payload).length === 0
                            ? "—"
                            : JSON.stringify(c.payload)}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={
                              c.status === "executed"
                                ? resultColor.success
                                : c.status === "failed"
                                  ? resultColor.failed
                                  : resultColor.pending
                            }
                          >
                            {c.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {c.executed_at
                            ? new Date(c.executed_at).toLocaleTimeString()
                            : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

function ManualCommandPanel({
  onSend,
  disabled,
}: {
  onSend: (cmd: string, payload?: Record<string, unknown>) => Promise<void>;
  disabled: boolean;
}) {
  return <ManualCommandPanelInner onSend={onSend} disabled={disabled} />;
}

type RiskSettings = {
  account_label: string;
  bankroll: number;
  max_stake_pct: number;
  max_stake_abs: number;
  min_stake_abs: number;
  min_edge_pct: number;
  kelly_fraction: number;
  auto_stake_enabled: boolean;
};

function RiskSettingsCard() {
  const sb = supabase as unknown as { from: (t: string) => any };
  const [s, setS] = useState<RiskSettings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    sb.from("risk_settings")
      .select("*")
      .eq("account_label", "primary")
      .maybeSingle()
      .then(({ data }: { data: RiskSettings | null }) => {
        setS(
          data ?? {
            account_label: "primary",
            bankroll: 0,
            max_stake_pct: 2,
            max_stake_abs: 1000,
            min_stake_abs: 1,
            min_edge_pct: 1,
            kelly_fraction: 0.25,
            auto_stake_enabled: true,
          },
        );
      });
  }, []);

  const save = async () => {
    if (!s) return;
    setSaving(true);
    const { error } = await sb
      .from("risk_settings")
      .upsert({ ...s, updated_at: new Date().toISOString() }, { onConflict: "account_label" });
    setSaving(false);
    if (error) toast.error(`Save failed: ${error.message}`);
    else toast.success("Risk settings saved");
  };

  const upd = <K extends keyof RiskSettings>(k: K, v: RiskSettings[K]) =>
    setS((prev) => (prev ? { ...prev, [k]: v } : prev));
  const num = (k: keyof RiskSettings) => (e: React.ChangeEvent<HTMLInputElement>) =>
    upd(k, Number(e.target.value) as never);

  if (!s) {
    return (
      <Card className="p-5">
        <div className="text-sm text-muted-foreground">Loading risk settings…</div>
      </Card>
    );
  }

  const fields: Array<{ key: keyof RiskSettings; label: string; step?: string; hint?: string }> = [
    { key: "bankroll", label: "Bankroll", step: "1", hint: "Total funds the bot may size against" },
    { key: "max_stake_pct", label: "Max stake %", step: "0.1", hint: "Per-leg cap as % of bankroll" },
    { key: "max_stake_abs", label: "Max stake (abs)", step: "1", hint: "Absolute ceiling per leg" },
    { key: "min_stake_abs", label: "Min stake", step: "0.5", hint: "Skip legs below this size" },
    { key: "min_edge_pct", label: "Min edge %", step: "0.1", hint: "Skip arbs below this profit %" },
    { key: "kelly_fraction", label: "Kelly fraction", step: "0.05", hint: "0.25 = ¼-Kelly (safer)" },
  ];

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Risk &amp; auto-stake
          </div>
          <h2 className="text-lg font-semibold">Bankroll-aware stake sizing</h2>
          <p className="max-w-xl text-sm text-muted-foreground">
            The bot sizes each leg with fractional Kelly on the arb edge,
            then clamps by your bankroll %, absolute cap, and min thresholds.
          </p>
        </div>
        <div className="flex items-center gap-3 rounded-md border border-border/60 bg-muted/40 px-3 py-2">
          <Switch
            checked={s.auto_stake_enabled}
            onCheckedChange={(v) => upd("auto_stake_enabled", v)}
          />
          <span className="text-sm">
            Auto-stake {s.auto_stake_enabled ? "on" : "off"}
          </span>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {fields.map((f) => (
          <div key={f.key} className="space-y-1">
            <Label className="text-xs">{f.label}</Label>
            <Input
              type="number"
              step={f.step}
              value={s[f.key] as number}
              onChange={num(f.key)}
            />
            {f.hint && <p className="text-[11px] text-muted-foreground">{f.hint}</p>}
          </div>
        ))}
      </div>

      <div className="mt-4 flex justify-end">
        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save risk settings"}
        </Button>
      </div>
    </Card>
  );
}

function ConnectBotCard({ online }: { online: boolean }) {
  const cmd = "cd bot && npm install && node index.js";
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? "";
  const supabaseAnon =
    import.meta.env.VITE_SUPABASE_ANON_KEY ??
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
    "";
  const envSnippet = [
    "# Supabase (auto-injected from Lovable Cloud)",
    `SUPABASE_URL=${supabaseUrl}`,
    `SUPABASE_ANON_KEY=${supabaseAnon}`,
    "",
    "# Fill these in:",
    "BETPAWA_EMAIL=",
    "BETPAWA_PASSWORD=",
    "THEODDSAPI_KEY=",
  ].join("\n");
  const copyText = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied`);
    } catch {
      toast.error("Copy failed");
    }
  };
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl space-y-2">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
            <Terminal className="h-3.5 w-3.5" />
            Connect your local bot
          </div>
          <h2 className="text-lg font-semibold">
            {online ? "Bot connected" : "Bot not connected yet"}
          </h2>
          <p className="text-sm text-muted-foreground">
            Puppeteer can't run on Lovable Cloud, so the execution bot runs on
            your own machine. It polls this dashboard for commands, places bets
            on BetPawa, and streams results back here in real time.
          </p>
          <ol className="ml-4 list-decimal space-y-1 text-sm text-muted-foreground">
            <li>Copy the <code className="rounded bg-muted px-1 font-mono text-xs">bot/</code> folder to your machine.</li>
            <li>Click <strong>Copy Bot .env</strong> → paste into <code className="rounded bg-muted px-1 font-mono text-xs">bot/.env</code> → add your BetPawa email + password.</li>
            <li>Run the command on the right. The status above flips to <span className="text-emerald-400">online</span> on first heartbeat.</li>
          </ol>
        </div>
        <div className="flex w-full max-w-md flex-col gap-2 lg:w-auto">
          <div className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-muted/40 px-3 py-2 font-mono text-xs">
            <span className="truncate">{cmd}</span>
            <Button size="sm" variant="ghost" onClick={() => copyText(cmd, "Command")}>
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => copyText(envSnippet, "Bot .env")}
          >
            <Copy className="mr-1.5 h-3.5 w-3.5" />
            Copy Bot .env
          </Button>
          <p className="text-xs text-muted-foreground">
            See <code className="rounded bg-muted px-1 font-mono">bot/README.md</code>{" "}
            for full setup, env vars, and pm2 instructions.
          </p>
        </div>
      </div>
    </Card>
  );
}

function ManualCommandPanelInner({
  onSend,
  disabled,
}: {
  onSend: (cmd: string, payload?: Record<string, unknown>) => Promise<void>;
  disabled: boolean;
}) {
  const [arbId, setArbId] = useState("");
  const [stake, setStake] = useState("");
  const [bookmaker, setBookmaker] = useState("");
  const [outcome, setOutcome] = useState("");
  const [odds, setOdds] = useState("");
  const [customCmd, setCustomCmd] = useState("");
  const [customPayload, setCustomPayload] = useState("{}");

  const submitBet = (kind: "mug_bet" | "hedge" | "manual") => async () => {
    const payload: Record<string, unknown> = {};
    if (arbId) payload.arb_id = arbId;
    if (bookmaker) payload.bookmaker = bookmaker;
    if (outcome) payload.outcome = outcome;
    if (stake) payload.stake = Number(stake);
    if (odds) payload.odds = Number(odds);
    await onSend(kind, payload);
  };

  const submitCustom = async () => {
    if (!customCmd.trim()) {
      toast.error("Command is required");
      return;
    }
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(customPayload || "{}");
    } catch {
      toast.error("Payload must be valid JSON");
      return;
    }
    await onSend(customCmd.trim(), parsed);
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="p-5">
        <h3 className="text-sm font-semibold">Place a targeted bet</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Queue a mug bet, hedge, or fully manual execution. Leave fields blank
          to let the agent fill them.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="arb">Arb ID (optional)</Label>
            <Input
              id="arb"
              value={arbId}
              onChange={(e) => setArbId(e.target.value)}
              placeholder="uuid"
              className="font-mono text-xs"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bm">Bookmaker</Label>
            <Input
              id="bm"
              value={bookmaker}
              onChange={(e) => setBookmaker(e.target.value)}
              placeholder="pinnacle"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="out">Outcome</Label>
            <Input
              id="out"
              value={outcome}
              onChange={(e) => setOutcome(e.target.value)}
              placeholder="home"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="odds">Odds</Label>
            <Input
              id="odds"
              type="number"
              step="0.01"
              value={odds}
              onChange={(e) => setOdds(e.target.value)}
              placeholder="2.10"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="stake">Stake</Label>
            <Input
              id="stake"
              type="number"
              step="0.01"
              value={stake}
              onChange={(e) => setStake(e.target.value)}
              placeholder="50.00"
            />
          </div>
        </div>
        <Separator className="my-4" />
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={submitBet("mug_bet")}
          >
            <Send className="mr-1.5 h-3.5 w-3.5" />
            Mug bet
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={submitBet("hedge")}
          >
            <Send className="mr-1.5 h-3.5 w-3.5" />
            Hedge
          </Button>
          <Button
            size="sm"
            disabled={disabled}
            onClick={submitBet("manual")}
          >
            <Send className="mr-1.5 h-3.5 w-3.5" />
            Manual
          </Button>
        </div>
      </Card>

      <Card className="p-5">
        <h3 className="text-sm font-semibold">Custom command</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Send an arbitrary command name + JSON payload to the agent.
        </p>
        <div className="mt-4 space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="cmd">Command</Label>
            <Input
              id="cmd"
              value={customCmd}
              onChange={(e) => setCustomCmd(e.target.value)}
              placeholder="refresh_balances"
              className="font-mono"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="payload">Payload (JSON)</Label>
            <textarea
              id="payload"
              value={customPayload}
              onChange={(e) => setCustomPayload(e.target.value)}
              rows={6}
              className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <Button size="sm" disabled={disabled} onClick={submitCustom}>
            <Send className="mr-1.5 h-3.5 w-3.5" />
            Send command
          </Button>
        </div>
      </Card>
    </div>
  );
}