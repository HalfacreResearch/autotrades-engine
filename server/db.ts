/**
 * Database helpers for autotrades-engine.
 *
 * ALL operations use the VPS MySQL databases:
 *   - CLIENT_PORTAL_DATABASE_URL → codex_portal (users, credentials, positions, log)
 *   - TRADINGHQ_DATABASE_URL     → tradinghq (ml_predictions, factor_snapshots, trade_recommendations)
 *
 * There is NO Manus-hosted database. DATABASE_URL is NOT used.
 */

import { and, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  ActivePosition,
  ClientConnection,
  ClientCredential,
  ExecutionLogEntry,
  InsertActivePosition,
  InsertExecutionLog,
  InsertUser,
  User,
  activePositions,
  clientConnections,
  clientCredentials,
  executionLog,
  users,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

// ─── codex_portal DB (CLIENT_PORTAL_DATABASE_URL) ────────────────────────────

let _clientPortalDb: ReturnType<typeof drizzle> | null = null;

export async function getClientPortalDb() {
  const url = process.env.CLIENT_PORTAL_DATABASE_URL;
  if (!url) return null;
  if (!_clientPortalDb) {
    try {
      _clientPortalDb = drizzle(url);
    } catch (error) {
      console.warn("[ClientPortalDB] Failed to connect:", error);
      _clientPortalDb = null;
    }
  }
  return _clientPortalDb;
}

// Alias — used by auth core which calls getDb()
export const getDb = getClientPortalDb;

// ─── tradinghq DB (TRADINGHQ_DATABASE_URL) ───────────────────────────────────

let _tradinghqDb: ReturnType<typeof drizzle> | null = null;

export async function getTradinghqDb() {
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

// ─── User helpers (codex_portal.users) ───────────────────────────────────────

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getClientPortalDb();
  if (!db) return;

  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};

  const textFields = ["name", "email", "loginMethod"] as const;
  for (const field of textFields) {
    const value = user[field];
    if (value === undefined) continue;
    const normalized = value ?? null;
    values[field] = normalized;
    updateSet[field] = normalized;
  }
  if (user.lastSignedIn !== undefined) {
    values.lastSignedIn = user.lastSignedIn;
    updateSet.lastSignedIn = user.lastSignedIn;
  }
  if (user.role !== undefined) {
    values.role = user.role;
    updateSet.role = user.role;
  } else if (user.openId === ENV.ownerOpenId) {
    values.role = "admin";
    updateSet.role = "admin";
  }
  if (!values.lastSignedIn) values.lastSignedIn = new Date();
  if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();

  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string): Promise<User | undefined> {
  const db = await getClientPortalDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}

// ─── Client helpers (codex_portal.client_credentials + client_connections) ───

/**
 * Returns all active clients with their SFOX API keys and trading settings.
 * Joins client_credentials → client_connections → users.
 */
export interface ClientWithCredentials {
  userId: number;
  credentialId: number;
  name: string | null;
  email: string | null;
  role: string | null;
  sfoxApiKey: string;
  isLive: boolean;
  initialBuyExecuted: boolean;
  isActive: boolean | null;
  autoTradeEnabled: boolean | null;
  maxBtcPerTrade: string | null;
}

export async function getAllClients(): Promise<ClientWithCredentials[]> {
  const db = await getClientPortalDb();
  if (!db) return [];
  try {
    const result = await db.execute(
      `SELECT u.id as userId, cc.id as credentialId, u.name, u.email, u.role,
       cc.sfoxApiKey, cc.is_live as isLive, cc.initial_buy_executed as initialBuyExecuted,
       cn.is_active as isActive, cn.auto_trade_enabled as autoTradeEnabled,
       cn.max_btc_per_trade as maxBtcPerTrade
       FROM client_credentials cc
       JOIN users u ON cc.userId = u.id
       LEFT JOIN client_connections cn ON cn.credential_id = cc.id
       WHERE u.role IN ('user', 'client')
       AND u.role != 'inactive'
       ORDER BY u.name`
    );
    const rows = (result as unknown[])[0] as ClientWithCredentials[];
    return rows.map(r => ({
      ...r,
      isLive: r.isLive == (1 as unknown) || r.isLive === true,
      initialBuyExecuted: r.initialBuyExecuted == (1 as unknown) || r.initialBuyExecuted === true,
      isActive: r.isActive == (1 as unknown) || r.isActive === true,
      autoTradeEnabled: r.autoTradeEnabled == (1 as unknown) || r.autoTradeEnabled === true,
    }));
  } catch (e) {
    console.warn("[ClientPortalDB] getAllClients error:", e);
    return [];
  }
}

