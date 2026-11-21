/** Statistics used by the agents, the gateway evidence runners and the overseer. Pure, deterministic. */
import type { Rng } from "./rng";

export const sum = (x: readonly number[]): number => {
  let s = 0;
  for (const v of x) s += v;
  return s;
};
export const mean = (x: readonly number[]): number => (x.length ? sum(x) / x.length : 0);
export function variance(x: readonly number[], ddof = 1): number {
  const n = x.length;
  if (n - ddof <= 0) return 0;
  const m = mean(x);
  let s = 0;
  for (const v of x) s += (v - m) * (v - m);
  return s / (n - ddof);
}
export const sd = (x: readonly number[], ddof = 1): number => Math.sqrt(variance(x, ddof));
export function skewness(x: readonly number[]): number {
  const n = x.length;
  if (n < 3) return 0;
  const m = mean(x);
  const s = sd(x, 0);
  if (s === 0) return 0;
  let a = 0;
  for (const v of x) a += ((v - m) / s) ** 3;
  return a / n;
}
/** Excess kurtosis. */
export function kurtosis(x: readonly number[]): number {
  const n = x.length;
  if (n < 4) return 0;
  const m = mean(x);
  const s = sd(x, 0);
  if (s === 0) return 0;
  let a = 0;
  for (const v of x) a += ((v - m) / s) ** 4;
  return a / n - 3;
}
export function quantile(x: readonly number[], q: number): number {
  if (!x.length) return 0;
  const s = [...x].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const a = s[lo] ?? 0;
  const b = s[hi] ?? a;
  return a + (b - a) * (pos - lo);
}
export const median = (x: readonly number[]): number => quantile(x, 0.5);

// ---------- special functions ----------
export function logGamma(z: number): number {
  const c = [
    76.18009172947146, -86.50532032941678, 24.01409824083091, -1.23173957245015,
    0.1208650973866179e-2, -0.5395239384953e-5,
  ];
  let x = z;
  let y = z;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (const ci of c) ser += ci / ++y;
  x = z;
  return -tmp + Math.log((2.506628274631 * ser) / x);
}
function betacf(a: number, b: number, x: number): number {
  const MAXIT = 200;
  const EPS = 3e-14;
  const FPMIN = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}
/** Regularised incomplete beta I_x(a,b). */
export function betaInc(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(
    logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x),
  );
  if (x < (a + 1) / (a + b + 2)) return (bt * betacf(a, b, x)) / a;
  return 1 - (bt * betacf(b, a, 1 - x)) / b;
}
export function normalCdf(z: number): number {
  // Abramowitz–Stegun 7.1.26 via erf, refined
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp((-z * z) / 2);
  const p =
    d *
    t *
    (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z >= 0 ? 1 - p : p;
}
/** Student-t CDF. */
export function tCdf(t: number, df: number): number {
  const x = df / (df + t * t);
  const ib = betaInc(x, df / 2, 0.5);
  return t >= 0 ? 1 - 0.5 * ib : 0.5 * ib;
}
export const tTwoSidedP = (t: number, df: number): number => 2 * (1 - tCdf(Math.abs(t), df));
/** F CDF. */
export function fCdf(f: number, d1: number, d2: number): number {
  if (f <= 0) return 0;
  return betaInc((d1 * f) / (d1 * f + d2), d1 / 2, d2 / 2);
}

// ---------- regression ----------
export interface OlsResult {
  beta: number[];
  se: number[];
  t: number[];
  p: number[];
  r2: number;
  residuals: number[];
  sigma2: number;
  df: number;
  xtxInv: number[][];
}
function invert(m: number[][]): number[][] {
  const n = m.length;
  const a = m.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r]![c]!) > Math.abs(a[piv]![c]!)) piv = r;
    [a[c], a[piv]] = [a[piv]!, a[c]!];
    const pv = a[c]![c]!;
    if (Math.abs(pv) < 1e-14) throw new Error("singular matrix");
    for (let j = 0; j < 2 * n; j++) a[c]![j]! /= pv;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = a[r]![c]!;
      if (f === 0) continue;
      for (let j = 0; j < 2 * n; j++) a[r]![j]! -= f * a[c]![j]!;
    }
  }
  return a.map((row) => row.slice(n));
}
/** OLS of y on columns X (an intercept column is prepended when `intercept`). */
export function ols(
  y: readonly number[],
  X: readonly (readonly number[])[],
  intercept = true,
): OlsResult {
  const n = y.length;
  const cols: number[][] = intercept
    ? [Array.from({ length: n }, () => 1), ...X.map((c) => [...c])]
    : X.map((c) => [...c]);
  const k = cols.length;
  const xtx = Array.from({ length: k }, (_, i) =>
    Array.from({ length: k }, (_, j) => {
      let s = 0;
      const ci = cols[i]!;
      const cj = cols[j]!;
      for (let r = 0; r < n; r++) s += ci[r]! * cj[r]!;
      return s;
    }),
  );
  const xty = cols.map((c) => {
    let s = 0;
    for (let r = 0; r < n; r++) s += c[r]! * y[r]!;
    return s;
  });
  const inv = invert(xtx);
  const beta = inv.map((row) => row.reduce((s, v, j) => s + v * xty[j]!, 0));
  const residuals = y.map((yy, r) => yy - cols.reduce((s, c, j) => s + c[r]! * beta[j]!, 0));
  const df = n - k;
  const sse = residuals.reduce((s, e) => s + e * e, 0);
  const sigma2 = df > 0 ? sse / df : 0;
  const ym = mean(y);
  const sst = y.reduce((s, v) => s + (v - ym) * (v - ym), 0);
  const se = inv.map((row, i) => Math.sqrt(Math.max(0, row[i]! * sigma2)));
  const t = beta.map((b, i) => (se[i]! > 0 ? b / se[i]! : 0));
  const p = t.map((tt) => (df > 0 ? tTwoSidedP(tt, df) : 1));
  return { beta, se, t, p, r2: sst > 0 ? 1 - sse / sst : 0, residuals, sigma2, df, xtxInv: inv };
}

