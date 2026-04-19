/**
 * Rotation Engine
 * Manages BTC -> ALT -> BTC rotation positions.
 *
 * Entry sizing (per Master Operating Document):
 *   T1 (Initial entry):  2% of BTC balance -- fires on ROTATE_IN signal
 *   T2 (DCA-down):       4% of BTC balance -- fires ONLY when price drops -2.5% from T1 entry
 *   T3 (DCA-down):       6% of BTC balance -- fires ONLY when price drops -5.0% from T1 entry
 *
 * Hard limits (server-side enforced, non-negotiable):
 *   - Single trade max:          6% of BTC balance
 *   - Total per altcoin max:     12% of BTC balance (T1 + T2 + T3 = 2 + 4 + 6 = 12%)
 *   - Total rotation exposure:   48% of BTC balance across all 4 pairs (hard block)
 *   - T2 trigger:                current price <= T1 entry price * (1 - 0.025)
 *   - T3 trigger:                current price <= T1 entry price * (1 - 0.050)
 *
 * Exit system (handled by VPS exit_monitor.py, NOT this engine):
 *   - At +3.6% above tranche entry: VPS places SFOX hard stop at +2.6% above entry (alg 304)
 *   - At +6.6% above tranche entry: VPS replaces hard stop with 3% trailing stop (alg 308)
 *   - Exit order is bottom-up: T3 exits first, T2 second, T1 last
 *   - All sells are manual. The VPS places stop orders. Matthew executes.
 *
 * Live vs. Mock (Rule 6 -- non-negotiable):
 *   - Every execution function checks client.isLive before calling SFOX API.
 *   - If isLive = false, the function logs intent but does NOT place a real order.
 *   - Only the Halfacre Research account is isLive = true.
 */

import {
  getAllClients,
  getOpenPositions,
  insertExecutionLog,
  insertPosition,
} from "./db";
import {
  executeRotationEntry,
  generateClientOrderId,
  getBalance,
  getOrderEstimate,
} from "./sfoxEngine";

// ─── DCA-down trigger constants (must match backtest_core.py exactly) ──────────

const T2_DROP_TRIGGER_PCT = 2.5;  // T2 fires when price drops 2.5% from T1 entry
const T3_DROP_TRIGGER_PCT = 5.0;  // T3 fires when price drops 5.0% from T1 entry
const MAX_PER_COIN_PCT     = 12.0; // Hard limit: max 12% of BTC per altcoin
const MAX_TOTAL_ROTATION_PCT = 48.0; // Hard limit: max 48% of BTC across all 4 pairs

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RotationSignal {
  pair: string;        // e.g. "ETH/BTC"
  altSymbol: string;   // e.g. "ETH"
  prediction: string;  // "ROTATE_IN" | "HOLD" | "ROTATE_OUT"
  confidence: number;  // 0.0 to 1.0
  modelName: string;
  date: string;
}

export interface RotationEntryResult {
  triggered: boolean;
  pair: string;
  trancheNumber: number;
  positionSizePercent: number;
  isDCAAddIn: boolean;
  clientResults: Array<{
    userId: number;
    name: string | null;
    success: boolean;
    orderId?: number;
    btcAmount?: number;
    executionPrice?: number;
    skipped?: boolean;
    skipReason?: string;
    error?: string;
  }>;
  skippedReason?: string;
}

// ─── Tranche determination (price-based) ─────────────────────────────────────

/**
 * Determine which tranche to buy and whether the price trigger has been met.
 *
 * This replaces the old count-based logic. The decision is:
 *   - No open positions for this pair: T1 at 2% (always fires on signal)
 *   - T1 exists, no T2: check if current price <= T1 entry * (1 - 2.5%)
 *   - T1 and T2 exist, no T3: check if current price <= T1 entry * (1 - 5.0%)
 *   - All three tranches exist: max exposure reached, no trade
 *
 * @param openPairPositions Open positions for this specific pair (all tranches)
 * @param currentPrice Current market price of the altcoin in BTC terms
 * @returns trancheNumber (1/2/3), positionSizePercent (2/4/6), and whether the trigger is met
 */
