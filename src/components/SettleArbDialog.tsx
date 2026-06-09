import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";

interface Props {
  arbId: string;
  eventName?: string | null;
  outcomes?: { name: string }[];
  trigger?: React.ReactNode;
  onSettled?: () => void;
}

export function SettleArbDialog({ arbId, eventName, outcomes = [], trigger, onSettled }: Props) {
  const [open, setOpen] = useState(false);
  const [winning, setWinning] = useState<string>(outcomes[0]?.name ?? "home");
  const [home, setHome] = useState("");
  const [away, setAway] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setSubmitting(true);
    try {
      const res = await fetch("/api/public/hooks/settle-arb", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          arb_id: arbId,
          winning_outcome: winning,
          home_score: home ? Number(home) : undefined,
          away_score: away ? Number(away) : undefined,
        }),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j.error || `HTTP ${res.status}`);
      const profit = Number(j.profit ?? 0);
      toast.success(`Settled: ${profit >= 0 ? "+" : ""}${profit.toFixed(2)}`,
        { description: `Staked ${Number(j.total_staked).toFixed(2)} · Returned ${Number(j.total_returned).toFixed(2)}` });
      setOpen(false);
      onSettled?.();
    } catch (e) {
      toast.error(`Settle failed: ${(e as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const options = outcomes.length ? outcomes : [{ name: "home" }, { name: "draw" }, { name: "away" }];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger ?? <Button size="sm" variant="outline">Settle</Button>}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Settle arb</DialogTitle>
          <DialogDescription>{eventName ?? arbId}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Winning outcome</Label>
            <select
              value={winning}
              onChange={(e) => setWinning(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              {options.map((o) => (<option key={o.name} value={o.name}>{o.name}</option>))}
              <option value="void">Void / Push</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Home score</Label>
              <Input type="number" value={home} onChange={(e) => setHome(e.target.value)} placeholder="—" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Away score</Label>
              <Input type="number" value={away} onChange={(e) => setAway(e.target.value)} placeholder="—" />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            P&amp;L is computed from <code className="font-mono">bet_logs</code> rows for this arb:
            winners pay stake × odds; losers lose stake.
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={submitting}>Cancel</Button>
          <Button onClick={submit} disabled={submitting}>{submitting ? "Settling…" : "Confirm settlement"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}