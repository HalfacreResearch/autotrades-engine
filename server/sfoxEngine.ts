/**
 * SFOX Execution Engine
 * Handles all trade execution against the SFOX API.
 * API credentials are decrypted server-side and NEVER exposed to the frontend.
 */

import crypto from "crypto";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SFOXBalance {
  currency: string;
  balance: number;
  available: number;
  held: number;
}

export interface SFOXOrderRequest {
  pair: string;
  quantity: number;
  price?: number; // omit for market orders
  type: "market" | "limit";
  side: "buy" | "sell";
  clientOrderId?: string;
}

export interface SFOXOrderResponse {
  id: number;
  pair: string;
  quantity: number;
  price: number;
  side: string;
  status: string;
  filled: number;
  avgFillPrice: number;
  createdAt: string;
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
  error?: string;
}

// ─── Encryption Helpers ───────────────────────────────────────────────────────

const ENCRYPTION_KEY = process.env.API_KEY_ENCRYPTION_SECRET || "";

export function encryptApiKey(plaintext: string): { encrypted: string; iv: string; authTag: string } {
  if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length < 32) {
    throw new Error("API_KEY_ENCRYPTION_SECRET must be at least 32 characters");
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
    throw new Error("API_KEY_ENCRYPTION_SECRET must be at least 32 characters");
  }
  const key = Buffer.from(ENCRYPTION_KEY.slice(0, 32), "utf8");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "hex"));
  decipher.setAuthTag(Buffer.from(authTag, "hex"));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(encrypted, "hex")), decipher.final()]);
  return decrypted.toString("utf8");
}

// ─── SFOX API Client ──────────────────────────────────────────────────────────

function getSFOXBaseUrl(useTestAccount: boolean): string {
  return useTestAccount
    ? "https://api.sfox.com/v1" // SFOX uses same endpoint; test mode via key
    : "https://api.sfox.com/v1";
}