export function determineEntrySize(
  openPairPositions: Array<{ trancheNumber: number | null; t1EntryPrice: string | null; entryPrice: string }>,
  currentPrice: number
): {
  trancheNumber: number;
  positionSizePercent: number;
  isDCAAddIn: boolean;
  label: string;
  triggerMet: boolean;
  triggerReason: string;
} {
  const existingTranches = openPairPositions.map(p => p.trancheNumber ?? 1);
  const hasT1 = existingTranches.includes(1);
  const hasT2 = existingTranches.includes(2);
  const hasT3 = existingTranches.includes(3);

  // No open positions: T1 fires on signal
  if (!hasT1) {
    return {
      trancheNumber: 1,
      positionSizePercent: 2,
      isDCAAddIn: false,
      label: "T1 initial entry (2%)",
      triggerMet: true,
      triggerReason: "No open position -- T1 fires on ROTATE_IN signal",
    };
  }

  // T1 exists, T2 not yet: check -2.5% price trigger
  if (hasT1 && !hasT2) {
    // Find T1 entry price -- stored on the T1 row
    const t1Row = openPairPositions.find(p => (p.trancheNumber ?? 1) === 1);
    const t1Price = t1Row ? Number(t1Row.t1EntryPrice ?? t1Row.entryPrice) : 0;
    if (t1Price <= 0) {
      return {
        trancheNumber: 2,
        positionSizePercent: 4,
        isDCAAddIn: true,
        label: "T2 DCA-down (4%)",
        triggerMet: false,
        triggerReason: "Cannot determine T1 entry price -- T2 blocked",
      };
    }
    const t2TriggerPrice = t1Price * (1 - T2_DROP_TRIGGER_PCT / 100);
    const triggerMet = currentPrice <= t2TriggerPrice;
    return {
      trancheNumber: 2,
      positionSizePercent: 4,
      isDCAAddIn: true,
      label: "T2 DCA-down (4%)",
      triggerMet,
      triggerReason: triggerMet
        ? `Price ${currentPrice.toFixed(8)} <= T2 trigger ${t2TriggerPrice.toFixed(8)} (-${T2_DROP_TRIGGER_PCT}% from T1 entry ${t1Price.toFixed(8)})`
        : `Price ${currentPrice.toFixed(8)} > T2 trigger ${t2TriggerPrice.toFixed(8)} -- drop of ${T2_DROP_TRIGGER_PCT}% from T1 entry not yet reached`,
    };
  }

  // T1 and T2 exist, T3 not yet: check -5.0% price trigger
  if (hasT1 && hasT2 && !hasT3) {
    const t1Row = openPairPositions.find(p => (p.trancheNumber ?? 1) === 1);
    const t1Price = t1Row ? Number(t1Row.t1EntryPrice ?? t1Row.entryPrice) : 0;
    if (t1Price <= 0) {
      return {
        trancheNumber: 3,
        positionSizePercent: 6,
        isDCAAddIn: true,
        label: "T3 final DCA-down (6%)",
        triggerMet: false,
        triggerReason: "Cannot determine T1 entry price -- T3 blocked",
      };
    }
    const t3TriggerPrice = t1Price * (1 - T3_DROP_TRIGGER_PCT / 100);
    const triggerMet = currentPrice <= t3TriggerPrice;
    return {
      trancheNumber: 3,
      positionSizePercent: 6,
      isDCAAddIn: true,
      label: "T3 final DCA-down (6%)",
      triggerMet,
      triggerReason: triggerMet
        ? `Price ${currentPrice.toFixed(8)} <= T3 trigger ${t3TriggerPrice.toFixed(8)} (-${T3_DROP_TRIGGER_PCT}% from T1 entry ${t1Price.toFixed(8)})`
        : `Price ${currentPrice.toFixed(8)} > T3 trigger ${t3TriggerPrice.toFixed(8)} -- drop of ${T3_DROP_TRIGGER_PCT}% from T1 entry not yet reached`,
    };
  }

  // All three tranches exist: max exposure reached
  return {
    trancheNumber: 0,
    positionSizePercent: 0,
    isDCAAddIn: true,
    label: "Max exposure reached (12%)",
    triggerMet: false,
    triggerReason: "All three tranches already open -- 12% max per coin reached",
  };
}

