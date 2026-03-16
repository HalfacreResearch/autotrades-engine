import { and, desc, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  ActivePosition,
  ClientConnection,
  ExecutionLog,
  InsertActivePosition,
  InsertClientConnection,
  InsertExecutionLog,
  InsertUser,
  activePositions,
  clientConnections,
  executionLog,
  users,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

// ─── Primary DB (autotrades) ──────────────────────────────────────────────────

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
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

// ─── External DB: tradinghq ───────────────────────────────────────────────────

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

// ─── External DB: codex-client-portal ────────────────────────────────────────

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

// ─── User helpers ─────────────────────────────────────────────────────────────

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
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

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}

// ─── Client Connection helpers ────────────────────────────────────────────────

export async function getAllClients(): Promise<ClientConnection[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(clientConnections)
    .orderBy(clientConnections.clientName);
}

export async function getClientById(id: number): Promise<ClientConnection | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(clientConnections).where(eq(clientConnections.id, id)).limit(1);
  return result[0];
}

export async function upsertClient(data: InsertClientConnection): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(clientConnections).values(data).onDuplicateKeyUpdate({
    set: {
      clientName: data.clientName,
      isActive: data.isActive,
      connectionStatus: data.connectionStatus,
      updatedAt: new Date(),
    },
  });
}

export async function updateClientConnectionStatus(
  id: number,
  status: ClientConnection["connectionStatus"],
  lastVerifiedAt?: Date
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(clientConnections)
    .set({ connectionStatus: status, lastVerifiedAt: lastVerifiedAt ?? new Date() })
    .where(eq(clientConnections.id, id));
}

export async function saveClientApiKey(
  id: number,
  encrypted: string,
  iv: string,
  authTag: string
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(clientConnections)
    .set({
      sfoxApiKeyEncrypted: encrypted,
      sfoxApiKeyIv: iv,
      sfoxApiKeyAuthTag: authTag,
      connectionStatus: "pending",
      updatedAt: new Date(),
    })
    .where(eq(clientConnections.id, id));
}

// ─── Active Position helpers ──────────────────────────────────────────────────

export async function getOpenPositions(clientId?: number): Promise<ActivePosition[]> {
  const db = await getDb();
  if (!db) return [];
  const conditions = [eq(activePositions.status, "open")];
  if (clientId !== undefined) conditions.push(eq(activePositions.clientId, clientId));
  return db
    .select()
    .from(activePositions)
    .where(and(...conditions))
    .orderBy(desc(activePositions.openedAt));
}

export async function getOpenPositionCount(clientId: number): Promise<number> {
  const positions = await getOpenPositions(clientId);
  return positions.length;
}

export async function insertPosition(data: InsertActivePosition): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(activePositions).values(data);
}

export async function updatePositionPnl(
  id: number,
  currentPrice: number,
  unrealizedPnlPercent: number,
  peakPnlPercent: number,
  trailingStopTriggered: boolean
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(activePositions)
    .set({ currentPrice: String(currentPrice), unrealizedPnlPercent: String(unrealizedPnlPercent), peakPnlPercent: String(peakPnlPercent), trailingStopTriggered })
    .where(eq(activePositions.id, id));
}

export async function closePosition(
  id: number,
  exitPrice: number,
  realizedPnlPercent: number
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(activePositions)
    .set({
      status: "closed",
      exitPrice: String(exitPrice),
      realizedPnlPercent: String(realizedPnlPercent),
      closedAt: new Date(),
    })
    .where(eq(activePositions.id, id));
}

// ─── Execution Log helpers ────────────────────────────────────────────────────

export async function insertExecutionLog(data: InsertExecutionLog): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(executionLog).values(data);
}

export async function updateExecutionLog(
  executionId: string,
  updates: Partial<ExecutionLog>
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(executionLog).set(updates).where(eq(executionLog.executionId, executionId));
}

export async function getExecutionLog(limit = 100, clientId?: number): Promise<ExecutionLog[]> {
  const db = await getDb();
  if (!db) return [];
  const conditions = clientId !== undefined ? [eq(executionLog.clientId, clientId)] : [];
  return db
    .select()
    .from(executionLog)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(executionLog.createdAt))
    .limit(limit);
}

// ─── TradinghqDB helpers (read-only signal feed) ──────────────────────────────

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

export async function getLatestSignals(limit = 20): Promise<TradinghqSignal[]> {
  const db = await getTradinghqDb();
  if (!db) return [];
  try {
    // Raw query since we don't have the full tradinghq schema imported here
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
    return (result as unknown[])[0] as TradinghqSignal[];
  } catch {
    return [];
  }
}

export async function getActivePositionsFromTradinghq() {
  const db = await getTradinghqDb();
  if (!db) return [];
  try {
    const result = await db.execute(
      `SELECT id, pair, size_percent as sizePercent, entry_price as entryPrice,
       current_price as currentPrice, unrealized_pnl_percent as unrealizedPnlPercent,
       peak_pnl_percent as peakPnlPercent, status, opened_at as openedAt
       FROM active_positions WHERE status = 'open' ORDER BY opened_at DESC`
    );
    return (result as unknown[])[0] as unknown[];
  } catch {
    return [];
  }
}