export async function getClientByUserId(userId: number): Promise<ClientWithCredentials | undefined> {
  const clients = await getAllClients();
  return clients.find(c => c.userId === userId);
}

export async function getClientByCredentialId(credentialId: number): Promise<ClientWithCredentials | undefined> {
  const clients = await getAllClients();
  return clients.find(c => c.credentialId === credentialId);
}

export async function getPendingInitialBuyClients(): Promise<ClientWithCredentials[]> {
  const clients = await getAllClients();
  return clients.filter(c => !c.initialBuyExecuted);
}

export async function markInitialBuyExecuted(credentialId: number): Promise<void> {
  const db = await getClientPortalDb();
  if (!db) return;
  await db
    .update(clientCredentials)
    .set({ initialBuyExecuted: true })
    .where(eq(clientCredentials.id, credentialId));
}

// ─── Active Position helpers (codex_portal.autotrades_active_positions) ───────

export async function getOpenPositions(userId?: number): Promise<ActivePosition[]> {
  const db = await getClientPortalDb();
  if (!db) return [];
  const conditions = [eq(activePositions.status, "open")];
  if (userId !== undefined) conditions.push(eq(activePositions.userId, userId));
  return db
    .select()
    .from(activePositions)
    .where(and(...conditions))
    .orderBy(desc(activePositions.openedAt));
}

export async function getOpenPositionCount(userId: number): Promise<number> {
  const positions = await getOpenPositions(userId);
  return positions.length;
}

export async function insertPosition(data: InsertActivePosition): Promise<void> {
  const db = await getClientPortalDb();
  if (!db) return;
  await db.insert(activePositions).values(data);
}

export async function updatePositionPrices(
  id: number,
  currentPrice: number,
  peakPrice: number,
  unrealizedBtcPnl: number,
): Promise<void> {
  // Stop placement is handled exclusively by the VPS exit monitor (exit_monitor.py).
  // This function only updates price tracking fields.
  const db = await getClientPortalDb();
  if (!db) return;
  await db
    .update(activePositions)
    .set({
      currentPrice: String(currentPrice),
      peakPrice: String(peakPrice),
      unrealizedBtcPnl: String(unrealizedBtcPnl),
    })
    .where(eq(activePositions.id, id));
}

export async function setTrailingStop(
  id: number,
  trailingStopPct: number,
  trailingStopPrice: number
): Promise<void> {
  const db = await getClientPortalDb();
  if (!db) return;
  await db
    .update(activePositions)
    .set({
      trailingStopPct: String(trailingStopPct),
      trailingStopPrice: String(trailingStopPrice),
    })
    .where(eq(activePositions.id, id));
}

export async function closePosition(
  id: number,
  closeExecutionId: number
): Promise<void> {
  const db = await getClientPortalDb();
  if (!db) return;
  await db
    .update(activePositions)
    .set({
      status: "closed",
      closedAt: new Date(),
      closeExecutionId,
    })
    .where(eq(activePositions.id, id));
}

// ─── Execution Log helpers (codex_portal.execution_log) ──────────────────────

export async function insertExecutionLog(data: InsertExecutionLog): Promise<number> {
  const db = await getClientPortalDb();
  if (!db) throw new Error("No DB connection");
  const result = await db.insert(executionLog).values(data);
  // Return the inserted row ID
  return (result as unknown as { insertId: number }).insertId;
}

export async function getExecutionLog(limit = 100, userId?: number): Promise<ExecutionLogEntry[]> {
  const db = await getClientPortalDb();
  if (!db) return [];
  const conditions = userId !== undefined ? [eq(executionLog.userId, userId)] : [];
  return db
    .select()
    .from(executionLog)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(executionLog.executedAt))
    .limit(limit);
}

// ─── TradinghqDB helpers (read-only) ─────────────────────────────────────────

export interface MlPrediction {
  id: number;
  date: string;
  modelName: string;
  prediction: string;
  confidence: number;
  probStrongBuy: number | null;
  probBuy: number | null;
  probHold: number | null;
  probSell: number | null;
  probStrongSell: number | null;
  topFeatures: unknown;
  modelVersion: string;
  createdAt: Date;
}

