/** Zod schemas for every runtime boundary: DB rows entering the engine, forms, CSV import. */
import { z } from "zod";

export const ParamsSchema = z.object({
  values: z.record(z.union([z.number(), z.array(z.number()), z.array(z.string())])),
  grid: z.record(z.array(z.number())),
});
export type AgentParams = z.infer<typeof ParamsSchema>;

export const RiskLimitsSchema = z.object({
  floorRatio: z.number().min(0.5).max(0.99),
  maxRiskPctEquity: z.number().min(0.001).max(0.05),
  cushionDivisorTrade: z.number().min(1).max(50),
  cushionDivisorOpen: z.number().min(1).max(20),
  dailyLossPct: z.number().min(0.002).max(0.2),
  weeklyLossPct: z.number().min(0.004).max(0.4),
  spreadMult: z.number().min(1).max(10),
  weekendCutoffMin: z.number().min(0).max(240),
});

export const PriceRowSchema = z
  .object({
    timestamp: z
      .string()
      .min(1)
      .refine(
        (s) => !Number.isNaN(Date.parse(s)) || /^\d{10,13}$/.test(s),
        "unparseable timestamp",
      ),
    bid: z.coerce.number().positive(),
    ask: z.coerce.number().positive(),
  })
  .refine((r) => r.ask >= r.bid, "ask must be ≥ bid");

export const PreRegSchema = z.object({
  hypothesis: z.string().min(20, "At least 20 characters"),
  rules: z.string().min(20, "At least 20 characters"),
  variantCount: z.coerce.number().int().min(1),
});

export const LlmDecisionSchema = z.object({
  budgets: z.array(
    z.object({
      code: z.enum(["G1", "G2", "G3", "G4"]),
      budget: z.number().min(0).max(1),
      reason: z.string(),
    }),
  ),
});