async function sfoxRequest<T>(
  method: "GET" | "POST" | "DELETE",
  path: string,
  apiKey: string,
  body?: Record<string, unknown>
): Promise<T> {
  const url = `https://api.sfox.com/v1${path}`;
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

// ─── Order Functions ──────────────────────────────────────────────────────────

export async function placeMarketBuy(
  pair: string,
  quantity: number,
  apiKey: string,
  clientOrderId?: string
): Promise<SFOXOrderResponse> {
  const sfoxPair = toSFOXPair(pair);
  return sfoxRequest<SFOXOrderResponse>("POST", "/orders/buy", apiKey, {
    pair: sfoxPair,
    quantity,
    orderType: "market",
    clientOrderId: clientOrderId ?? generateClientOrderId("BUY", pair),
  });
}

export async function placeMarketSell(
  pair: string,
  quantity: number,
  apiKey: string,
  clientOrderId?: string
): Promise<SFOXOrderResponse> {
  const sfoxPair = toSFOXPair(pair);
  return sfoxRequest<SFOXOrderResponse>("POST", "/orders/sell", apiKey, {
    pair: sfoxPair,
    quantity,
    orderType: "market",
    clientOrderId: clientOrderId ?? generateClientOrderId("SELL", pair),
  });
}

export async function getOrder(orderId: number, apiKey: string): Promise<SFOXOrderResponse> {
  return sfoxRequest<SFOXOrderResponse>("GET", `/orders/${orderId}`, apiKey);
}

export async function cancelOrder(orderId: number, apiKey: string): Promise<void> {
  await sfoxRequest<unknown>("DELETE", `/orders/${orderId}`, apiKey);
}

// ─── Safety Checks ────────────────────────────────────────────────────────────

export async function runSafetyChecks(params: {
  apiKey: string;
  tradeType: "DCA_BUY" | "ROTATION_ENTRY" | "ROTATION_EXIT";
  pair: string;
  positionSizePercent: number;
  openPositionCount: number;
  currentMarketPrice?: number;
}): Promise<SafetyCheckResult> {
  const { apiKey, tradeType, pair, positionSizePercent, openPositionCount, currentMarketPrice } = params;
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

  // Position limit check (max 3 concurrent rotations)
  if (tradeType === "ROTATION_ENTRY") {
    if (openPositionCount >= 3) {
      errors.push(`Maximum 3 concurrent rotation positions reached (currently ${openPositionCount}). Cannot open new rotation.`);
    }
  }

  // Balance checks
  if (tradeType === "DCA_BUY") {
    const requiredUsd = usdBalance * (positionSizePercent / 100);
    if (usdBalance < 10) {
      errors.push(`Insufficient USD balance: $${usdBalance.toFixed(2)} available. Minimum $10 required.`);
    } else if (requiredUsd < 5) {
      warnings.push(`Small trade size: $${requiredUsd.toFixed(2)} USD. Consider a larger position.`);
    }
  }

  if (tradeType === "ROTATION_ENTRY") {
    const requiredBtc = btcBalance * (positionSizePercent / 100);
    if (btcBalance < 0.0001) {
      errors.push(`Insufficient BTC balance: ${btcBalance.toFixed(8)} BTC available.`);
    } else if (requiredBtc < 0.00005) {
      warnings.push(`Very small rotation size: ${requiredBtc.toFixed(8)} BTC.`);
    }
    // Max 12% per single rotation (2% min, 4% mid, 6% max per signal strength)
    if (positionSizePercent > 12) {
      errors.push(`Position size ${positionSizePercent}% exceeds maximum 12% per rotation.`);
    }
    if (positionSizePercent < 2) {
      errors.push(`Position size ${positionSizePercent}% is below minimum 2% rotation.`);
    }
  }

  if (tradeType === "ROTATION_EXIT") {
    const altCurrency = pair.split("/")[0];
    const altBalance = balances.find((b) => b.currency === altCurrency?.toUpperCase());
    if (!altBalance || altBalance.available <= 0) {
      errors.push(`No ${altCurrency} balance available to sell.`);
    }
  }

  // Price deviation check (warn if market price seems stale)
  if (currentMarketPrice && currentMarketPrice > 0) {
    // This is a soft warning — actual price will be fetched at execution
    warnings.push(`Execution will use live market price. Reference price: $${currentMarketPrice.toLocaleString()}`);
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

// ─── High-Level Execution Functions ──────────────────────────────────────────

export async function executeDCABuy(params: {
  apiKey: string;
  positionSizePercent: number;
  clientOrderId?: string;
}): Promise<TradeExecutionResult> {
  const { apiKey, positionSizePercent, clientOrderId } = params;

  try {
    const usdBal = await getBalance("USD", apiKey);
    if (!usdBal || usdBal.available <= 0) {
      return { success: false, error: "No USD balance available" };
    }

    const usdAmount = usdBal.available * (positionSizePercent / 100);
    if (usdAmount < 5) {
      return { success: false, error: `Trade size too small: $${usdAmount.toFixed(2)}` };
    }

    // SFOX DCA: buy BTC/USD with USD amount
    const order = await placeMarketBuy("BTC/USD", usdAmount, apiKey, clientOrderId);

    return {
      success: true,
      orderId: order.id,
      executionPrice: order.avgFillPrice || order.price,
      quantity: order.filled || order.quantity,
      usdValue: usdAmount,
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function executeRotationEntry(params: {
  apiKey: string;
  pair: string; // e.g. "ETH/BTC"
  positionSizePercent: number;
  clientOrderId?: string;
}): Promise<TradeExecutionResult> {
  const { apiKey, pair, positionSizePercent, clientOrderId } = params;

  try {
    const btcBal = await getBalance("BTC", apiKey);
    if (!btcBal || btcBal.available <= 0) {
      return { success: false, error: "No BTC balance available" };
    }

    const btcAmount = btcBal.available * (positionSizePercent / 100);
    if (btcAmount < 0.00005) {
      return { success: false, error: `BTC amount too small: ${btcAmount.toFixed(8)} BTC` };
    }

    // Buy altcoin with BTC
    const order = await placeMarketBuy(pair, btcAmount, apiKey, clientOrderId);

    return {
      success: true,
      orderId: order.id,
      executionPrice: order.avgFillPrice || order.price,
      quantity: order.filled || order.quantity,
      usdValue: undefined,
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function executeRotationExit(params: {
  apiKey: string;
  pair: string; // e.g. "ETH/BTC"
  sellPercent?: number; // default 100% of position
  clientOrderId?: string;
}): Promise<TradeExecutionResult> {
  const { apiKey, pair, sellPercent = 100, clientOrderId } = params;
  const altCurrency = pair.split("/")[0];

  try {
    if (!altCurrency) {
      return { success: false, error: "Invalid pair format" };
    }

    const altBal = await getBalance(altCurrency, apiKey);
    if (!altBal || altBal.available <= 0) {
      return { success: false, error: `No ${altCurrency} balance available to sell` };
    }

    const sellAmount = altBal.available * (sellPercent / 100);
    const order = await placeMarketSell(pair, sellAmount, apiKey, clientOrderId);

    return {
      success: true,
      orderId: order.id,
      executionPrice: order.avgFillPrice || order.price,
      quantity: order.filled || order.quantity,
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function testConnection(apiKey: string): Promise<{ connected: boolean; error?: string; btcBalance?: number }> {
  try {
    const balances = await getBalances(apiKey);
    const btc = balances.find((b) => b.currency === "BTC");
    return { connected: true, btcBalance: btc?.available ?? 0 };
  } catch (err) {
    return { connected: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function toSFOXPair(pair: string): string {
  // SFOX uses "btcusd" format
  return pair.replace("/", "").toLowerCase();
}

export function generateClientOrderId(type: string, pair: string): string {
  const ts = Date.now();
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `CODEX-${type}-${pair.replace("/", "")}-${ts}-${rand}`;
}
