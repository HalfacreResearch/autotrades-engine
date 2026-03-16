var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// server/sfoxEngine.ts
var sfoxEngine_exports = {};
__export(sfoxEngine_exports, {
  cancelOrder: () => cancelOrder,
  decryptApiKey: () => decryptApiKey,
  encryptApiKey: () => encryptApiKey,
  executeDCABuy: () => executeDCABuy,
  executeRotationEntry: () => executeRotationEntry,
  executeRotationExit: () => executeRotationExit,
  generateClientOrderId: () => generateClientOrderId,
  getBalance: () => getBalance,
  getBalances: () => getBalances,
  getOrder: () => getOrder,
  placeMarketBuy: () => placeMarketBuy,
  placeMarketSell: () => placeMarketSell,
  runSafetyChecks: () => runSafetyChecks,
  testConnection: () => testConnection,
  toSFOXPair: () => toSFOXPair
});
import crypto from "crypto";
function encryptApiKey(plaintext) {
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
    authTag: authTag.toString("hex")
  };
}
function decryptApiKey(encrypted, iv, authTag) {
  if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length < 32) {
    throw new Error("API_KEY_ENCRYPTION_SECRET must be at least 32 characters");
  }
  const key = Buffer.from(ENCRYPTION_KEY.slice(0, 32), "utf8");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "hex"));
  decipher.setAuthTag(Buffer.from(authTag, "hex"));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(encrypted, "hex")), decipher.final()]);
  return decrypted.toString("utf8");
}
async function sfoxRequest(method, path3, apiKey, body) {
  const url = `https://api.sfox.com/v1${path3}`;
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json"
  };
  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : void 0
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`SFOX API error ${response.status}: ${errorText}`);
  }
  return response.json();
}
async function getBalances(apiKey) {
  const raw = await sfoxRequest(
    "GET",
    "/account/balance",
    apiKey
  );
  return Object.entries(raw).map(([currency, data]) => ({
    currency: currency.toUpperCase(),
    balance: data.balance,
    available: data.available,
    held: data.held
  }));
}
async function getBalance(currency, apiKey) {
  const balances = await getBalances(apiKey);
  return balances.find((b) => b.currency === currency.toUpperCase()) ?? null;
}
async function placeMarketBuy(pair, quantity, apiKey, clientOrderId) {
  const sfoxPair = toSFOXPair(pair);
  return sfoxRequest("POST", "/orders/buy", apiKey, {
    pair: sfoxPair,
    quantity,
    orderType: "market",
    clientOrderId: clientOrderId ?? generateClientOrderId("BUY", pair)
  });
}
async function placeMarketSell(pair, quantity, apiKey, clientOrderId) {
  const sfoxPair = toSFOXPair(pair);
  return sfoxRequest("POST", "/orders/sell", apiKey, {
    pair: sfoxPair,
    quantity,
    orderType: "market",
    clientOrderId: clientOrderId ?? generateClientOrderId("SELL", pair)
  });
}
async function getOrder(orderId, apiKey) {
  return sfoxRequest("GET", `/orders/${orderId}`, apiKey);
}
async function cancelOrder(orderId, apiKey) {
  await sfoxRequest("DELETE", `/orders/${orderId}`, apiKey);
}
async function runSafetyChecks(params) {
  const { apiKey, tradeType, pair, positionSizePercent, openPositionCount, currentMarketPrice } = params;
  const warnings = [];
  const errors = [];
  let balances = [];
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
  if (tradeType === "ROTATION_ENTRY") {
    if (openPositionCount >= 3) {
      errors.push(`Maximum 3 concurrent rotation positions reached (currently ${openPositionCount}). Cannot open new rotation.`);
    }
  }
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
    if (btcBalance < 1e-4) {
      errors.push(`Insufficient BTC balance: ${btcBalance.toFixed(8)} BTC available.`);
    } else if (requiredBtc < 5e-5) {
      warnings.push(`Very small rotation size: ${requiredBtc.toFixed(8)} BTC.`);
    }
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
  if (currentMarketPrice && currentMarketPrice > 0) {
    warnings.push(`Execution will use live market price. Reference price: $${currentMarketPrice.toLocaleString()}`);
  }
  return {
    passed: errors.length === 0,
    warnings,
    errors,
    balances,
    btcBalance,
    usdBalance,
    openPositionCount
  };
}
async function executeDCABuy(params) {
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
    const order = await placeMarketBuy("BTC/USD", usdAmount, apiKey, clientOrderId);
    return {
      success: true,
      orderId: order.id,
      executionPrice: order.avgFillPrice || order.price,
      quantity: order.filled || order.quantity,
      usdValue: usdAmount
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
async function executeRotationEntry(params) {
  const { apiKey, pair, positionSizePercent, clientOrderId } = params;
  try {
    const btcBal = await getBalance("BTC", apiKey);
    if (!btcBal || btcBal.available <= 0) {
      return { success: false, error: "No BTC balance available" };
    }
    const btcAmount = btcBal.available * (positionSizePercent / 100);
    if (btcAmount < 5e-5) {
      return { success: false, error: `BTC amount too small: ${btcAmount.toFixed(8)} BTC` };
    }
    const order = await placeMarketBuy(pair, btcAmount, apiKey, clientOrderId);
    return {
      success: true,
      orderId: order.id,
      executionPrice: order.avgFillPrice || order.price,
      quantity: order.filled || order.quantity,
      usdValue: void 0
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
async function executeRotationExit(params) {
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
      quantity: order.filled || order.quantity
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
async function testConnection(apiKey) {
  try {
    const balances = await getBalances(apiKey);
    const btc = balances.find((b) => b.currency === "BTC");
    return { connected: true, btcBalance: btc?.available ?? 0 };
  } catch (err) {
    return { connected: false, error: err instanceof Error ? err.message : String(err) };
  }
}
function toSFOXPair(pair) {
  return pair.replace("/", "").toLowerCase();
}
function generateClientOrderId(type, pair) {
  const ts = Date.now();
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `CODEX-${type}-${pair.replace("/", "")}-${ts}-${rand}`;
}
var ENCRYPTION_KEY;
var init_sfoxEngine = __esm({
  "server/sfoxEngine.ts"() {
    "use strict";
    ENCRYPTION_KEY = process.env.API_KEY_ENCRYPTION_SECRET || "";
  }
});

// server/_core/index.ts
import "dotenv/config";
import express2 from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";

// shared/const.ts
var COOKIE_NAME = "app_session_id";
var ONE_YEAR_MS = 1e3 * 60 * 60 * 24 * 365;
var AXIOS_TIMEOUT_MS = 3e4;
var UNAUTHED_ERR_MSG = "Please login (10001)";
var NOT_ADMIN_ERR_MSG = "You do not have required permission (10002)";

// server/db.ts
import { and, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";

// drizzle/schema.ts
import {
  bigint,
  boolean,
  decimal,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar
} from "drizzle-orm/mysql-core";
var users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull()
});
var clientConnections = mysqlTable("client_connections", {
  id: int("id").autoincrement().primaryKey(),
  /** Client name for display */
  clientName: varchar("client_name", { length: 255 }).notNull(),
  /** Client email for identification */
  clientEmail: varchar("client_email", { length: 320 }).notNull().unique(),
  /** Encrypted SFOX API key (AES-256-GCM) */
  sfoxApiKeyEncrypted: text("sfox_api_key_encrypted"),
  /** IV for decryption */
  sfoxApiKeyIv: varchar("sfox_api_key_iv", { length: 64 }),
  /** Auth tag for AES-GCM */
  sfoxApiKeyAuthTag: varchar("sfox_api_key_auth_tag", { length: 64 }),
  /** Whether this client is active for trading */
  isActive: boolean("is_active").default(true).notNull(),
  /** Last time SFOX connection was verified */
  lastVerifiedAt: timestamp("last_verified_at"),
  /** SFOX connection status */
  connectionStatus: mysqlEnum("connection_status", ["connected", "error", "pending", "unconfigured"]).default("unconfigured").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()
});
var executionLog = mysqlTable(
  "execution_log",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    /** UUID for this execution */
    executionId: varchar("execution_id", { length: 36 }).notNull().unique(),
    /** Client who this trade was executed for */
    clientId: int("client_id").notNull().references(() => clientConnections.id),
    /** Reference to tradinghq recommendation_id */
    recommendationId: varchar("recommendation_id", { length: 36 }),
    /** Type of trade */
    tradeType: mysqlEnum("trade_type", ["DCA_BUY", "ROTATION_ENTRY", "ROTATION_EXIT"]).notNull(),
    /** Trading pair e.g. BTC/USD, ETH/BTC */
    pair: varchar("pair", { length: 20 }).notNull(),
    /** Buy or sell */
    side: mysqlEnum("side", ["buy", "sell"]).notNull(),
    /** Position size as % of relevant balance */
    positionSizePercent: decimal("position_size_percent", { precision: 5, scale: 2 }).notNull(),
    /** Quantity of base asset */
    quantity: decimal("quantity", { precision: 20, scale: 8 }),
    /** Price at execution */
    executionPrice: decimal("execution_price", { precision: 20, scale: 8 }),
    /** Total USD value of trade */
    usdValue: decimal("usd_value", { precision: 20, scale: 2 }),
    /** SFOX order ID */
    sfoxOrderId: varchar("sfox_order_id", { length: 64 }),
    /** Execution status */
    status: mysqlEnum("status", ["pending", "executed", "failed", "cancelled"]).notNull().default("pending"),
    /** Whether this was a test account trade */
    isTestAccount: boolean("is_test_account").default(true).notNull(),
    /** Error message if failed */
    errorMessage: text("error_message"),
    /** Realized P&L in BTC terms (for rotation exits) */
    realizedPnlBtc: decimal("realized_pnl_btc", { precision: 20, scale: 8 }),
    /** Realized P&L percentage */
    realizedPnlPercent: decimal("realized_pnl_percent", { precision: 10, scale: 4 }),
    /** Entry price (for rotation exits, to calculate P&L) */
    entryPrice: decimal("entry_price", { precision: 20, scale: 8 }),
    /** Who triggered this execution */
    executedBy: int("executed_by").references(() => users.id),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    executedAt: timestamp("executed_at")
  },
  (table) => ({
    clientIdx: index("idx_exec_client").on(table.clientId),
    statusIdx: index("idx_exec_status").on(table.status),
    typeIdx: index("idx_exec_type").on(table.tradeType),
    createdIdx: index("idx_exec_created").on(table.createdAt)
  })
);
var activePositions = mysqlTable(
  "active_positions",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    clientId: int("client_id").notNull().references(() => clientConnections.id),
    /** Trading pair e.g. ETH/BTC */
    pair: varchar("pair", { length: 20 }).notNull(),
    /** Position size as % of BTC stack */
    sizePercent: decimal("size_percent", { precision: 5, scale: 2 }).notNull(),
    /** Entry price */
    entryPrice: decimal("entry_price", { precision: 20, scale: 8 }).notNull(),
    /** Current price (refreshed periodically) */
    currentPrice: decimal("current_price", { precision: 20, scale: 8 }),
    /** Unrealized P&L % */
    unrealizedPnlPercent: decimal("unrealized_pnl_percent", { precision: 10, scale: 4 }),
    /** Peak P&L % reached (for trailing stop) */
    peakPnlPercent: decimal("peak_pnl_percent", { precision: 10, scale: 4 }),
    /** Trailing stop threshold % (e.g. 5 = stop if drops 5% from peak) */
    trailingStopPercent: decimal("trailing_stop_percent", { precision: 5, scale: 2 }).default("5.00"),
    /** Whether trailing stop has been triggered */
    trailingStopTriggered: boolean("trailing_stop_triggered").default(false).notNull(),
    /** Reference execution log entry that opened this position */
    openExecutionId: varchar("open_execution_id", { length: 36 }),
    /** Status */
    status: mysqlEnum("status", ["open", "closing", "closed"]).notNull().default("open"),
    openedAt: timestamp("opened_at").defaultNow().notNull(),
    closedAt: timestamp("closed_at"),
    exitPrice: decimal("exit_price", { precision: 20, scale: 8 }),
    realizedPnlPercent: decimal("realized_pnl_percent", { precision: 10, scale: 4 })
  },
  (table) => ({
    clientIdx: index("idx_pos_client").on(table.clientId),
    statusIdx: index("idx_pos_status").on(table.status),
    pairIdx: index("idx_pos_pair").on(table.pair)
  })
);

// server/_core/env.ts
var ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? ""
};

// server/db.ts
var _db = null;
async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}
var _tradinghqDb = null;
async function getTradinghqDb() {
  const url = process.env.TRADINGHQ_DATABASE_URL;
  if (!url) return null;
  if (!_tradinghqDb) {
    try {
      _tradinghqDb = drizzle(url);
    } catch (error) {
      console.warn("[TradinghqDB] Failed to connect:", error);
      _tradinghqDb = null;
    }
  }
  return _tradinghqDb;
}
async function upsertUser(user) {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;
  const values = { openId: user.openId };
  const updateSet = {};
  const textFields = ["name", "email", "loginMethod"];
  for (const field of textFields) {
    const value = user[field];
    if (value === void 0) continue;
    const normalized = value ?? null;
    values[field] = normalized;
    updateSet[field] = normalized;
  }
  if (user.lastSignedIn !== void 0) {
    values.lastSignedIn = user.lastSignedIn;
    updateSet.lastSignedIn = user.lastSignedIn;
  }
  if (user.role !== void 0) {
    values.role = user.role;
    updateSet.role = user.role;
  } else if (user.openId === ENV.ownerOpenId) {
    values.role = "admin";
    updateSet.role = "admin";
  }
  if (!values.lastSignedIn) values.lastSignedIn = /* @__PURE__ */ new Date();
  if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = /* @__PURE__ */ new Date();
  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}
async function getUserByOpenId(openId) {
  const db = await getDb();
  if (!db) return void 0;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}
async function getAllClients() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(clientConnections).orderBy(clientConnections.clientName);
}
async function getClientById(id) {
  const db = await getDb();
  if (!db) return void 0;
  const result = await db.select().from(clientConnections).where(eq(clientConnections.id, id)).limit(1);
  return result[0];
}
async function upsertClient(data) {
  const db = await getDb();
  if (!db) return;
  await db.insert(clientConnections).values(data).onDuplicateKeyUpdate({
    set: {
      clientName: data.clientName,
      isActive: data.isActive,
      connectionStatus: data.connectionStatus,
      updatedAt: /* @__PURE__ */ new Date()
    }
  });
}
async function updateClientConnectionStatus(id, status, lastVerifiedAt) {
  const db = await getDb();
  if (!db) return;
  await db.update(clientConnections).set({ connectionStatus: status, lastVerifiedAt: lastVerifiedAt ?? /* @__PURE__ */ new Date() }).where(eq(clientConnections.id, id));
}
async function saveClientApiKey(id, encrypted, iv, authTag) {
  const db = await getDb();
  if (!db) return;
  await db.update(clientConnections).set({
    sfoxApiKeyEncrypted: encrypted,
    sfoxApiKeyIv: iv,
    sfoxApiKeyAuthTag: authTag,
    connectionStatus: "pending",
    updatedAt: /* @__PURE__ */ new Date()
  }).where(eq(clientConnections.id, id));
}
async function getOpenPositions(clientId) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [eq(activePositions.status, "open")];
  if (clientId !== void 0) conditions.push(eq(activePositions.clientId, clientId));
  return db.select().from(activePositions).where(and(...conditions)).orderBy(desc(activePositions.openedAt));
}
async function getOpenPositionCount(clientId) {
  const positions = await getOpenPositions(clientId);
  return positions.length;
}
async function insertPosition(data) {
  const db = await getDb();
  if (!db) return;
  await db.insert(activePositions).values(data);
}
async function updatePositionPnl(id, currentPrice, unrealizedPnlPercent, peakPnlPercent, trailingStopTriggered) {
  const db = await getDb();
  if (!db) return;
  await db.update(activePositions).set({ currentPrice: String(currentPrice), unrealizedPnlPercent: String(unrealizedPnlPercent), peakPnlPercent: String(peakPnlPercent), trailingStopTriggered }).where(eq(activePositions.id, id));
}
async function closePosition(id, exitPrice, realizedPnlPercent) {
  const db = await getDb();
  if (!db) return;
  await db.update(activePositions).set({
    status: "closed",
    exitPrice: String(exitPrice),
    realizedPnlPercent: String(realizedPnlPercent),
    closedAt: /* @__PURE__ */ new Date()
  }).where(eq(activePositions.id, id));
}
async function insertExecutionLog(data) {
  const db = await getDb();
  if (!db) return;
  await db.insert(executionLog).values(data);
}
async function updateExecutionLog(executionId, updates) {
  const db = await getDb();
  if (!db) return;
  await db.update(executionLog).set(updates).where(eq(executionLog.executionId, executionId));
}
async function getExecutionLog(limit = 100, clientId) {
  const db = await getDb();
  if (!db) return [];
  const conditions = clientId !== void 0 ? [eq(executionLog.clientId, clientId)] : [];
  return db.select().from(executionLog).where(conditions.length ? and(...conditions) : void 0).orderBy(desc(executionLog.createdAt)).limit(limit);
}
async function getLatestSignals(limit = 20) {
  const db = await getTradinghqDb();
  if (!db) return [];
  try {
    const result = await db.execute(
      `SELECT recommendation_id as recommendationId, type, pair, signal, confidence, score, action, 
       position_size as positionSize, risk_level as riskLevel, factors, model_info as modelInfo,
       status, price_at_generation as priceAtGeneration, createdAt, expiresAt
       FROM trade_recommendations
       WHERE status IN ('pending', 'approved')
       AND expiresAt > NOW()
       ORDER BY createdAt DESC
       LIMIT ${limit}`
    );
    return result[0];
  } catch {
    return [];
  }
}

