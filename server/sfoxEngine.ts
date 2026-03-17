/**
 * SFOX Execution Engine
 * Handles all trade execution against the SFOX API.
 * API credentials are decrypted server-side and NEVER exposed to the frontend.
 *
 * Order Algorithm IDs:
 *   100 = Market (instant fill, no price guarantee)
 *   200 = Smart Routing (best price across venues — DEFAULT for all CodexYield trades)
 *   201 = Limit (specific price or better)
 *   304 = Stop (triggers at price, becomes market)
 *   307 = TWAP (time-weighted average price over a window)
 *   308 = Trailing Stop (stop trails price by percent or amount)
 */

import crypto from "crypto";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SFOXBalance {
  currency: string;
  balance: number;
  available: number;
  held: number;
}

export interface SFOXOrderResponse {
  id: number;
  pair: string;
  quantity: number;
  price: number;
  amount: number;
  side_id: number;
  action: string;
  algorithm_id: number;
  algorithm: string;
  type: string;
  filled: number;
  vwap: number;
  filled_amount: number;
  fees: number;
  net_proceeds: number;
  status: string;
  status_code: number;
  routing_option: string;
  routing_type: string;
  time_in_force: string;
  expires: string | null;
  dateupdated: string;
  date_added: string;
  client_order_id: string;
  avgFillPrice?: number; // convenience alias for vwap
}

export interface SFOXOrderEstimate {
  price: number;        // estimated limit price to specify
  subtotal: number;     // estimated cost/proceeds before fees
  fees: number;         // estimated fees in quote currency
  total: number;        // estimated cost/proceeds net fees
  quantity: number;     // base currency quantity
  vwap: number;         // estimated fill price
  currency_pair: string;
  routing_type: string;
}

export interface SafetyCheckResult {
  passed: boolean;
  warnings: string[];
  errors: string[];
  balances?: SFOXBalance[];
  btcBalance?: number;
  usdBalance?: number;
  openPositionCount?: number;
}

export interface TradeExecutionResult {
  success: boolean;
  orderId?: number;
  executionPrice?: number;
  quantity?: number;
  usdValue?: number;
  btcValue?: number;
  fees?: number;
  error?: string;
}

export type VolatilityTier = "low" | "medium" | "high";

export interface TrailingStopRecommendation {
  tier: VolatilityTier;
  stopPercent: number; // 0.06, 0.10, or 0.15
  rationale: string;
}

// ─── Encryption Helpers ───────────────────────────────────────────────────────

const ENCRYPTION_KEY = process.env.API_KEY_ENCRYPTION_SECRET || process.env.AUTOTRADES_SECRET || "";

export function encryptApiKey(plaintext: string): { encrypted: string; iv: string; authTag: string } {
  if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length < 32) {
    throw new Error("AUTOTRADES_SECRET must be at least 32 characters");
  }
  const key = Buffer.from(ENCRYPTION_KEY.slice(0, 32), "utf8");
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    encrypted: encrypted.toString("hex"),
    iv: iv.toString("hex"),
    authTag: authTag.toString("hex"),
  };
}

export function decryptApiKey(encrypted: string, iv: string, authTag: string): string {
  if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length < 32) {
    throw new Error("AUTOTRADES_SECRET must be at least 32 characters");
  }
  const key = Buffer.from(ENCRYPTION_KEY.slice(0, 32), "utf8");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "hex"));
  decipher.setAuthTag(Buffer.from(authTag, "hex"));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(encrypted, "hex")), decipher.final()]);
  return decrypted.toString("utf8");
}

// ─── SFOX API Client ──────────────────────────────────────────────────────────

async function sfoxRequest<T>(
  method: "GET" | "POST" | "DELETE",
  path: string,
  apiKey: string,
  body?: Record<string, unknown>,
  queryParams?: Record<string, string | number | boolean>
): Promise<T> {
  let url = `https://api.sfox.com/v1${path}`;
  if (queryParams && Object.keys(queryParams).length > 0) {
    const qs = new URLSearchParams(
      Object.entries(queryParams).map(([k, v]) => [k, String(v)])
    ).toString();
    url += `?${qs}`;
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`SFOX API error ${response.status}: ${errorText}`);
  }

  return response.json() as Promise<T>;
}

