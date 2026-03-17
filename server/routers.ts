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
  decryptApiKey,
  executeDCABuy,
  executeRotationEntry,
  executeRotationExit,
  generateClientOrderId,
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
          currentMarketPrice: input.currentMarketPrice,
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
          currentMarketPrice: input.currentMarketPrice,
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
          currentMarketPrice: input.currentMarketPrice,
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

        const result = await executeRotationExit({
          apiKey,
          pair: input.pair,
          sellPercent: input.sellPercent,
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
