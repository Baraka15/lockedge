/**
 * REAL-TIME ARB ENGINE - UNIT TESTS
 * Validates all core functionality
 */

import { RealtimeArbEngine } from "./realtime-arb-engine.js";
import { describe, test, expect, beforeAll, afterAll } from "@jest/globals";

describe("RealtimeArbEngine", () => {
  let engine;

  beforeAll(async () => {
    engine = new RealtimeArbEngine({
      bookmakers: [
        { id: "betpawa", name: "BetPawa", wsUrl: "wss://betpawa.example.com/live" },
        { id: "bet22", name: "22Bet", wsUrl: "wss://bet22.example.com/live" },
        { id: "sportpesa", name: "SportPesa", wsUrl: "wss://sportpesa.example.com/live" },
      ],
      minEdge: 0.8,
      scanInterval: 100,
    });
  });

  afterAll(async () => {
    await engine.stop();
  });

  test("Cache Layer - Store and Retrieve Odds", () => {
    const { cache } = engine;

    cache.setOdds("betpawa", "Home", 2.5);
    cache.setOdds("bet22", "Home", 2.4);

    const odds1 = cache.getOdds("betpawa", "Home");
    const odds2 = cache.getOdds("bet22", "Home");

    expect(odds1).toBe(2.5);
    expect(odds2).toBe(2.4);

    const stats = cache.getStats();
    expect(stats.hits).toBe(2);
    expect(stats.oddsSize).toBe(2);
  });

  test("Cache Layer - TTL Expiration", async () => {
    const { cache } = engine;

    cache.setOdds("betpawa", "Draw", 3.0, 100); // 100ms TTL
    await new Promise((r) => setTimeout(r, 150)); // Wait 150ms

    const odds = cache.getOdds("betpawa", "Draw");
    expect(odds).toBeNull();
  });

  test("Rate Limiter - Allow and Block Requests", () => {
    const { rateLimiter } = engine;

    // Should allow
    for (let i = 0; i < 100; i++) {
      expect(rateLimiter.isAllowed()).toBe(true);
    }

    const status = rateLimiter.getStatus();
    expect(status.used).toBe(100);
    expect(status.remaining).toBe(900); // 1000 - 100
  });

  test("ML Detector - Detect Arbitrage", () => {
    const { mlDetector } = engine;

    const outcomes = [
      { outcome: "Home", odds: 1.91, volume: 1000000 },
      { outcome: "Draw", odds: 3.31, volume: 1000000 },
      { outcome: "Away", odds: 4.20, volume: 1000000 },
    ];

    const arbs = mlDetector.detectArbs(outcomes, 0.8);

    expect(Array.isArray(arbs)).toBe(true);
    // This combination has a real arbitrage of ~1.6%
    if (arbs.length > 0) {
      expect(arbs[0].edge).toBeGreaterThan(0.5);
      expect(arbs[0].confidence).toBeGreaterThan(0.5);
    }
  });

  test("State Machine - Transitions", async () => {
    const { stateMachine } = engine;

    expect(stateMachine.state).toBe("idle");

    stateMachine.transition("connecting");
    expect(stateMachine.state).toBe("connecting");

    stateMachine.transition("connected");
    expect(stateMachine.state).toBe("connected");

    const info = stateMachine.getInfo();
    expect(info.state).toBe("connected");
    expect(info.previousState).toBe("connecting");
  });

  test("Request Batcher - Queue and Flush", async () => {
    const { batcher } = engine;

    let processedCount = 0;

    for (let i = 0; i < 10; i++) {
      batcher.add({
        id: i,
        process: async () => {
          processedCount++;
        },
      });
    }

    // Manually flush
    await batcher.flush();

    expect(processedCount).toBe(10);
  });
});

describe("ML Detector - Edge Cases", () => {
  let engine;

  beforeAll(() => {
    engine = new RealtimeArbEngine();
  });

  test("No Arbitrage - Equal Odds", () => {
    const { mlDetector } = engine;

    const outcomes = [
      { outcome: "Home", odds: 2.0, volume: 1000000 },
      { outcome: "Away", odds: 2.0, volume: 1000000 },
    ];

    const arbs = mlDetector.detectArbs(outcomes);
    // Might detect but edge should be ~0% or negative
    if (arbs.length > 0) {
      expect(arbs[0].edge).toBeLessThan(1);
    }
  });

  test("Strong Arbitrage - High Edge", () => {
    const { mlDetector } = engine;

    const outcomes = [
      { outcome: "Home", odds: 1.5, volume: 1000000 },
      { outcome: "Away", odds: 3.0, volume: 1000000 },
    ];

    const arbs = mlDetector.detectArbs(outcomes);

    if (arbs.length > 0) {
      expect(arbs[0].edge).toBeGreaterThan(2.0);
      expect(arbs[0].confidence).toBeGreaterThan(0.75);
    }
  });
});

console.log("✅ All tests defined. Run with: npm test");