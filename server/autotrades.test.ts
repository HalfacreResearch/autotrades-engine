import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// Mock the db module so tests don't need a real database
vi.mock("./db", () => {
  const client = {
    userId: 1,
    credentialId: 1,
    name: "Test Client",
    email: "test@example.com",
    sfoxApiKey: "test-sfox-api-key",
    isActive: true,
    autoTradeEnabled: true,
    hasApiKey: true,
    initialBuyExecuted: true,
  };
  return {
    getDb: vi.fn().mockResolvedValue(null),
    getTradinghqDb: vi.fn().mockResolvedValue(null),
    getClientPortalDb: vi.fn().mockResolvedValue(null),
    getAllClients: vi.fn().mockResolvedValue([client]),
    getClientByUserId: vi.fn().mockResolvedValue(client),
    getOpenPositions: vi.fn().mockResolvedValue([]),
    getExecutionLog: vi.fn().mockResolvedValue([]),
    getLatestMlPredictions: vi.fn().mockResolvedValue([]),
    getLatestRuleBasedSignals: vi.fn().mockResolvedValue([]),
    insertExecutionLog: vi.fn().mockResolvedValue(1),
    insertPosition: vi.fn().mockResolvedValue(undefined),
    closePosition: vi.fn().mockResolvedValue(undefined),
    setTrailingStop: vi.fn().mockResolvedValue(undefined),
    getPendingInitialBuyClients: vi.fn().mockResolvedValue([]),
    getOpenPositionCount: vi.fn().mockResolvedValue(0),
    upsertUser: vi.fn().mockResolvedValue(undefined),
    getUserByOpenId: vi.fn().mockResolvedValue(undefined),
  };
});

// Mock sfoxEngine so no real API calls are made
vi.mock("./sfoxEngine", () => ({
  SFOXEngine: vi.fn().mockImplementation(() => ({
    testConnection: vi.fn().mockResolvedValue({ connected: true, btcBalance: 0.5, usdBalance: 1000 }),
    getBalances: vi.fn().mockResolvedValue({ balances: [{ currency: "BTC", balance: 0.5, available: 0.5 }] }),
    executeDCABuy: vi.fn().mockResolvedValue({ success: true, orderId: "test-order-1", executionPrice: 50000, filledQty: 0.001 }),
    executeRotationEntry: vi.fn().mockResolvedValue({ success: true, orderId: "test-order-2", executionPrice: 0.05, filledQty: 0.1 }),
    executeRotationExit: vi.fn().mockResolvedValue({ success: true, orderId: "test-order-3", executionPrice: 0.055, filledQty: 0.1, realizedPnlPercent: 10 }),
  })),
  decryptApiKey: vi.fn().mockReturnValue("decrypted-api-key"),
  encryptApiKey: vi.fn().mockReturnValue({ encrypted: "enc", iv: "iv", authTag: "tag" }),
  runSafetyChecks: vi.fn().mockResolvedValue({ passed: true, warnings: [], errors: [] }),
  getBalances: vi.fn().mockResolvedValue([{ currency: "BTC", balance: 0.5, available: 0.5 }]),
  getBalance: vi.fn().mockResolvedValue({ currency: "USD", balance: 10000, available: 10000 }),
  getOrderEstimate: vi.fn().mockResolvedValue({ estimatedPrice: 50000, estimatedFee: 5, estimatedTotal: 10005 }),
  getOpenOrders: vi.fn().mockResolvedValue([]),
  placeSmartRoutingBuy: vi.fn().mockResolvedValue({ success: true, orderId: 1, executionPrice: 50000, filledQty: 0.001, fee: 5 }),
  placeSmartRoutingSell: vi.fn().mockResolvedValue({ success: true, orderId: 2, executionPrice: 50000, filledQty: 0.001, fee: 5 }),
  placeTrailingStop: vi.fn().mockResolvedValue({ success: true, orderId: 3, executionPrice: 0, filledQty: 0, fee: 0 }),
  placeMarketSell: vi.fn().mockResolvedValue({ success: true, orderId: 4, executionPrice: 50000, filledQty: 0.001, fee: 5 }),
  calculateVolatilityTier: vi.fn().mockResolvedValue("medium"),
  getTrailingStopRecommendation: vi.fn().mockResolvedValue({ tier: "medium", recommendedPct: 0.10, rationale: "test" }),
}));

function createAdminContext(): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "owner-open-id",
      email: "admin@example.com",
      name: "Admin",
      loginMethod: "manus",
      role: "admin",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

function createUnauthContext(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

describe("auth.logout", () => {
  it("clears session cookie and returns success", async () => {
    const ctx = createAdminContext();
    const clearedCookies: string[] = [];
    ctx.res.clearCookie = (name: string) => { clearedCookies.push(name); };
    const caller = appRouter.createCaller(ctx);
    const result = await caller.auth.logout();
    expect(result.success).toBe(true);
    expect(clearedCookies.length).toBe(1);
  });
});

describe("clients.getAll", () => {
  it("returns client list for authenticated user", async () => {
    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.clients.getAll();
    expect(Array.isArray(result)).toBe(true);
    // May be empty in test env (no VPS connection)
    if (result.length > 0) {
      expect(result[0]).toHaveProperty("userId");
      expect(result[0]).toHaveProperty("hasApiKey");
    }
  });

  it("throws UNAUTHORIZED for unauthenticated users", async () => {
    const ctx = createUnauthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.clients.getAll()).rejects.toThrow();
  });
});

describe("safety.runChecks", () => {
  it("returns safety check result with passed/warnings/errors fields", async () => {
    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.safety.runChecks({
      userId: 1,
      tradeType: "DCA_BUY",
      pair: "BTC/USD",
      positionSizePercent: 10,
    });
    expect(result).toHaveProperty("passed");
    expect(result).toHaveProperty("warnings");
    expect(result).toHaveProperty("errors");
    expect(Array.isArray(result.warnings)).toBe(true);
    expect(Array.isArray(result.errors)).toBe(true);
  });
});

describe("positions.getAll", () => {
  it("returns empty array when no positions exist", async () => {
    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.positions.getAll();
    expect(Array.isArray(result)).toBe(true);
  });
});

describe("log.getAll", () => {
  it("returns execution log array", async () => {
    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.log.getAll({ limit: 10 });
    expect(Array.isArray(result)).toBe(true);
  });
});

describe("mlPredictions.getLatest", () => {
  it("returns an array (empty or populated)", async () => {
    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.mlPredictions.getLatest();
    expect(Array.isArray(result)).toBe(true);
  });
});
