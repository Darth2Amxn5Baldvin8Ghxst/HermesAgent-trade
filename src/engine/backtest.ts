/** Backtests, parameter grids, the plateau filter and the random-entry baseline — all on HermesEngine. */
import { HermesEngine, defaultConfig, defaultParams } from "./engine";
import { Rng, hashSeed, sha256 } from "./rng";
import { mean, median, pairedTTest, sd, sharpe, maxDrawdown } from "./stats";
import { ALL_SYMBOLS, type AgentCode, type Sym, type Trade } from "./types";
import type { ParamValues } from "./agents/base";
import { SIM_START_MS } from "./engine";

const MIN = 60_000;
const DAY = 86_400_000;

export interface BacktestSpec {
  agent: AgentCode;
  params: ParamValues;
  seed: number;
  days: number; // calendar days of M1 bars
  startMs?: number;
  spreadMultiplier?: number;
  tailInjection?: { every: number; mult: number } | null;
  historical?: import("./types").Bar[] | null;
}
export interface TradeLite {
  t: number;
  closedAt: number;
  symbol: Sym;
  side: "LONG" | "SHORT";
  entry: number;
  exit: number;
  stop: number;
  target: number | null;
  holdMin: number;
  net: number;
  r: number;
  retPct: number; // net / starting equity × 100
  reason: string;
  tag: string;
  costR: number; // (gross − net) / risk at stop
}
export interface BacktestMetrics {
  trades: number;
  sharpe: number;
  sharpeT: number;
  maxDdPct: number;
  hitRate: number;
  profitFactor: number;
  expectancyR: number;
  netPnl: number;
  returnPct: number;
}
export interface BacktestResult {
  spec: BacktestSpec;
  metrics: BacktestMetrics;
  trades: TradeLite[];
  dailyReturns: number[];
  dailyEquity: { t: number; equity: number }[];
  mids: Partial<Record<Sym, Float32Array>>;
  startMs: number;
  hash: string;
}

export function metricsFrom(
  trades: readonly TradeLite[],
  daily: readonly number[],
  equity: readonly number[],
  starting: number,
): BacktestMetrics {
  const wins = trades.filter((t) => t.net > 0);
  const losses = trades.filter((t) => t.net <= 0);
  const gw = wins.reduce((a, t) => a + t.net, 0);
  const gl = -losses.reduce((a, t) => a + t.net, 0);
  const net = trades.reduce((a, t) => a + t.net, 0);
  const s = sd(daily);
  return {
    trades: trades.length,
    sharpe: sharpe(daily, 252),
    sharpeT: s > 0 ? (mean(daily) / s) * Math.sqrt(daily.length) : 0,
    maxDdPct: maxDrawdown(equity).maxDd * 100,
    hitRate: trades.length ? wins.length / trades.length : 0,
    profitFactor: gl > 0 ? gw / gl : gw > 0 ? Infinity : 0,
    expectancyR: trades.length ? mean(trades.map((t) => t.r)) : 0,
    netPnl: net,
    returnPct: (net / starting) * 100,
  };
}

export function toLite(t: Trade, starting: number): TradeLite {
  const net = t.net.toNumber();
  return {
    t: t.openedAt,
    closedAt: t.closedAt,
    symbol: t.symbol,
    side: t.side,
    entry: t.entryPx,
    exit: t.exitPx,
    stop: t.stopPx,
    target: t.targetPx,
    holdMin: t.holdSeconds / 60,
    net,
    r: t.rMultiple,
    retPct: (net / starting) * 100,
    reason: t.exitReason,
    tag: t.symbol,
    costR: t.riskAtStop.gt(0) ? t.gross.minus(t.net).div(t.riskAtStop).toNumber() : 0,
  };
}

