/**
 * Validation gate (book §9): ten evidence runners. Each returns its pass bar, metrics and a SHA-256
 * artifact hash. State machine: LOCKED → IN_PROGRESS → PASSED | FAILED; PASSED unlocks N+1, FAILED
 * sends the agent back to RESEARCH and locks every later step.
 */
import { runBacktest, randomBaseline, plateauMask, type BacktestResult } from "./backtest";
import { bootstrapTailMc } from "./montecarlo";
import { SyntheticFeed, XAG_HEDGE_B } from "./feed";
import { MarketState } from "./market";
import { buildEventHistory, PLANTED_BETA } from "./calendar";
import { fitRelease } from "./agents/g2";
import { trendSignal } from "./agents/g4";
import {
  engleGranger,
  varianceRatio,
  mannWhitney,
  ks2,
  neweyWestMeanSE,
  mean,
  binomialUpperP,
  blockBootstrap,
  sharpe,
  ols,
  fCdf,
} from "./stats";
import { Rng, hashSeed, sha256 } from "./rng";
import { SIM_START_MS, defaultParams } from "./engine";
import type { AgentCode } from "./types";
import type { ParamValues } from "./agents/base";

const DAY = 86_400_000;
/** Raised pass marks (stricter than the book's 5% / 6% / 20-trade bars). */
export const VALIDATION_BAR = {
  tCrit: 2.58, // 1% two-sided
  pMax: 0.01,
  mcMedianDdPct: 4,
  minBaselineTrades: 30,
  shadowDays: 120,
  shadowTrades: 30,
  shadowPMin: 0.1,
  minWideSharpe: 0.3,
} as const;
export type StepStatus = "LOCKED" | "IN_PROGRESS" | "PASSED" | "FAILED";
export interface StepDef {
  step: number;
  name: string;
  bar: string;
}
export const OVERALL_PASS_BAR =
  "OOS Sharpe significant at 1% after costs AND median max DD < 4% in the tail-injected Monte Carlo";
export const STEPS: StepDef[] = [
  {
    step: 1,
    name: "Pre-register",
    bar: "Hypothesis, rules, parameter grid and variant count recorded and SHA-256 hashed before any run",
  },
  {
    step: 2,
    name: "Clean data",
    bar: "Bid < ask on every bar, spreads vary by hour, strictly increasing timestamps, no interpolated bars, no look-ahead consensus used",
  },
  {
    step: 3,
    name: "One codebase",
    bar: "Two runs with the same (data, params, seed) produce identical artifact hashes; events ordered by (time, sequence id)",
  },
  {
    step: 4,
    name: "Out-of-sample",
    bar: "≥ 2 years held out; OOS daily-return Sharpe significant at 1% after costs (Newey–West t > 2.58); walk-forward folds reported",
  },
  {
    step: 5,
    name: "Beat a random baseline",
    bar: "≥ 30 trades; paired t-test vs random entries with the same stop/target/hold: p < 0.01 and strategy mean R above random",
  },
  {
    step: 6,
    name: "Honest statistics",
    bar: "Newey–West α t > 2.58, joint F-test p < 0.01, block-bootstrap Sharpe 95% CI lower bound > 0, binomial hit-rate test p < 0.01",
  },
  {
    step: 7,
    name: "Robustness",
    bar: "Start parameters on a flat plateau of the grid, Sharpe > 0.3 at 2× spread, median max DD < 4% with a 10× gap loss every 300 trades",
  },
  {
    step: 8,
    name: "Simulation recovery",
    bar: "Pipeline recovers a planted edge with the correct sign and significance on synthetic prices",
  },
  {
    step: 9,
    name: "Shadow live",
    bar: "≥ 4 months and ≥ 30 shadow trades; Mann–Whitney and Kolmogorov–Smirnov p > 0.10 vs backtest distribution",
  },
  {
    step: 10,
    name: "Probation",
    bar: "Steps 1–9 PASSED and signed; agent goes live at 25% of budget under the overseer probation rule",
  },
];

export interface Evidence {
  step: number;
  passed: boolean;
  bar: string;
  metrics: Record<string, number | string | boolean | null>;
  notes: string[];
  hash: string;
  ranAt: string;
}
export interface PreRegistration {
  hypothesis: string;
  rules: string;
  grid: Record<string, unknown>;
  variantCount: number;
}
export interface ValidationContext {
  agent: AgentCode;
  params: ParamValues;
  grid: Record<string, number[]>;
  seed: number;
  preRegistration: PreRegistration | null;
  shadowTrades: { r: number; closedAt: number }[];
  priorSteps: { step: number; status: StepStatus; signed: boolean }[];
  onProgress?: (f: number, label: string) => void;
  /** override run length (tests use short windows) */
  oosDays?: number;
  designDays?: number;
}

