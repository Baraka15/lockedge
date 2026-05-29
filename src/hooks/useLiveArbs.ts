import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { ArbOpportunity } from "@/lib/odds/types";

interface ArbRow {
  id: string;
  event_name: string;
  market_type: string;
  outcomes: ArbOpportunity["outcomes"];
  total_arb_percent: number | string;
  required_total_stake: number | string;
  detected_at: string;
  expires_at: string;
  is_acknowledged: boolean;
  dedup_key: string;
}

function fromRow(r: ArbRow): ArbOpportunity {
  return {
    id: r.id,
    eventName: r.event_name,
    marketType: r.market_type,
    outcomes: r.outcomes,
    totalArbPercent: Number(r.total_arb_percent),
    requiredTotalStake: Number(r.required_total_stake),
    detectedAt: r.detected_at,
    expiresAt: r.expires_at,
    isAcknowledged: r.is_acknowledged,
    dedupKey: r.dedup_key,
  };
}

export function useLiveArbs() {
  const [arbs, setArbs] = useState<ArbOpportunity[]>([]);
  const [tick, setTick] = useState(0);

  // Initial load + realtime subscription
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { data } = await supabase
        .from("arbs")
        .select("*")
        .eq("is_acknowledged", false)
        .gt("expires_at", new Date().toISOString())
        .order("detected_at", { ascending: false });
      if (cancelled) return;
      setArbs((data ?? []).map((r) => fromRow(r as ArbRow)));
    })();

    const channel = supabase
      .channel("arbs-live")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "arbs" },
        (payload) => {
          const row = payload.new as ArbRow;
          if (row.is_acknowledged) return;
          if (new Date(row.expires_at).getTime() <= Date.now()) return;
          setArbs((prev) =>
            prev.some((a) => a.id === row.id) ? prev : [fromRow(row), ...prev],
          );
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "arbs" },
        (payload) => {
          const row = payload.new as ArbRow;
          setArbs((prev) =>
            row.is_acknowledged
              ? prev.filter((a) => a.id !== row.id)
              : prev.map((a) => (a.id === row.id ? fromRow(row) : a)),
          );
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, []);

  // 1Hz tick for countdown rendering + client-side expiry sweep
  useEffect(() => {
    const t = setInterval(() => {
      setTick((n) => n + 1);
      setArbs((prev) => prev.filter((a) => new Date(a.expiresAt).getTime() > Date.now()));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  const acknowledgeArb = useCallback(async (id: string) => {
    setArbs((prev) => prev.filter((a) => a.id !== id));
    const { error } = await supabase
      .from("arbs")
      .update({ is_acknowledged: true })
      .eq("id", id);
    if (error) console.error("acknowledgeArb failed", error);
  }, []);

  return { arbs, acknowledgeArb, tick };
}