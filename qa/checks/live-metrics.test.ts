import { describe, expect, test } from "bun:test";
import { countdownLabel, hourlyMetrics, potentialProfit, secondsUntil, type ProfitSnapshot } from "../../src/lib/arb/live-metrics";

const now = Date.parse("2026-10-10T12:07:00Z");
const quote: ProfitSnapshot = {
  id: "a", dedup_key: "match:h2h", tier: "sure", total_arb_percent: 95,
  required_total_stake: 100, detected_at: new Date(now - 60_000).toISOString(),
};

describe("live profit and countdown calculations", () => {
  test("wall-clock countdown clamps and refreshes immediately", () => {
    expect(secondsUntil(new Date(now + 90_000).toISOString(), now)).toBe(90);
    expect(secondsUntil(new Date(now - 1).toISOString(), now)).toBe(0);
    expect(secondsUntil("invalid", now)).toBe(0);
    expect(countdownLabel(90)).toBe("01:30");
    expect(countdownLabel(0)).toBe("00:00");
  });
  test("uses payout ROI rather than inverse-book difference", () => {
    expect(potentialProfit(quote)).toBeCloseTo(5.26315789);
    expect(potentialProfit({ ...quote, tier: "value" })).toBe(0);
    expect(potentialProfit({ ...quote, total_arb_percent: 0 })).toBe(0);
    expect(potentialProfit({ ...quote, total_arb_percent: 101 })).toBe(0);
  });
  test("deduplicates updates and excludes older and future quotes", () => {
    const metrics = hourlyMetrics([
      quote,
      { ...quote, id: "b", detected_at: new Date(now - 30_000).toISOString() },
      { ...quote, id: "old", dedup_key: "old", detected_at: new Date(now - 3_600_001).toISOString() },
      { ...quote, id: "future", dedup_key: "future", detected_at: new Date(now + 1).toISOString() },
    ], [], now);
    expect(metrics.count).toBe(1);
    expect(metrics.potential).toBeCloseTo(5.26315789);
    expect(metrics.buckets).toHaveLength(6);
  });
  test("separates recorded losses from potential gains and rolls off with time", () => {
    const settlements = [{ profit: -12, settled_at: new Date(now - 1000).toISOString() }];
    const metrics = hourlyMetrics([quote], settlements, now);
    expect(metrics.realised).toBe(-12);
    expect(metrics.potential).toBeGreaterThan(0);
    expect(hourlyMetrics([quote], settlements, now + 3_600_000).potential).toBe(0);
    expect(hourlyMetrics([quote], settlements, now + 3_600_000).realised).toBe(0);
  });
});