export async function runBacktest(
  spec: BacktestSpec,
  onProgress?: (f: number) => void,
): Promise<BacktestResult> {
  const startMs = spec.startMs ?? SIM_START_MS;
  const base = defaultConfig(spec.seed);
  const params = {
    ...defaultParams(),
    [spec.agent]: { ...defaultParams()[spec.agent], ...spec.params },
  };
  const enabled = { G1: false, G2: false, G3: false, G4: false, [spec.agent]: true };
  const eng = new HermesEngine({
    ...base,
    feed: {
      seed: spec.seed,
      startMs,
      spreadMultiplier: spec.spreadMultiplier ?? 1,
      historical: spec.historical ?? null,
    },
    params,
    enabled,
    tailInjection: spec.tailInjection ?? null,
  });
  const starting = 25000;
  const endMs = startMs + spec.days * DAY;
  const mids: Partial<Record<Sym, number[]>> = {};
  const record: Sym[] =
    spec.agent === "G4"
      ? ["XAUUSD", "NAS100", "GBPJPY", "BTCUSD", "EURUSD"]
      : spec.agent === "G3"
        ? ["XAUUSD", "XAGUSD"]
        : ["XAUUSD"];
  for (const s of record) mids[s] = [];
  const times: number[] = [];
  const dailyEquity: { t: number; equity: number }[] = [];
  let lastDay = -1;
  let i = 0;
  const histEnd = spec.historical?.length ? spec.historical[spec.historical.length - 1]!.t : null;
  while (histEnd !== null ? !eng.feed.exhausted : eng.now < endMs) {
    eng.step();
    times.push(eng.now);
    for (const s of record) mids[s]!.push(eng.market.mid(s));
    const d = Math.floor(eng.now / DAY);
    if (d !== lastDay) {
      lastDay = d;
      dailyEquity.push({ t: eng.now, equity: eng.accounts[spec.agent].equity.toNumber() });
    }
    if (onProgress && ++i % 20000 === 0)
      onProgress(Math.min(1, (eng.now - startMs) / (endMs - startMs)));
  }
  dailyEquity.push({ t: eng.now, equity: eng.accounts[spec.agent].equity.toNumber() });
  const trades = eng.trades.map((t) => {
    const l = toLite(t, starting);
    const o = eng.orders.get(t.orderId);
    l.tag = o?.tag?.split(" ")[0] ?? t.symbol;
    return l;
  });
  const eq = dailyEquity.map((d) => d.equity);
  const daily = eq.slice(1).map((v, k) => v / eq[k]! - 1);
  const midsF: Partial<Record<Sym, Float32Array>> = {};
  for (const s of record) midsF[s] = Float32Array.from(mids[s]!);
  const hash = await sha256(
    trades.map((t) => [
      t.t,
      t.closedAt,
      t.symbol,
      t.side,
      t.entry.toFixed(5),
      t.exit.toFixed(5),
      t.net.toFixed(6),
    ]),
  );
  onProgress?.(1);
  void ALL_SYMBOLS;
  void MIN;
  return {
    spec,
    metrics: metricsFrom(trades, daily, eq, starting),
    trades,
    dailyReturns: daily,
    dailyEquity,
    mids: midsF,
    startMs,
    hash: hash,
  };
}

/** Random entries with the same stop/target/hold on the same bars; pairs one random trade per strategy trade. */
export function randomBaseline(
  res: BacktestResult,
  seed: number,
): { strat: number[]; random: number[]; test: ReturnType<typeof pairedTTest> } {
  const rng = new Rng(hashSeed(seed, "random-baseline"));
  const strat: number[] = [];
  const random: number[] = [];
  for (const tr of res.trades) {
    const path = res.mids[tr.symbol];
    if (!path || path.length < 100) continue;
    const stopDist = Math.abs(tr.entry - tr.stop);
    if (stopDist <= 0) continue;
    const tgtDist = tr.target !== null ? Math.abs(tr.target - tr.entry) : null;
    const hold = Math.max(1, Math.round(tr.holdMin));
    const startIdx = rng.int(Math.max(1, path.length - hold - 1));
    const dir = rng.next() < 0.5 ? 1 : -1;
    const e = path[startIdx]!;
    let exit = path[Math.min(path.length - 1, startIdx + hold)]!;
    for (let k = startIdx + 1; k <= Math.min(path.length - 1, startIdx + hold); k++) {
      const m = path[k]!;
      if ((m - e) * dir <= -stopDist) {
        exit = e - dir * stopDist;
        break;
      }
      if (tgtDist !== null && (m - e) * dir >= tgtDist) {
        exit = e + dir * tgtDist;
        break;
      }
    }
    // charge the random trade the same cost (in R) the strategy trade paid
    random.push(((exit - e) * dir) / stopDist - tr.costR);
    strat.push(tr.r);
  }
  return { strat, random, test: pairedTTest(strat, random) };
}

// ---------- grid + plateau ----------
export interface GridCell {
  a: number;
  b: number;
  metrics: BacktestMetrics;
}
/** 3×3 median filter. */
export function medianFilter3(grid: number[][]): number[][] {
  return grid.map((row, i) =>
    row.map((_, j) => {
      const xs: number[] = [];
      for (let di = -1; di <= 1; di++)
        for (let dj = -1; dj <= 1; dj++) {
          const v = grid[i + di]?.[j + dj];
          if (v !== undefined && Number.isFinite(v)) xs.push(v);
        }
      return median(xs);
    }),
  );
}
/**
 * Flat-plateau mask (Kissell Ch10): a cell is on the plateau when it is close to its 3×3 median
 * (no isolated peak) and that neighbourhood median is at or above the grid median.
 */
export function plateauMask(grid: number[][], tol = 0.25): boolean[][] {
  const flat = grid.flat().filter(Number.isFinite);
  if (!flat.length) return grid.map((r) => r.map(() => false));
  const range = Math.max(...flat) - Math.min(...flat) || 1;
  const med = median(flat);
  const f = medianFilter3(grid);
  return grid.map((row, i) =>
    row.map(
      (v, j) => Number.isFinite(v) && Math.abs(v - f[i]![j]!) <= tol * range && f[i]![j]! >= med,
    ),
  );
}