/**
 * Calculate total BTC rotation exposure across all 4 pairs for a single client.
 * Sums entryBtcAmount for all open rotation positions.
 * Used to enforce the 48% hard block.
 *
 * @param openPositions All open positions for this client
 * @param btcBalance Client's current BTC balance
 * @returns totalExposurePct as a percentage of BTC balance
 */
export function calculateTotalRotationExposure(
  openPositions: Array<{ strategy: string; entryBtcAmount: string }>,
  btcBalance: number
): number {
  if (btcBalance <= 0) return 0;
  const totalBtcInRotation = openPositions
    .filter(p => p.strategy === "ROTATION")
    .reduce((sum, p) => sum + Number(p.entryBtcAmount), 0);
  return (totalBtcInRotation / btcBalance) * 100;
}

// ─── Main entry executor ──────────────────────────────────────────────────────

/**
 * Execute a rotation entry across all active clients.
 *
 * For T1: fires immediately on ROTATE_IN signal.
 * For T2/T3: fires only if the price-based DCA-down trigger has been met.
 *
 * Live vs. Mock is enforced per client. Only isLive=true clients place real orders.
 *
 * @param signal The rotation signal from the Arbiter / ML predictions
 * @param currentPrice Current market price of the altcoin in BTC (fetched by caller or auto-fetched)
 * @param forceSizePercent Override the auto-determined size (for manual trades only)
 * @param dryRun Log intent but do not place orders
 */
