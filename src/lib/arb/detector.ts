import type { ArbOpportunity, NormalizedOdds } from "../odds/types";
import { calculateArb } from "./calculator";

export function detectArbs(
  groups: Map<string, NormalizedOdds[]>,
  totalInvestment: number,
): Array<Omit<ArbOpportunity, "id" | "detectedAt" | "expiresAt" | "isAcknowledged">> {
  const out: Array<Omit<ArbOpportunity, "id" | "detectedAt" | "expiresAt" | "isAcknowledged">> = [];
  for (const [groupKey, group] of groups) {
    const arb = calculateArb(group, totalInvestment);
    if (!arb) continue;
    // Stable key per event+market: re-detection refreshes the existing row's
    // expires_at (see engine upsert) instead of inserting a near-duplicate
    // card every poll cycle.
    const dedupKey = groupKey;
    out.push({ ...arb, dedupKey });
  }
  return out;
}