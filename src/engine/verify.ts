/**
 * "Verified in code" — every engine-verifiable number in the strategy book, recomputed from formulas
 * and live engine state. Keys match {{v:key|…}} markers in content/book.ts.
 */
import { BOOK_MC, type McSummary, type TailScenario } from "./montecarlo";
import { jobsonKorkieMonths } from "./overseer";
import { binomialUpperP } from "./stats";

export interface Verified {
  value: string;
  formula: string;
  inputs: string;
}
const P = BOOK_MC.winRate;
const W = BOOK_MC.avgWinPct;
const L = BOOK_MC.avgLossPct;
const N = BOOK_MC.nTrades;
const MONTHS = 23;

export function verifiedNumbers(
  live: {
    mc?: Partial<Record<TailScenario, McSummary>>;
    g1HitRate?: number | null;
    g1Trades?: number;
    goldEventsPerYear?: number;
  } = {},
): Record<string, Verified> {
  const perMonth = N / MONTHS;
  const exp = P * W - (1 - P) * L;
  const mMean = perMonth * exp;
  const mSd = Math.sqrt(perMonth * P * (1 - P)) * (W + L);
  const out: Record<string, Verified> = {
    "sonic.hitRate": {
      value: `${(P * 100).toFixed(1)}%${live.g1HitRate != null ? ` · live G1 ${(live.g1HitRate * 100).toFixed(1)}% (${live.g1Trades} trades)` : ""}`,
      formula: "winners / trades",
      inputs: `Sonic 82.9% reported; live G1 hit rate from the running simulator`,
    },
    "sonic.payoff": {
      value: `${(W / L).toFixed(3)}×`,
      formula: "avg win / avg loss",
      inputs: `${W}% / ${L}%`,
    },
    "sonic.tradesPerMonth": {
      value: perMonth.toFixed(2),
      formula: "trades / months",
      inputs: `${N} / ${MONTHS}`,
    },
    "sonic.profitFactor": {
      value: ((P * W) / ((1 - P) * L)).toFixed(3),
      formula: "p·W / ((1−p)·L)",
      inputs: `p=${P}, W=${W}%, L=${L}%`,
    },
    "sonic.expectancy": {
      value: `${exp.toFixed(4)}%`,
      formula: "p·W − (1−p)·L",
      inputs: `p=${P}, W=${W}%, L=${L}%`,
    },
    "sonic.ddInLosses": {
      value: (0.86 / L).toFixed(2),
      formula: "max DD / avg loss",
      inputs: `0.86% / ${L}%`,
    },
    "sonic.monthlyMean": {
      value: `${mMean.toFixed(3)}%`,
      formula: "n·(p·W − (1−p)·L), n = trades/month",
      inputs: `n=${perMonth.toFixed(2)}`,
    },
    "sonic.monthlySd": {
      value: `${mSd.toFixed(3)}%`,
      formula: "√(n·p·(1−p))·(W+L)",
      inputs: `n=${perMonth.toFixed(2)}, p=${P}`,
    },
    "sonic.sharpe": {
      value: ((mMean / mSd) * Math.sqrt(12)).toFixed(2),
      formula: "(monthly mean / monthly SD)·√12",
      inputs: `${mMean.toFixed(3)} / ${mSd.toFixed(3)}`,
    },
    "sonic.dd12x": {
      value: `${(0.86 * 12).toFixed(2)}%`,
      formula: "0.86% × 12",
      inputs: "linear amplification",
    },
    "sonic.dd24x": {
      value: `${(0.86 * 24).toFixed(2)}%`,
      formula: "0.86% × 24",
      inputs: "linear amplification",
    },
    "stefanini.luck": {
      value: `${(binomialUpperP(8, 10, 0.5) * 100).toFixed(2)}%`,
      formula: "P(X ≥ 8 | n=10, p=0.5)",
      inputs: "exact binomial",
    },
    "g4.scaledDd": {
      value: `−${((17.7 * 6) / 12.2).toFixed(2)}%`,
      formula: "−17.7% × 6% / 12.2%",
      inputs: "linear vol scaling",
    },
    "gateway.capFresh": {
      value: `${((0.08 / 8) * 100).toFixed(2)}%`,
      formula: "min(1.5%, cushion/8), cushion = 1 − 0.92",
      inputs: "equity = HWM",
    },
    "gateway.cap4dd": {
      value: `${(((0.96 - 0.92) / 8) * 100).toFixed(2)}% of HWM`,
      formula: "(0.96 − 0.92) / 8",
      inputs: "equity = 0.96 × HWM",
    },
    "overseer.jk1": {
      value: `${jobsonKorkieMonths(1).toFixed(1)} months`,
      formula: "12·(1.645 / S)²",
      inputs: "S = 1",
    },
    "overseer.jk2": {
      value: `${jobsonKorkieMonths(2).toFixed(1)} months`,
      formula: "12·(1.645 / S)²",
      inputs: "S = 2",
    },
    "validation.falsePositives": {
      value: (100 * 0.05).toFixed(0),
      formula: "rules × α",
      inputs: "100 × 0.05",
    },
    "miller.recover20": {
      value: `+${((1 / 0.8 - 1) * 100).toFixed(0)}%`,
      formula: "1/(1 − d) − 1",
      inputs: "d = 20%",
    },
    "miller.recover50": {
      value: `+${((1 / 0.5 - 1) * 100).toFixed(0)}%`,
      formula: "1/(1 − d) − 1",
      inputs: "d = 50%",
    },
    "g2.eventsPerYear": {
      value: `${live.goldEventsPerYear ?? 24}`,
      formula: "12 CPI + 12 NFP",
      inputs: "seeded calendar",
    },
  };
  for (const sc of ["NONE", "10X_1_IN_300", "25X_1_IN_300"] as const) {
    const r = live.mc?.[sc];
    out[`mc.${sc}.median`] = r
      ? {
          value: `${r.medianMaxDd.toFixed(3)}%`,
          formula: "median of max drawdown over runs",
          inputs: `${r.runs.toLocaleString()} runs × ${N} trades, scenario ${sc}`,
        }
      : {
          value: "run the Monte Carlo Lab",
          formula: "median of max drawdown over runs",
          inputs: `scenario ${sc}`,
        };
    out[`mc.${sc}.pLose`] = r
      ? {
          value: `${(r.pLosingMonth * 100).toFixed(1)}%`,
          formula: "P(any of 23 months < 0)",
          inputs: `${r.runs.toLocaleString()} runs`,
        }
      : {
          value: "run the Monte Carlo Lab",
          formula: "P(any of 23 months < 0)",
          inputs: `scenario ${sc}`,
        };
  }
  return out;
}
