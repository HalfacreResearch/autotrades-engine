/**
 * Rotation Engine
 * Manages BTC → ALT → BTC rotation positions.
 *
 * Entry sizing:
 *   Initial entry:   2% of BTC balance
 *   DCA add-in:      4% more (same alt, better price or stronger signal)
 *   Final DCA:       6% more (max 12% total exposure per altcoin)
 *
 * Trailing stop automation:
 *   - Monitors open positions for net profitability
 *   - Net profitable = current BTC value > entry BTC cost × (1 + fees + slippage)
 *   - Once profitable: calculates 30d volatility tier → places SFOX Trailing Stop (alg 308)
 *   - Trailing stop tiers: Low vol → 6%, Medium → 10%, High → 15%
 *
 * Hard limits (server-side enforced):
 *   - Single trade: max 6% of BTC balance
 *   - Total per altcoin: max 12% of BTC balance (3 entries max)
 *   - Max 3 concurrent rotation positions
 *
 * Execution:
 *   - Smart Routing (algorithm_id 200) for entries
 *   - Trailing Stop (algorithm_id 308) for exits (auto-set when profitable)
 *   - Manual exit always available via executeRotationExit
 *   - Fires for ALL active clients simultaneously
 */

import {
  getAllClients,
  getOpenPositions,
  insertExecutionLog,
  insertPosition,
  setTrailingStop,
} from "./db";
import {
  calculateBreakevenBtc,
  calculateVolatilityTier,
  executeRotationEntry,
  generateClientOrderId,
  getBalance,
  isNetProfitable,
  placeTrailingStop,
} from "./sfoxEngine";

export interface RotationSignal {
  pair: string;           // e.g. "ETH/BTC"
  altSymbol: string;      // e.g. "ETH"
  prediction: string;     // "ROTATE_IN" | "HOLD" | "ROTATE_OUT"
  confidence: number;     // 0.0 – 1.0
  modelName: string;
  date: string;
}

export interface RotationEntryResult {
  triggered: boolean;
  pair: string;
  positionSizePercent: number;
  isDCAAddIn: boolean;
  clientResults: Array<{
    userId: number;
    name: string | null;
    success: boolean;
    orderId?: number;
    btcAmount?: number;
    executionPrice?: number;
    error?: string;
  }>;
  skippedReason?: string;
}

export interface TrailingStopCheckResult {
  positionsChecked: number;
  trailingStopsSet: number;
  results: Array<{
    positionId: number;
    userId: number;
    pair: string;
    netProfitable: boolean;
    trailingStopSet: boolean;
    stopPercent?: number;
    error?: string;
  }>;
}

/**
 * Determine rotation entry size based on existing exposure to this altcoin.
 * Returns 0 if max exposure already reached.
 */
export function determineEntrySize(openPairPositionCount: number): {
  positionSizePercent: number;
  isDCAAddIn: boolean;
  label: string;
} {
  if (openPairPositionCount === 0) {
    return { positionSizePercent: 2, isDCAAddIn: false, label: "Initial entry (2%)" };
  } else if (openPairPositionCount === 1) {
    return { positionSizePercent: 4, isDCAAddIn: true, label: "DCA add-in (4%)" };
  } else if (openPairPositionCount === 2) {
    return { positionSizePercent: 6, isDCAAddIn: true, label: "Final DCA (6%)" };
  } else {
    return { positionSizePercent: 0, isDCAAddIn: true, label: "Max exposure reached (12%)" };
  }
}

/**
 * Execute a rotation entry across all active clients.
 * @param signal The rotation signal from ML predictions
 * @param forceSizePercent Override the auto-determined size (for manual trades)
 * @param dryRun Log intent but do not place orders
 */
