import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { hourlyMetrics, type ProfitSnapshot, type ProfitSettlement } from "@/lib/arb/live-metrics";

const queryKey = ["hourly-profit-metrics"];

export function useHourlyMetrics(now: number) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const { data: roles, error: roleError } = await supabase.from("user_roles").select("role");
      if (roleError) throw roleError;
      const canReadSettlements = roles?.some((r) => r.role === "admin" || r.role === "operator") ?? false;
      const since = new Date(Date.now() - 6 * 3_600_000).toISOString();
      // Page through rows: the default API cap must not silently truncate busy hours.
      const arbs: ProfitSnapshot[] = [];
      for (let offset = 0; ; offset += 500) {
        const { data, error } = await supabase.from("arbs")
          .select("id, dedup_key, tier, total_arb_percent, required_total_stake, detected_at")
          .gte("detected_at", since).order("detected_at").order("id").range(offset, offset + 499);
        if (error) throw error;
        arbs.push(...(data ?? []));
        if ((data?.length ?? 0) < 500) break;
      }
      const settlements: ProfitSettlement[] = [];
      if (canReadSettlements) {
        for (let offset = 0; ; offset += 500) {
          const { data, error } = await supabase.from("settlements").select("profit, settled_at, id")
            .gte("settled_at", since).order("settled_at").order("id").range(offset, offset + 499);
          if (error) throw error;
          settlements.push(...(data ?? []));
          if ((data?.length ?? 0) < 500) break;
        }
      }
      return { arbs, settlements, canReadSettlements };
    },
    refetchInterval: 10_000,
    retry: 1,
  });

  useEffect(() => {
    const refresh = () => { void queryClient.invalidateQueries({ queryKey }); };
    const channel = supabase.channel("hourly-profit-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "arbs" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "settlements" }, refresh)
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [queryClient]);

  return {
    ...query,
    metrics: hourlyMetrics(query.data?.arbs ?? [], query.data?.settlements ?? [], now),
    canReadSettlements: query.data?.canReadSettlements ?? false,
  };
}