// server/_core/cookies.ts
function isSecureRequest(req) {
  if (req.protocol === "https") return true;
  const forwardedProto = req.headers["x-forwarded-proto"];
  if (!forwardedProto) return false;
  const protoList = Array.isArray(forwardedProto) ? forwardedProto : forwardedProto.split(",");
  return protoList.some((proto) => proto.trim().toLowerCase() === "https");
}
function getSessionCookieOptions(req) {
  return {
    httpOnly: true,
    path: "/",
    sameSite: "none",
    secure: isSecureRequest(req)
  };
}

// shared/_core/errors.ts
var HttpError = class extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
    this.name = "HttpError";
  }
};
var ForbiddenError = (msg) => new HttpError(403, msg);

// server/_core/sdk.ts
import axios from "axios";
import { parse as parseCookieHeader } from "cookie";
import { SignJWT, jwtVerify } from "jose";
var isNonEmptyString = (value) => typeof value === "string" && value.length > 0;
var EXCHANGE_TOKEN_PATH = `/webdev.v1.WebDevAuthPublicService/ExchangeToken`;
var GET_USER_INFO_PATH = `/webdev.v1.WebDevAuthPublicService/GetUserInfo`;
var GET_USER_INFO_WITH_JWT_PATH = `/webdev.v1.WebDevAuthPublicService/GetUserInfoWithJwt`;
var OAuthService = class {
  constructor(client) {
    this.client = client;
    console.log("[OAuth] Initialized with baseURL:", ENV.oAuthServerUrl);
    if (!ENV.oAuthServerUrl) {
      console.error(
        "[OAuth] ERROR: OAUTH_SERVER_URL is not configured! Set OAUTH_SERVER_URL environment variable."
      );
    }
  }
  decodeState(state) {
    const redirectUri = atob(state);
    return redirectUri;
  }
  async getTokenByCode(code, state) {
    const payload = {
      clientId: ENV.appId,
      grantType: "authorization_code",
      code,
      redirectUri: this.decodeState(state)
    };
    const { data } = await this.client.post(
      EXCHANGE_TOKEN_PATH,
      payload
    );
    return data;
  }
  async getUserInfoByToken(token) {
    const { data } = await this.client.post(
      GET_USER_INFO_PATH,
      {
        accessToken: token.accessToken
      }
    );
    return data;
  }
};
var createOAuthHttpClient = () => axios.create({
  baseURL: ENV.oAuthServerUrl,
  timeout: AXIOS_TIMEOUT_MS
});
var SDKServer = class {
  client;
  oauthService;
  constructor(client = createOAuthHttpClient()) {
    this.client = client;
    this.oauthService = new OAuthService(this.client);
  }
  deriveLoginMethod(platforms, fallback) {
    if (fallback && fallback.length > 0) return fallback;
    if (!Array.isArray(platforms) || platforms.length === 0) return null;
    const set = new Set(
      platforms.filter((p) => typeof p === "string")
    );
    if (set.has("REGISTERED_PLATFORM_EMAIL")) return "email";
    if (set.has("REGISTERED_PLATFORM_GOOGLE")) return "google";
    if (set.has("REGISTERED_PLATFORM_APPLE")) return "apple";
    if (set.has("REGISTERED_PLATFORM_MICROSOFT") || set.has("REGISTERED_PLATFORM_AZURE"))
      return "microsoft";
    if (set.has("REGISTERED_PLATFORM_GITHUB")) return "github";
    const first = Array.from(set)[0];
    return first ? first.toLowerCase() : null;
  }
  /**
   * Exchange OAuth authorization code for access token
   * @example
   * const tokenResponse = await sdk.exchangeCodeForToken(code, state);
   */
  async exchangeCodeForToken(code, state) {
    return this.oauthService.getTokenByCode(code, state);
  }
  /**
   * Get user information using access token
   * @example
   * const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);
   */
  async getUserInfo(accessToken) {
    const data = await this.oauthService.getUserInfoByToken({
      accessToken
    });
    const loginMethod = this.deriveLoginMethod(
      data?.platforms,
      data?.platform ?? data.platform ?? null
    );
    return {
      ...data,
      platform: loginMethod,
      loginMethod
    };
  }
  parseCookies(cookieHeader) {
    if (!cookieHeader) {
      return /* @__PURE__ */ new Map();
    }
    const parsed = parseCookieHeader(cookieHeader);
    return new Map(Object.entries(parsed));
  }
  getSessionSecret() {
    const secret = ENV.cookieSecret;
    return new TextEncoder().encode(secret);
  }
  /**
   * Create a session token for a Manus user openId
   * @example
   * const sessionToken = await sdk.createSessionToken(userInfo.openId);
   */
  async createSessionToken(openId, options = {}) {
    return this.signSession(
      {
        openId,
        appId: ENV.appId,
        name: options.name || ""
      },
      options
    );
  }
  async signSession(payload, options = {}) {
    const issuedAt = Date.now();
    const expiresInMs = options.expiresInMs ?? ONE_YEAR_MS;
    const expirationSeconds = Math.floor((issuedAt + expiresInMs) / 1e3);
    const secretKey = this.getSessionSecret();
    return new SignJWT({
      openId: payload.openId,
      appId: payload.appId,
      name: payload.name
    }).setProtectedHeader({ alg: "HS256", typ: "JWT" }).setExpirationTime(expirationSeconds).sign(secretKey);
  }
  async verifySession(cookieValue) {
    if (!cookieValue) {
      console.warn("[Auth] Missing session cookie");
      return null;
    }
    try {
      const secretKey = this.getSessionSecret();
      const { payload } = await jwtVerify(cookieValue, secretKey, {
        algorithms: ["HS256"]
      });
      const { openId, appId, name } = payload;
      if (!isNonEmptyString(openId) || !isNonEmptyString(appId) || !isNonEmptyString(name)) {
        console.warn("[Auth] Session payload missing required fields");
        return null;
      }
      return {
        openId,
        appId,
        name
      };
    } catch (error) {
      console.warn("[Auth] Session verification failed", String(error));
      return null;
    }
  }
  async getUserInfoWithJwt(jwtToken) {
    const payload = {
      jwtToken,
      projectId: ENV.appId
    };
    const { data } = await this.client.post(
      GET_USER_INFO_WITH_JWT_PATH,
      payload
    );
    const loginMethod = this.deriveLoginMethod(
      data?.platforms,
      data?.platform ?? data.platform ?? null
    );
    return {
      ...data,
      platform: loginMethod,
      loginMethod
    };
  }
  async authenticateRequest(req) {
    const cookies = this.parseCookies(req.headers.cookie);
    const sessionCookie = cookies.get(COOKIE_NAME);
    const session = await this.verifySession(sessionCookie);
    if (!session) {
      throw ForbiddenError("Invalid session cookie");
    }
    const sessionUserId = session.openId;
    const signedInAt = /* @__PURE__ */ new Date();
    let user = await getUserByOpenId(sessionUserId);
    if (!user) {
      try {
        const userInfo = await this.getUserInfoWithJwt(sessionCookie ?? "");
        await upsertUser({
          openId: userInfo.openId,
          name: userInfo.name || null,
          email: userInfo.email ?? null,
          loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
          lastSignedIn: signedInAt
        });
        user = await getUserByOpenId(userInfo.openId);
      } catch (error) {
        console.error("[Auth] Failed to sync user from OAuth:", error);
        throw ForbiddenError("Failed to sync user info");
      }
    }
    if (!user) {
      throw ForbiddenError("User not found");
    }
    await upsertUser({
      openId: user.openId,
      lastSignedIn: signedInAt
    });
    return user;
  }
};
var sdk = new SDKServer();