// ─── Balance Functions ────────────────────────────────────────────────────────

export async function getBalances(apiKey: string): Promise<SFOXBalance[]> {
  const raw = await sfoxRequest<Record<string, { balance: number; available: number; held: number }>>(
    "GET",
    "/account/balance",
    apiKey
  );
  return Object.entries(raw).map(([currency, data]) => ({
    currency: currency.toUpperCase(),
    balance: data.balance,
    available: data.available,
    held: data.held,
  }));
}

export async function getBalance(currency: string, apiKey: string): Promise<SFOXBalance | null> {
  const balances = await getBalances(apiKey);
  return balances.find((b) => b.currency === currency.toUpperCase()) ?? null;
}

// ─── Order Estimate (pre-trade price check) ───────────────────────────────────

/**
 * Get estimated execution price before placing an order.
 * Use this to show Matthew the estimated cost/proceeds + fees before confirming.
 * @param side "buy" | "sell"
 * @param pair e.g. "btcusd", "ethbtc"
 * @param quantity base currency quantity (for sell or limit buy)
 * @param maxspend quote currency amount to spend (for market buy — USD to spend)
 */
export async function getOrderEstimate(params: {
  side: "buy" | "sell";
  pair: string;
  apiKey: string;
  quantity?: number;
  maxspend?: number;
}): Promise<SFOXOrderEstimate> {
  const { side, pair, apiKey, quantity, maxspend } = params;
  const sfoxPair = toSFOXPair(pair);

  const queryParams: Record<string, string | number | boolean> = { pair: sfoxPair };
  if (quantity !== undefined) queryParams.quantity = quantity;
  if (maxspend !== undefined) queryParams.maxspend = maxspend;

  return sfoxRequest<SFOXOrderEstimate>(
    "GET",
    `/offer/${side}`,
    apiKey,
    undefined,
    queryParams
  );
}

// ─── Open Orders ──────────────────────────────────────────────────────────────

export async function getOpenOrders(
  apiKey: string,
  filters?: {
    action?: "buy" | "sell";
    currency_pair?: string;
    algorithm_id?: number;
    limit?: number;
  }
): Promise<SFOXOrderResponse[]> {
  const queryParams: Record<string, string | number | boolean> = {};
  if (filters?.action) queryParams.action = filters.action;
  if (filters?.currency_pair) queryParams.currency_pair = toSFOXPair(filters.currency_pair);
  if (filters?.algorithm_id) queryParams.algorithm_id = filters.algorithm_id;
  if (filters?.limit) queryParams.limit = filters.limit;

  return sfoxRequest<SFOXOrderResponse[]>("GET", "/orders", apiKey, undefined, queryParams);
}

export async function getDoneOrders(
  apiKey: string,
  filters?: {
    action?: "buy" | "sell";
    currency_pair?: string;
    limit?: number;
  }
): Promise<SFOXOrderResponse[]> {
  const queryParams: Record<string, string | number | boolean> = { limit: filters?.limit ?? 50 };
  if (filters?.action) queryParams.action = filters.action;
  if (filters?.currency_pair) queryParams.currency_pair = toSFOXPair(filters.currency_pair);

  return sfoxRequest<SFOXOrderResponse[]>("GET", "/orders/done", apiKey, undefined, queryParams);
}

export async function getOrder(orderId: number, apiKey: string): Promise<SFOXOrderResponse> {
  return sfoxRequest<SFOXOrderResponse>("GET", `/orders/${orderId}`, apiKey);
}

export async function cancelOrder(orderId: number, apiKey: string): Promise<void> {
  await sfoxRequest<unknown>("DELETE", `/orders/${orderId}`, apiKey);
}

// ─── Smart Routing Orders (DEFAULT for all CodexYield trades) ─────────────────

/**
 * Smart Routing Buy — algorithm_id 200
 * For DCA buys: specify amountUsd (USD to spend). SFOX calculates quantity.
 * For rotation entries: specify quantity (BTC to spend buying altcoin).
 */
