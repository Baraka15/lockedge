import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const sb = supabase as unknown as { from: (t: string) => any; channel: (n: string) => any; removeChannel: (c: any) => void };

export interface BookmakerHealth {
  bookmaker: string;
  totalBets: number;
  successes: number;
  failures: number;
  successRate: number;
  avgDriftPct: number | null;
  lastBetAt: string | null;
  balance: number | null;
  sessionStartedAt: string | null;
  captchaCount: number;
  lastCaptchaAt: string | null;
  reliability: number; // 0..1
}

const WINDOW_DAYS = 7;

export function useBookmakerHealth() {
  const [health, setHealth] = useState<BookmakerHealth[]>([]);

  useEffect(() => {
    let mounted = true;
    const compute = async () => {
      const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();
      const [{ data: logs }, { data: bals }, { data: agent }] = await Promise.all([
        sb.from("bet_logs").select("bookmaker, result, details, logged_at").gte("logged_at", since),
        sb.from("balances").select("*"),
        sb.from("agent_status").select("metadata").eq("agent_id", "primary").maybeSingle(),
      ]);
      const meta = (agent?.data ?? agent ?? {}).metadata ?? agent?.metadata ?? {};
      const sessions = meta?.sessions ?? {};
      const captcha = meta?.captcha ?? {};

      const byBm: Record<string, BookmakerHealth> = {};
      for (const l of (logs ?? []) as any[]) {
        const k = (l.bookmaker || "unknown").toLowerCase();
        const b = byBm[k] ??= {
          bookmaker: k, totalBets: 0, successes: 0, failures: 0, successRate: 0,
          avgDriftPct: null, lastBetAt: null, balance: null,
          sessionStartedAt: sessions?.[k]?.saved_at ?? null,
          captchaCount: captcha?.[k]?.count ?? 0,
          lastCaptchaAt: captcha?.[k]?.last_at ?? null,
          reliability: 0,
        };
        b.totalBets++;
        if (l.result === "success" || l.result === "partial") b.successes++;
        if (l.result === "failed" || l.result === "odds_drifted") b.failures++;
        if (!b.lastBetAt || l.logged_at > b.lastBetAt) b.lastBetAt = l.logged_at;
        const drift = l.details?.diffPct;
        if (typeof drift === "number") {
          b.avgDriftPct = b.avgDriftPct == null ? drift : (b.avgDriftPct + drift) / 2;
        }
      }
      for (const bal of (bals ?? []) as any[]) {
        const k = (bal.bookmaker || "").toLowerCase();
        if (!byBm[k]) byBm[k] = {
          bookmaker: k, totalBets: 0, successes: 0, failures: 0, successRate: 0,
          avgDriftPct: null, lastBetAt: null, balance: null,
          sessionStartedAt: sessions?.[k]?.saved_at ?? null,
          captchaCount: captcha?.[k]?.count ?? 0,
          lastCaptchaAt: captcha?.[k]?.last_at ?? null,
          reliability: 0,
        };
        byBm[k].balance = Number(bal.balance);
      }
      for (const b of Object.values(byBm)) {
        b.successRate = b.totalBets ? b.successes / b.totalBets : 0;
        // Reliability = success rate, penalised by recent captcha events.
        const captchaPenalty = b.captchaCount > 0 ? Math.min(0.4, b.captchaCount * 0.1) : 0;
        b.reliability = Math.max(0, b.successRate - captchaPenalty);
      }
      if (mounted) setHealth(Object.values(byBm).sort((a, b) => a.bookmaker.localeCompare(b.bookmaker)));
    };
    compute();
    const t = setInterval(compute, 15_000);
    return () => { mounted = false; clearInterval(t); };
  }, []);

  return health;
}

/**
 * Confidence score 0-100 for an arb opportunity.
 * Combines edge size, time remaining, and per-bookmaker reliability.
 */
export function confidenceScore(opts: {
  edgePct: number;
  secondsRemaining: number;
  bookmakerReliability: number[]; // 0..1 per leg
}): number {
  const edgeScore = Math.min(1, opts.edgePct / 5); // 5%+ = full
  const timeScore = Math.min(1, opts.secondsRemaining / 120); // 120s+ = full
  const relScore = opts.bookmakerReliability.length
    ? opts.bookmakerReliability.reduce((a, b) => a + b, 0) / opts.bookmakerReliability.length
    : 0.7;
  const raw = 0.4 * edgeScore + 0.3 * timeScore + 0.3 * relScore;
  return Math.round(raw * 100);
}