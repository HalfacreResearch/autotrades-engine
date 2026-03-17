/**
 * DCA Engine
 * Automated Dollar-Cost Averaging: USD → BTC
 *
 * Signal strength → position size mapping:
 *   STRONG   (confidence ≥ 0.75) → 10% of available USD
 *   MODERATE (confidence ≥ 0.60) → 7.5% of available USD
 *   WEAK     (confidence ≥ 0.45) → 5% of available USD
 *   MINIMAL  (confidence ≥ 0.30) → 2.5% of available USD
 *   NONE     (confidence < 0.30)  → no trade
 *
 * Hard limits (server-side enforced):
 *   - Automated DCA never exceeds 10% of USD balance per trade
 *   - 25% initial buy is MANUAL ONLY — never triggered by this engine
 *   - Minimum trade size: $5 USD
 *
 * Execution:
 *   - Smart Routing (algorithm_id 200) across all venues
 *   - Fires for ALL active clients simultaneously
 *   - Every execution logged to codex_portal execution_log
 */

import { getAllClients, insertExecutionLog, updateExecutionLog } from "./db";
import { decryptApiKey, executeDCABuy, generateClientOrderId } from "./sfoxEngine";

export interface DCASignal {
  prediction: string;   // "BUY" | "STRONG_BUY" | "HOLD" | "SELL" | "STRONG_SELL"
  confidence: number;   // 0.0 – 1.0
  modelName: string;
  date: string;
}

export interface DCAEngineResult {
  triggered: boolean;
  positionSizePercent: number;
  signalStrength: string;
  clientResults: Array<{
    clientId: number;
    clientName: string;
    success: boolean;
    orderId?: number;
    usdAmount?: number;
    executionPrice?: number;
    error?: string;
  }>;
  skippedReason?: string;
}

/**
 * Map ML prediction signal to DCA position size.
 * Returns 0 if no trade should be placed.
 */
export function mapSignalToPositionSize(signal: DCASignal): {
  positionSizePercent: number;
  signalStrength: string;
} {
  // Only act on BUY signals
  if (!signal.prediction.includes("BUY")) {
    return { positionSizePercent: 0, signalStrength: "NONE" };
  }

  const confidence = signal.confidence;

  if (confidence >= 0.75) {
    return { positionSizePercent: 10, signalStrength: "STRONG" };
  } else if (confidence >= 0.60) {
    return { positionSizePercent: 7.5, signalStrength: "MODERATE" };
  } else if (confidence >= 0.45) {
    return { positionSizePercent: 5, signalStrength: "WEAK" };
  } else if (confidence >= 0.30) {
    return { positionSizePercent: 2.5, signalStrength: "MINIMAL" };
  } else {
    return { positionSizePercent: 0, signalStrength: "NONE" };
  }
}

/**
 * Determine the composite signal from multiple ML models.
 * Uses the highest-confidence BUY signal from the 7d and 30d direction models.
 * Rule-based signals are used as secondary confirmation.
 */
export function resolveCompositeSignal(
  mlPredictions: DCASignal[],
  ruleBasedBuySignal: boolean
): DCASignal | null {
  // Filter to BUY signals from direction models only
  const buySignals = mlPredictions.filter(
    (p) =>
      p.prediction.includes("BUY") &&
      (p.modelName.includes("direction") || p.modelName.includes("dca"))
  );

  if (buySignals.length === 0) return null;

  // Sort by confidence descending, take the strongest
  buySignals.sort((a, b) => b.confidence - a.confidence);
  const strongest = buySignals[0];
  if (!strongest) return null;

  // Require rule-based confirmation for MINIMAL signals (confidence < 0.45)
  if (strongest.confidence < 0.45 && !ruleBasedBuySignal) {
    return null;
  }

  return strongest;
}

/**
 * Run the DCA engine for all active clients.
 * Called by the scheduler — typically once per day.
 *
 * @param signal The resolved composite DCA signal
 * @param dryRun If true, logs the intent but does not place orders
 */
export async function runDCAEngine(
  signal: DCASignal,
  dryRun = false
): Promise<DCAEngineResult> {
  const { positionSizePercent, signalStrength } = mapSignalToPositionSize(signal);

  if (positionSizePercent === 0) {
    return {
      triggered: false,
      positionSizePercent: 0,
      signalStrength: "NONE",
      clientResults: [],
      skippedReason: `Signal ${signal.prediction} with confidence ${(signal.confidence * 100).toFixed(1)}% does not meet minimum threshold for DCA buy`,
    };
  }

  // Hard limit check
  if (positionSizePercent > 10) {
    return {
      triggered: false,
      positionSizePercent,
      signalStrength,
      clientResults: [],
      skippedReason: `Position size ${positionSizePercent}% exceeds automated DCA hard limit of 10%`,
    };
  }

  const allClients = await getAllClients();
  const clients = allClients.filter((c) => c.isActive);
  const clientResults: DCAEngineResult["clientResults"] = [];

  for (const client of clients) {
    if (!client.sfoxApiKeyEncrypted || !client.sfoxApiKeyIv || !client.sfoxApiKeyAuthTag) {
      clientResults.push({
        clientId: client.id,
        clientName: client.clientName,
        success: false,
        error: "No SFOX API key configured",
      });
      continue;
    }

    let apiKey: string;
    try {
      apiKey = decryptApiKey(
        client.sfoxApiKeyEncrypted,
        client.sfoxApiKeyIv,
        client.sfoxApiKeyAuthTag
      );
    } catch (err) {
      clientResults.push({
        clientId: client.id,
        clientName: client.clientName,
        success: false,
        error: `Failed to decrypt API key: ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }

    const executionId = `dca-${client.id}-${Date.now()}`;

    // Log pending
    await insertExecutionLog({
      executionId,
      clientId: client.id,
      tradeType: "DCA_BUY",
      pair: "BTC/USD",
      side: "buy",
      positionSizePercent: String(positionSizePercent),
      status: dryRun ? "pending" : "pending",
      isTestAccount: false,
    });

    if (dryRun) {
      clientResults.push({
        clientId: client.id,
        clientName: client.clientName,
        success: true,
        usdAmount: 0, // would need balance fetch for dry run estimate
      });
      await updateExecutionLog(executionId, {
        status: "cancelled",
        errorMessage: "Dry run — no order placed",
      });
      continue;
    }

    const result = await executeDCABuy({
      apiKey,
      positionSizePercent,
      clientOrderId: generateClientOrderId("DCA", "BTCUSD"),
    });

    await updateExecutionLog(executionId, {
      status: result.success ? "executed" : "failed",
      sfoxOrderId: result.orderId ? String(result.orderId) : undefined,
      executionPrice: result.executionPrice ? String(result.executionPrice) : undefined,
      quantity: result.quantity ? String(result.quantity) : undefined,
      usdValue: result.usdValue ? String(result.usdValue) : undefined,
      errorMessage: result.error,
      executedAt: new Date(),
    });

    clientResults.push({
      clientId: client.id,
      clientName: client.clientName,
      success: result.success,
      orderId: result.orderId,
      usdAmount: result.usdValue,
      executionPrice: result.executionPrice,
      error: result.error,
    });
  }

  return {
    triggered: true,
    positionSizePercent,
    signalStrength,
    clientResults,
  };
}
