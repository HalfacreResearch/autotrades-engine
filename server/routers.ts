import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, publicProcedure, router } from "./_core/trpc";
import {
  closePosition,
  getAllClients,
  getClientByUserId,
  getExecutionLog,
  getLatestMlPredictions,
  getLatestRuleBasedSignals,
  getLatestSignals,
  getOpenPositionCount,
  getOpenPositions,
  getPendingInitialBuyClients,
  insertExecutionLog,
  insertPosition,
  markInitialBuyExecuted,
  setTrailingStop,
  updatePositionPrices,
} from "./db";
import {
  calculateVolatilityTier,
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
    getLatest: publicProcedure.query(async () => {
      return getLatestMlPredictions();
    }),
    getRuleBasedSignals: publicProcedure.query(async () => {
      return getLatestRuleBasedSignals();
    }),
  }),

  // ─── Clients (read-only — for trade execution dialogs) ────────────────────
  // Client management (add/edit/API keys) lives at client.codexyield.com
  clients: router({
    getAll: publicProcedure.query(async () => {
      const clients = await getAllClients();
      // Never return the raw SFOX API key to the frontend
      return clients.map((c) => ({
        userId: c.userId,
        credentialId: c.credentialId,
        name: c.name,
        email: c.email,
        isActive: c.isActive,
        autoTradeEnabled: c.autoTradeEnabled,
        hasApiKey: !!c.sfoxApiKey,
        initialBuyExecuted: c.initialBuyExecuted,
        isLive: c.isLive,
      }));
    }),

    // Returns clients who have an API key but have never had their initial 25% BTC buy executed.
    // These appear as alerts on the Dashboard prompting Matthew to execute the manual initial buy.
    getPendingInitialBuy: publicProcedure.query(async () => {
      const clients = await getPendingInitialBuyClients();
      return clients.map((c) => ({
        userId: c.userId,
        credentialId: c.credentialId,
        name: c.name,
        email: c.email,
      }));
    }),
  }),

  // ─── Safety Checks ─────────────────────────────────────────────────────────
  safety: router({
    runChecks: publicProcedure
      .input(
        z.object({
          userId: z.number(),
          tradeType: z.enum(["DCA_BUY", "ROTATION_ENTRY", "ROTATION_EXIT"]),
          pair: z.string(),
          positionSizePercent: z.number().min(0.1).max(100),
        })
      )
      .mutation(async ({ ctx, input }) => {
        requireAdmin(ctx);
        const client = await getClientByUserId(input.userId);
        if (!client?.sfoxApiKey) {
          return { passed: false, warnings: [], errors: ["No SFOX API key configured for this client"] };
        }
        const openPositionCount = await getOpenPositionCount(input.userId);
        const result = await runSafetyChecks({
          apiKey: client.sfoxApiKey,
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
    executeDCA: publicProcedure
      .input(
        z.object({
          userId: z.number(),
          positionSizePercent: z.number().min(1).max(10),
          recommendationId: z.number().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        requireAdmin(ctx);

        const client = await getClientByUserId(input.userId);
        if (!client?.sfoxApiKey) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "No SFOX API key configured for this client" });
        }

        const openPositionCount = await getOpenPositionCount(input.userId);
        const safetyResult = await runSafetyChecks({
          apiKey: client.sfoxApiKey,
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

        const result = await executeDCABuy({
          apiKey: client.sfoxApiKey,
          positionSizePercent: input.positionSizePercent,
          clientOrderId: generateClientOrderId("DCA", "BTCUSD"),
        });

        const logId = await insertExecutionLog({
          userId: input.userId,
          recommendationId: input.recommendationId,
          pair: "BTC/USD",
          strategy: "DCA",
          side: "buy",
          quantity: String(result.quantity ?? "0"),
          price: String(result.executionPrice ?? "0"),
          totalUsd: result.usdValue ? String(result.usdValue) : null,
          sfoxOrderId: result.orderId ? String(result.orderId) : null,
          status: result.success ? "filled" : "failed",
          notes: result.error ?? null,
        });

        return {
          success: result.success,
          logId,
          orderId: result.orderId,
          executionPrice: result.executionPrice,
          quantity: result.quantity,
          error: result.error,
          warnings: safetyResult.warnings,
        };
      }),

    executeRotationEntry: publicProcedure
      .input(
        z.object({
          userId: z.number(),
          pair: z.string().regex(/^[A-Z]+\/BTC$/, "Must be an ALT/BTC pair"),
          positionSizePercent: z.number().min(2).max(12),
          recommendationId: z.number().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        requireAdmin(ctx);

        const client = await getClientByUserId(input.userId);
        if (!client?.sfoxApiKey) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "No SFOX API key configured for this client" });
        }

        const openPositionCount = await getOpenPositionCount(input.userId);
        const safetyResult = await runSafetyChecks({
          apiKey: client.sfoxApiKey,
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

        const result = await executeRotationEntry({
          apiKey: client.sfoxApiKey,
          pair: input.pair,
          positionSizePercent: input.positionSizePercent,
          clientOrderId: generateClientOrderId("ROT_ENTRY", input.pair.replace("/", "")),
        });

        const logId = await insertExecutionLog({
          userId: input.userId,
          recommendationId: input.recommendationId,
          pair: input.pair,
          strategy: "ROTATION",
          side: "buy",
          quantity: String(result.quantity ?? "0"),
          price: String(result.executionPrice ?? "0"),
          sfoxOrderId: result.orderId ? String(result.orderId) : null,
          status: result.success ? "filled" : "failed",
          notes: result.error ?? null,
        });

        if (result.success && result.executionPrice && result.quantity) {
          await insertPosition({
            userId: input.userId,
            pair: input.pair,
            strategy: "ROTATION",
            entryExecutionId: logId,
            entryPrice: String(result.executionPrice),
            entryBtcAmount: String(result.quantity),
            status: "open",
          });
        }

        return {
          success: result.success,
          logId,
          orderId: result.orderId,
          executionPrice: result.executionPrice,
          quantity: result.quantity,
          error: result.error,
          warnings: safetyResult.warnings,
        };
      }),

    executeRotationExit: publicProcedure
      .input(
        z.object({
          userId: z.number(),
          positionId: z.number(),
          pair: z.string(),
          entryPrice: z.number(),
          entryBtcAmount: z.number(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        requireAdmin(ctx);

        const client = await getClientByUserId(input.userId);
        if (!client?.sfoxApiKey) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "No SFOX API key configured for this client" });
        }

        const altCurrency = input.pair.split("/")[0] ?? "";
        const altBal = await getBalance(altCurrency, client.sfoxApiKey);
        const sellQuantity = altBal?.available ?? 0;
        if (sellQuantity <= 0) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `No ${altCurrency} balance available to sell` });
        }

        const result = await executeRotationExit({
          apiKey: client.sfoxApiKey,
          pair: input.pair,
          quantity: sellQuantity,
          clientOrderId: generateClientOrderId("ROT_EXIT", input.pair.replace("/", "")),
        });

        let btcPnl = 0;
        if (result.success && result.executionPrice && input.entryPrice > 0) {
          const pnlPct = (result.executionPrice - input.entryPrice) / input.entryPrice;
          btcPnl = input.entryBtcAmount * pnlPct;
        }

        const logId = await insertExecutionLog({
          userId: input.userId,
          pair: input.pair,
          strategy: "ROTATION",
          side: "sell",
          quantity: String(result.quantity ?? "0"),
          price: String(result.executionPrice ?? "0"),
          sfoxOrderId: result.orderId ? String(result.orderId) : null,
          status: result.success ? "filled" : "failed",
          btcPnl: btcPnl !== 0 ? String(btcPnl.toFixed(8)) : null,
          notes: result.error ?? null,
        });

        if (result.success) {
          await closePosition(input.positionId, logId);
        }

        return {
          success: result.success,
          logId,
          orderId: result.orderId,
          executionPrice: result.executionPrice,
          btcPnl,
          error: result.error,
        };
      }),
  }),

  // ─── Active Positions ──────────────────────────────────────────────────────
  positions: router({
    getAll: publicProcedure
      .input(z.object({ userId: z.number().optional() }).optional())
      .query(async ({ input }) => {
        return getOpenPositions(input?.userId);
      }),

    refreshPrices: publicProcedure
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
        const entryBtcAmount = parseFloat(String(position.entryBtcAmount));
        const unrealizedBtcPnl = entryBtcAmount * ((input.currentPrice - entryPrice) / entryPrice);
        const currentPeak = parseFloat(String(position.peakPrice ?? String(entryPrice)));
        const newPeak = Math.max(currentPeak, input.currentPrice);

        // Stop placement is handled exclusively by the VPS exit monitor (exit_monitor.py).
        // This endpoint only updates current price, peak price, and unrealized P&L.
        await updatePositionPrices(
          input.positionId,
          input.currentPrice,
          newPeak,
          unrealizedBtcPnl,
        );

        return { unrealizedBtcPnl, peakPrice: newPeak };
      }),
  }),

  // ─── Manual Trading Endpoints ────────────────────────────────────────────
  trading: router({
    /**
     * Get an order estimate before confirming a manual trade.
     */
    getOrderEstimate: publicProcedure
      .input(
        z.object({
          userId: z.number(),
          side: z.enum(["buy", "sell"]),
          pair: z.string(),
          quantity: z.number().optional(),
          maxspend: z.number().optional(),
        })
      )
      .query(async ({ ctx, input }) => {
        requireAdmin(ctx);
        const client = await getClientByUserId(input.userId);
        if (!client?.sfoxApiKey) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "No SFOX API key configured" });
        }
        return getOrderEstimate({
          side: input.side,
          pair: input.pair,
          apiKey: client.sfoxApiKey,
          quantity: input.quantity,
          maxspend: input.maxspend,
        });
      }),

    /**
     * Execute the one-time 25% initial BTC purchase for a new client.
     * MANUAL ONLY — never called by the scheduler.
     */
    executeInitialBuy: publicProcedure
      .input(z.object({ userId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        requireAdmin(ctx);
        const client = await getClientByUserId(input.userId);
        if (!client?.sfoxApiKey) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "No SFOX API key configured" });
        }
        if (client.initialBuyExecuted) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Initial buy has already been executed for this client" });
        }
        const result = await executeInitialBuy({ apiKey: client.sfoxApiKey });
        const logId = await insertExecutionLog({
          userId: input.userId,
          pair: "BTC/USD",
          strategy: "DCA",
          side: "buy",
          quantity: String(result.quantity ?? "0"),
          price: String(result.executionPrice ?? "0"),
          totalUsd: result.usdValue ? String(result.usdValue) : null,
          sfoxOrderId: result.orderId ? String(result.orderId) : null,
          status: result.success ? "filled" : "failed",
          notes: result.success ? "Initial 25% BTC purchase" : (result.error ?? null),
        });
        if (result.success) {
          await markInitialBuyExecuted(client.credentialId);
        }
        return { success: result.success, logId, orderId: result.orderId, executionPrice: result.executionPrice, quantity: result.quantity, error: result.error };
      }),

    /**
     * Execute a manual rotation entry across ALL active clients simultaneously.
     * Smart Routing only. Sizes: 2%, 4%, or 6% of BTC balance.
     */
    executeManualEntry: publicProcedure
      .input(
        z.object({
          pair: z.string().regex(/^[A-Z]+\/BTC$/, "Must be an ALT/BTC pair"),
          positionSizePercent: z.enum(["2", "4", "6"]).transform(Number),
        })
      )
      .mutation(async ({ ctx, input }) => {
        requireAdmin(ctx);
        const allClients = await getAllClients();
        const clients = allClients.filter((c) => c.isActive && c.sfoxApiKey);
        const clientResults = [];
        for (const client of clients) {
          const openPositions = await getOpenPositions(client.userId);
          const existingExposure = openPositions
            .filter((p) => p.pair.toUpperCase() === input.pair.toUpperCase())
            .reduce((sum, p) => sum + Number(p.entryBtcAmount), 0);
          // Check max 12% total exposure per altcoin (approximate via position count × avg size)
          const openPairPositions = openPositions.filter((p) => p.pair.toUpperCase() === input.pair.toUpperCase());
          if (openPairPositions.length >= 3) {
            clientResults.push({ userId: client.userId, name: client.name, success: false, error: "Max 12% exposure reached (3 entries)" });
            continue;
          }
          const result = await executeRotationEntry({
            apiKey: client.sfoxApiKey,
            pair: input.pair,
            positionSizePercent: input.positionSizePercent,
            clientOrderId: generateClientOrderId("MANUAL-ENTRY", input.pair),
          });
          const logId = await insertExecutionLog({
            userId: client.userId,
            pair: input.pair,
            strategy: "ROTATION",
            side: "buy",
            quantity: String(result.quantity ?? "0"),
            price: String(result.executionPrice ?? "0"),
            sfoxOrderId: result.orderId ? String(result.orderId) : null,
            status: result.success ? "filled" : "failed",
            notes: result.error ?? null,
          });
          if (result.success && result.executionPrice && result.quantity) {
            // Determine tranche number based on existing open positions for this pair
            const trancheNum = openPairPositions.length + 1; // 1, 2, or 3
            // T1 entry price: use this entry's price for T1, or the first open position's entry price for T2/T3
            const t1Price = trancheNum === 1
              ? String(result.executionPrice)
              : String(openPairPositions[0]?.entryPrice ?? result.executionPrice);
            await insertPosition({
              userId: client.userId,
              pair: input.pair,
              strategy: "ROTATION",
              entryExecutionId: logId,
              entryPrice: String(result.executionPrice),
              entryBtcAmount: String(result.quantity),
              status: "open",
              trancheNumber: trancheNum,
              t1EntryPrice: t1Price,
              exitStage: "none",
            });
          }
          clientResults.push({ userId: client.userId, name: client.name, success: result.success, orderId: result.orderId, executionPrice: result.executionPrice, error: result.error });
        }
        return { clientResults };
      }),

    /**
     * Execute a full rotation exit across ALL active clients simultaneously.
     */
    executeManualExit: publicProcedure
      .input(z.object({ pair: z.string() }))
      .mutation(async ({ ctx, input }) => {
        requireAdmin(ctx);
        const allClients = await getAllClients();
        const clients = allClients.filter((c) => c.isActive && c.sfoxApiKey);
        const clientResults = [];
        const altCurrency = input.pair.split("/")[0] ?? "";
        for (const client of clients) {
          const altBal = await getBalance(altCurrency, client.sfoxApiKey);
          const quantity = altBal?.available ?? 0;
          if (quantity <= 0) {
            clientResults.push({ userId: client.userId, name: client.name, success: false, error: `No ${altCurrency} balance` });
            continue;
          }
          const result = await executeRotationExit({
            apiKey: client.sfoxApiKey,
            pair: input.pair,
            quantity,
            clientOrderId: generateClientOrderId("MANUAL-EXIT", input.pair),
          });
          const openPositions = await getOpenPositions(client.userId);
          const pos = openPositions.find((p) => p.pair.toUpperCase() === input.pair.toUpperCase());
          let btcPnl = 0;
          if (result.success && result.executionPrice && pos) {
            const entryPrice = parseFloat(String(pos.entryPrice));
            const entryBtcAmount = parseFloat(String(pos.entryBtcAmount));
            btcPnl = entryBtcAmount * ((result.executionPrice - entryPrice) / entryPrice);
          }
          const logId = await insertExecutionLog({
            userId: client.userId,
            pair: input.pair,
            strategy: "ROTATION",
            side: "sell",
            quantity: String(result.quantity ?? "0"),
            price: String(result.executionPrice ?? "0"),
            sfoxOrderId: result.orderId ? String(result.orderId) : null,
            status: result.success ? "filled" : "failed",
            btcPnl: btcPnl !== 0 ? String(btcPnl.toFixed(8)) : null,
            notes: result.error ?? null,
          });
          if (result.success && pos) {
            await closePosition(pos.id, logId);
          }
          clientResults.push({ userId: client.userId, name: client.name, success: result.success, orderId: result.orderId, executionPrice: result.executionPrice, error: result.error });
        }
        return { clientResults };
      }),

    /**
     * Capital exit — sell only the original BTC risked, leave profits running.
     */
    executeCapitalExit: publicProcedure
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
        const clients = allClients.filter((c) => c.isActive && c.sfoxApiKey);
        const clientResults = [];
        for (const client of clients) {
          const result = await executeCapitalExit({
            apiKey: client.sfoxApiKey,
            pair: input.pair,
            entryBtcCost: input.entryBtcCost,
            currentPrice: input.currentPrice,
            clientOrderId: generateClientOrderId("CAP-EXIT", input.pair),
          });
          await insertExecutionLog({
            userId: client.userId,
            pair: input.pair,
            strategy: "ROTATION",
            side: "sell",
            quantity: String(result.quantity ?? "0"),
            price: String(result.executionPrice ?? "0"),
            sfoxOrderId: result.orderId ? String(result.orderId) : null,
            status: result.success ? "filled" : "failed",
            notes: result.success ? "Capital exit — profits left running" : (result.error ?? null),
          });
          clientResults.push({ userId: client.userId, name: client.name, success: result.success, orderId: result.orderId, executionPrice: result.executionPrice, error: result.error });
        }
        return { clientResults };
      }),

    /**
     * Emergency exit — Market order, immediate fill regardless of price.
     */
    executeEmergencyExit: publicProcedure
      .input(z.object({ pair: z.string() }))
      .mutation(async ({ ctx, input }) => {
        requireAdmin(ctx);
        const allClients = await getAllClients();
        const clients = allClients.filter((c) => c.isActive && c.sfoxApiKey);
        const clientResults = [];
        const altCurrency = input.pair.split("/")[0] ?? "";
        for (const client of clients) {
          const altBal = await getBalance(altCurrency, client.sfoxApiKey);
          const quantity = altBal?.available ?? 0;
          if (quantity <= 0) {
            clientResults.push({ userId: client.userId, name: client.name, success: false, error: `No ${altCurrency} balance` });
            continue;
          }
          const result = await executeEmergencyExit({
            apiKey: client.sfoxApiKey,
            pair: input.pair,
            quantity,
            clientOrderId: generateClientOrderId("EMRG-EXIT", input.pair),
          });
          await insertExecutionLog({
            userId: client.userId,
            pair: input.pair,
            strategy: "ROTATION",
            side: "sell",
            quantity: String(result.quantity ?? "0"),
            price: String(result.executionPrice ?? "0"),
            sfoxOrderId: result.orderId ? String(result.orderId) : null,
            status: result.success ? "filled" : "failed",
            notes: result.success ? "EMERGENCY EXIT — Market order" : (result.error ?? null),
          });
          clientResults.push({ userId: client.userId, name: client.name, success: result.success, orderId: result.orderId, executionPrice: result.executionPrice, error: result.error });
        }
        return { clientResults };
      }),

    /**
     * Emergency liquidation — sell ALL assets → USD for a specific client.
     * Client offboarding only. Requires typed confirmation.
     */
    executeEmergencyLiquidation: publicProcedure
      .input(
        z.object({
          userId: z.number(),
          confirmationString: z.string(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        requireAdmin(ctx);
        const client = await getClientByUserId(input.userId);
        if (!client) throw new TRPCError({ code: "NOT_FOUND", message: "Client not found" });
        const expectedConfirmation = `LIQUIDATE ${(client.name ?? "CLIENT").toUpperCase()}`;
        if (input.confirmationString !== expectedConfirmation) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `Type exactly: ${expectedConfirmation}` });
        }
        if (!client.sfoxApiKey) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "No SFOX API key configured" });
        }
        const result = await executeEmergencyLiquidation({ apiKey: client.sfoxApiKey, clientName: client.name ?? "CLIENT" });
        return { success: result.success, orders: result.orders.length, errors: result.errors };
      }),

    /**
     * Set or adjust a trailing stop on an open position.
     * Fires across ALL active clients that hold this pair.
     */
    setTrailingStop: publicProcedure
      .input(
        z.object({
          pair: z.string(),
          stopPercent: z.number().min(0.01).max(0.50),
        })
      )
      .mutation(async ({ ctx, input }) => {
        requireAdmin(ctx);
        const allClients = await getAllClients();
        const clients = allClients.filter((c) => c.isActive && c.sfoxApiKey);
        const clientResults = [];
        const altCurrency = input.pair.split("/")[0] ?? "";
        for (const client of clients) {
          const altBal = await getBalance(altCurrency, client.sfoxApiKey);
          const quantity = altBal?.available ?? 0;
          if (quantity <= 0) continue;
          try {
            const order = await placeTrailingStop({
              pair: input.pair,
              quantity,
              apiKey: client.sfoxApiKey,
              stopPercent: input.stopPercent,
              clientOrderId: generateClientOrderId("TRAIL", input.pair),
            });
            // Update position record with trailing stop
            const openPositions = await getOpenPositions(client.userId);
            const pos = openPositions.find((p) => p.pair.toUpperCase() === input.pair.toUpperCase());
            if (pos) {
              const currentPrice = parseFloat(String(pos.currentPrice ?? pos.entryPrice));
              await setTrailingStop(pos.id, input.stopPercent, currentPrice * (1 - input.stopPercent));
            }
            clientResults.push({ userId: client.userId, name: client.name, success: true, orderId: order.id });
          } catch (err) {
            clientResults.push({ userId: client.userId, name: client.name, success: false, error: err instanceof Error ? err.message : String(err) });
          }
        }
        return { clientResults };
      }),

    /**
     * Get volatility tier recommendation for a trailing stop.
     */
    getTrailingStopRecommendation: publicProcedure
      .input(z.object({ dailyPrices: z.array(z.number()).min(2) }))
      .query(({ input }) => {
        return calculateVolatilityTier(input.dailyPrices);
      }),
  }),

  // ─── Arbiter Signals (read from tradinghq DB) ────────────────────────────
  signals: router({
    getLatest: publicProcedure
      .input(z.object({ limit: z.number().min(1).max(50).default(20) }).optional())
      .query(async ({ input }) => {
        return getLatestSignals(input?.limit ?? 20);
      }),
  }),

  // ─── Execution Log ─────────────────────────────────────────────────────────
  log: router({
    getAll: publicProcedure
      .input(
        z.object({
          limit: z.number().min(1).max(500).default(100),
          userId: z.number().optional(),
        }).optional()
      )
      .query(async ({ input }) => {
        return getExecutionLog(input?.limit ?? 100, input?.userId);
      }),
  }),
});

export type AppRouter = typeof appRouter;
