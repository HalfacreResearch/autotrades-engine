/**
 * Drizzle schema — mirrors the actual VPS codex_portal MySQL tables exactly.
 * These type definitions are used for type safety only.
 * The tables already exist on the VPS — do NOT run migrations against them.
 *
 * All DB operations use CLIENT_PORTAL_DATABASE_URL (codex_portal on VPS).
 * Signal/prediction reads use TRADINGHQ_DATABASE_URL (tradinghq on VPS).
 * There is NO Manus-hosted database.
 */

import {
  boolean,
  decimal,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/mysql-core";

// ─── users ────────────────────────────────────────────────────────────────────
// Mirrors codex_portal.users exactly

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin", "client", "inactive"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ─── client_credentials ───────────────────────────────────────────────────────
// Mirrors codex_portal.client_credentials exactly
// Stores SFOX API keys per user. Keys are stored as-is (managed by client portal).

export const clientCredentials = mysqlTable("client_credentials", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  sfoxApiKey: text("sfoxApiKey").notNull(),
  /**
   * Whether the initial 25% USD-to-BTC buy has been executed.
   * Defaults TRUE for all existing clients — NEVER fires automatically.
   * Set to FALSE only for brand-new clients who need their first trade.
   * The 25% initial buy is ALWAYS manual — never automated.
   */
  isLive: boolean("is_live").default(false).notNull(),
  initialBuyExecuted: boolean("initial_buy_executed").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ClientCredential = typeof clientCredentials.$inferSelect;
export type InsertClientCredential = typeof clientCredentials.$inferInsert;

// ─── client_connections ───────────────────────────────────────────────────────
// Mirrors codex_portal.client_connections exactly
// Join table linking users to their credentials with trading settings.

export const clientConnections = mysqlTable("client_connections", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  credentialId: int("credential_id").notNull(),
  isActive: boolean("is_active").default(true),
  autoTradeEnabled: boolean("auto_trade_enabled").default(false),
  maxBtcPerTrade: decimal("max_btc_per_trade", { precision: 20, scale: 8 }),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export type ClientConnection = typeof clientConnections.$inferSelect;
export type InsertClientConnection = typeof clientConnections.$inferInsert;

// ─── execution_log ────────────────────────────────────────────────────────────
// Mirrors codex_portal.execution_log exactly

export const executionLog = mysqlTable(
  "execution_log",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("user_id").notNull(),
    recommendationId: int("recommendation_id"),
    pair: varchar("pair", { length: 20 }).notNull(),
    strategy: mysqlEnum("strategy", ["DCA", "ROTATION"]).notNull(),
    side: mysqlEnum("side", ["buy", "sell"]).notNull(),
    quantity: decimal("quantity", { precision: 20, scale: 8 }).notNull(),
    price: decimal("price", { precision: 20, scale: 8 }).notNull(),
    totalUsd: decimal("total_usd", { precision: 20, scale: 2 }),
    totalBtc: decimal("total_btc", { precision: 20, scale: 8 }),
    feeUsd: decimal("fee_usd", { precision: 20, scale: 8 }),
    codexFeeUsd: decimal("codex_fee_usd", { precision: 20, scale: 8 }),
    sfoxOrderId: varchar("sfox_order_id", { length: 100 }),
    status: mysqlEnum("status", ["pending", "filled", "partial", "failed", "cancelled"])
      .notNull()
      .default("pending"),
    btcPnl: decimal("btc_pnl", { precision: 20, scale: 8 }),
    notes: text("notes"),
    executedAt: timestamp("executed_at").defaultNow().notNull(),
  },
  (table) => ({
    userIdx: index("idx_exec_user").on(table.userId),
    statusIdx: index("idx_exec_status").on(table.status),
  })
);

export type ExecutionLogEntry = typeof executionLog.$inferSelect;
export type InsertExecutionLog = typeof executionLog.$inferInsert;

// ─── autotrades_active_positions ─────────────────────────────────────────────
// Mirrors codex_portal.autotrades_active_positions exactly

export const activePositions = mysqlTable(
  "autotrades_active_positions",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("user_id").notNull(),
    pair: varchar("pair", { length: 20 }).notNull(),
    strategy: mysqlEnum("strategy", ["DCA", "ROTATION"]).notNull(),
    entryExecutionId: int("entry_execution_id"),
    entryPrice: decimal("entry_price", { precision: 20, scale: 8 }).notNull(),
    entryBtcAmount: decimal("entry_btc_amount", { precision: 20, scale: 8 }).notNull(),
    currentPrice: decimal("current_price", { precision: 20, scale: 8 }),
    peakPrice: decimal("peak_price", { precision: 20, scale: 8 }),
    trailingStopPct: decimal("trailing_stop_pct", { precision: 5, scale: 4 }).default("0.0500"),
    trailingStopPrice: decimal("trailing_stop_price", { precision: 20, scale: 8 }),
    unrealizedBtcPnl: decimal("unrealized_btc_pnl", { precision: 20, scale: 8 }),
    status: mysqlEnum("status", ["open", "closed", "stopped_out"]).notNull().default("open"),
    openedAt: timestamp("opened_at").defaultNow().notNull(),
    closedAt: timestamp("closed_at"),
    closeExecutionId: int("close_execution_id"),
    /**
     * Tranche tracking -- required for the documented per-tranche exit system.
     * trancheNumber: 1 = initial entry (2%), 2 = DCA-down at -2.5% (4%), 3 = DCA-down at -5.0% (6%)
     * t1EntryPrice: T1 entry price stored on ALL tranches as the reference for DCA-down triggers.
     * stopOrderId: SFOX order ID of the active stop order placed for this tranche.
     * exitStage: tracks which stop has been placed by the VPS exit monitor.
     */
    trancheNumber: int("tranche_number").notNull().default(1),
    t1EntryPrice: decimal("t1_entry_price", { precision: 20, scale: 8 }),
    stopOrderId: varchar("stop_order_id", { length: 100 }),
    exitStage: mysqlEnum("exit_stage", ["none", "hard_stop_placed", "trailing_stop_placed"]).notNull().default("none"),
  },
  (table) => ({
    userIdx: index("idx_pos_user").on(table.userId),
    statusIdx: index("idx_pos_status").on(table.status),
    pairIdx: index("idx_pos_pair").on(table.pair),
  })
);

export type ActivePosition = typeof activePositions.$inferSelect;
export type InsertActivePosition = typeof activePositions.$inferInsert;