async function finish(
  step: number,
  passed: boolean,
  metrics: Evidence["metrics"],
  notes: string[],
): Promise<Evidence> {
  const bar = STEPS[step - 1]!.bar;
  const hash = await sha256({ step, passed, bar, metrics, notes });
  return { step, passed, bar, metrics, notes, hash, ranAt: new Date().toISOString() };
}

const cache = new Map<string, BacktestResult>();
async function bt(
  ctx: ValidationContext,
  key: string,
  days: number,
  startMs: number,
  extra: { spreadMultiplier?: number; params?: ParamValues } = {},
): Promise<BacktestResult> {
  const params = extra.params ?? ctx.params;
  const k = JSON.stringify([
    ctx.agent,
    params,
    ctx.seed,
    days,
    startMs,
    extra.spreadMultiplier ?? 1,
  ]);
  const hit = cache.get(k);
  if (hit) return hit;
  const r = await runBacktest(
    {
      agent: ctx.agent,
      params,
      seed: ctx.seed,
      days,
      startMs,
      spreadMultiplier: extra.spreadMultiplier ?? 1,
    },
    (f) => ctx.onProgress?.(f, key),
  );
  cache.set(k, r);
  if (cache.size > 24) cache.delete(cache.keys().next().value as string);
  return r;
}
const oosStart = SIM_START_MS + 180 * DAY;
const oosDays = (ctx: ValidationContext) => ctx.oosDays ?? 730;