// server/_core/oauth.ts
function getQueryParam(req, key) {
  const value = req.query[key];
  return typeof value === "string" ? value : void 0;
}
function registerOAuthRoutes(app) {
  app.get("/api/oauth/callback", async (req, res) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");
    if (!code || !state) {
      res.status(400).json({ error: "code and state are required" });
      return;
    }
    try {
      const tokenResponse = await sdk.exchangeCodeForToken(code, state);
      const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);
      if (!userInfo.openId) {
        res.status(400).json({ error: "openId missing from user info" });
        return;
      }
      await upsertUser({
        openId: userInfo.openId,
        name: userInfo.name || null,
        email: userInfo.email ?? null,
        loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
        lastSignedIn: /* @__PURE__ */ new Date()
      });
      const sessionToken = await sdk.createSessionToken(userInfo.openId, {
        name: userInfo.name || "",
        expiresInMs: ONE_YEAR_MS
      });
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
      res.redirect(302, "/");
    } catch (error) {
      console.error("[OAuth] Callback failed", error);
      res.status(500).json({ error: "OAuth callback failed" });
    }
  });
}

// server/routers.ts
import { TRPCError as TRPCError3 } from "@trpc/server";
import { nanoid } from "nanoid";
import { z as z2 } from "zod";

// server/_core/systemRouter.ts
import { z } from "zod";

