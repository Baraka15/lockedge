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
    const detectedSlot = Math.floor(Date.now() / 10_000); // dedupe within 10s
    const dedupKey = `${groupKey}::${detectedSlot}`;
    out.push({ ...arb, dedupKey });
  }
  return out;
}