export interface RuleBasedSignal {
  id: number;
  predictionType: string;
  pair: string;
  overallSignal: string;
  overallScore: number;
  confidence: number;
  activeFeatureCount: number;
  factors: unknown;
  createdAt: Date;
}

export interface TradinghqSignal {
  recommendationId: string;
  type: string;
  pair: string;
  signal: string;
  confidence: number;
  score: number;
  action: string;
  positionSize: string;
  riskLevel: string;
  factors: unknown;
  modelInfo: unknown;
  status: string;
  priceAtGeneration: string | null;
  createdAt: Date;
  expiresAt: Date;
}

export async function getLatestMlPredictions(): Promise<MlPrediction[]> {
  const db = await getTradinghqDb();
  if (!db) return [];
  try {
    const result = await db.execute(
      `SELECT p.id, p.date, p.model_name as modelName, p.prediction, p.confidence,
       p.prob_strong_buy as probStrongBuy, p.prob_buy as probBuy, p.prob_hold as probHold,
       p.prob_sell as probSell, p.prob_strong_sell as probStrongSell,
       p.top_features as topFeatures, p.model_version as modelVersion, p.created_at as createdAt
       FROM ml_predictions p
       INNER JOIN (
         SELECT model_name, MAX(created_at) as max_created
         FROM ml_predictions
         GROUP BY model_name
       ) latest ON p.model_name = latest.model_name AND p.created_at = latest.max_created
       ORDER BY FIELD(p.model_name, 'btc_direction_7d', 'btc_direction_30d', 'rotation_signal', 'dca_intensity')`
    );
    const rows = (result as unknown[])[0] as MlPrediction[];
    return rows.map(r => ({
      ...r,
      confidence: typeof r.confidence === 'string' ? parseFloat(r.confidence as unknown as string) : r.confidence,
      topFeatures: typeof r.topFeatures === 'string' ? JSON.parse(r.topFeatures as unknown as string) : r.topFeatures,
    }));
  } catch (e) {
    console.warn('[TradinghqDB] getLatestMlPredictions error:', e);
    return [];
  }
}

export async function getLatestRuleBasedSignals(): Promise<RuleBasedSignal[]> {
  const db = await getTradinghqDb();
  if (!db) return [];
  try {
    const result = await db.execute(
      `SELECT f.id, f.prediction_type as predictionType, f.pair,
       f.overall_signal as overallSignal, f.overall_score as overallScore,
       f.confidence, f.active_features_count as activeFeatureCount,
       f.factors, f.createdAt
       FROM factor_snapshots f
       INNER JOIN (
         SELECT prediction_type, pair, MAX(createdAt) as max_created
         FROM factor_snapshots
         WHERE prediction_type IN ('RULE_DCA', 'RULE_ROTATION')
         GROUP BY prediction_type, pair
       ) latest ON f.prediction_type = latest.prediction_type
         AND f.pair = latest.pair
         AND f.createdAt = latest.max_created
       ORDER BY f.prediction_type, f.pair`
    );
    const rows = (result as unknown[])[0] as RuleBasedSignal[];
    return rows.map(r => ({
      ...r,
      overallScore: typeof r.overallScore === 'string' ? parseFloat(r.overallScore as unknown as string) : r.overallScore,
      confidence: typeof r.confidence === 'string' ? parseFloat(r.confidence as unknown as string) : r.confidence,
      factors: typeof r.factors === 'string' ? JSON.parse(r.factors as unknown as string) : r.factors,
    }));
  } catch (e) {
    console.warn('[TradinghqDB] getLatestRuleBasedSignals error:', e);
    return [];
  }
}

export async function getLatestSignals(limit = 20): Promise<TradinghqSignal[]> {
  const db = await getTradinghqDb();
  if (!db) return [];
  try {
    const result = await db.execute(
      `SELECT recommendation_id as recommendationId, type, pair, signal_type as signal, confidence, score, action,
       position_size as positionSize, risk_level as riskLevel, factors, model_info as modelInfo,
       status, price_at_generation as priceAtGeneration, createdAt, expiresAt
       FROM trade_recommendations
       WHERE status IN ('pending', 'approved')
       AND expiresAt > NOW()
       ORDER BY createdAt DESC
       LIMIT ${limit}`
    );
    return (result as unknown[])[0] as TradinghqSignal[];
  } catch {
    return [];
  }
}
