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
  varchar,
} from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Client connections — stores encrypted SFOX API credentials per client.
 * API keys are encrypted server-side and NEVER returned to the frontend.
 */
export const clientConnections = mysqlTable("client_connections", {
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
  connectionStatus: mysqlEnum("connection_status", ["connected", "error", "pending", "unconfigured"])
    .default("unconfigured")
    .notNull(),
  /**
   * Whether the initial 25% USD-to-BTC buy has been executed for this client.
   * Defaults to TRUE for all existing clients (set via migration) to prevent
   * accidentally re-firing the initial buy on clients who are already onboarded.
   * Only set to FALSE for genuinely new clients who have not yet had their first trade.
   */
  initialBuyExecuted: boolean("initial_buy_executed").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ClientConnection = typeof clientConnections.$inferSelect;
export type InsertClientConnection = typeof clientConnections.$inferInsert;

/**
 * Trade execution log — every trade executed through this system.
 */
export const executionLog = mysqlTable(
  "execution_log",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    /** UUID for this execution */
    executionId: varchar("execution_id", { length: 36 }).notNull().unique(),
    /** Client who this trade was executed for */
    clientId: int("client_id")
      .notNull()
      .references(() => clientConnections.id),
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
    executedAt: timestamp("executed_at"),
  },
  (table) => ({
    clientIdx: index("idx_exec_client").on(table.clientId),
    statusIdx: index("idx_exec_status").on(table.status),
    typeIdx: index("idx_exec_type").on(table.tradeType),
    createdIdx: index("idx_exec_created").on(table.createdAt),
  })
);

export type ExecutionLog = typeof executionLog.$inferSelect;
export type InsertExecutionLog = typeof executionLog.$inferInsert;

/**
 * Active rotation positions tracked per client.
 */
export const activePositions = mysqlTable(
  "active_positions",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    clientId: int("client_id")
      .notNull()
      .references(() => clientConnections.id),
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
    realizedPnlPercent: decimal("realized_pnl_percent", { precision: 10, scale: 4 }),
  },
  (table) => ({
    clientIdx: index("idx_pos_client").on(table.clientId),
    statusIdx: index("idx_pos_status").on(table.status),
    pairIdx: index("idx_pos_pair").on(table.pair),
  })
);

export type ActivePosition = typeof activePositions.$inferSelect;
export type InsertActivePosition = typeof activePositions.$inferInsert;
