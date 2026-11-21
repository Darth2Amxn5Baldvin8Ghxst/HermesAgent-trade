/**
 * Overseer rule engine (book §8). Deterministic; an optional LLM review may only CUT a budget
 * below what these rules allow, never raise it.
 */
import { mean, neweyWestMeanSE, ols, sd, skewness, sharpeT } from "./stats";
import type { AgentCode } from "./types";

export interface OverseerAgentInput {
  code: AgentCode;
  status: string;
  budget: number;
  dailyReturns: number[]; // live/shadow daily returns of the agent account
  expectedDailyPnl: number; // from backtest expectancy (account ccy)
  sigmaExpectedDaily: number;
  realizedPnl: number; // over the evaluation window
  windowDays: number;
  maxDdPct: number;
  goldShareOfRisk: number; // fraction of this agent's risk that is XAUUSD
  factors: { gold: number[]; dxy: number[]; nas: number[] }; // aligned daily factor returns
  lastAction: "HOLD" | "HALVE" | "RAISE" | "CAP_GOLD" | "SHRINK" | null;
}
export type OverseerAction = "HOLD" | "HALVE" | "RAISE" | "CAP_GOLD" | "SHRINK";
export interface OverseerDecision {
  code: AgentCode;
  action: OverseerAction;
  budgetFrom: number;
  budgetTo: number;
  z: number;
  probation: boolean;
  requiredMonths: number;
  liveMonths: number;
  sharpeAnnual: number;
  sharpeTStat: number;
  ambiguityPenalty: number;
  alpha: number;
  alphaT: number;
  betas: { gold: number; dxy: number; nas: number };
  tailScore: number;
  reason: string;
}

/** Months of daily data for an annual Sharpe S to be significant (one-sided 5%): 12·(1.645/S)². */
export function jobsonKorkieMonths(sharpeAnnual: number): number {
  if (sharpeAnnual <= 0) return Infinity;
  return 12 * (1.645 / sharpeAnnual) ** 2;
}
export const ambiguityPenalty = (tStat: number): number => 1 / (1 + Math.max(0, tStat));
export function zScore(realized: number, expected: number, sigma: number): number {
  return sigma > 0 ? (realized - expected) / sigma : 0;
}

export function factorAlpha(
  r: number[],
  f: OverseerAgentInput["factors"],
): { alpha: number; alphaT: number; betas: { gold: number; dxy: number; nas: number } } {
  const n = Math.min(r.length, f.gold.length, f.dxy.length, f.nas.length);
  if (n < 10) return { alpha: mean(r), alphaT: 0, betas: { gold: 0, dxy: 0, nas: 0 } };
  const y = r.slice(-n);
  const reg = ols(y, [f.gold.slice(-n), f.dxy.slice(-n), f.nas.slice(-n)]);
  const se = neweyWestMeanSE(reg.residuals);
  const alpha = reg.beta[0] ?? 0;
  return {
    alpha,
    alphaT: se > 0 ? alpha / se : 0,
    betas: { gold: reg.beta[1] ?? 0, dxy: reg.beta[2] ?? 0, nas: reg.beta[3] ?? 0 },
  };
}

