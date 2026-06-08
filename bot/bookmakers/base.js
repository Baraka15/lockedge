/**
 * Bookmaker interface. Each implementation MUST export the same shape:
 *
 *   {
 *     id: string,                                  // "betpawa"
 *     login(): Promise<{ balance: number|null }>,  // idempotent; reuse session
 *     readBalance(): Promise<number|null>,
 *     verifyOdds({event_url, outcome_selector, outcome_label, expectedOdds}): Promise<{liveOdds: number|null, found: boolean}>,
 *     placeBet({arb_id, outcome, stake, odds, event_url, outcome_selector, outcome_label}): Promise<{result, odds, balance}>,
 *     keepAlive?(): Promise<void>,                 // optional, called every 10min
 *     shutdown(): Promise<void>,
 *   }
 *
 * Result values: "success" | "partial" | "failed" | "odds_drifted".
 */
export const REQUIRED_METHODS = ["id", "login", "readBalance", "verifyOdds", "placeBet", "shutdown"];

export function assertImplements(mod) {
  const missing = REQUIRED_METHODS.filter((m) => mod[m] === undefined);
  if (missing.length) {
    throw new Error(`Bookmaker module missing: ${missing.join(", ")}`);
  }
}