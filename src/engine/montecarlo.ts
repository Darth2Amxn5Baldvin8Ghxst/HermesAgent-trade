/**
 * Monte Carlo of independent trades with fixed win/loss sizes (book §1, page 2). Equity is additive in
 * % of starting equity, matching the book's calculation. Per-run seeds derive from (seed, run index),
 * so results are identical however the runs are split across workers.
 */
import { Rng, hashSeed } from "./rng";
import { quantile } from "./stats";

export type TailScenario = "NONE" | "10X_1_IN_300" | "25X_1_IN_300";
export const TAIL_MULT: Record<TailScenario, number> = {
  NONE: 0,
  "10X_1_IN_300": 10,
  "25X_1_IN_300": 25,
};
export interface McConfig {
  nTrades: number;
  nRuns: number;
  winRate: number;
  avgWinPct: number; // e.g. 0.072 (% of equity)
  avgLossPct: number; // e.g. 0.103
  tail: TailScenario;
  seed: number;
  months: number; // 23 in the book
  tailEvery?: number; // 300
}
export const BOOK_MC: McConfig = {
  nTrades: 631,
  nRuns: 20000,
  winRate: 0.829,
  avgWinPct: 0.072,
  avgLossPct: 0.103,
  tail: "NONE",
  seed: 20261109,
  months: 23,
  tailEvery: 300,
};

export interface McChunk {
  maxDd: Float64Array;
  terminal: Float64Array;
  losingMonth: Uint8Array;
  paths: number[][]; // sampled cumulative paths (first runs of the chunk, ≤ samplePaths)
}

export function simulateChunk(
  cfg: McConfig,
  start: number,
  count: number,
  samplePaths = 0,
): McChunk {
  const maxDd = new Float64Array(count);
  const terminal = new Float64Array(count);
  const losingMonth = new Uint8Array(count);
  const paths: number[][] = [];
  const mult = TAIL_MULT[cfg.tail];
  const pTail = mult > 0 ? 1 / (cfg.tailEvery ?? 300) : 0;
  const edges = Array.from({ length: cfg.months + 1 }, (_, i) =>
    Math.floor((i * cfg.nTrades) / cfg.months),
  );
  const step = Math.max(1, Math.floor(cfg.nTrades / 120));
  for (let k = 0; k < count; k++) {
    const rng = new Rng(hashSeed(cfg.seed, `mc:${start + k}`));
    let cum = 0;
    let peak = 0;
    let dd = 0;
    let month = 0;
    let monthSum = 0;
    let anyLose = 0;
    const keep = k < samplePaths;
    const path: number[] = keep ? [0] : [];
    for (let i = 0; i < cfg.nTrades; i++) {
      let r = rng.next() < cfg.winRate ? cfg.avgWinPct : -cfg.avgLossPct;
      if (pTail > 0 && rng.next() < pTail) r = -cfg.avgLossPct * mult;
      cum += r;
      monthSum += r;
      if (cum > peak) peak = cum;
      if (peak - cum > dd) dd = peak - cum;
      if (i + 1 === edges[month + 1]) {
        if (monthSum < 0) anyLose = 1;
        month++;
        monthSum = 0;
      }
      if (keep && (i + 1) % step === 0) path.push(cum);
    }
    maxDd[k] = dd;
    terminal[k] = cum;
    losingMonth[k] = anyLose;
    if (keep) paths.push(path);
  }
  return { maxDd, terminal, losingMonth, paths };
}

export interface McSummary {
  medianMaxDd: number;
  p95MaxDd: number;
  p99MaxDd: number;
  pLosingMonth: number;
  medianTerminal: number;
  ddHist: { x: number; n: number }[];
  terminalHist: { x: number; n: number }[];
  paths: number[][];
  runs: number;
}
function hist(xs: Float64Array, bins = 40): { x: number; n: number }[] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of xs) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!Number.isFinite(lo) || hi === lo) return [{ x: lo, n: xs.length }];
  const w = (hi - lo) / bins;
  const out = Array.from({ length: bins }, (_, i) => ({ x: lo + (i + 0.5) * w, n: 0 }));
  for (const v of xs) out[Math.min(bins - 1, Math.floor((v - lo) / w))]!.n++;
  return out;
}
export function summarize(chunks: McChunk[]): McSummary {
  const n = chunks.reduce((a, c) => a + c.maxDd.length, 0);
  const dd = new Float64Array(n);
  const term = new Float64Array(n);
  let lose = 0;
  let o = 0;
  const paths: number[][] = [];
  for (const c of chunks) {
    dd.set(c.maxDd, o);
    term.set(c.terminal, o);
    o += c.maxDd.length;
    for (const v of c.losingMonth) lose += v;
    for (const p of c.paths) if (paths.length < 100) paths.push(p);
  }
  const sorted = Array.from(dd).sort((a, b) => a - b);
  const q = (p: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))] ?? 0;
  return {
    medianMaxDd: quantile(sorted, 0.5),
    p95MaxDd: q(0.95),
    p99MaxDd: q(0.99),
    pLosingMonth: n ? lose / n : 0,
    medianTerminal: quantile(Array.from(term), 0.5),
    ddHist: hist(dd),
    terminalHist: hist(term),
    paths,
    runs: n,
  };
}
export function runMonteCarlo(cfg: McConfig): McSummary {
  return summarize([simulateChunk(cfg, 0, cfg.nRuns, 100)]);
}

/** Bootstrap Monte Carlo on an agent's own trade returns (validation step 7 tail injection). */
export function bootstrapTailMc(
  tradeReturnsPct: readonly number[],
  nTrades: number,
  nRuns: number,
  seed: number,
  mult = 10,
  every = 300,
): { medianMaxDd: number; p95MaxDd: number } {
  if (!tradeReturnsPct.length) return { medianMaxDd: 0, p95MaxDd: 0 };
  const losses = tradeReturnsPct.filter((r) => r < 0);
  const avgLoss = losses.length ? -losses.reduce((a, b) => a + b, 0) / losses.length : 0;
  const dds: number[] = [];
  for (let k = 0; k < nRuns; k++) {
    const rng = new Rng(hashSeed(seed, `boot:${k}`));
    let cum = 0;
    let peak = 0;
    let dd = 0;
    for (let i = 0; i < nTrades; i++) {
      let r = tradeReturnsPct[rng.int(tradeReturnsPct.length)]!;
      if (rng.next() < 1 / every) r = -avgLoss * mult;
      cum += r;
      if (cum > peak) peak = cum;
      if (peak - cum > dd) dd = peak - cum;
    }
    dds.push(dd);
  }
  return { medianMaxDd: quantile(dds, 0.5), p95MaxDd: quantile(dds, 0.95) };
}