export async function placeSmartRoutingBuy(params: {
  pair: string;           // e.g. "btcusd", "ethbtc"
  apiKey: string;
  amountUsd?: number;     // USD to spend (for BTC/USD DCA buys)
  quantity?: number;      // base currency quantity (for ALT/BTC rotation entries)
  price?: number;         // optional limit price for Smart Routing
  clientOrderId?: string;
}): Promise<SFOXOrderResponse> {
  const { pair, apiKey, amountUsd, quantity, price, clientOrderId } = params;
  const sfoxPair = toSFOXPair(pair);

  const body: Record<string, unknown> = {
    currency_pair: sfoxPair,
    algorithm_id: 200,
    routing_option: "WeightedExchange",
    client_order_id: clientOrderId ?? generateClientOrderId("SR-BUY", pair),
  };

  if (amountUsd !== undefined) body.amount = amountUsd;
  if (quantity !== undefined) body.quantity = quantity;
  if (price !== undefined) body.price = price;

  return sfoxRequest<SFOXOrderResponse>("POST", "/orders/buy", apiKey, body);
}

/**
 * Smart Routing Sell — algorithm_id 200
 * For rotation exits: specify quantity (altcoin quantity to sell back to BTC).
 * For emergency BTC→USD liquidation: specify quantity (BTC to sell).
 */
export async function placeSmartRoutingSell(params: {
  pair: string;           // e.g. "ethbtc", "btcusd"
  quantity: number;       // base currency quantity to sell
  apiKey: string;
  price?: number;         // optional limit price
  clientOrderId?: string;
}): Promise<SFOXOrderResponse> {
  const { pair, quantity, apiKey, price, clientOrderId } = params;
  const sfoxPair = toSFOXPair(pair);

  const body: Record<string, unknown> = {
    currency_pair: sfoxPair,
    quantity,
    algorithm_id: 200,
    routing_option: "WeightedExchange",
    client_order_id: clientOrderId ?? generateClientOrderId("SR-SELL", pair),
  };

  if (price !== undefined) body.price = price;

  return sfoxRequest<SFOXOrderResponse>("POST", "/orders/sell", apiKey, body);
}

// ─── Trailing Stop (auto-set when position becomes net profitable) ─────────────

/**
 * Place a Trailing Stop sell order — algorithm_id 308
 * Used to protect rotation profits. Fires automatically when position is net profitable.
 * @param stopPercent e.g. 0.10 = 10% trailing stop
 * @param stopAmount alternative: fixed quote currency amount to trail
 */
export async function placeTrailingStop(params: {
  pair: string;           // e.g. "ethbtc"
  quantity: number;       // full position quantity to protect
  apiKey: string;
  stopPercent?: number;   // e.g. 0.10 for 10% trailing stop (recommended)
  stopAmount?: number;    // alternative: fixed amount in quote currency
  clientOrderId?: string;
}): Promise<SFOXOrderResponse> {
  const { pair, quantity, apiKey, stopPercent, stopAmount, clientOrderId } = params;
  const sfoxPair = toSFOXPair(pair);

  if (!stopPercent && !stopAmount) {
    throw new Error("Either stopPercent or stopAmount must be specified for a trailing stop");
  }

  const body: Record<string, unknown> = {
    currency_pair: sfoxPair,
    quantity,
    algorithm_id: 308,
    client_order_id: clientOrderId ?? generateClientOrderId("TRAIL", pair),
  };

  if (stopPercent !== undefined) body.stop_percent = stopPercent;
  if (stopAmount !== undefined) body.stop_amount = stopAmount;

  return sfoxRequest<SFOXOrderResponse>("POST", "/orders/sell", apiKey, body);
}

// ─── TWAP (for large DCA buys to minimize market impact) ─────────────────────

/**
 * Place a TWAP buy order — algorithm_id 307
 * Executes evenly over a time window. Use for large DCA buys to minimize slippage.
 * @param totalTime total execution window in seconds (e.g. 3600 = 1 hour)
 * @param interval slice frequency in seconds (default 900 = 15 min)
 * @param continuous if true, executes as fast as possible over totalTime
 */
