import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const sb = supabase as unknown as { from: (t: string) => any; channel: (n: string) => any; removeChannel: (c: any) => void };

export interface Settlement {
  id: string;
  arb_id: string | null;
  event_name: string | null;
  match_date: string | null;
  home_score: number | null;
  away_score: number | null;
  winning_outcome: string | null;
  total_staked: number;
  total_returned: number;
  profit: number;
  settled_at: string;
}

export function useSettlements(limit = 200) {
  const [items, setItems] = useState<Settlement[]>([]);
  useEffect(() => {
    let mounted = true;
    sb.from("settlements").select("*").order("settled_at", { ascending: false }).limit(limit)
      .then(({ data }: any) => { if (mounted && data) setItems(data as Settlement[]); });
    const ch = sb.channel("settlements_rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "settlements" }, (p: any) => {
        if (p.eventType === "INSERT" && p.new) setItems((prev) => [p.new as Settlement, ...prev].slice(0, limit));
        if (p.eventType === "UPDATE" && p.new) setItems((prev) => prev.map((x) => x.id === (p.new as Settlement).id ? (p.new as Settlement) : x));
      })
      .subscribe();
    return () => { mounted = false; sb.removeChannel(ch); };
  }, [limit]);

  // Build cumulative curve in chronological order
  const chrono = [...items].sort((a, b) => new Date(a.settled_at).getTime() - new Date(b.settled_at).getTime());
  let cum = 0;
  const curve = chrono.map((s) => { cum += Number(s.profit); return { at: s.settled_at, profit: cum, single: Number(s.profit) }; });

  const totals = items.reduce((acc, s) => {
    acc.profit += Number(s.profit);
    acc.staked += Number(s.total_staked);
    acc.returned += Number(s.total_returned);
    if (Number(s.profit) > 0) acc.wins += 1;
    acc.count += 1;
    return acc;
  }, { profit: 0, staked: 0, returned: 0, wins: 0, count: 0 });

  const winRate = totals.count ? totals.wins / totals.count : 0;
  const roi = totals.staked > 0 ? totals.profit / totals.staked : 0;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const activeToday = items.filter((s) => new Date(s.settled_at) >= today).length;
  const best = items.reduce<Settlement | null>((b, s) => !b || s.profit > b.profit ? s : b, null);
  const worst = items.reduce<Settlement | null>((b, s) => !b || s.profit < b.profit ? s : b, null);

  return { items, curve, totals, winRate, roi, activeToday, best, worst };
}

export interface OddsApiStatus {
  status: "live" | "error" | "missing_key" | "unknown";
  detail?: string;
  remaining?: number | null;
  checked_at?: string;
}

export function useOddsApiHealth(pollMs = 10 * 60 * 1000) {
  const [s, setS] = useState<OddsApiStatus>({ status: "unknown" });

  useEffect(() => {
    let stopped = false;
    const ping = async () => {
      try {
        const r = await fetch("/api/odds-health");
        const j = await r.json();
        if (!stopped) setS({ status: j.status, detail: j.detail, remaining: j.remaining, checked_at: j.checked_at });
      } catch (e) {
        if (!stopped) setS({ status: "error", detail: (e as Error).message });
      }
    };
    ping();
    const t = setInterval(ping, pollMs);
    return () => { stopped = true; clearInterval(t); };
  }, [pollMs]);

  return s;
}