export async function runRotationEntry(
  signal: RotationSignal,
  currentPrice?: number,
  forceSizePercent?: number,
  dryRun = false
): Promise<RotationEntryResult> {
  if (!signal.prediction.includes("ROTATE_IN") && !signal.prediction.includes("BUY")) {
    return {
      triggered: false,
      pair: signal.pair,
      trancheNumber: 0,
      positionSizePercent: 0,
      isDCAAddIn: false,
      clientResults: [],
      skippedReason: `Signal ${signal.prediction} is not a rotation entry signal`,
    };
  }

  // Auto-fetch current price if not provided
  let livePrice = currentPrice ?? 0;
  if (!livePrice) {
    try {
      // Use the first available live client key to fetch the price estimate
      const allClients = await getAllClients();
      const liveClient = allClients.find(c => c.isActive && c.sfoxApiKey && c.isLive);
      const anyClient = liveClient ?? allClients.find(c => c.isActive && c.sfoxApiKey);
      if (anyClient) {
        const estimate = await getOrderEstimate({
          side: "buy",
          pair: signal.pair,
          apiKey: anyClient.sfoxApiKey,
          quantity: 0.001,
        });
        livePrice = estimate.vwap ?? estimate.price ?? 0;
      }
    } catch {
      // Price fetch failed -- T1 can still proceed without price check
      // T2/T3 will be blocked below if price is unavailable
    }
  }

  const allClients = await getAllClients();
  const clients = allClients.filter(c => c.isActive && c.sfoxApiKey);
  const clientResults: RotationEntryResult["clientResults"] = [];

  let finalSizePercent = forceSizePercent ?? 2;
  let finalTrancheNumber = 1;
  let isDCAAddIn = false;

  for (const client of clients) {
    const openPositions = await getOpenPositions(client.userId);
    const openPairPositions = openPositions.filter(
      p => p.pair.toUpperCase() === signal.pair.toUpperCase()
    );

    // Determine entry size and check price trigger (unless size is forced)
    if (!forceSizePercent) {
      const sizing = determineEntrySize(openPairPositions, livePrice);

      if (sizing.positionSizePercent === 0) {
        clientResults.push({
          userId: client.userId,
          name: client.name,
          success: false,
          skipped: true,
          skipReason: sizing.triggerReason,
        });
        continue;
      }

      if (!sizing.triggerMet) {
        clientResults.push({
          userId: client.userId,
          name: client.name,
          success: false,
          skipped: true,
          skipReason: sizing.triggerReason,
        });
        continue;
      }

      finalSizePercent = sizing.positionSizePercent;
      finalTrancheNumber = sizing.trancheNumber;
      isDCAAddIn = sizing.isDCAAddIn;
    }

    // Hard limit: single trade never exceeds 6%
    if (finalSizePercent > 6) {
      clientResults.push({
        userId: client.userId,
        name: client.name,
        success: false,
        error: `Entry size ${finalSizePercent}% exceeds hard limit of 6% per trade`,
      });
      continue;
    }

    // Hard limit: 12% max per coin
    const existingCoinBtc = openPairPositions.reduce(
      (sum, p) => sum + Number(p.entryBtcAmount), 0
    );

    // Hard limit: 48% max total rotation exposure
    let btcBalance = 0;
    try {
      const btcBal = await getBalance("BTC", client.sfoxApiKey);
      btcBalance = btcBal?.available ?? 0;
    } catch {
      // If balance fetch fails for mock accounts, skip the exposure check
    }

    if (btcBalance > 0) {
      const newCoinExposurePct = ((existingCoinBtc + btcBalance * (finalSizePercent / 100)) / btcBalance) * 100;
      if (newCoinExposurePct > MAX_PER_COIN_PCT) {
        clientResults.push({
          userId: client.userId,
          name: client.name,
          success: false,
          error: `This trade would bring ${signal.pair} exposure to ${newCoinExposurePct.toFixed(1)}% -- exceeds 12% per-coin hard limit`,
        });
        continue;
      }

      const totalRotationExposurePct = calculateTotalRotationExposure(openPositions, btcBalance);
      const newTotalExposurePct = totalRotationExposurePct + finalSizePercent;
      if (newTotalExposurePct > MAX_TOTAL_ROTATION_PCT) {
        clientResults.push({
          userId: client.userId,
          name: client.name,
          success: false,
          error: `This trade would bring total rotation exposure to ${newTotalExposurePct.toFixed(1)}% -- exceeds 48% total hard limit`,
        });
        continue;
      }
    }

    // Live vs. Mock check (Rule 6 -- non-negotiable)
    if (!client.isLive) {
      // Mock: log intent, do not call SFOX API
      const mockLogId = await insertExecutionLog({
        userId: client.userId,
        pair: signal.pair,
        strategy: "ROTATION",
        side: "buy",
        quantity: "0",
        price: String(livePrice),
        sfoxOrderId: null,
        status: "pending",
        notes: `[MOCK] ${finalTrancheNumber === 1 ? "T1 initial entry" : `T${finalTrancheNumber} DCA-down`} ${finalSizePercent}% -- not executed (mock account)`,
      });

      // Record mock position with tranche tracking
      const t1Price = finalTrancheNumber === 1
        ? livePrice
        : Number(openPairPositions.find(p => (p.trancheNumber ?? 1) === 1)?.entryPrice ?? livePrice);

      await insertPosition({
        userId: client.userId,
        pair: signal.pair,
        strategy: "ROTATION",
        entryExecutionId: mockLogId,
        entryPrice: String(livePrice),
        entryBtcAmount: String(btcBalance > 0 ? btcBalance * (finalSizePercent / 100) : 0),
        status: "open",
        trancheNumber: finalTrancheNumber,
        t1EntryPrice: String(t1Price),
        exitStage: "none",
      });

      clientResults.push({
        userId: client.userId,
        name: client.name,
        success: true,
        skipped: false,
        skipReason: undefined,
        btcAmount: btcBalance > 0 ? btcBalance * (finalSizePercent / 100) : 0,
        executionPrice: livePrice,
      });
      continue;
    }

    if (dryRun) {
      clientResults.push({
        userId: client.userId,
        name: client.name,
        success: true,
        skipped: false,
      });
      continue;
    }

    // Live execution via SFOX Smart Routing (algorithm 200)
    const result = await executeRotationEntry({
      apiKey: client.sfoxApiKey,
      pair: signal.pair,
      positionSizePercent: finalSizePercent,
      clientOrderId: generateClientOrderId(
        finalTrancheNumber === 1 ? "ROT-T1" : `ROT-T${finalTrancheNumber}-DCA`,
        signal.pair
      ),
    });

    const logId = await insertExecutionLog({
      userId: client.userId,
      pair: signal.pair,
      strategy: "ROTATION",
      side: "buy",
      quantity: String(result.quantity ?? "0"),
      price: String(result.executionPrice ?? "0"),
      sfoxOrderId: result.orderId ? String(result.orderId) : null,
      status: result.success ? "filled" : "failed",
      notes: result.error ?? `T${finalTrancheNumber} ${finalSizePercent}% rotation entry`,
    });

    if (result.success && result.executionPrice && result.quantity) {
      // Store T1 entry price on all tranches for DCA-down trigger calculations
      const t1Price = finalTrancheNumber === 1
        ? result.executionPrice
        : Number(openPairPositions.find(p => (p.trancheNumber ?? 1) === 1)?.entryPrice ?? result.executionPrice);

      await insertPosition({
        userId: client.userId,
        pair: signal.pair,
        strategy: "ROTATION",
        entryExecutionId: logId,
        entryPrice: String(result.executionPrice),
        entryBtcAmount: String(result.btcValue ?? result.quantity),
        status: "open",
        trancheNumber: finalTrancheNumber,
        t1EntryPrice: String(t1Price),
        exitStage: "none",
      });
    }

    clientResults.push({
      userId: client.userId,
      name: client.name,
      success: result.success,
      orderId: result.orderId,
      btcAmount: result.btcValue,
      executionPrice: result.executionPrice,
      error: result.error,
    });
  }

  return {
    triggered: true,
    pair: signal.pair,
    trancheNumber: finalTrancheNumber,
    positionSizePercent: finalSizePercent,
    isDCAAddIn,
    clientResults,
  };
}