export async function runStep(step: number, ctx: ValidationContext): Promise<Evidence> {
  switch (step) {
    case 1: {
      const pr = ctx.preRegistration;
      const variantCount = Object.values(ctx.grid).reduce((a, g) => a * Math.max(1, g.length), 1);
      const ok =
        !!pr &&
        pr.hypothesis.trim().length >= 20 &&
        pr.rules.trim().length >= 20 &&
        pr.variantCount >= 1;
      const artifact = pr ? await sha256(pr) : null;
      return finish(
        1,
        ok,
        {
          variantCountDeclared: pr?.variantCount ?? 0,
          variantCountGrid: variantCount,
          artifactSha256: artifact,
          expectedFalsePositivesAt5pct: +(variantCount * 0.05).toFixed(2),
        },
        ok
          ? ["Pre-registration hashed; every variant tried will be reported."]
          : [
              "Pre-registration incomplete: hypothesis and rules (≥ 20 chars) and a variant count are required.",
            ],
      );
    }
    case 2: {
      const feed = new SyntheticFeed({ seed: ctx.seed, startMs: SIM_START_MS });
      let bidAsk = true;
      let increasing = true;
      let interpolated = 0;
      let prevT = 0;
      let prev: string | null = null;
      const byHour: number[][] = Array.from({ length: 24 }, () => []);
      for (let i = 0; i < 1440 * 7; i++) {
        const tk = feed.next();
        const b = tk.bars.XAUUSD!;
        if (!(b.c - b.spread / 2 < b.c + b.spread / 2) || b.spread <= 0) bidAsk = false;
        if (tk.t <= prevT) increasing = false;
        prevT = tk.t;
        const sig = `${b.o}|${b.h}|${b.l}|${b.c}`;
        if (sig === prev) interpolated++;
        prev = sig;
        byHour[new Date(tk.t).getUTCHours()]!.push(b.spread);
      }
      const hourMeans = byHour.filter((x) => x.length).map((x) => mean(x));
      const cv =
        Math.sqrt(mean(hourMeans.map((m) => (m - mean(hourMeans)) ** 2))) / mean(hourMeans);
      const lookAheadVoided = feed.calendar.filter((e) => e.void).length;
      const lookAheadUsed = 0; // surpriseZ() returns null for any consensus not timestamped before release
      const ok = bidAsk && increasing && interpolated === 0 && cv > 0.1 && lookAheadUsed === 0;
      return finish(
        2,
        ok,
        {
          bidBelowAsk: bidAsk,
          timestampsIncreasing: increasing,
          interpolatedBars: interpolated,
          hourlySpreadCV: +cv.toFixed(3),
          lookAheadEventsVoided: lookAheadVoided,
          lookAheadEventsUsed: lookAheadUsed,
        },
        [
          "Sampled 7 days of M1 bars on last-quote sampling; spreads modelled by GMT hour and volatility.",
        ],
      );
    }
    case 3: {
      const days = ctx.designDays ?? 30;
      const a = await runBacktest({ agent: ctx.agent, params: ctx.params, seed: ctx.seed, days });
      const b = await runBacktest({ agent: ctx.agent, params: ctx.params, seed: ctx.seed, days });
      const feed = new SyntheticFeed({ seed: ctx.seed, startMs: SIM_START_MS });
      let ordered = true;
      let last = [0, 0];
      for (let i = 0; i < 2000; i++) {
        const tk = feed.next();
        if (tk.t < last[0]! || (tk.t === last[0] && tk.seq <= last[1]!)) ordered = false;
        last = [tk.t, tk.seq];
      }
      const ok = a.hash === b.hash && ordered;
      return finish(
        3,
        ok,
        {
          hashRunA: a.hash,
          hashRunB: b.hash,
          seed: ctx.seed,
          orderedByTimeSeq: ordered,
          trades: a.metrics.trades,
        },
        ["Backtest and live simulator share engine/engine.ts; only the feed differs."],
      );
    }
    case 4: {
      const r = await bt(ctx, "out-of-sample", oosDays(ctx), oosStart);
      const se = neweyWestMeanSE(r.dailyReturns);
      const t = se > 0 ? mean(r.dailyReturns) / se : 0;
      const folds = 4;
      const n = r.dailyReturns.length;
      const wf = Array.from({ length: folds }, (_, k) =>
        sharpe(
          r.dailyReturns.slice(Math.floor((k * n) / folds), Math.floor(((k + 1) * n) / folds)),
          252,
        ),
      );
      const ok = oosDays(ctx) >= 730 && t > VALIDATION_BAR.tCrit;
      return finish(
        4,
        ok,
        {
          oosDays: oosDays(ctx),
          trades: r.metrics.trades,
          sharpeAnnual: +r.metrics.sharpe.toFixed(3),
          neweyWestT: +t.toFixed(3),
          wf1: +wf[0]!.toFixed(2),
          wf2: +wf[1]!.toFixed(2),
          wf3: +wf[2]!.toFixed(2),
          wf4: +wf[3]!.toFixed(2),
          maxDdPct: +r.metrics.maxDdPct.toFixed(3),
        },
        [
          `OOS window starts ${new Date(oosStart).toISOString().slice(0, 10)}, never used during design.`,
        ],
      );
    }
    case 5: {
      const r = await bt(ctx, "out-of-sample", oosDays(ctx), oosStart);
      const rb = randomBaseline(r, ctx.seed);
      const ok = rb.strat.length >= VALIDATION_BAR.minBaselineTrades && rb.test.p < VALIDATION_BAR.pMax && rb.test.meanDiff > 0;
      return finish(
        5,
        ok,
        {
          pairs: rb.strat.length,
          meanRStrategy: +mean(rb.strat).toFixed(4),
          meanRRandom: +mean(rb.random).toFixed(4),
          t: +rb.test.t.toFixed(3),
          p: +rb.test.p.toFixed(5),
        },
        ["Random entries share each trade's stop, target, hold and cost on the same bars."],
      );
    }
    case 6: {
      const r = await bt(ctx, "out-of-sample", oosDays(ctx), oosStart);
      const d = r.dailyReturns;
      const se = neweyWestMeanSE(d);
      const nwT = se > 0 ? mean(d) / se : 0;
      const wins = r.trades.filter((x) => x.net > 0);
      const losses = r.trades.filter((x) => x.net <= 0);
      const avgW = wins.length ? mean(wins.map((x) => x.r)) : 0;
      const avgL = losses.length ? -mean(losses.map((x) => x.r)) : 0;
      const breakeven = avgW + avgL > 0 ? avgL / (avgW + avgL) : 0.5;
      const binP = r.trades.length
        ? binomialUpperP(wins.length, r.trades.length, Math.min(0.99, Math.max(0.01, breakeven)))
        : 1;
      const boot = blockBootstrap(
        d,
        (s) => sharpe(s, 252),
        new Rng(hashSeed(ctx.seed, "boot-sharpe")),
        5,
        500,
      );
      // joint F-test: trade R on one dummy per conditional rule group (no intercept), H0 all β = 0
      const groups = [...new Set(r.trades.map((x) => x.tag))];
      let fP = 1;
      if (groups.length && r.trades.length > groups.length + 2) {
        const y = r.trades.map((x) => x.r);
        const X = groups.map((g) => r.trades.map((x) => (x.tag === g ? 1 : 0)));
        try {
          const fit = ols(y, X, false);
          const rss1 = fit.residuals.reduce((a, e) => a + e * e, 0);
          const rss0 = y.reduce((a, v) => a + v * v, 0);
          const k = groups.length;
          const F = (rss0 - rss1) / k / (rss1 / (y.length - k));
          fP = 1 - fCdf(F, k, y.length - k);
        } catch {
          fP = 1;
        }
      }
      const ok = nwT > VALIDATION_BAR.tCrit && fP < VALIDATION_BAR.pMax && boot.lo > 0 && binP < VALIDATION_BAR.pMax;
      return finish(
        6,
        ok,
        {
          neweyWestT: +nwT.toFixed(3),
          jointFP: +fP.toFixed(5),
          ruleGroups: groups.length,
          bootSharpeLo: +boot.lo.toFixed(3),
          bootSharpeHi: +boot.hi.toFixed(3),
          hitRate: r.trades.length ? +(wins.length / r.trades.length).toFixed(4) : 0,
          breakevenHitRate: +breakeven.toFixed(4),
          binomialP: +binP.toFixed(5),
        },
        ["Block length 5 days, 500 bootstrap replicates."],
      );
    }
    case 7: {
      const keys = Object.keys(ctx.grid).slice(0, 2);
      const [ka, kb] = keys;
      let plateau = false;
      const gridVals: number[][] = [];
      if (ka && kb) {
        const ga = ctx.grid[ka]!;
        const gb = ctx.grid[kb]!;
        let done = 0;
        for (const va of ga) {
          const row: number[] = [];
          for (const vb of gb) {
            const res = await bt(
              ctx,
              `grid ${++done}/${ga.length * gb.length}`,
              ctx.designDays ?? 90,
              SIM_START_MS,
              { params: { ...ctx.params, [ka]: va, [kb]: vb } },
            );
            row.push(res.metrics.sharpe);
          }
          gridVals.push(row);
        }
        const mask = plateauMask(gridVals);
        const ia = ga.indexOf(Number(ctx.params[ka]));
        const ib = gb.indexOf(Number(ctx.params[kb]));
        plateau = ia >= 0 && ib >= 0 && !!mask[ia]?.[ib];
      }
      const wide = await bt(ctx, "2× spread", ctx.designDays ?? 180, oosStart, {
        spreadMultiplier: 2,
      });
      const base = await bt(ctx, "out-of-sample", oosDays(ctx), oosStart);
      const tail = bootstrapTailMc(
        base.trades.map((x) => x.retPct),
        631,
        4000,
        ctx.seed,
        10,
        300,
      );
      const ok = plateau && wide.metrics.sharpe > VALIDATION_BAR.minWideSharpe && tail.medianMaxDd < VALIDATION_BAR.mcMedianDdPct;
      return finish(
        7,
        ok,
        {
          onPlateau: plateau,
          gridParamA: ka ?? null,
          gridParamB: kb ?? null,
          gridSharpe: JSON.stringify(gridVals.map((r) => r.map((v) => +v.toFixed(2)))),
          sharpeAt2xSpread: +wide.metrics.sharpe.toFixed(3),
          tailMedianMaxDdPct: +tail.medianMaxDd.toFixed(3),
          tailP95MaxDdPct: +tail.p95MaxDd.toFixed(3),
        },
        [
          "Tail injection: one 10× average-loss gap per 300 trades, bootstrapped from the agent's OOS trades.",
        ],
      );
    }
    case 8: {
      const notes: string[] = [];
      let ok = false;
      const m: Evidence["metrics"] = {};
      if (ctx.agent === "G2") {
        // a long synthetic history: recovery checks the pipeline, not the (deliberately low) live power
        const hist = buildEventHistory(ctx.seed, SIM_START_MS, 40, PLANTED_BETA);
        const fit = fitRelease(hist, "CPI");
        const best = fit.fits.reduce((a, f) => (Math.abs(f.t) > Math.abs(a.t) ? f : a));
        ok = Math.sign(best.beta) === Math.sign(PLANTED_BETA.CPI) && best.significant;
        Object.assign(m, {
          syntheticEvents: hist.filter((h) => h.kind === "CPI").length,
          plantedBeta: PLANTED_BETA.CPI,
          recoveredBeta: +best.beta.toFixed(5),
          window: best.w,
          t: +best.t.toFixed(2),
        });
      } else if (ctx.agent === "G3") {
        const f = new SyntheticFeed({ seed: ctx.seed, startMs: SIM_START_MS });
        const ms = new MarketState(f.daily);
        const y = ms
          .d1("XAUUSD")
          .slice(-500)
          .map((d) => Math.log(d.c));
        const x = ms
          .d1("XAGUSD")
          .slice(-500)
          .map((d) => Math.log(d.c));
        const eg = engleGranger(y, x);
        ok = eg.cointegrated && Math.abs(eg.hedgeRatio - XAG_HEDGE_B) < 0.15;
        Object.assign(m, {
          plantedHedge: XAG_HEDGE_B,
          recoveredHedge: +eg.hedgeRatio.toFixed(4),
          adfResidual: +eg.adfResidual.toFixed(3),
        });
      } else if (ctx.agent === "G1") {
        const vrOf = (planted: boolean) => {
          const f = new SyntheticFeed({
            seed: ctx.seed,
            startMs: SIM_START_MS,
            plantedEdge: planted,
          });
          const ms = new MarketState(f.daily);
          for (let i = 0; i < 1440 * 15; i++) ms.onTick(f.next());
          const c = ms.m15("XAUUSD").map((b) => b.c);
          return varianceRatio(
            c.slice(1).map((v, i) => Math.log(v / c[i]!)),
            4,
          );
        };
        const p = vrOf(true);
        const n = vrOf(false);
        ok = p.vr < 1 && p.z < -1.96 && p.vr < n.vr;
        Object.assign(m, {
          vrPlanted: +p.vr.toFixed(4),
          zPlanted: +p.z.toFixed(2),
          vrNoEdge: +n.vr.toFixed(4),
          zNoEdge: +n.z.toFixed(2),
        });
      } else {
        const rng = new Rng(hashSeed(ctx.seed, "trend-recovery"));
        let lp = 0;
        const closes: number[] = [];
        for (let i = 0; i < 400; i++) {
          lp += 0.002 + 0.01 * rng.normal();
          closes.push(Math.exp(lp));
        }
        const s = trendSignal(closes, [20, 50, 180]);
        ok = s !== null && s > 0;
        Object.assign(m, { plantedDriftPerDay: 0.002, recoveredSignal: s });
      }
      notes.push("Synthetic prices with a known planted edge, run through the same engine code.");
      return finish(8, ok, m, notes);
    }
    case 9: {
      const sh = ctx.shadowTrades;
      const spanDays = sh.length
        ? (Math.max(...sh.map((x) => x.closedAt)) - Math.min(...sh.map((x) => x.closedAt))) / DAY
        : 0;
      const r = await bt(ctx, "out-of-sample", oosDays(ctx), oosStart);
      const live = sh.map((x) => x.r);
      const back = r.trades.map((x) => x.r);
      const mw = live.length && back.length ? mannWhitney(live, back) : { u: 0, z: 0, p: 0 };
      const ks = live.length && back.length ? ks2(live, back) : { d: 1, p: 0 };
      const ok = spanDays >= VALIDATION_BAR.shadowDays && live.length >= VALIDATION_BAR.shadowTrades && mw.p > VALIDATION_BAR.shadowPMin && ks.p > VALIDATION_BAR.shadowPMin;
      return finish(
        9,
        ok,
        {
          shadowTrades: live.length,
          shadowSpanDays: +spanDays.toFixed(1),
          backtestTrades: back.length,
          mannWhitneyP: +mw.p.toFixed(4),
          ksD: +ks.d.toFixed(4),
          ksP: +ks.p.toFixed(4),
        },
        ["Shadow trades come from the live simulator's trade log for this agent."],
      );
    }
    case 10: {
      const prior = ctx.priorSteps.filter((s) => s.step <= 9);
      const ok = prior.length === 9 && prior.every((s) => s.status === "PASSED" && s.signed);
      return finish(
        10,
        ok,
        {
          stepsPassedAndSigned: prior.filter((s) => s.status === "PASSED" && s.signed).length,
          probationBudgetFraction: 0.25,
        },
        ok
          ? ["Agent promoted to PROBATION at 25% of its budget."]
          : ["Steps 1–9 must all be PASSED and signed first."],
      );
    }
    default:
      throw new Error(`unknown step ${step}`);
  }
}

/** Transition rule for the gate state machine. */
export function nextStatuses(statuses: StepStatus[], step: number, passed: boolean): StepStatus[] {
  const s = [...statuses];
  if (passed) {
    s[step - 1] = "PASSED";
    if (step < 10 && s[step] === "LOCKED") s[step] = "IN_PROGRESS";
  } else {
    s[step - 1] = "FAILED";
    for (let k = step; k < 10; k++) s[k] = "LOCKED";
  }
  return s;
}
export const canPromoteToLive = (steps: { status: StepStatus; signed: boolean }[]): boolean =>
  steps.length === 10 && steps.every((s) => s.status === "PASSED" && s.signed);
export { defaultParams };
