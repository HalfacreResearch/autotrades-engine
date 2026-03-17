import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import {
  closePosition,
  getAllClients,
  getClientById,
  getExecutionLog,
  getLatestMlPredictions,
  getLatestRuleBasedSignals,
  getOpenPositionCount,
  getOpenPositions,
  insertExecutionLog,
  insertPosition,
  updateExecutionLog,
  updatePositionPnl,
} from "./db";
import {
  calculateVolatilityTier,
  decryptApiKey,
  executeCapitalExit,
  executeDCABuy,
  executeEmergencyExit,
  executeEmergencyLiquidation,
  executeInitialBuy,
  executeRotationEntry,
  executeRotationExit,
  generateClientOrderId,
  getBalance,
  getOrderEstimate,
  placeTrailingStop,
  runSafetyChecks,
} from "./sfoxEngine";

// ─── Auth middleware ──────────────────────────────────────────────────────────

function requireAdmin(ctx: { user?: { role?: string } | null }) {
  if (!ctx.user || ctx.user.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
  }
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const appRouter = router({
  system: systemRouter,

  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  // ─── ML Predictions (read from tradinghq DB) ──────────────────────────────
  mlPredictions: router({
    getLatest: protectedProcedure.query(async () => {
      return getLatestMlPredictions();
    }),
    getRuleBasedSignals: protectedProcedure.query(async () => {
      return getLatestRuleBasedSignals();
    }),
  }),

  // ─── Clients (read-only — for trade execution dialogs) ────────────────────
  // Client management (add/edit/API keys) lives at client.codexyield.com
  clients: router({
    getAll: protectedProcedure.query(async () => {
      const clients = await getAllClients();
      // Never return encrypted API key fields to the frontend
      return clients.map((c) => ({
        id: c.id,
        clientName: c.clientName,
        clientEmail: c.clientEmail,
        isActive: c.isActive,
        connectionStatus: c.connectionStatus,
        lastVerifiedAt: c.lastVerifiedAt,
        hasApiKey: !!(c.sfoxApiKeyEncrypted && c.sfoxApiKeyIv && c.sfoxApiKeyAuthTag),
        createdAt: c.createdAt,
      }));
    }),

    // Returns clients who have an API key but have never had their initial 25% BTC buy executed.
    // These appear as alerts on the Dashboard prompting Matthew to execute the manual initial buy.
    getPendingInitialBuy: protectedProcedure.query(async () => {
      const clients = await getAllClients();
      return clients
        .filter((c) => c.isActive && c.sfoxApiKeyEncrypted && !c.initialBuyExecuted)
        .map((c) => ({ id: c.id, clientName: c.clientName }));
    }),
  }),

  // ─── Safety Checks ─────────────────────────────────────────────────────────
  safety: router({
    runChecks: protectedProcedure
      .input(
        z.object({
          clientId: z.number(),
          tradeType: z.enum(["DCA_BUY", "ROTATION_ENTRY", "ROTATION_EXIT"]),
          pair: z.string(),
          positionSizePercent: z.number().min(0.1).max(100),
          currentMarketPrice: z.number().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        requireAdmin(ctx);
        const client = await getClientById(input.clientId);
        if (!client?.sfoxApiKeyEncrypted || !client.sfoxApiKeyIv || !client.sfoxApiKeyAuthTag) {
          return {
            passed: false,
            warnings: [],
            errors: ["No SFOX API key configured for this client"],
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
        });
        return {
          passed: result.passed,
          warnings: result.warnings,
          errors: result.errors,
          btcBalance: result.btcBalance,
          usdBalance: result.usdBalance,
          openPositionCount: result.openPositionCount,
        };
      }),
  }),

  // ─── Trade Execution ───────────────────────────────────────────────────────
  trades: router({
    executeDCA: protectedProcedure
      .input(
        z.object({
          clientId: z.number(),
          positionSizePercent: z.number().min(1).max(100),
          isTestAccount: z.boolean().default(true),
          recommendationId: z.string().optional(),
          currentMarketPrice: z.number().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        requireAdmin(ctx);

        const client = await getClientById(input.clientId);
        if (!client?.sfoxApiKeyEncrypted || !client.sfoxApiKeyIv || !client.sfoxApiKeyAuthTag) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "No SFOX API key configured for this client" });
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
        });

        if (!safetyResult.passed) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `Safety checks failed: ${safetyResult.errors.join("; ")}`,
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
          executedBy: ctx.user?.id,
        });

        const result = await executeDCABuy({
          apiKey,
          positionSizePercent: input.positionSizePercent,
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

        return {
          success: result.success,
          executionId,
          orderId: result.orderId,
          executionPrice: result.executionPrice,
          quantity: result.quantity,
          error: result.error,
          warnings: safetyResult.warnings,
        };
      }),

    executeRotationEntry: protectedProcedure
      .input(
        z.object({
          clientId: z.number(),
          pair: z.string().regex(/^[A-Z]+\/BTC$/, "Must be an ALT/BTC pair"),
          positionSizePercent: z.number().min(2).max(12),
          isTestAccount: z.boolean().default(true),
          recommendationId: z.string().optional(),
          currentMarketPrice: z.number().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        requireAdmin(ctx);

        const client = await getClientById(input.clientId);
        if (!client?.sfoxApiKeyEncrypted || !client.sfoxApiKeyIv || !client.sfoxApiKeyAuthTag) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "No SFOX API key configured for this client" });
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
        });

        if (!safetyResult.passed) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `Safety checks failed: ${safetyResult.errors.join("; ")}`,
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
          executedBy: ctx.user?.id,
        });

        const result = await executeRotationEntry({
          apiKey,
          pair: input.pair,
          positionSizePercent: input.positionSizePercent,
          clientOrderId: generateClientOrderId("ROT_ENTRY", input.pair.replace("/", "")),
        });

        await updateExecutionLog(executionId, {
          status: result.success ? "executed" : "failed",
          sfoxOrderId: result.orderId ? String(result.orderId) : undefined,
          executionPrice: result.executionPrice ? String(result.executionPrice) : undefined,
          quantity: result.quantity ? String(result.quantity) : undefined,
          errorMessage: result.error,
          executedAt: new Date(),
        });

        if (result.success && result.executionPrice) {
          await insertPosition({
            clientId: input.clientId,
            pair: input.pair,
            sizePercent: String(input.positionSizePercent),
            entryPrice: String(result.executionPrice),
            openExecutionId: executionId,
            status: "open",
          });
        }

        return {
          success: result.success,
          executionId,
          orderId: result.orderId,
          executionPrice: result.executionPrice,
          quantity: result.quantity,
          error: result.error,
          warnings: safetyResult.warnings,
        };
      }),

    executeRotationExit: protectedProcedure
      .input(
        z.object({
          clientId: z.number(),
          positionId: z.number(),
          pair: z.string(),
          entryPrice: z.number(),
          isTestAccount: z.boolean().default(true),
          sellPercent: z.number().min(1).max(100).default(100),
        })
      )
      .mutation(async ({ ctx, input }) => {
        requireAdmin(ctx);

        const client = await getClientById(input.clientId);
        if (!client?.sfoxApiKeyEncrypted || !client.sfoxApiKeyIv || !client.sfoxApiKeyAuthTag) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "No SFOX API key configured for this client" });
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
          openPositionCount,
        });

        if (!safetyResult.passed) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `Safety checks failed: ${safetyResult.errors.join("; ")}`,
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
          executedBy: ctx.user?.id,
        });

        // Fetch live altcoin balance from SFOX to determine exact quantity to sell
        const altCurrency = input.pair.split("/")[0] ?? "";
        const altBal = await getBalance(altCurrency, apiKey);
        const sellQuantity = altBal?.available ?? 0;
        if (sellQuantity <= 0) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `No ${altCurrency} balance available to sell` });
        }
        const result = await executeRotationExit({
          apiKey,
          pair: input.pair,
          quantity: sellQuantity,
          clientOrderId: generateClientOrderId("ROT_EXIT", input.pair.replace("/", "")),
        });

        let realizedPnlPercent = 0;
        if (result.success && result.executionPrice && input.entryPrice > 0) {
          realizedPnlPercent = ((result.executionPrice - input.entryPrice) / input.entryPrice) * 100;
        }

        await updateExecutionLog(executionId, {
          status: result.success ? "executed" : "failed",
          sfoxOrderId: result.orderId ? String(result.orderId) : undefined,
          executionPrice: result.executionPrice ? String(result.executionPrice) : undefined,
          quantity: result.quantity ? String(result.quantity) : undefined,
          realizedPnlPercent: String(realizedPnlPercent.toFixed(4)),
          errorMessage: result.error,
          executedAt: new Date(),
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
          error: result.error,
        };
      }),
  }),

  // ─── Active Positions ──────────────────────────────────────────────────────
  positions: router({
    getAll: protectedProcedure
      .input(z.object({ clientId: z.number().optional() }).optional())
      .query(async ({ input }) => {
        const positions = await getOpenPositions(input?.clientId);
        return positions;
      }),

    refreshPnl: protectedProcedure
      .input(
        z.object({
          positionId: z.number(),
          currentPrice: z.number(),
        })
      )
      .mutation(async ({ input }) => {
        const positions = await getOpenPositions();
        const position = positions.find((p) => p.id === input.positionId);
        if (!position) throw new TRPCError({ code: "NOT_FOUND", message: "Position not found" });

        const entryPrice = parseFloat(String(position.entryPrice));
        const unrealizedPnlPercent = ((input.currentPrice - entryPrice) / entryPrice) * 100;
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
          trailingStopTriggered,
        };
      }),
  }),

  // ─── Manual Trading Endpoints ────────────────────────────────────────────
  trading: router({
    /**
     * Get an order estimate (price, fees, quantity) before confirming a trade.
     * Used for the confirmation screen on manual trades.
     */
    getOrderEstimate: protectedProcedure
      .input(
        z.object({
          clientId: z.number(),
          side: z.enum(["buy", "sell"]),
          pair: z.string(),
          quantity: z.number().optional(),
          maxspend: z.number().optional(),
        })
      )
      .query(async ({ ctx, input }) => {
        requireAdmin(ctx);
        const client = await getClientById(input.clientId);
        if (!client?.sfoxApiKeyEncrypted || !client.sfoxApiKeyIv || !client.sfoxApiKeyAuthTag) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "No SFOX API key configured" });
        }
        const apiKey = decryptApiKey(
          client.sfoxApiKeyEncrypted,
          client.sfoxApiKeyIv,
          client.sfoxApiKeyAuthTag
        );
        return getOrderEstimate({
          side: input.side,
          pair: input.pair,
          apiKey,
          quantity: input.quantity,
          maxspend: input.maxspend,
        });
      }),

    /**
     * Execute the one-time 25% initial BTC purchase for a new client.
     * MANUAL ONLY — never called by the scheduler.
     * Fires for a single specified client only.
     */
    executeInitialBuy: protectedProcedure
      .input(z.object({ clientId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        requireAdmin(ctx);
        const client = await getClientById(input.clientId);
        if (!client?.sfoxApiKeyEncrypted || !client.sfoxApiKeyIv || !client.sfoxApiKeyAuthTag) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "No SFOX API key configured" });
        }
        const apiKey = decryptApiKey(
          client.sfoxApiKeyEncrypted,
          client.sfoxApiKeyIv,
          client.sfoxApiKeyAuthTag
        );
        const executionId = nanoid();
        await insertExecutionLog({
          executionId,
          clientId: input.clientId,
          tradeType: "DCA_BUY",
          pair: "BTC/USD",
          side: "buy",
          positionSizePercent: "25",
          status: "pending",
          isTestAccount: false,
          executedBy: ctx.user?.id,
        });
        const result = await executeInitialBuy({ apiKey });
        await updateExecutionLog(executionId, {
          status: result.success ? "executed" : "failed",
          sfoxOrderId: result.orderId ? String(result.orderId) : undefined,
          executionPrice: result.executionPrice ? String(result.executionPrice) : undefined,
          quantity: result.quantity ? String(result.quantity) : undefined,
          usdValue: result.usdValue ? String(result.usdValue) : undefined,
          errorMessage: result.error,
          executedAt: new Date(),
        });
        return { success: result.success, executionId, orderId: result.orderId, executionPrice: result.executionPrice, quantity: result.quantity, error: result.error };
      }),

    /**
     * Execute a manual rotation entry across ALL active clients simultaneously.
     * Smart Routing only. Sizes: 2%, 4%, or 6% of BTC balance.
     */
    executeManualEntry: protectedProcedure
      .input(
        z.object({
          pair: z.string().regex(/^[A-Z]+\/BTC$/, "Must be an ALT/BTC pair"),
          positionSizePercent: z.enum(["2", "4", "6"]).transform(Number),
        })
      )
      .mutation(async ({ ctx, input }) => {
        requireAdmin(ctx);
        const allClients = await getAllClients();
        const clients = allClients.filter((c) => c.isActive);
        const clientResults = [];
        for (const client of clients) {
          if (!client.sfoxApiKeyEncrypted || !client.sfoxApiKeyIv || !client.sfoxApiKeyAuthTag) {
            clientResults.push({ clientId: client.id, clientName: client.clientName, success: false, error: "No API key" });
            continue;
          }
          const apiKey = decryptApiKey(client.sfoxApiKeyEncrypted, client.sfoxApiKeyIv, client.sfoxApiKeyAuthTag);
          const openPositions = await getOpenPositions(client.id);
          const existingExposure = openPositions
            .filter((p) => p.pair.toUpperCase() === input.pair.toUpperCase())
            .reduce((sum, p) => sum + Number(p.sizePercent), 0);
          const newTotal = existingExposure + input.positionSizePercent;
          if (newTotal > 12) {
            clientResults.push({ clientId: client.id, clientName: client.clientName, success: false, error: `Total exposure would be ${newTotal}% (max 12%)` });
            continue;
          }
          const executionId = nanoid();
          await insertExecutionLog({ executionId, clientId: client.id, tradeType: "ROTATION_ENTRY", pair: input.pair, side: "buy", positionSizePercent: String(input.positionSizePercent), status: "pending", isTestAccount: false, executedBy: ctx.user?.id });
          const result = await executeRotationEntry({ apiKey, pair: input.pair, positionSizePercent: input.positionSizePercent, clientOrderId: generateClientOrderId("MANUAL-ENTRY", input.pair) });
          await updateExecutionLog(executionId, { status: result.success ? "executed" : "failed", sfoxOrderId: result.orderId ? String(result.orderId) : undefined, executionPrice: result.executionPrice ? String(result.executionPrice) : undefined, quantity: result.quantity ? String(result.quantity) : undefined, errorMessage: result.error, executedAt: new Date() });
          if (result.success && result.executionPrice) {
            await insertPosition({ clientId: client.id, pair: input.pair, sizePercent: String(input.positionSizePercent), entryPrice: String(result.executionPrice), openExecutionId: executionId, status: "open" });
          }
          clientResults.push({ clientId: client.id, clientName: client.clientName, success: result.success, orderId: result.orderId, executionPrice: result.executionPrice, error: result.error });
        }
        return { clientResults };
      }),

    /**
     * Execute a full rotation exit across ALL active clients simultaneously.
     * Sells 100% of the altcoin position via Smart Routing.
     */
    executeManualExit: protectedProcedure
      .input(z.object({ pair: z.string() }))
      .mutation(async ({ ctx, input }) => {
        requireAdmin(ctx);
        const allClients = await getAllClients();
        const clients = allClients.filter((c) => c.isActive);
        const clientResults = [];
        const altCurrency = input.pair.split("/")[0] ?? "";
        for (const client of clients) {
          if (!client.sfoxApiKeyEncrypted || !client.sfoxApiKeyIv || !client.sfoxApiKeyAuthTag) {
            clientResults.push({ clientId: client.id, clientName: client.clientName, success: false, error: "No API key" });
            continue;
          }
          const apiKey = decryptApiKey(client.sfoxApiKeyEncrypted, client.sfoxApiKeyIv, client.sfoxApiKeyAuthTag);
          const altBal = await getBalance(altCurrency, apiKey);
          const quantity = altBal?.available ?? 0;
          if (quantity <= 0) {
            clientResults.push({ clientId: client.id, clientName: client.clientName, success: false, error: `No ${altCurrency} balance` });
            continue;
          }
          const executionId = nanoid();
          await insertExecutionLog({ executionId, clientId: client.id, tradeType: "ROTATION_EXIT", pair: input.pair, side: "sell", positionSizePercent: "100", status: "pending", isTestAccount: false, executedBy: ctx.user?.id });
          const result = await executeRotationExit({ apiKey, pair: input.pair, quantity, clientOrderId: generateClientOrderId("MANUAL-EXIT", input.pair) });
          await updateExecutionLog(executionId, { status: result.success ? "executed" : "failed", sfoxOrderId: result.orderId ? String(result.orderId) : undefined, executionPrice: result.executionPrice ? String(result.executionPrice) : undefined, quantity: result.quantity ? String(result.quantity) : undefined, errorMessage: result.error, executedAt: new Date() });
          const openPositions = await getOpenPositions(client.id);
          const pos = openPositions.find((p) => p.pair.toUpperCase() === input.pair.toUpperCase());
          if (result.success && result.executionPrice && pos) {
            const pnl = ((result.executionPrice - Number(pos.entryPrice)) / Number(pos.entryPrice)) * 100;
            await closePosition(pos.id, result.executionPrice, pnl);
          }
          clientResults.push({ clientId: client.id, clientName: client.clientName, success: result.success, orderId: result.orderId, executionPrice: result.executionPrice, error: result.error });
        }
        return { clientResults };
      }),

    /**
     * Capital exit — sell only the original BTC risked, leave profits running.
     * Fires across ALL active clients.
     */
    executeCapitalExit: protectedProcedure
      .input(
        z.object({
          pair: z.string(),
          entryBtcCost: z.number().positive(),
          currentPrice: z.number().positive(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        requireAdmin(ctx);
        const allClients = await getAllClients();
        const clients = allClients.filter((c) => c.isActive);
        const clientResults = [];
        for (const client of clients) {
          if (!client.sfoxApiKeyEncrypted || !client.sfoxApiKeyIv || !client.sfoxApiKeyAuthTag) {
            clientResults.push({ clientId: client.id, clientName: client.clientName, success: false, error: "No API key" });
            continue;
          }
          const apiKey = decryptApiKey(client.sfoxApiKeyEncrypted, client.sfoxApiKeyIv, client.sfoxApiKeyAuthTag);
          const executionId = nanoid();
          await insertExecutionLog({ executionId, clientId: client.id, tradeType: "ROTATION_EXIT", pair: input.pair, side: "sell", positionSizePercent: "capital_only", status: "pending", isTestAccount: false, executedBy: ctx.user?.id });
          const result = await executeCapitalExit({ apiKey, pair: input.pair, entryBtcCost: input.entryBtcCost, currentPrice: input.currentPrice, clientOrderId: generateClientOrderId("CAP-EXIT", input.pair) });
          await updateExecutionLog(executionId, { status: result.success ? "executed" : "failed", sfoxOrderId: result.orderId ? String(result.orderId) : undefined, executionPrice: result.executionPrice ? String(result.executionPrice) : undefined, quantity: result.quantity ? String(result.quantity) : undefined, errorMessage: result.error, executedAt: new Date() });
          clientResults.push({ clientId: client.id, clientName: client.clientName, success: result.success, orderId: result.orderId, executionPrice: result.executionPrice, error: result.error });
        }
        return { clientResults };
      }),

    /**
     * Emergency exit — Market order, immediate fill regardless of price.
     * Fires for ALL active clients.
     */
    executeEmergencyExit: protectedProcedure
      .input(z.object({ pair: z.string() }))
      .mutation(async ({ ctx, input }) => {
        requireAdmin(ctx);
        const allClients = await getAllClients();
        const clients = allClients.filter((c) => c.isActive);
        const clientResults = [];
        const altCurrency = input.pair.split("/")[0] ?? "";
        for (const client of clients) {
          if (!client.sfoxApiKeyEncrypted || !client.sfoxApiKeyIv || !client.sfoxApiKeyAuthTag) {
            clientResults.push({ clientId: client.id, clientName: client.clientName, success: false, error: "No API key" });
            continue;
          }
          const apiKey = decryptApiKey(client.sfoxApiKeyEncrypted, client.sfoxApiKeyIv, client.sfoxApiKeyAuthTag);
          const altBal = await getBalance(altCurrency, apiKey);
          const quantity = altBal?.available ?? 0;
          if (quantity <= 0) {
            clientResults.push({ clientId: client.id, clientName: client.clientName, success: false, error: `No ${altCurrency} balance` });
            continue;
          }
          const executionId = nanoid();
          await insertExecutionLog({ executionId, clientId: client.id, tradeType: "ROTATION_EXIT", pair: input.pair, side: "sell", positionSizePercent: "100", status: "pending", isTestAccount: false, executedBy: ctx.user?.id });
          const result = await executeEmergencyExit({ apiKey, pair: input.pair, quantity, clientOrderId: generateClientOrderId("EMRG-EXIT", input.pair) });
          await updateExecutionLog(executionId, { status: result.success ? "executed" : "failed", sfoxOrderId: result.orderId ? String(result.orderId) : undefined, executionPrice: result.executionPrice ? String(result.executionPrice) : undefined, quantity: result.quantity ? String(result.quantity) : undefined, errorMessage: result.error, executedAt: new Date() });
          clientResults.push({ clientId: client.id, clientName: client.clientName, success: result.success, orderId: result.orderId, executionPrice: result.executionPrice, error: result.error });
        }
        return { clientResults };
      }),

    /**
     * Emergency liquidation — sell ALL assets → USD for a specific client.
     * Client offboarding only. Requires double confirmation before calling.
     */
    executeEmergencyLiquidation: protectedProcedure
      .input(
        z.object({
          clientId: z.number(),
          confirmationString: z.string(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        requireAdmin(ctx);
        const client = await getClientById(input.clientId);
        if (!client) throw new TRPCError({ code: "NOT_FOUND", message: "Client not found" });
        const expectedConfirmation = `LIQUIDATE ${client.clientName.toUpperCase()}`;
        if (input.confirmationString !== expectedConfirmation) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `Type exactly: ${expectedConfirmation}` });
        }
        if (!client.sfoxApiKeyEncrypted || !client.sfoxApiKeyIv || !client.sfoxApiKeyAuthTag) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "No SFOX API key configured" });
        }
        const apiKey = decryptApiKey(client.sfoxApiKeyEncrypted, client.sfoxApiKeyIv, client.sfoxApiKeyAuthTag);
        const result = await executeEmergencyLiquidation({ apiKey, clientName: client.clientName });
        return { success: result.success, orders: result.orders.length, errors: result.errors };
      }),

    /**
     * Set or adjust a trailing stop on an open position.
     * Fires across ALL active clients that hold this pair.
     */
    setTrailingStop: protectedProcedure
      .input(
        z.object({
          pair: z.string(),
          stopPercent: z.number().min(0.01).max(0.50),
        })
      )
      .mutation(async ({ ctx, input }) => {
        requireAdmin(ctx);
        const allClients = await getAllClients();
        const clients = allClients.filter((c) => c.isActive);
        const clientResults = [];
        const altCurrency = input.pair.split("/")[0] ?? "";
        for (const client of clients) {
          if (!client.sfoxApiKeyEncrypted || !client.sfoxApiKeyIv || !client.sfoxApiKeyAuthTag) continue;
          const apiKey = decryptApiKey(client.sfoxApiKeyEncrypted, client.sfoxApiKeyIv, client.sfoxApiKeyAuthTag);
          const altBal = await getBalance(altCurrency, apiKey);
          const quantity = altBal?.available ?? 0;
          if (quantity <= 0) continue;
          try {
            const order = await placeTrailingStop({ pair: input.pair, quantity, apiKey, stopPercent: input.stopPercent, clientOrderId: generateClientOrderId("TRAIL", input.pair) });
            clientResults.push({ clientId: client.id, clientName: client.clientName, success: true, orderId: order.id });
          } catch (err) {
            clientResults.push({ clientId: client.id, clientName: client.clientName, success: false, error: err instanceof Error ? err.message : String(err) });
          }
        }
        return { clientResults };
      }),

    /**
     * Get volatility tier recommendation for a trailing stop.
     * Returns suggested stop percent based on 30d price history.
     */
    getTrailingStopRecommendation: protectedProcedure
      .input(z.object({ dailyPrices: z.array(z.number()).min(2) }))
      .query(({ input }) => {
        return calculateVolatilityTier(input.dailyPrices);
      }),
  }),

  // ─── Execution Log ─────────────────────────────────────────────────────────
  log: router({
    getAll: protectedProcedure
      .input(
        z.object({
          limit: z.number().min(1).max(500).default(100),
          clientId: z.number().optional(),
        }).optional()
      )
      .query(async ({ input }) => {
        return getExecutionLog(input?.limit ?? 100, input?.clientId);
      }),
  }),
});

export type AppRouter = typeof appRouter;