/** Newey–West HAC standard error of the sample mean (the "alpha" of a return series). */
export function neweyWestMeanSE(x: readonly number[], lags?: number): number {
  const n = x.length;
  if (n < 2) return 0;
  const L = lags ?? Math.floor(4 * (n / 100) ** (2 / 9));
  const m = mean(x);
  const e = x.map((v) => v - m);
  let s = e.reduce((a, v) => a + v * v, 0) / n;
  for (let l = 1; l <= L; l++) {
    let g = 0;
    for (let t = l; t < n; t++) g += e[t]! * e[t - l]!;
    g /= n;
    s += 2 * (1 - l / (L + 1)) * g;
  }
  return Math.sqrt(Math.max(s, 0) / n);
}

// ---------- tests used by agents ----------
export interface VarianceRatio {
  vr: number;
  z: number;
  n: number;
  q: number;
}
/**
 * Lo–MacKinlay (1988) variance ratio with overlapping q-period sums and the bias-corrected
 * estimators: σ²_a = Σ(r−μ)²/(n−1), σ²_c = Σ(Σq r − qμ)² / m, m = q(n−q+1)(1−q/n). VR = σ²_c/σ²_a.
 * Homoskedastic z = (VR−1)/√(2(2q−1)(q−1)/(3qn)).
 */
export function varianceRatio(r: readonly number[], q: number): VarianceRatio {
  const n = r.length;
  if (n < q * 2 || q < 2) return { vr: 1, z: 0, n, q };
  const mu = mean(r);
  let sa = 0;
  for (const v of r) sa += (v - mu) ** 2;
  sa /= n - 1;
  let win = 0;
  for (let i = 0; i < q; i++) win += r[i]!;
  let sc = (win - q * mu) ** 2;
  for (let t = q; t < n; t++) {
    win += r[t]! - r[t - q]!;
    sc += (win - q * mu) ** 2;
  }
  const m = q * (n - q + 1) * (1 - q / n);
  sc /= m;
  const vr = sa > 0 ? sc / sa : 1;
  const phi = (2 * (2 * q - 1) * (q - 1)) / (3 * q * n);
  return { vr, z: (vr - 1) / Math.sqrt(phi), n, q };
}
/** Closed-form population VR(q) for an AR(1) return process with coefficient ρ. */
export function ar1VarianceRatio(rho: number, q: number): number {
  let s = 0;
  for (let k = 1; k < q; k++) s += (1 - k / q) * rho ** k;
  return 1 + 2 * s;
}