// server/_core/notification.ts
import { TRPCError } from "@trpc/server";
var TITLE_MAX_LENGTH = 1200;
var CONTENT_MAX_LENGTH = 2e4;
var trimValue = (value) => value.trim();
var isNonEmptyString2 = (value) => typeof value === "string" && value.trim().length > 0;
var buildEndpointUrl = (baseUrl) => {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(
    "webdevtoken.v1.WebDevService/SendNotification",
    normalizedBase
  ).toString();
};
var validatePayload = (input) => {
  if (!isNonEmptyString2(input.title)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Notification title is required."
    });
  }
  if (!isNonEmptyString2(input.content)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Notification content is required."
    });
  }
  const title = trimValue(input.title);
  const content = trimValue(input.content);
  if (title.length > TITLE_MAX_LENGTH) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Notification title must be at most ${TITLE_MAX_LENGTH} characters.`
    });
  }
  if (content.length > CONTENT_MAX_LENGTH) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Notification content must be at most ${CONTENT_MAX_LENGTH} characters.`
    });
  }
  return { title, content };
};
async function notifyOwner(payload) {
  const { title, content } = validatePayload(payload);
  if (!ENV.forgeApiUrl) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Notification service URL is not configured."
    });
  }
  if (!ENV.forgeApiKey) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Notification service API key is not configured."
    });
  }
  const endpoint = buildEndpointUrl(ENV.forgeApiUrl);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${ENV.forgeApiKey}`,
        "content-type": "application/json",
        "connect-protocol-version": "1"
      },
      body: JSON.stringify({ title, content })
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.warn(
        `[Notification] Failed to notify owner (${response.status} ${response.statusText})${detail ? `: ${detail}` : ""}`
      );
      return false;
    }
    return true;
  } catch (error) {
    console.warn("[Notification] Error calling notification service:", error);
    return false;
  }
}

// server/_core/trpc.ts
import { initTRPC, TRPCError as TRPCError2 } from "@trpc/server";
import superjson from "superjson";
var t = initTRPC.context().create({
  transformer: superjson
});
var router = t.router;
var publicProcedure = t.procedure;
var requireUser = t.middleware(async (opts) => {
  const { ctx, next } = opts;
  if (!ctx.user) {
    throw new TRPCError2({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }
  return next({
    ctx: {
      ...ctx,
      user: ctx.user
    }
  });
});
var protectedProcedure = t.procedure.use(requireUser);
var adminProcedure = t.procedure.use(
  t.middleware(async (opts) => {
    const { ctx, next } = opts;
    if (!ctx.user || ctx.user.role !== "admin") {
      throw new TRPCError2({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }
    return next({
      ctx: {
        ...ctx,
        user: ctx.user
      }
    });
  })
);

// server/_core/systemRouter.ts
var systemRouter = router({
  health: publicProcedure.input(
    z.object({
      timestamp: z.number().min(0, "timestamp cannot be negative")
    })
  ).query(() => ({
    ok: true
  })),
  notifyOwner: adminProcedure.input(
    z.object({
      title: z.string().min(1, "title is required"),
      content: z.string().min(1, "content is required")
    })
  ).mutation(async ({ input }) => {
    const delivered = await notifyOwner(input);
    return {
      success: delivered
    };
  })
});

// server/routers.ts
init_sfoxEngine();
function requireAdmin(ctx) {
  if (!ctx.user || ctx.user.role !== "admin") {
    throw new TRPCError3({ code: "FORBIDDEN", message: "Admin access required" });
  }
}
var appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true };
    })
  }),
  // ─── Signals (read from tradinghq DB) ──────────────────────────────────────
  signals: router({
    getFeed: protectedProcedure.input(z2.object({ limit: z2.number().min(1).max(50).default(20) }).optional()).query(async ({ input }) => {
      const signals = await getLatestSignals(input?.limit ?? 20);
      return signals;
    })
  }),
  // ─── Clients ───────────────────────────────────────────────────────────────
  clients: router({
    getAll: protectedProcedure.query(async () => {
      const clients = await getAllClients();
      return clients.map((c) => ({
        id: c.id,
        clientName: c.clientName,
        clientEmail: c.clientEmail,
        isActive: c.isActive,
        connectionStatus: c.connectionStatus,
        lastVerifiedAt: c.lastVerifiedAt,
        hasApiKey: !!(c.sfoxApiKeyEncrypted && c.sfoxApiKeyIv && c.sfoxApiKeyAuthTag),
        createdAt: c.createdAt
      }));
    }),
    add: protectedProcedure.input(
      z2.object({
        clientName: z2.string().min(1).max(255),
        clientEmail: z2.string().email()
      })
    ).mutation(async ({ ctx, input }) => {
      requireAdmin(ctx);
      await upsertClient({
        clientName: input.clientName,
        clientEmail: input.clientEmail,
        isActive: true,
        connectionStatus: "unconfigured"
      });
      return { success: true };
    }),
    setApiKey: protectedProcedure.input(
      z2.object({
        clientId: z2.number(),
        apiKey: z2.string().min(10)
      })
    ).mutation(async ({ ctx, input }) => {
      requireAdmin(ctx);
      const { encrypted, iv, authTag } = encryptApiKey(input.apiKey);
      await saveClientApiKey(input.clientId, encrypted, iv, authTag);
      const result = await testConnection(input.apiKey);
      await updateClientConnectionStatus(
        input.clientId,
        result.connected ? "connected" : "error",
        /* @__PURE__ */ new Date()
      );
      return { success: true, connected: result.connected, error: result.error };
    }),
    testConnection: protectedProcedure.input(z2.object({ clientId: z2.number() })).mutation(async ({ ctx, input }) => {
      requireAdmin(ctx);
      const client = await getClientById(input.clientId);
      if (!client?.sfoxApiKeyEncrypted || !client.sfoxApiKeyIv || !client.sfoxApiKeyAuthTag) {
        throw new TRPCError3({ code: "BAD_REQUEST", message: "No API key configured for this client" });
      }
      const apiKey = decryptApiKey(
        client.sfoxApiKeyEncrypted,
        client.sfoxApiKeyIv,
        client.sfoxApiKeyAuthTag
      );
      const result = await testConnection(apiKey);
      await updateClientConnectionStatus(
        input.clientId,
        result.connected ? "connected" : "error",
        /* @__PURE__ */ new Date()
      );
      return { connected: result.connected, btcBalance: result.btcBalance, error: result.error };
    }),
    getBalances: protectedProcedure.input(z2.object({ clientId: z2.number() })).query(async ({ ctx, input }) => {
      requireAdmin(ctx);
      const client = await getClientById(input.clientId);
      if (!client?.sfoxApiKeyEncrypted || !client.sfoxApiKeyIv || !client.sfoxApiKeyAuthTag) {
        return { balances: [], error: "No API key configured" };
      }
      try {
        const apiKey = decryptApiKey(
          client.sfoxApiKeyEncrypted,
          client.sfoxApiKeyIv,
          client.sfoxApiKeyAuthTag
        );
        const { getBalances: getBalances2 } = await Promise.resolve().then(() => (init_sfoxEngine(), sfoxEngine_exports));
        const balances = await getBalances2(apiKey);
        return { balances, error: null };
      } catch (err) {
        return { balances: [], error: err instanceof Error ? err.message : String(err) };
      }
    })
  }),
  // ─── Safety Checks ─────────────────────────────────────────────────────────
  safety: router({
    runChecks: protectedProcedure.input(
      z2.object({
        clientId: z2.number(),
        tradeType: z2.enum(["DCA_BUY", "ROTATION_ENTRY", "ROTATION_EXIT"]),
        pair: z2.string(),
        positionSizePercent: z2.number().min(0.1).max(100),
        currentMarketPrice: z2.number().optional()
      })
    ).mutation(async ({ ctx, input }) => {
      requireAdmin(ctx);
      const client = await getClientById(input.clientId);
      if (!client?.sfoxApiKeyEncrypted || !client.sfoxApiKeyIv || !client.sfoxApiKeyAuthTag) {
        return {
          passed: false,
          warnings: [],
          errors: ["No SFOX API key configured for this client"]
        };
      }
      const apiKey = decryptApiKey(
        client.sfoxApiKeyEncrypted,
        client.sfoxApiKeyIv,
        client.sfoxApiKeyAuthTag
      );
      const openPositionCount = await getOpenPositionCount(input.clientId);
      const result = await runSafetyChecks({
        apiKey,
        tradeType: input.tradeType,
        pair: input.pair,
        positionSizePercent: input.positionSizePercent,
        openPositionCount,
        currentMarketPrice: input.currentMarketPrice
      });
      return {
        passed: result.passed,
        warnings: result.warnings,
        errors: result.errors,
        btcBalance: result.btcBalance,
        usdBalance: result.usdBalance,
        openPositionCount: result.openPositionCount
      };
    })
  }),
  // ─── Trade Execution ───────────────────────────────────────────────────────
  trades: router({
    executeDCA: protectedProcedure.input(
      z2.object({
        clientId: z2.number(),
        positionSizePercent: z2.number().min(1).max(100),
        isTestAccount: z2.boolean().default(true),
        recommendationId: z2.string().optional(),
        currentMarketPrice: z2.number().optional()
      })
    ).mutation(async ({ ctx, input }) => {
      requireAdmin(ctx);
      const client = await getClientById(input.clientId);
      if (!client?.sfoxApiKeyEncrypted || !client.sfoxApiKeyIv || !client.sfoxApiKeyAuthTag) {
        throw new TRPCError3({ code: "BAD_REQUEST", message: "No SFOX API key configured for this client" });
      }
      const apiKey = decryptApiKey(
        client.sfoxApiKeyEncrypted,
        client.sfoxApiKeyIv,
        client.sfoxApiKeyAuthTag
      );
      const openPositionCount = await getOpenPositionCount(input.clientId);
      const safetyResult = await runSafetyChecks({
        apiKey,
        tradeType: "DCA_BUY",
        pair: "BTC/USD",
        positionSizePercent: input.positionSizePercent,
        openPositionCount,
        currentMarketPrice: input.currentMarketPrice
      });
      if (!safetyResult.passed) {
        throw new TRPCError3({
          code: "PRECONDITION_FAILED",
          message: `Safety checks failed: ${safetyResult.errors.join("; ")}`
        });
      }
      const executionId = nanoid();
      await insertExecutionLog({
        executionId,
        clientId: input.clientId,
        recommendationId: input.recommendationId,
        tradeType: "DCA_BUY",
        pair: "BTC/USD",
        side: "buy",
        positionSizePercent: String(input.positionSizePercent),
        status: "pending",
        isTestAccount: input.isTestAccount,
        executedBy: ctx.user?.id
      });
      const result = await executeDCABuy({
        apiKey,
        positionSizePercent: input.positionSizePercent,
        clientOrderId: generateClientOrderId("DCA", "BTCUSD")
      });
      await updateExecutionLog(executionId, {
        status: result.success ? "executed" : "failed",
        sfoxOrderId: result.orderId ? String(result.orderId) : void 0,
        executionPrice: result.executionPrice ? String(result.executionPrice) : void 0,
        quantity: result.quantity ? String(result.quantity) : void 0,
        usdValue: result.usdValue ? String(result.usdValue) : void 0,
        errorMessage: result.error,
        executedAt: /* @__PURE__ */ new Date()
      });
      return {
        success: result.success,
        executionId,
        orderId: result.orderId,
        executionPrice: result.executionPrice,
        quantity: result.quantity,
        error: result.error,
        warnings: safetyResult.warnings
      };
    }),
    executeRotationEntry: protectedProcedure.input(
      z2.object({
        clientId: z2.number(),
        pair: z2.string().regex(/^[A-Z]+\/BTC$/, "Must be an ALT/BTC pair"),
        positionSizePercent: z2.number().min(2).max(12),
        isTestAccount: z2.boolean().default(true),
        recommendationId: z2.string().optional(),
        currentMarketPrice: z2.number().optional()
      })
    ).mutation(async ({ ctx, input }) => {
      requireAdmin(ctx);
      const client = await getClientById(input.clientId);
      if (!client?.sfoxApiKeyEncrypted || !client.sfoxApiKeyIv || !client.sfoxApiKeyAuthTag) {
        throw new TRPCError3({ code: "BAD_REQUEST", message: "No SFOX API key configured for this client" });
      }
      const apiKey = decryptApiKey(
        client.sfoxApiKeyEncrypted,
        client.sfoxApiKeyIv,
        client.sfoxApiKeyAuthTag
      );
      const openPositionCount = await getOpenPositionCount(input.clientId);
      const safetyResult = await runSafetyChecks({
        apiKey,
        tradeType: "ROTATION_ENTRY",
        pair: input.pair,
        positionSizePercent: input.positionSizePercent,
        openPositionCount,
        currentMarketPrice: input.currentMarketPrice
      });
      if (!safetyResult.passed) {
        throw new TRPCError3({
          code: "PRECONDITION_FAILED",
          message: `Safety checks failed: ${safetyResult.errors.join("; ")}`
        });
      }
      const executionId = nanoid();
      await insertExecutionLog({
        executionId,
        clientId: input.clientId,
        recommendationId: input.recommendationId,
        tradeType: "ROTATION_ENTRY",
        pair: input.pair,
        side: "buy",
        positionSizePercent: String(input.positionSizePercent),
        status: "pending",
        isTestAccount: input.isTestAccount,
        executedBy: ctx.user?.id
      });
      const result = await executeRotationEntry({
        apiKey,
        pair: input.pair,
        positionSizePercent: input.positionSizePercent,
        clientOrderId: generateClientOrderId("ROT_ENTRY", input.pair.replace("/", ""))
      });
      await updateExecutionLog(executionId, {
        status: result.success ? "executed" : "failed",
        sfoxOrderId: result.orderId ? String(result.orderId) : void 0,
        executionPrice: result.executionPrice ? String(result.executionPrice) : void 0,
        quantity: result.quantity ? String(result.quantity) : void 0,
        errorMessage: result.error,
        executedAt: /* @__PURE__ */ new Date()
      });
      if (result.success && result.executionPrice) {
        await insertPosition({
          clientId: input.clientId,
          pair: input.pair,
          sizePercent: String(input.positionSizePercent),
          entryPrice: String(result.executionPrice),
          openExecutionId: executionId,
          status: "open"
        });
      }
      return {
        success: result.success,
        executionId,
        orderId: result.orderId,
        executionPrice: result.executionPrice,
        quantity: result.quantity,
        error: result.error,
        warnings: safetyResult.warnings
      };
    }),
    executeRotationExit: protectedProcedure.input(
      z2.object({
        clientId: z2.number(),
        positionId: z2.number(),
        pair: z2.string(),
        entryPrice: z2.number(),
        isTestAccount: z2.boolean().default(true),
        sellPercent: z2.number().min(1).max(100).default(100)
      })
    ).mutation(async ({ ctx, input }) => {
      requireAdmin(ctx);
      const client = await getClientById(input.clientId);
      if (!client?.sfoxApiKeyEncrypted || !client.sfoxApiKeyIv || !client.sfoxApiKeyAuthTag) {
        throw new TRPCError3({ code: "BAD_REQUEST", message: "No SFOX API key configured for this client" });
      }
      const apiKey = decryptApiKey(
        client.sfoxApiKeyEncrypted,
        client.sfoxApiKeyIv,
        client.sfoxApiKeyAuthTag
      );
      const openPositionCount = await getOpenPositionCount(input.clientId);
      const safetyResult = await runSafetyChecks({
        apiKey,
        tradeType: "ROTATION_EXIT",
        pair: input.pair,
        positionSizePercent: input.sellPercent,
        openPositionCount
      });
      if (!safetyResult.passed) {
        throw new TRPCError3({
          code: "PRECONDITION_FAILED",
          message: `Safety checks failed: ${safetyResult.errors.join("; ")}`
        });
      }
      const executionId = nanoid();
      await insertExecutionLog({
        executionId,
        clientId: input.clientId,
        tradeType: "ROTATION_EXIT",
        pair: input.pair,
        side: "sell",
        positionSizePercent: String(input.sellPercent),
        entryPrice: String(input.entryPrice),
        status: "pending",
        isTestAccount: input.isTestAccount,
        executedBy: ctx.user?.id
      });
      const result = await executeRotationExit({
        apiKey,
        pair: input.pair,
        sellPercent: input.sellPercent,
        clientOrderId: generateClientOrderId("ROT_EXIT", input.pair.replace("/", ""))
      });
      let realizedPnlPercent = 0;
      if (result.success && result.executionPrice && input.entryPrice > 0) {
        realizedPnlPercent = (result.executionPrice - input.entryPrice) / input.entryPrice * 100;
      }
      await updateExecutionLog(executionId, {
        status: result.success ? "executed" : "failed",
        sfoxOrderId: result.orderId ? String(result.orderId) : void 0,
        executionPrice: result.executionPrice ? String(result.executionPrice) : void 0,
        quantity: result.quantity ? String(result.quantity) : void 0,
        realizedPnlPercent: String(realizedPnlPercent.toFixed(4)),
        errorMessage: result.error,
        executedAt: /* @__PURE__ */ new Date()
      });
      if (result.success && result.executionPrice) {
        await closePosition(input.positionId, result.executionPrice, realizedPnlPercent);
      }
      return {
        success: result.success,
        executionId,
        orderId: result.orderId,
        executionPrice: result.executionPrice,
        realizedPnlPercent,
        error: result.error
      };
    })
  }),
  // ─── Active Positions ──────────────────────────────────────────────────────
  positions: router({
    getAll: protectedProcedure.input(z2.object({ clientId: z2.number().optional() }).optional()).query(async ({ input }) => {
      const positions = await getOpenPositions(input?.clientId);
      return positions;
    }),
    refreshPnl: protectedProcedure.input(
      z2.object({
        positionId: z2.number(),
        currentPrice: z2.number()
      })
    ).mutation(async ({ input }) => {
      const positions = await getOpenPositions();
      const position = positions.find((p) => p.id === input.positionId);
      if (!position) throw new TRPCError3({ code: "NOT_FOUND", message: "Position not found" });
      const entryPrice = parseFloat(String(position.entryPrice));
      const unrealizedPnlPercent = (input.currentPrice - entryPrice) / entryPrice * 100;
      const currentPeak = parseFloat(String(position.peakPnlPercent ?? "0"));
      const newPeak = Math.max(currentPeak, unrealizedPnlPercent);
      const trailingStop = parseFloat(String(position.trailingStopPercent ?? "5"));
      const trailingStopTriggered = newPeak > 0 && unrealizedPnlPercent < newPeak - trailingStop;
      await updatePositionPnl(
        input.positionId,
        input.currentPrice,
        unrealizedPnlPercent,
        newPeak,
        trailingStopTriggered
      );
      return {
        unrealizedPnlPercent,
        peakPnlPercent: newPeak,
        trailingStopTriggered
      };
    })
  }),
  // ─── Execution Log ─────────────────────────────────────────────────────────
  log: router({
    getAll: protectedProcedure.input(
      z2.object({
        limit: z2.number().min(1).max(500).default(100),
        clientId: z2.number().optional()
      }).optional()
    ).query(async ({ input }) => {
      return getExecutionLog(input?.limit ?? 100, input?.clientId);
    })
  })
});

// server/_core/context.ts
async function createContext(opts) {
  let user = null;
  try {
    user = await sdk.authenticateRequest(opts.req);
  } catch (error) {
    user = null;
  }
  return {
    req: opts.req,
    res: opts.res,
    user
  };
}

// server/_core/vite.ts
import express from "express";
import fs2 from "fs";
import { nanoid as nanoid2 } from "nanoid";
import path2 from "path";
import { createServer as createViteServer } from "vite";

// vite.config.ts
import { jsxLocPlugin } from "@builder.io/vite-plugin-jsx-loc";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";
import { vitePluginManusRuntime } from "vite-plugin-manus-runtime";
var PROJECT_ROOT = import.meta.dirname;
var LOG_DIR = path.join(PROJECT_ROOT, ".manus-logs");
var MAX_LOG_SIZE_BYTES = 1 * 1024 * 1024;
var TRIM_TARGET_BYTES = Math.floor(MAX_LOG_SIZE_BYTES * 0.6);
function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}
function trimLogFile(logPath, maxSize) {
  try {
    if (!fs.existsSync(logPath) || fs.statSync(logPath).size <= maxSize) {
      return;
    }
    const lines = fs.readFileSync(logPath, "utf-8").split("\n");
    const keptLines = [];
    let keptBytes = 0;
    const targetSize = TRIM_TARGET_BYTES;
    for (let i = lines.length - 1; i >= 0; i--) {
      const lineBytes = Buffer.byteLength(`${lines[i]}