export async function runRotationEntry(
  signal: RotationSignal,
  forceSizePercent?: number,
  dryRun = false
): Promise<RotationEntryResult> {
  if (!signal.prediction.includes("ROTATE_IN") && !signal.prediction.includes("BUY")) {
    return {
      triggered: false,
      pair: signal.pair,
      positionSizePercent: 0,
      isDCAAddIn: false,
      clientResults: [],
      skippedReason: `Signal ${signal.prediction} is not a rotation entry signal`,
    };
  }

  const allClients = await getAllClients();
  const clients = allClients.filter((c) => c.isActive && c.sfoxApiKey);
  const clientResults: RotationEntryResult["clientResults"] = [];

  let finalSizePercent = forceSizePercent ?? 2;
  let isDCAAddIn = false;

  for (const client of clients) {
    // Calculate current exposure to this altcoin for this client
    const openPositions = await getOpenPositions(client.userId);
    const existingAltPositions = openPositions.filter(
      (p) => p.pair.toUpperCase() === signal.pair.toUpperCase()
    );

    // Determine entry size if not forced
    if (!forceSizePercent) {
      const sizing = determineEntrySize(existingAltPositions.length);
      if (sizing.positionSizePercent === 0) {
        clientResults.push({
          userId: client.userId,
          name: client.name,
          success: false,
          error: `Max exposure (12%) already reached for ${signal.pair}`,
        });
        continue;
      }
      finalSizePercent = sizing.positionSizePercent;
      isDCAAddIn = sizing.isDCAAddIn;
    }

    // Hard limit checks
    if (finalSizePercent > 6) {
      clientResults.push({
        userId: client.userId,
        name: client.name,
        success: false,
        error: `Entry size ${finalSizePercent}% exceeds hard limit of 6% per trade`,
      });
      continue;
    }

    // Max 3 concurrent rotations
    const totalOpenPositions = openPositions.filter((p) => p.status === "open").length;
    if (totalOpenPositions >= 3 && existingAltPositions.length === 0) {
      clientResults.push({
        userId: client.userId,
        name: client.name,
        success: false,
        error: `Maximum 3 concurrent rotations reached (currently ${totalOpenPositions})`,
      });
      continue;
    }

    if (dryRun) {
      clientResults.push({
        userId: client.userId,
        name: client.name,
        success: true,
      });
      continue;
    }

    const result = await executeRotationEntry({
      apiKey: client.sfoxApiKey,
      pair: signal.pair,
      positionSizePercent: finalSizePercent,
      clientOrderId: generateClientOrderId("ROT-ENTRY", signal.pair),
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
      notes: result.error ?? null,
    });

    // Record open position
    if (result.success && result.executionPrice && result.quantity) {
      await insertPosition({
        userId: client.userId,
        pair: signal.pair,
        strategy: "ROTATION",
        entryExecutionId: logId,
        entryPrice: String(result.executionPrice),
        entryBtcAmount: String(result.quantity),
        status: "open",
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
    positionSizePercent: finalSizePercent,
    isDCAAddIn,
    clientResults,
  };
}

/**
 * Check all open positions and automatically set trailing stops when net profitable.
 * Called by the scheduler — typically every 15 minutes.
 *
 * @param altPriceHistory Map of alt symbol → array of 30 daily closing prices (ALT/BTC)
 */
export async function checkAndSetTrailingStops(
  altPriceHistory: Map<string, number[]>
): Promise<TrailingStopCheckResult> {
  const allClients = await getAllClients();
  const activeClients = allClients.filter((c) => c.isActive && c.sfoxApiKey);
  const results: TrailingStopCheckResult["results"] = [];
  let trailingStopsSet = 0;
  let positionsChecked = 0;

  for (const client of activeClients) {
    const openPositions = await getOpenPositions(client.userId);
    // Only check positions that don't already have a trailing stop set
    const openRotations = openPositions.filter(
      (p) => p.status === "open" && !p.trailingStopPrice
    );

    for (const position of openRotations) {
      positionsChecked++;
      const altSymbol = position.pair.split("/")[0] ?? "";

      // Get current alt balance from SFOX
      let currentAltBalance = 0;
      let currentPrice = 0;
      try {
        const altBal = await getBalance(altSymbol, client.sfoxApiKey);
        currentAltBalance = altBal?.available ?? 0;
        currentPrice = Number(position.currentPrice ?? position.entryPrice);
      } catch (err) {
        results.push({
          positionId: position.id,
          userId: client.userId,
          pair: position.pair,
          netProfitable: false,
          trailingStopSet: false,
          error: `Failed to fetch balance: ${err instanceof Error ? err.message : String(err)}`,
        });
        continue;
      }

      // Calculate entry BTC cost from stored entryBtcAmount
      const entryBtcCost = Number(position.entryBtcAmount);
      const currentBtcValue = currentAltBalance * currentPrice;
      const netProfitable = isNetProfitable(entryBtcCost, currentBtcValue);

      if (!netProfitable) {
        results.push({
          positionId: position.id,
          userId: client.userId,
          pair: position.pair,
          netProfitable: false,
          trailingStopSet: false,
        });
        continue;
      }

      // Calculate volatility tier for trailing stop %
      const priceHistory = altPriceHistory.get(altSymbol) ?? [];
      const volatilityRec = calculateVolatilityTier(priceHistory);

      // Place trailing stop on SFOX
      try {
        if (currentAltBalance > 0) {
          await placeTrailingStop({
            pair: position.pair,
            quantity: currentAltBalance,
            apiKey: client.sfoxApiKey,
            stopPercent: volatilityRec.stopPercent,
            clientOrderId: generateClientOrderId("TRAIL", position.pair),
          });

          // Update position record with trailing stop details
          const trailingStopPrice = currentPrice * (1 - volatilityRec.stopPercent);
          await setTrailingStop(position.id, volatilityRec.stopPercent, trailingStopPrice);

          trailingStopsSet++;
          results.push({
            positionId: position.id,
            userId: client.userId,
            pair: position.pair,
            netProfitable: true,
            trailingStopSet: true,
            stopPercent: volatilityRec.stopPercent,
          });
        }
      } catch (err) {
        results.push({
          positionId: position.id,
          userId: client.userId,
          pair: position.pair,
          netProfitable: true,
          trailingStopSet: false,
          error: `Failed to place trailing stop: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
  }

  return { positionsChecked, trailingStopsSet, results };
}

/**
 * Calculate the breakeven BTC value for a position.
 * Exposed for use in the UI to show breakeven threshold.
 */
export function getBreakevenBtc(entryBtcCost: number): number {
  return calculateBreakevenBtc(entryBtcCost);
}
