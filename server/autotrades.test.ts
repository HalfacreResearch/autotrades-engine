import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// Mock the db module so tests don't need a real database
vi.mock("./db", () => ({
  getDb: vi.fn().mockResolvedValue(null),
  getTradinghqDb: vi.fn().mockResolvedValue(null),
  getClientPortalDb: vi.fn().mockResolvedValue(null),
  getAllClients: vi.fn().mockResolvedValue([
    {
      id: 1,
      clientName: "Test Client",
      clientEmail: "test@example.com",
      encryptedApiKey: "encrypted-key",
      connectionStatus: "connected",
      isActive: true,
      lastVerifiedAt: new Date(),
      hasApiKey: true,
    },
  ]),
  getClientById: vi.fn().mockResolvedValue({
    id: 1,
    clientName: "Test Client",
    clientEmail: "test@example.com",
    encryptedApiKey: "encrypted-key",
    connectionStatus: "connected",
    isActive: true,
    lastVerifiedAt: new Date(),
    hasApiKey: true,
  }),
  getOpenPositionsForClient: vi.fn().mockResolvedValue([]),
  getOpenPositions: vi.fn().mockResolvedValue([]),
  getExecutionLog: vi.fn().mockResolvedValue([]),
  getLatestSignals: vi.fn().mockResolvedValue([]),
  getActivePositionsFromTradinghq: vi.fn().mockResolvedValue([]),
  insertExecutionLog: vi.fn().mockResolvedValue({ id: 1 }),
  updateExecutionLog: vi.fn().mockResolvedValue(undefined),
  updateClientConnectionStatus: vi.fn().mockResolvedValue(undefined),
  saveClientApiKey: vi.fn().mockResolvedValue(undefined),
  upsertClient: vi.fn().mockResolvedValue(undefined),
  insertPosition: vi.fn().mockResolvedValue(undefined),
  updatePositionPnl: vi.fn().mockResolvedValue(undefined),
  closePosition: vi.fn().mockResolvedValue(undefined),
  getOpenPositionCount: vi.fn().mockResolvedValue(0),
  upsertUser: vi.fn().mockResolvedValue(undefined),
  getUserByOpenId: vi.fn().mockResolvedValue(undefined),
}));

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
  encryptApiKey: vi.fn().mockReturnValue("encrypted-api-key"),
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
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toHaveProperty("clientName");
    expect(result[0]).toHaveProperty("connectionStatus");
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
      clientId: 1,
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

describe("signals.getFeed", () => {
  it("returns signal feed array", async () => {
    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.signals.getFeed({ limit: 10 });
    expect(Array.isArray(result)).toBe(true);
  });
});