export async function placeTWAPBuy(params: {
  pair: string;
  amountUsd: number;      // USD to spend total
  apiKey: string;
  totalTime: number;      // seconds
  interval?: number;      // seconds between slices, default 900
  continuous?: boolean;
  postOnly?: boolean;
  clientOrderId?: string;
}): Promise<SFOXOrderResponse> {
  const { pair, amountUsd, apiKey, totalTime, interval, continuous, postOnly, clientOrderId } = params;
  const sfoxPair = toSFOXPair(pair);

  const body: Record<string, unknown> = {
    currency_pair: sfoxPair,
    amount: amountUsd,
    algorithm_id: 307,
    total_time: totalTime,
    client_order_id: clientOrderId ?? generateClientOrderId("TWAP-BUY", pair),
  };

  if (interval !== undefined) body.interval = interval;
  if (continuous !== undefined) body.continuous = continuous;
  if (postOnly !== undefined) body.post_only = postOnly;

  return sfoxRequest<SFOXOrderResponse>("POST", "/orders/buy", apiKey, body);
}

// ─── Market Orders (emergency use only) ──────────────────────────────────────

/**
 * Emergency Market Buy — algorithm_id 100
 * Instant fill, no price guarantee. Only for emergency situations.
 */
export async function placeMarketBuy(
  pair: string,
  amountUsd: number,
  apiKey: string,
  clientOrderId?: string
): Promise<SFOXOrderResponse> {
  const sfoxPair = toSFOXPair(pair);
  return sfoxRequest<SFOXOrderResponse>("POST", "/orders/buy", apiKey, {
    currency_pair: sfoxPair,
    amount: amountUsd,
    algorithm_id: 100,
    client_order_id: clientOrderId ?? generateClientOrderId("EMRG-BUY", pair),
  });
}

/**
 * Emergency Market Sell — algorithm_id 100
 * Instant fill, no price guarantee. Only for emergency exits.
 */
export async function placeMarketSell(
  pair: string,
  quantity: number,
  apiKey: string,
  clientOrderId?: string
): Promise<SFOXOrderResponse> {
  const sfoxPair = toSFOXPair(pair);
  return sfoxRequest<SFOXOrderResponse>("POST", "/orders/sell", apiKey, {
    currency_pair: sfoxPair,
    quantity,
    algorithm_id: 100,
    client_order_id: clientOrderId ?? generateClientOrderId("EMRG-SELL", pair),
  });
}

// ─── Volatility Tier & Trailing Stop Recommendation ──────────────────────────

/**
 * Calculate the recommended trailing stop percentage based on 30-day price volatility.
 * Volatility is measured as the coefficient of variation (std dev / mean) of daily returns.
 *
 * Tiers:
 *   Low    (<3% daily vol)  → 6%  trailing stop
 *   Medium (3-6% daily vol) → 10% trailing stop
 *   High   (>6% daily vol)  → 15% trailing stop
 */
export function calculateVolatilityTier(dailyPrices: number[]): TrailingStopRecommendation {
  if (dailyPrices.length < 2) {
    return {
      tier: "medium",
      stopPercent: 0.10,
      rationale: "Insufficient price history — defaulting to medium (10%) trailing stop",
    };
  }

  // Calculate daily returns
  const returns: number[] = [];
  for (let i = 1; i < dailyPrices.length; i++) {
    const prev = dailyPrices[i - 1];
    const curr = dailyPrices[i];
    if (prev && prev > 0 && curr) {
      returns.push(Math.abs((curr - prev) / prev));
    }
  }

  if (returns.length === 0) {
    return { tier: "medium", stopPercent: 0.10, rationale: "Could not calculate returns" };
  }

  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;

  if (mean < 0.03) {
    return {
      tier: "low",
      stopPercent: 0.06,
      rationale: `Low volatility (${(mean * 100).toFixed(1)}% avg daily move) — tight 6% trailing stop`,
    };
  } else if (mean < 0.06) {
    return {
      tier: "medium",
      stopPercent: 0.10,
      rationale: `Medium volatility (${(mean * 100).toFixed(1)}% avg daily move) — standard 10% trailing stop`,
    };
  } else {
    return {
      tier: "high",
      stopPercent: 0.15,
      rationale: `High volatility (${(mean * 100).toFixed(1)}% avg daily move) — wide 15% trailing stop to avoid noise`,
    };
  }
}

