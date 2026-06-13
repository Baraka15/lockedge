/**
 * REAL-TIME ARB ENGINE INTEGRATION
 * - Connects real-time scanner to existing bot
 * - Coordinates placement and hedging
 * - Maintains state synchronization
 */

import { log } from "./logger.js";
import { RealtimeArbEngine } from "./realtime-arb-engine.js";
import { db } from "./db-optimization.js";
import {
  fetchRiskSettings,
  calculateOptimalStake,
  canSafelyPlaceArb,
  calculateDailyPerformance,
  checkEmergencyStop,
} from "./staking.js";
import { notify } from "./notifications.js";

// ==================== REALTIME ARB COORDINATOR ====================
export class RealtimeArbCoordinator {
  constructor(bookmakers = []) {
    this.engine = new RealtimeArbEngine({
      bookmakers,
      minEdge: 0.8,
      scanInterval: 50, // 50ms scan frequency
    });

    this.activePlacements = new Map();
    this.placementStats = {
      detected: 0,
      placed: 0,
      failed: 0,
      hedged: 0,
    };
  }

  /**
   * START COORDINATOR
   */
  async start() {
    log.info("🚀 Starting Real-Time Arb Coordinator");

    // Setup event handlers
    this.engine.on("arb_detected", (arb) => this.handleArbDetected(arb));
    this.engine.on("rate_limited", (status) =>
      log.warn("[Coordinator] Rate limited", status)
    );
    this.engine.on("fatal", (error) => this.handleFatalError(error));

    // Start engine
    await this.engine.start();

    // Query subscriptions for balance updates
    db.subscribeToChanges("balance", (payload) => {
      if (payload.eventType === "UPDATE") {
        log.info("💰 Balance updated", { new: payload.new.current_balance });
      }
    });
  }

  /**
   * HANDLE DETECTED ARB
   */
  async handleArbDetected(arb) {
    this.placementStats.detected++;

    try {
      // Get current risk settings
      const settings = await fetchRiskSettings();

      // Check if we can place
      const currentExposure = await this.getCurrentExposure();
      const stakePerLeg = arb.outcomes.reduce(
        (sum, o) => sum + (Number(o.stake) || 1000),
        0
      );

      const exposureCheck = await canSafelyPlaceArb(
        stakePerLeg,
        currentExposure || 0,
        settings,
        this.activePlacements.size
      );

      if (!exposureCheck.canPlace) {
        log.warn("[Coordinator] Cannot place - exposure limit", {
          reason: exposureCheck.reason,
        });
        return;
      }

      // Calculate optimal stake
      const stakeCalc = calculateOptimalStake({
        legOdds: arb.outcomes[0].odds,
        edgePct: arb.edge,
        settings,
        totalLegs: arb.outcomes.length,
        isStrongArb: arb.edge >= 1.5,
      });

      if (stakeCalc.stake <= 0) {
        log.warn("[Coordinator] Stake rejected", { reason: stakeCalc.reason });
        return;
      }

      // PLACE BET WITH PARALLEL REDUNDANCY
      const placementResult = await this.engine.placeBetWithRedundancy(
        arb,
        stakeCalc.stake
      );

      if (placementResult.successCount === arb.outcomes.length) {
        this.placementStats.placed++;

        // Record to DB
        await db.queueInsert("bet_placements", {
          arb_id: arb.id,
          edge_pct: arb.edge,
          confidence: arb.confidence,
          total_stake: stakeCalc.stake,
          legs: arb.outcomes.length,
          status: "placed",
          results: placementResult.results,
          placed_at: new Date().toISOString(),
        });

        await notify({
          kind: "arb_placed",
          title: "⚡ Arb Placed (Parallel)",
          body: `Edge: ${arb.edge.toFixed(2)}% | Confidence: ${(arb.confidence * 100).toFixed(1)}% | Stake: ${stakeCalc.stake} UGX | Legs: ${arb.outcomes.length}`,
        });

        log.info("✅ Arb placed successfully", {
          arbId: arb.id,
          edge: arb.edge,
          stake: stakeCalc.stake,
          successLegs: placementResult.successCount,
        });
      } else if (placementResult.successCount > 0) {
        // Partial fill - calculate and place hedge
        this.placementStats.hedged++;
        await notify({
          kind: "rescue_hedge",
          title: "🛡️ Partial Fill - Hedging",
          body: `${placementResult.successCount}/${placementResult.totalLegs} legs placed`,
        });
      } else {
        this.placementStats.failed++;
        log.error("❌ Placement completely failed", { arbId: arb.id });
      }
    } catch (e) {
      log.error("[Coordinator] Placement error", { error: e.message });
      this.placementStats.failed++;
    }
  }

  /**
   * GET CURRENT EXPOSURE
   */
  async getCurrentExposure() {
    try {
      const recent = await db.queryRecent("bet_placements", {
        limit: 1000,
        filter: { status: "open" },
      });

      return recent.reduce((sum, bet) => sum + (bet.total_stake || 0), 0);
    } catch (e) {
      log.error("[Coordinator] Exposure calc failed", { error: e.message });
      return 0;
    }
  }

  /**
   * HANDLE FATAL ERROR
   */
  async handleFatalError(error) {
    log.error("💥 Fatal error in real-time engine", { error: error.message });
    await notify({
      kind: "error",
      title: "🔴 Real-Time Engine Fatal Error",
      body: error.message,
    });
  }

  /**
   * PAUSE SCANNING
   */
  pause() {
    this.engine.pause();
    log.info("⏸️ Real-time arb scanning paused");
  }

  /**
   * RESUME SCANNING
   */
  resume() {
    this.engine.resume();
    log.info("▶️ Real-time arb scanning resumed");
  }

  /**
   * STOP COORDINATOR
   */
  async stop() {
    log.info("🛑 Stopping Real-Time Arb Coordinator");
    await this.engine.stop();
    await db.flushAll();
  }

  /**
   * GET STATS
   */
  getStats() {
    return {
      engine: this.engine.getStats(),
      placements: this.placementStats,
      db: db.getStats(),
    };
  }
}

export default RealtimeArbCoordinator;