/**
 * Calculate the breakeven price for a tranche.
 * Breakeven = entry price * (1 + 1.6% round-trip cost).
 * Used by the dashboard to show Matthew when a tranche is net profitable.
 */
export function getBreakevenPrice(entryPrice: number): number {
  return entryPrice * (1 + 0.016);
}

/**
 * Calculate the hard stop price for a tranche (Phase 2 target).
 * Hard stop = entry price * (1 + 2.6%).
 * This is the price at which the VPS exit monitor places a SFOX stop order (alg 304).
 */
export function getHardStopPrice(entryPrice: number): number {
  return entryPrice * (1 + 0.026);
}

/**
 * Calculate the Phase 2 activation price for a tranche.
 * Phase 2 activates at entry price * (1 + 3.6%).
 * At this point the VPS exit monitor places the hard stop at +2.6%.
 */
export function getPhase2ActivationPrice(entryPrice: number): number {
  return entryPrice * (1 + 0.036);
}

/**
 * Calculate the Phase 3 activation price for a tranche.
 * Phase 3 activates at entry price * (1 + 6.6%).
 * At this point the VPS exit monitor replaces the hard stop with a 3% trailing stop (alg 308).
 */
export function getPhase3ActivationPrice(entryPrice: number): number {
  return entryPrice * (1 + 0.066);
}