/**
 * Calculate whether a position is net profitable after fees and slippage.
 * Returns true if current value exceeds entry cost plus estimated fees plus slippage buffer.
 * @param entryBtcCost BTC spent to enter the position
 * @param currentBtcValue current BTC value of the altcoin position
 * @param estimatedFeesPercent SFOX fee rate (typically 0.003 = 0.3% per side)
 * @param slippageBufferPercent additional buffer for slippage (default 0.002 = 0.2%)
 */
export function isNetProfitable(
  entryBtcCost: number,
  currentBtcValue: number,
  estimatedFeesPercent = 0.003,
  slippageBufferPercent = 0.002
): boolean {
  const totalCostBasis = entryBtcCost * (1 + estimatedFeesPercent * 2 + slippageBufferPercent);
  return currentBtcValue > totalCostBasis;
}

/**
 * Calculate the breakeven BTC value for a position.
 * This is the minimum current value needed to be net profitable.
 */
export function calculateBreakevenBtc(
  entryBtcCost: number,
  estimatedFeesPercent = 0.003,
  slippageBufferPercent = 0.002
): number {
  return entryBtcCost * (1 + estimatedFeesPercent * 2 + slippageBufferPercent);
}

// ─── High-Level Execution Functions ──────────────────────────────────────────

/**
 * Execute a DCA Buy (USD → BTC) via Smart Routing.
 * @param positionSizePercent percentage of available USD to spend (2.5, 5, 7.5, or 10)
 * Hard limit: never exceeds 10% automatically. 25% only via executeInitialBuy.
 */
