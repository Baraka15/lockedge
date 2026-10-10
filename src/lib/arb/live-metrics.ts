export interface ProfitSnapshot {
  id: string;
  dedup_key: string;
  tier?: string | null;
  total_arb_percent: number | string;
  required_total_stake: number | string;
  detected_at: string;
}

export interface ProfitSettlement {
  profit: number | string;
  settled_at: string;
}

export function secondsUntil(expiresAt: string, now: number): number {
  const expiry = Date.parse(expiresAt);
  return Number.isFinite(expiry) ? Math.max(0, Math.ceil((expiry - now) / 1000)) : 0;
}

export function countdownLabel(seconds: number): string {
  return `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
}

export function potentialProfit(row: ProfitSnapshot): number {
  const book = Number(row.total_arb_percent);
  const stake = Number(row.required_total_stake);
  if (row.tier === "value" || !Number.isFinite(book) || !Number.isFinite(stake) || book < 88 || book >= 100 || stake <= 0) return 0;
  return stake * (100 / book - 1);
}

export function hourlyMetrics(rows: ProfitSnapshot[], settlements: ProfitSettlement[], now: number) {
  const hour = 3_600_000;
  const currentHour = Math.floor(now / hour) * hour;
  const buckets = Array.from({ length: 6 }, (_, i) => ({
    at: currentHour - (5 - i) * hour, potential: 0, realised: 0, count: 0,
  }));
  const latest = new Map<string, ProfitSnapshot>();
  for (const row of rows) {
    const previous = latest.get(row.dedup_key || row.id);
    if (!previous || Date.parse(row.detected_at) > Date.parse(previous.detected_at)) latest.set(row.dedup_key || row.id, row);
  }
  let potential = 0;
  let realised = 0;
  let count = 0;
  for (const row of latest.values()) {
    const at = Date.parse(row.detected_at);
    const profit = potentialProfit(row);
    if (at > now || profit <= 0) continue;
    if (at >= now - hour) { potential += profit; count++; }
    const bucket = buckets.find((b) => at >= b.at && at < b.at + hour);
    if (bucket) { bucket.potential += profit; bucket.count++; }
  }
  for (const settlement of settlements) {
    const at = Date.parse(settlement.settled_at);
    const profit = Number(settlement.profit);
    if (at > now || !Number.isFinite(profit)) continue;
    if (at >= now - hour) realised += profit;
    const bucket = buckets.find((b) => at >= b.at && at < b.at + hour);
    if (bucket) bucket.realised += profit;
  }
  return { potential, realised, count, buckets };
}