/** Augmented Dickey–Fuller τ statistic with constant: Δy_t = α + γ y_{t−1} + Σ δ_i Δy_{t−i}. */
export function adfStat(y: readonly number[], lags = 1): number {
  const dy = y.slice(1).map((v, i) => v - y[i]!);
  const rows = dy.length - lags;
  if (rows < 10) return 0;
  const Y: number[] = [];
  const ylag: number[] = [];
  const lagCols: number[][] = Array.from({ length: lags }, () => []);
  for (let t = lags; t < dy.length; t++) {
    Y.push(dy[t]!);
    ylag.push(y[t]!);
    for (let i = 1; i <= lags; i++) lagCols[i - 1]!.push(dy[t - i]!);
  }
  const res = ols(Y, [ylag, ...lagCols]);
  return res.t[1] ?? 0;
}
/** MacKinnon 5% critical values. */
export const DF_CRIT_5 = -2.86; // single series, constant
export const EG_CRIT_5 = -3.34; // Engle–Granger residual, 2 variables, constant

export interface EngleGranger {
  hedgeRatio: number;
  intercept: number;
  adfX: number;
  adfY: number;
  adfResidual: number;
  unitRootX: boolean;
  unitRootY: boolean;
  cointegrated: boolean;
  residuals: number[];
}
/** Engle–Granger two-step on log prices: y = a + b x + e; ADF(e) < EG 5% → cointegrated. */
export function engleGranger(y: readonly number[], x: readonly number[]): EngleGranger {
  const adfY = adfStat(y);
  const adfX = adfStat(x);
  const reg = ols(y, [x]);
  const residuals = reg.residuals;
  const adfResidual = adfStat(residuals);
  const unitRootX = adfX > DF_CRIT_5;
  const unitRootY = adfY > DF_CRIT_5;
  return {
    hedgeRatio: reg.beta[1] ?? 0,
    intercept: reg.beta[0] ?? 0,
    adfX,
    adfY,
    adfResidual,
    unitRootX,
    unitRootY,
    cointegrated: unitRootX && unitRootY && adfResidual < EG_CRIT_5,
    residuals,
  };
}

/** Aldridge's sign test θ = (N⁺/N − 0.5)/√(0.25/N). */
export function signTestTheta(nPos: number, n: number): number {
  if (n === 0) return 0;
  return (nPos / n - 0.5) / Math.sqrt(0.25 / n);
}
export const bonferroni = (p: number, m: number): number => Math.min(1, p * m);
export const bonferroniAlpha = (alpha: number, m: number): number => alpha / m;

export interface TTest {
  t: number;
  df: number;
  p: number;
  meanDiff: number;
}
export function pairedTTest(a: readonly number[], b: readonly number[]): TTest {
  const n = Math.min(a.length, b.length);
  const d = Array.from({ length: n }, (_, i) => a[i]! - b[i]!);
  const m = mean(d);
  const s = sd(d);
  const t = s > 0 ? m / (s / Math.sqrt(n)) : 0;
  return { t, df: n - 1, p: n > 1 ? tTwoSidedP(t, n - 1) : 1, meanDiff: m };
}
export function oneSampleT(x: readonly number[], mu0 = 0): TTest {
  const n = x.length;
  const m = mean(x);
  const s = sd(x);
  const t = s > 0 ? (m - mu0) / (s / Math.sqrt(n)) : 0;
  return { t, df: n - 1, p: n > 1 ? tTwoSidedP(t, n - 1) : 1, meanDiff: m - mu0 };
}
/** Exact one-sided binomial P(X ≥ k | n, p0). */
export function binomialUpperP(k: number, n: number, p0: number): number {
  let s = 0;
  for (let i = k; i <= n; i++) {
    s += Math.exp(
      logGamma(n + 1) -
        logGamma(i + 1) -
        logGamma(n - i + 1) +
        i * Math.log(p0) +
        (n - i) * Math.log(1 - p0),
    );
  }
  return Math.min(1, s);
}
/** Mann–Whitney U with normal approximation (tie-averaged ranks). */
export function mannWhitney(
  a: readonly number[],
  b: readonly number[],
): { u: number; z: number; p: number } {
  const all = [...a.map((v) => ({ v, g: 0 })), ...b.map((v) => ({ v, g: 1 }))].sort(
    (x, y) => x.v - y.v,
  );
  const ranks = new Array<number>(all.length);
  for (let i = 0; i < all.length;) {
    let j = i;
    while (j + 1 < all.length && all[j + 1]!.v === all[i]!.v) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[k] = r;
    i = j + 1;
  }
  let ra = 0;
  all.forEach((x, i) => {
    if (x.g === 0) ra += ranks[i]!;
  });
  const n1 = a.length;
  const n2 = b.length;
  const u = ra - (n1 * (n1 + 1)) / 2;
  const mu = (n1 * n2) / 2;
  const sigma = Math.sqrt((n1 * n2 * (n1 + n2 + 1)) / 12);
  const z = sigma > 0 ? (u - mu) / sigma : 0;
  return { u, z, p: 2 * (1 - normalCdf(Math.abs(z))) };
}
/** Two-sample Kolmogorov–Smirnov with asymptotic p-value. */
export function ks2(a: readonly number[], b: readonly number[]): { d: number; p: number } {
  const x = [...a].sort((p, q) => p - q);
  const y = [...b].sort((p, q) => p - q);
  let i = 0;
  let j = 0;
  let d = 0;
  while (i < x.length && j < y.length) {
    const v = Math.min(x[i]!, y[j]!);
    while (i < x.length && x[i]! <= v) i++;
    while (j < y.length && y[j]! <= v) j++;
    d = Math.max(d, Math.abs(i / x.length - j / y.length));
  }
  const ne = (x.length * y.length) / (x.length + y.length);
  const lambda = (Math.sqrt(ne) + 0.12 + 0.11 / Math.sqrt(ne)) * d;
  let p = 0;
  for (let k = 1; k <= 100; k++) p += 2 * (-1) ** (k - 1) * Math.exp(-2 * k * k * lambda * lambda);
  return { d, p: Math.min(1, Math.max(0, p)) };
}
/** Moving-block bootstrap percentile interval for a statistic. */
export function blockBootstrap(
  x: readonly number[],
  stat: (s: number[]) => number,
  rng: Rng,
  blockLen = 5,
  reps = 1000,
): { lo: number; hi: number; dist: number[] } {
  const n = x.length;
  const dist: number[] = [];
  if (n < blockLen) return { lo: 0, hi: 0, dist };
  for (let r = 0; r < reps; r++) {
    const s: number[] = [];
    while (s.length < n) {
      const start = rng.int(n - blockLen + 1);
      for (let k = 0; k < blockLen && s.length < n; k++) s.push(x[start + k]!);
    }
    dist.push(stat(s));
  }
  return { lo: quantile(dist, 0.025), hi: quantile(dist, 0.975), dist };
}