export async function executeDCABuy(params: {
  apiKey: string;
  positionSizePercent: number;
  clientOrderId?: string;
}): Promise<TradeExecutionResult> {
  const { apiKey, positionSizePercent, clientOrderId } = params;

  // Hard limit: automated DCA never exceeds 10%
  if (positionSizePercent > 10) {
    return { success: false, error: `DCA buy size ${positionSizePercent}% exceeds automated maximum of 10%. Use executeInitialBuy for the 25% onboarding trade.` };
  }

  try {
    const usdBal = await getBalance("USD", apiKey);
    if (!usdBal || usdBal.available <= 0) {
      return { success: false, error: "No USD balance available" };
    }

    const usdAmount = usdBal.available * (positionSizePercent / 100);
    if (usdAmount < 5) {
      return { success: false, error: `Trade size too small: $${usdAmount.toFixed(2)} (minimum $5)` };
    }

    const order = await placeSmartRoutingBuy({
      pair: "BTC/USD",
      apiKey,
      amountUsd: usdAmount,
      clientOrderId: clientOrderId ?? generateClientOrderId("DCA", "BTCUSD"),
    });

    return {
      success: true,
      orderId: order.id,
      executionPrice: order.vwap || order.price,
      quantity: order.filled || order.quantity,
      usdValue: usdAmount,
      fees: order.fees,
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Execute the one-time initial 25% BTC purchase for a new client.
 * MANUAL ONLY — never called by the scheduler.
 * Requires explicit confirmation before calling.
 */
export async function executeInitialBuy(params: {
  apiKey: string;
  clientOrderId?: string;
}): Promise<TradeExecutionResult> {
  const { apiKey, clientOrderId } = params;

  try {
    const usdBal = await getBalance("USD", apiKey);
    if (!usdBal || usdBal.available <= 0) {
      return { success: false, error: "No USD balance available" };
    }

    const usdAmount = usdBal.available * 0.25; // 25% of total USD
    if (usdAmount < 5) {
      return { success: false, error: `Trade size too small: $${usdAmount.toFixed(2)}` };
    }

    const order = await placeSmartRoutingBuy({
      pair: "BTC/USD",
      apiKey,
      amountUsd: usdAmount,
      clientOrderId: clientOrderId ?? generateClientOrderId("INIT-BUY", "BTCUSD"),
    });

    return {
      success: true,
      orderId: order.id,
      executionPrice: order.vwap || order.price,
      quantity: order.filled || order.quantity,
      usdValue: usdAmount,
      fees: order.fees,
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Execute a Rotation Entry (BTC → ALT) via Smart Routing.
 * @param positionSizePercent percentage of BTC balance (2, 4, or 6 per trade; max 12 total per alt)
 */
export async function executeRotationEntry(params: {
  apiKey: string;
  pair: string;           // e.g. "ETH/BTC"
  positionSizePercent: number; // 2, 4, or 6
  clientOrderId?: string;
}): Promise<TradeExecutionResult> {
  const { apiKey, pair, positionSizePercent, clientOrderId } = params;

  // Hard limit: single rotation trade never exceeds 6% of BTC
  if (positionSizePercent > 6) {
    return { success: false, error: `Rotation entry size ${positionSizePercent}% exceeds maximum 6% per trade.` };
  }
  if (positionSizePercent < 2) {
    return { success: false, error: `Rotation entry size ${positionSizePercent}% is below minimum 2%.` };
  }

  try {
    const btcBal = await getBalance("BTC", apiKey);
    if (!btcBal || btcBal.available <= 0) {
      return { success: false, error: "No BTC balance available" };
    }

    const btcAmount = btcBal.available * (positionSizePercent / 100);
    if (btcAmount < 0.0001) {
      return { success: false, error: `BTC amount too small: ${btcAmount.toFixed(8)} BTC` };
    }

    const order = await placeSmartRoutingBuy({
      pair,
      apiKey,
      quantity: btcAmount,
      clientOrderId: clientOrderId ?? generateClientOrderId("ROT-ENTRY", pair),
    });

    return {
      success: true,
      orderId: order.id,
      executionPrice: order.vwap || order.price,
      quantity: order.filled || order.quantity,
      btcValue: btcAmount,
      fees: order.fees,
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Execute a Full Rotation Exit (ALT → BTC) via Smart Routing.
 * Sells 100% of the altcoin position back to BTC.
 */
export async function executeRotationExit(params: {
  apiKey: string;
  pair: string;           // e.g. "ETH/BTC"
  quantity: number;       // exact quantity to sell (full position)
  clientOrderId?: string;
}): Promise<TradeExecutionResult> {
  const { apiKey, pair, quantity, clientOrderId } = params;

  try {
    const order = await placeSmartRoutingSell({
      pair,
      quantity,
      apiKey,
      clientOrderId: clientOrderId ?? generateClientOrderId("ROT-EXIT", pair),
    });

    return {
      success: true,
      orderId: order.id,
      executionPrice: order.vwap || order.price,
      quantity: order.filled || order.quantity,
      fees: order.fees,
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Execute a Capital Exit — sell only the original BTC risked, leave profits running.
 * @param entryBtcCost original BTC spent to enter the position
 * @param currentPrice current ALT/BTC price (to calculate how much alt to sell)
 */
export async function executeCapitalExit(params: {
  apiKey: string;
  pair: string;           // e.g. "ETH/BTC"
  entryBtcCost: number;   // original BTC risked
  currentPrice: number;   // current ALT/BTC price
  clientOrderId?: string;
}): Promise<TradeExecutionResult> {
  const { apiKey, pair, entryBtcCost, currentPrice, clientOrderId } = params;

  if (currentPrice <= 0) {
    return { success: false, error: "Invalid current price for capital exit calculation" };
  }

  // Quantity to sell = original BTC cost / current price
  // This recovers the original BTC while leaving the profit portion in the alt
  const quantityToSell = entryBtcCost / currentPrice;

  try {
    const order = await placeSmartRoutingSell({
      pair,
      quantity: quantityToSell,
      apiKey,
      clientOrderId: clientOrderId ?? generateClientOrderId("CAP-EXIT", pair),
    });

    return {
      success: true,
      orderId: order.id,
      executionPrice: order.vwap || order.price,
      quantity: order.filled || order.quantity,
      btcValue: entryBtcCost,
      fees: order.fees,
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Emergency Exit — Market order sell. No price guarantee.
 * Use only when immediate exit is required regardless of price.
 */
export async function executeEmergencyExit(params: {
  apiKey: string;
  pair: string;
  quantity: number;
  clientOrderId?: string;
}): Promise<TradeExecutionResult> {
  const { apiKey, pair, quantity, clientOrderId } = params;

  try {
    const order = await placeMarketSell(
      pair,
      quantity,
      apiKey,
      clientOrderId ?? generateClientOrderId("EMRG-EXIT", pair)
    );

    return {
      success: true,
      orderId: order.id,
      executionPrice: order.vwap || order.price,
      quantity: order.filled || order.quantity,
      fees: order.fees,
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Emergency Liquidation — sell ALL altcoins to BTC, then ALL BTC to USD.
 * Client offboarding only. Requires double confirmation before calling.
 * Returns a summary of all orders placed.
 */
export async function executeEmergencyLiquidation(params: {
  apiKey: string;
  clientName: string;
}): Promise<{
  success: boolean;
  orders: TradeExecutionResult[];
  errors: string[];
  totalUsdRecovered?: number;
}> {
  const { apiKey } = params;
  const orders: TradeExecutionResult[] = [];
  const errors: string[] = [];

  try {
    // Step 1: Get all balances
    const balances = await getBalances(apiKey);
    const nonBtcNonUsd = balances.filter(
      (b) => b.currency !== "BTC" && b.currency !== "USD" && b.available > 0
    );

    // Step 2: Sell all altcoins to BTC
    for (const bal of nonBtcNonUsd) {
      const pair = `${bal.currency}/BTC`;
      const result = await executeRotationExit({
        apiKey,
        pair,
        quantity: bal.available,
        clientOrderId: generateClientOrderId("LIQ-ALT", pair),
      });
      orders.push(result);
      if (!result.success) {
        errors.push(`Failed to sell ${bal.currency}: ${result.error}`);
      }
    }

    // Step 3: Wait briefly for fills, then sell all BTC to USD
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const btcBal = await getBalance("BTC", apiKey);
    if (btcBal && btcBal.available > 0) {
      const btcResult = await executeEmergencyExit({
        apiKey,
        pair: "BTC/USD",
        quantity: btcBal.available,
        clientOrderId: generateClientOrderId("LIQ-BTC", "BTCUSD"),
      });
      orders.push(btcResult);
      if (!btcResult.success) {
        errors.push(`Failed to sell BTC: ${btcResult.error}`);
      }
    }

    return {
      success: errors.length === 0,
      orders,
      errors,
    };
  } catch (err) {
    return {
      success: false,
      orders,
      errors: [...errors, err instanceof Error ? err.message : String(err)],
    };
  }
}

// ─── Safety Checks ────────────────────────────────────────────────────────────

export async function runSafetyChecks(params: {
  apiKey: string;
  tradeType: "DCA_BUY" | "ROTATION_ENTRY" | "ROTATION_EXIT" | "CAPITAL_EXIT" | "INITIAL_BUY" | "EMERGENCY_EXIT" | "EMERGENCY_LIQUIDATION";
  pair?: string;
  positionSizePercent?: number;
  openPositionCount?: number;
  totalAltExposurePercent?: number; // current total % of BTC in this specific alt
}): Promise<SafetyCheckResult> {
  const { apiKey, tradeType, pair, positionSizePercent = 0, openPositionCount = 0, totalAltExposurePercent = 0 } = params;
  const warnings: string[] = [];
  const errors: string[] = [];

  let balances: SFOXBalance[] = [];
  let btcBalance = 0;
  let usdBalance = 0;

  try {
    balances = await getBalances(apiKey);
    const btc = balances.find((b) => b.currency === "BTC");
    const usd = balances.find((b) => b.currency === "USD");
    btcBalance = btc?.available ?? 0;
    usdBalance = usd?.available ?? 0;
  } catch (err) {
    errors.push(`Failed to fetch balances: ${err instanceof Error ? err.message : String(err)}`);
    return { passed: false, warnings, errors };
  }

  if (tradeType === "DCA_BUY") {
    if (positionSizePercent > 10) {
      errors.push(`Automated DCA size ${positionSizePercent}% exceeds hard limit of 10%.`);
    }
    const requiredUsd = usdBalance * (positionSizePercent / 100);
    if (usdBalance < 10) {
      errors.push(`Insufficient USD balance: $${usdBalance.toFixed(2)} available.`);
    } else if (requiredUsd < 5) {
      warnings.push(`Small trade size: $${requiredUsd.toFixed(2)} USD.`);
    }
  }

  if (tradeType === "INITIAL_BUY") {
    const requiredUsd = usdBalance * 0.25;
    if (usdBalance < 20) {
      errors.push(`Insufficient USD balance for initial buy: $${usdBalance.toFixed(2)} available.`);
    } else if (requiredUsd < 5) {
      warnings.push(`Initial buy amount is very small: $${requiredUsd.toFixed(2)}.`);
    }
    warnings.push(`This will spend 25% of available USD ($${(usdBalance * 0.25).toFixed(2)}) to buy BTC.`);
  }

  if (tradeType === "ROTATION_ENTRY") {
    if (positionSizePercent > 6) {
      errors.push(`Rotation entry size ${positionSizePercent}% exceeds hard limit of 6% per trade.`);
    }
    if (positionSizePercent < 2) {
      errors.push(`Rotation entry size ${positionSizePercent}% is below minimum 2%.`);
    }
    // Check total exposure to this alt won't exceed 12%
    const newTotalExposure = totalAltExposurePercent + positionSizePercent;
    if (newTotalExposure > 12) {
      errors.push(`This trade would bring total exposure to ${newTotalExposure}% of BTC, exceeding the 12% maximum per altcoin.`);
    }
    // Max 3 concurrent rotations
    if (openPositionCount >= 3 && totalAltExposurePercent === 0) {
      errors.push(`Maximum 3 concurrent rotation positions reached (currently ${openPositionCount}).`);
    }
    const requiredBtc = btcBalance * (positionSizePercent / 100);
    if (btcBalance < 0.0001) {
      errors.push(`Insufficient BTC balance: ${btcBalance.toFixed(8)} BTC available.`);
    } else if (requiredBtc < 0.0001) {
      warnings.push(`Very small rotation size: ${requiredBtc.toFixed(8)} BTC.`);
    }
  }

  if (tradeType === "ROTATION_EXIT" || tradeType === "CAPITAL_EXIT" || tradeType === "EMERGENCY_EXIT") {
    if (pair) {
      const altCurrency = pair.split("/")[0];
      if (altCurrency) {
        const altBalance = balances.find((b) => b.currency === altCurrency.toUpperCase());
        if (!altBalance || altBalance.available <= 0) {
          errors.push(`No ${altCurrency} balance available to sell.`);
        }
      }
    }
  }

  if (tradeType === "EMERGENCY_LIQUIDATION") {
    warnings.push("EMERGENCY LIQUIDATION: This will sell ALL assets and convert everything to USD. This action cannot be undone.");
    if (btcBalance <= 0 && balances.every((b) => b.currency === "USD" || b.available <= 0)) {
      errors.push("No assets to liquidate — account appears to be already in USD.");
    }
  }

  return {
    passed: errors.length === 0,
    warnings,
    errors,
    balances,
    btcBalance,
    usdBalance,
    openPositionCount,
  };
}

export async function testConnection(apiKey: string): Promise<{ connected: boolean; error?: string; btcBalance?: number; usdBalance?: number }> {
  try {
    const balances = await getBalances(apiKey);
    const btc = balances.find((b) => b.currency === "BTC");
    const usd = balances.find((b) => b.currency === "USD");
    return { connected: true, btcBalance: btc?.available ?? 0, usdBalance: usd?.available ?? 0 };
  } catch (err) {
    return { connected: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function toSFOXPair(pair: string): string {
  // SFOX uses "btcusd" format (no slash, lowercase)
  return pair.replace("/", "").toLowerCase();
}

export function generateClientOrderId(type: string, pair: string): string {
  const ts = Date.now();
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `CODEX-${type}-${pair.replace("/", "")}-${ts}-${rand}`;
}
