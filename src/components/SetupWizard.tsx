import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Check, ChevronRight, Wifi, WifiOff } from "lucide-react";
import { toast } from "sonner";
import { useOddsApiHealth } from "@/hooks/usePerformance";

const LS_KEY = "arb_setup_wizard_completed_v1";
const sb = supabase as unknown as { from: (t: string) => any };

type Currency = "UGX" | "USD";

export function SetupWizard() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [bankroll, setBankroll] = useState(1_000_000);
  const [currency, setCurrency] = useState<Currency>("UGX");
  const [riskPct, setRiskPct] = useState(2);
  const [bms, setBms] = useState({ betpawa: false, sportybet: false, betway: false });
  const [telegramChat, setTelegramChat] = useState("");
  const [notifyEnabled, setNotifyEnabled] = useState(true);
  const odds = useOddsApiHealth();

  useEffect(() => {
    if (typeof window === "undefined") return;
    const done = localStorage.getItem(LS_KEY);
    if (done) return;
    sb.from("risk_settings").select("bankroll").eq("account_label", "primary").maybeSingle()
      .then(({ data }: any) => { if (!data || !Number(data.bankroll)) setOpen(true); });
  }, []);

  const next = () => setStep((s) => Math.min(4, s + 1));
  const back = () => setStep((s) => Math.max(0, s - 1));

  const finish = async (skipped = false) => {
    const metadata = {
      wizard_completed_at: new Date().toISOString(),
      currency, bookmakers_configured: bms, skipped,
    };
    const { error } = await sb.from("risk_settings").upsert({
      account_label: "primary",
      bankroll,
      max_stake_pct: riskPct,
      telegram_chat_id: telegramChat || null,
      notify_enabled: notifyEnabled,
      metadata,
      updated_at: new Date().toISOString(),
    }, { onConflict: "account_label" });
    if (error) { toast.error(`Save failed: ${error.message}`); return; }
    localStorage.setItem(LS_KEY, "1");
    setOpen(false);
    toast.success(skipped ? "Setup skipped — finish later in Risk Settings." : "Setup complete!");
  };

  const sendTestTelegram = async () => {
    if (!telegramChat) { toast.error("Enter a chat id first"); return; }
    try {
      const res = await fetch("/api/public/hooks/notify-test", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: telegramChat }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j.ok) toast.success("Test sent — check Telegram");
      else toast.error(j.error || "Send failed");
    } catch (e) { toast.error((e as Error).message); }
  };

  const stepTitles = ["Welcome", "Bankroll", "Bookmakers", "Odds API", "Telegram"];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Setup wizard · step {step + 1} of 5 — {stepTitles[step]}</DialogTitle>
        </DialogHeader>

        <div className="mb-2 flex items-center gap-1">
          {stepTitles.map((_, i) => (
            <div key={i} className={`h-1 flex-1 rounded ${i <= step ? "bg-primary" : "bg-muted"}`} />
          ))}
        </div>

        {step === 0 && (
          <div className="space-y-3 text-sm">
            <p>Welcome to your arbitrage command center. The system:</p>
            <ul className="ml-5 list-disc space-y-1 text-muted-foreground">
              <li>Polls TheOddsAPI for live odds across bookmakers.</li>
              <li>Detects arbitrage opportunities in real time.</li>
              <li>A local Puppeteer bot places synchronised bets on BetPawa, SportyBet, BetWay.</li>
              <li>Sends Telegram alerts for big arbs and tracks every settlement.</li>
            </ul>
            <p className="text-muted-foreground">This wizard takes ~2 minutes.</p>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-3 text-sm">
            <div className="flex gap-2">
              {(["UGX", "USD"] as const).map((c) => (
                <Button key={c} size="sm" variant={currency === c ? "default" : "outline"} onClick={() => setCurrency(c)}>{c}</Button>
              ))}
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Bankroll ({currency})</Label>
              <Input type="number" value={bankroll} onChange={(e) => setBankroll(Number(e.target.value))} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Max stake per leg (% of bankroll)</Label>
              <Input type="number" step="0.1" value={riskPct} onChange={(e) => setRiskPct(Number(e.target.value))} />
              <p className="text-[11px] text-muted-foreground">2% is a safe default. 5%+ is aggressive.</p>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-2 text-sm">
            <p className="text-muted-foreground">Tick each bookmaker whose credentials you've already set in <code className="font-mono text-xs">bot/.env</code>:</p>
            {(["betpawa", "sportybet", "betway"] as const).map((k) => (
              <label key={k} className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2">
                <div>
                  <div className="capitalize font-medium">{k}</div>
                  <div className="text-[11px] text-muted-foreground">
                    Requires {k.toUpperCase()}_{k === "betpawa" ? "PHONE" : k === "sportybet" ? "PHONE/EMAIL" : "EMAIL"} + _PASSWORD
                  </div>
                </div>
                <Switch checked={bms[k]} onCheckedChange={(v) => setBms({ ...bms, [k]: v })} />
              </label>
            ))}
          </div>
        )}

        {step === 3 && (
          <div className="space-y-3 text-sm">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className={odds.status === "live" ? "border-emerald-500/40 text-emerald-400" : "border-rose-500/40 text-rose-400"}>
                {odds.status === "live" ? <Wifi className="mr-1 h-3 w-3" /> : <WifiOff className="mr-1 h-3 w-3" />}
                {odds.status}
              </Badge>
              {odds.remaining != null && <span className="text-xs text-muted-foreground">{odds.remaining} requests left this period</span>}
            </div>
            {odds.status !== "live" && (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">
                Set <code className="font-mono">THEODDSAPI_KEY</code> in your project secrets. Get a key at <span className="underline">the-odds-api.com</span>.
              </div>
            )}
          </div>
        )}

        {step === 4 && (
          <div className="space-y-3 text-sm">
            <div className="space-y-1">
              <Label className="text-xs">Telegram chat id</Label>
              <Input value={telegramChat} onChange={(e) => setTelegramChat(e.target.value)} placeholder="e.g. 7168775421" />
              <p className="text-[11px] text-muted-foreground">Talk to @userinfobot in Telegram to find your chat id.</p>
            </div>
            <div className="flex items-center gap-3 rounded-md border border-border/60 px-3 py-2">
              <Switch checked={notifyEnabled} onCheckedChange={setNotifyEnabled} />
              <span>Send alerts</span>
            </div>
            <Button size="sm" variant="outline" onClick={sendTestTelegram}>Send test message</Button>
          </div>
        )}

        <div className="mt-4 flex justify-between gap-2">
          <div>
            {step > 0 && <Button variant="ghost" size="sm" onClick={back}>Back</Button>}
          </div>
          <div className="flex gap-2">
            {step >= 2 && step < 4 && (
              <Button variant="ghost" size="sm" onClick={() => finish(true)}>Skip rest</Button>
            )}
            {step < 4 ? (
              <Button size="sm" onClick={next} disabled={step === 1 && !bankroll}>
                Next <ChevronRight className="ml-1 h-3.5 w-3.5" />
              </Button>
            ) : (
              <Button size="sm" onClick={() => finish(false)}>
                <Check className="mr-1 h-3.5 w-3.5" /> Finish
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}