// ---------- performance ----------
export function sharpe(returns: readonly number[], periodsPerYear: number): number {
  const s = sd(returns);
  return s > 0 ? (mean(returns) / s) * Math.sqrt(periodsPerYear) : 0;
}
/** t-stat of a per-period Sharpe: SR·√n (Lo 2002, iid). */
export function sharpeT(returns: readonly number[]): number {
  const s = sd(returns);
  return s > 0 ? (mean(returns) / s) * Math.sqrt(returns.length) : 0;
}
export interface Drawdown {
  maxDd: number; // fraction of peak
  peakIdx: number;
  troughIdx: number;
  recoveryIdx: number | null;
}
export function maxDrawdown(equity: readonly number[]): Drawdown {
  let peak = equity[0] ?? 0;
  let peakIdx = 0;
  let best: Drawdown = { maxDd: 0, peakIdx: 0, troughIdx: 0, recoveryIdx: null };
  let curPeakIdx = 0;
  for (let i = 0; i < equity.length; i++) {
    const e = equity[i]!;
    if (e > peak) {
      peak = e;
      curPeakIdx = i;
    }
    const dd = peak > 0 ? (peak - e) / peak : 0;
    if (dd > best.maxDd) best = { maxDd: dd, peakIdx: curPeakIdx, troughIdx: i, recoveryIdx: null };
  }
  peakIdx = best.peakIdx;
  const peakVal = equity[peakIdx] ?? 0;
  for (let i = best.troughIdx; i < equity.length; i++) {
    if (equity[i]! >= peakVal) {
      best.recoveryIdx = i;
      break;
    }
  }
  return best;
}
/** Additive max drawdown in the same units as the path (used by the Monte Carlo on % returns). */
export function maxDrawdownAdditive(cum: Float64Array | readonly number[]): number {
  let peak = 0;
  let dd = 0;
  for (let i = 0; i < cum.length; i++) {
    const v = cum[i]!;
    if (v > peak) peak = v;
    if (peak - v > dd) dd = peak - v;
  }
  return dd;
}
export function historicalVaR(returns: readonly number[], level = 0.95): number {
  return -quantile(returns, 1 - level);
}
/** EWMA variance recursion (RiskMetrics λ = 0.94); returns the latest σ. */
export function ewmaVol(returns: readonly number[], lambda = 0.94): number {
  if (!returns.length) return 0;
  let v =
    returns.slice(0, Math.min(20, returns.length)).reduce((a, r) => a + r * r, 0) /
    Math.min(20, returns.length);
  for (const r of returns) v = lambda * v + (1 - lambda) * r * r;
  return Math.sqrt(v);
}