`, "utf-8");
      if (keptBytes + lineBytes > targetSize) break;
      keptLines.unshift(lines[i]);
      keptBytes += lineBytes;
    }
    fs.writeFileSync(logPath, keptLines.join("\n"), "utf-8");
  } catch {
  }
}
function writeToLogFile(source, entries) {
  if (entries.length === 0) return;
  ensureLogDir();
  const logPath = path.join(LOG_DIR, `${source}.log`);
  const lines = entries.map((entry) => {
    const ts = (/* @__PURE__ */ new Date()).toISOString();
    return `[${ts}] ${JSON.stringify(entry)}`;
  });
  fs.appendFileSync(logPath, `${lines.join("\n")}
`, "utf-8");
  trimLogFile(logPath, MAX_LOG_SIZE_BYTES);
}
function vitePluginManusDebugCollector() {
  return {
    name: "manus-debug-collector",
    transformIndexHtml(html) {
      if (process.env.NODE_ENV === "production") {
        return html;
      }
      return {
        html,
        tags: [
          {
            tag: "script",
            attrs: {
              src: "/__manus__/debug-collector.js",
              defer: true
            },
            injectTo: "head"
          }
        ]
      };
    },
    configureServer(server) {
      server.middlewares.use("/__manus__/logs", (req, res, next) => {
        if (req.method !== "POST") {
          return next();
        }
        const handlePayload = (payload) => {
          if (payload.consoleLogs?.length > 0) {
            writeToLogFile("browserConsole", payload.consoleLogs);
          }
          if (payload.networkRequests?.length > 0) {
            writeToLogFile("networkRequests", payload.networkRequests);
          }
          if (payload.sessionEvents?.length > 0) {
            writeToLogFile("sessionReplay", payload.sessionEvents);
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true }));
        };
        const reqBody = req.body;
        if (reqBody && typeof reqBody === "object") {
          try {
            handlePayload(reqBody);
          } catch (e) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: false, error: String(e) }));
          }
          return;
        }
        let body = "";
        req.on("data", (chunk) => {
          body += chunk.toString();
        });
        req.on("end", () => {
          try {
            const payload = JSON.parse(body);
            handlePayload(payload);
          } catch (e) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: false, error: String(e) }));
          }
        });
      });
    }
  };
}
var plugins = [react(), tailwindcss(), jsxLocPlugin(), vitePluginManusRuntime(), vitePluginManusDebugCollector()];
var vite_config_default = defineConfig({
  plugins,
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets")
    }
  },
  envDir: path.resolve(import.meta.dirname),
  root: path.resolve(import.meta.dirname, "client"),
  publicDir: path.resolve(import.meta.dirname, "client", "public"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true
  },
  server: {
    host: true,
    allowedHosts: [
      ".manuspre.computer",
      ".manus.computer",
      ".manus-asia.computer",
      ".manuscomputer.ai",
      ".manusvm.computer",
      "localhost",
      "127.0.0.1"
    ],
    fs: {
      strict: true,
      deny: ["**/.*"]
    }
  }
});

// server/_core/vite.ts
async function setupVite(app, server) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true
  };
  const vite = await createViteServer({
    ...vite_config_default,
    configFile: false,
    server: serverOptions,
    appType: "custom"
  });
  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;
    try {
      const clientTemplate = path2.resolve(
        import.meta.dirname,
        "../..",
        "client",
        "index.html"
      );
      let template = await fs2.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid2()}"`
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e);
      next(e);
    }
  });
}
function serveStatic(app) {
  const distPath = process.env.NODE_ENV === "development" ? path2.resolve(import.meta.dirname, "../..", "dist", "public") : path2.resolve(import.meta.dirname, "public");
  if (!fs2.existsSync(distPath)) {
    console.error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`
    );
  }
  app.use(express.static(distPath));
  app.use("*", (_req, res) => {
    res.sendFile(path2.resolve(distPath, "index.html"));
  });
}

// server/_core/index.ts
function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}
async function findAvailablePort(startPort = 3e3) {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}
async function startServer() {
  const app = express2();
  const server = createServer(app);
  app.use(express2.json({ limit: "50mb" }));
  app.use(express2.urlencoded({ limit: "50mb", extended: true }));
  registerOAuthRoutes(app);
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext
    })
  );
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }
  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);
  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }
  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}
startServer().catch(console.error);
