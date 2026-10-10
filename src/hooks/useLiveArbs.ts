import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
  tier?: string | null;
  book_margin_pct?: number | string | null;
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
    tier: r.tier === "value" ? "value" : "sure",
    bookMarginPct: Number(r.book_margin_pct ?? 0),
  };
}

export function useLiveArbs() {
  const queryClient = useQueryClient();
  const [now, setNow] = useState(Date.now);
  const queryKey = ["active-arbs"];
  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase.from("arbs").select("*")
        .eq("is_acknowledged", false).gt("expires_at", new Date().toISOString())
        .order("detected_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((r) => fromRow(r as unknown as ArbRow));
    },
    refetchInterval: 5000,
    retry: 1,
  });

  // Initial load + realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel("arbs-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "arbs" },
        () => { void queryClient.invalidateQueries({ queryKey: ["active-arbs"] }); },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") void queryClient.invalidateQueries({ queryKey: ["active-arbs"] });
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient]);

  // 1Hz tick for countdown rendering + client-side expiry sweep
  useEffect(() => {
    const t = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(t);
  }, []);

  const acknowledgeArb = useCallback(async (id: string) => {
    const { error } = await supabase
      .from("arbs")
      .update({ is_acknowledged: true })
      .eq("id", id);
    if (error) { console.error("acknowledgeArb failed", error); return; }
    await queryClient.invalidateQueries({ queryKey: ["active-arbs"] });
  }, [queryClient]);

  const arbs = (query.data ?? []).filter((a) => Date.parse(a.expiresAt) > now);
  return { arbs, acknowledgeArb, tick: now, now, error: query.error, isPending: query.isPending, refetch: query.refetch };
}