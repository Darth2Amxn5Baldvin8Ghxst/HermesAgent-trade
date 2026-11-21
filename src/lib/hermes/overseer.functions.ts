import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const Input = z.object({
  agents: z
    .array(
      z.object({
        code: z.enum(["G1", "G2", "G3", "G4"]),
        ruleBudget: z.number().min(0).max(1),
        summary: z.record(z.union([z.number(), z.string(), z.boolean(), z.null()])),
      }),
    )
    .max(8),
});
const LlmOut = z.object({
  budgets: z.array(
    z.object({
      code: z.enum(["G1", "G2", "G3", "G4"]),
      budget: z.number().min(0).max(1),
      reason: z.string().max(600),
    }),
  ),
});

/** Reports whether the optional DeepSeek key is configured (never returns the key). */
export const overseerModelStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => ({ deepseekConnected: !!process.env.DEEPSEEK_API_KEY }));

/**
 * Optional DeepSeek review of the rule engine's proposal. The model may only lower budgets; the
 * client applies min(rule, llm). Missing key → { model: "rule-engine-fallback" }.
 */
export const overseerLlmReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data }) => {
    const key = process.env.DEEPSEEK_API_KEY;
    if (!key) return { model: "rule-engine-fallback" as const, budgets: null, error: null };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25_000);
    try {
      const res = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        signal: ctrl.signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: "deepseek-reasoner",
          messages: [
            {
              role: "system",
              content:
                'You are the HermesAgents overseer. You may only CUT an agent\'s risk budget below the rule-engine budget, never raise it, and you never place orders. Reply with JSON only: {"budgets":[{"code":"G1","budget":0.25,"reason":"..."}]}.',
            },
            { role: "user", content: JSON.stringify(data.agents) },
          ],
        }),
      });
      if (!res.ok)
        return {
          model: "rule-engine-fallback" as const,
          budgets: null,
          error: `DeepSeek HTTP ${res.status}`,
        };
      const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const text = body.choices?.[0]?.message?.content ?? "";
      const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
      const parsed = LlmOut.safeParse(JSON.parse(json || "{}"));
      if (!parsed.success)
        return {
          model: "rule-engine-fallback" as const,
          budgets: null,
          error: "DeepSeek reply failed validation",
        };
      return { model: "deepseek-r1" as const, budgets: parsed.data.budgets, error: null };
    } catch (e) {
      return {
        model: "rule-engine-fallback" as const,
        budgets: null,
        error: e instanceof Error ? e.message : "DeepSeek call failed",
      };
    } finally {
      clearTimeout(timer);
    }
  });