export function runOverseer(
  inputs: OverseerAgentInput[],
  opts: { goldCap?: number } = {},
): { decisions: OverseerDecision[]; goldShare: number; shrinkage: number } {
  const N = inputs.length;
  const goldCap = opts.goldCap ?? 0.5;
  const decisions: OverseerDecision[] = inputs.map((a) => {
    const t = sharpeT(a.dailyReturns);
    const s = sd(a.dailyReturns);
    const sharpeAnnual = s > 0 ? (mean(a.dailyReturns) / s) * Math.sqrt(252) : 0;
    const liveMonths = a.windowDays / 21;
    const req = jobsonKorkieMonths(sharpeAnnual);
    const probation = a.status === "PROBATION" || liveMonths < req;
    const z = zScore(
      a.realizedPnl,
      a.expectedDailyPnl * a.windowDays,
      a.sigmaExpectedDaily * Math.sqrt(Math.max(1, a.windowDays)),
    );
    const fa = factorAlpha(a.dailyReturns, a.factors);
    let action: OverseerAction = "HOLD";
    let to = a.budget;
    let reason = `z=${z.toFixed(2)} inside ±1 band — no reallocation (hysteresis).`;
    if (z < -1) {
      action = "HALVE";
      to = a.budget / 2;
      reason = `Realised vs expected z=${z.toFixed(2)} < −1: cut fast, budget halved.`;
    } else if (z > 1 && !probation) {
      if (fa.alphaT > 1.96) {
        action = "RAISE";
        to = a.budget * 1.25;
        reason = `z=${z.toFixed(2)} > +1 after probation and residual α t=${fa.alphaT.toFixed(2)}: raised by the 25% maximum.`;
      } else
        reason = `z=${z.toFixed(2)} > +1 but residual α t=${fa.alphaT.toFixed(2)} not significant: gold beta, not an edge — hold.`;
    } else if (z > 1 && probation)
      reason = `z=${z.toFixed(2)} > +1 but still on probation (${liveMonths.toFixed(1)} of ${Number.isFinite(req) ? req.toFixed(1) : "∞"} months): hold.`;
    const skew = skewness(a.dailyReturns);
    return {
      code: a.code,
      action,
      budgetFrom: a.budget,
      budgetTo: to,
      z,
      probation,
      requiredMonths: req,
      liveMonths,
      sharpeAnnual,
      sharpeTStat: t,
      ambiguityPenalty: ambiguityPenalty(t),
      alpha: fa.alpha,
      alphaT: fa.alphaT,
      betas: fa.betas,
      tailScore: a.maxDdPct - skew,
      reason,
    };
  });
  // Shrink toward equal once ≥ 4 weeks of data: w = (1−δ)·equal + δ·skill, δ scaled by (1 − ambiguity)
  const weeks = Math.min(...inputs.map((a) => a.windowDays)) / 5;
  let shrinkage = 1;
  if (weeks >= 4) {
    const skill = decisions.map((d) => Math.max(0, d.sharpeAnnual) * (1 - d.ambiguityPenalty));
    const tot = skill.reduce((a, b) => a + b, 0);
    const meanPen = mean(decisions.map((d) => d.ambiguityPenalty));
    shrinkage = Math.min(1, Math.max(0, meanPen)); // weight on equal
    if (tot > 0) {
      decisions.forEach((d, i) => {
        const target = shrinkage * (1 / N) + (1 - shrinkage) * (skill[i]! / tot);
        // never raise beyond the deterministic band rules: only allow decreases here
        if (target < d.budgetTo) {
          d.budgetTo = target;
          if (d.action === "HOLD") {
            d.action = "SHRINK";
            d.reason += ` Shrinkage toward equal (δ=${shrinkage.toFixed(2)}) lowers it to ${(target * 100).toFixed(1)}%.`;
          }
        }
      });
    }
  }
  // Cap shared gold exposure at 50% of total portfolio risk
  const total = decisions.reduce((a, d) => a + d.budgetTo, 0);
  const goldRisk = decisions.reduce((a, d, i) => a + d.budgetTo * inputs[i]!.goldShareOfRisk, 0);
  let goldShare = total > 0 ? goldRisk / total : 0;
  if (goldShare > goldCap && goldRisk > 0) {
    const nonGold = total - goldRisk;
    const scale = (goldCap * nonGold) / ((1 - goldCap) * goldRisk);
    decisions.forEach((d, i) => {
      const g = inputs[i]!.goldShareOfRisk;
      if (g <= 0) return;
      const nb = d.budgetTo * (1 - g) + d.budgetTo * g * scale;
      if (nb < d.budgetTo) {
        d.reason += ` Gold cap: portfolio gold risk ${(goldShare * 100).toFixed(0)}% > 50% → scaled to ${(nb * 100).toFixed(1)}%.`;
        d.budgetTo = nb;
        if (d.action === "HOLD" || d.action === "SHRINK") d.action = "CAP_GOLD";
      }
    });
    const t2 = decisions.reduce((a, d) => a + d.budgetTo, 0);
    goldShare =
      t2 > 0
        ? decisions.reduce((a, d, i) => a + d.budgetTo * inputs[i]!.goldShareOfRisk, 0) / t2
        : 0;
  }
  return { decisions, goldShare, shrinkage };
}

/** LLM review may only lower budgets: final = min(rule budget, llm budget). */
export function applyLlmCut(rule: number, llm: number | null | undefined): number {
  if (llm === null || llm === undefined || !Number.isFinite(llm) || llm < 0) return rule;
  return Math.min(rule, llm);
}
