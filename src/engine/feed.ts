/**
 * SyntheticFeed — deterministic M1 bars: GBM with GARCH(1,1) clustering, regime switching (range with
 * intraday mean reversion vs trend), jump-diffusion tails (≈1 per 500 bars at 3–8σ), session spread
 * profile, CPI/NFP volatility spikes, cointegrated XAU/XAG and a dollar index. Weekends are skipped.
 */
import { Rng, hashSeed } from "./rng";
import { HOUR_SPREAD_PROFILE, MARKETS, TRADING_MINUTES_PER_YEAR } from "./markets";
import { ALL_SYMBOLS, type Bar, type Sym, type Tick } from "./types";
import {
  DRIFT_HORIZON_MIN,
  NEWS_SPIKE_PER_S,
  PLANTED_BETA,
  buildCalendar,
  type MacroEvent,
} from "./calendar";

const MIN = 60_000;
const DAY = 86_400_000;
export const XAG_HEDGE_B = 0.9; // ln XAU = a + b ln XAG + u

export interface FeedOptions {
  seed: number;
  startMs: number;
  warmupDays?: number;
  spreadMultiplier?: number; // validation: 2× spread rerun
  plantedEdge?: boolean; // keep the planted G2 drift and G1 range reversion (default true)
  dxyLeakIntoSpread?: number; // tests: inject DXY into the XAU/XAG residual
  cointegrated?: boolean; // tests: break the XAU/XAG tie
  /** HistoricalFeed: imported XAUUSD M1 bars replace the synthetic gold path (other markets stay synthetic). */
  historical?: readonly Bar[] | null;
}
interface SymState {
  lp: number; // log mid
  h: number; // GARCH variance (per-minute)
  sigma: number; // unconditional per-minute σ
  regime: -1 | 0 | 1; // trend down / range / trend up
  anchor: number;
}
export interface DailyClose {
  t: number;
  c: number;
}

export class SyntheticFeed {
  readonly seed: number;
  readonly calendar: MacroEvent[];
  readonly daily: Record<Sym, DailyClose[]>;
  private rng: Rng;
  private st: Record<Sym, SymState>;
  private u: number; // XAU/XAG residual
  private a: number;
  private t: number;
  private seq = 0;
  private opts: Required<FeedOptions>;

  constructor(options: FeedOptions) {
    this.opts = {
      warmupDays: 520,
      spreadMultiplier: 1,
      plantedEdge: true,
      dxyLeakIntoSpread: 0,
      cointegrated: true,
      historical: null,
      ...options,
    };
    if (this.opts.historical?.length) {
      options = { ...options, startMs: this.opts.historical[0]!.t };
      this.opts.startMs = options.startMs;
    }
    this.seed = options.seed;
    this.rng = new Rng(hashSeed(options.seed, "feed"));
    this.t = options.startMs;
    this.calendar = buildCalendar(
      options.seed,
      options.startMs - DAY,
      options.startMs + 5 * 365 * DAY,
    );
    this.st = {} as Record<Sym, SymState>;
    this.daily = {} as Record<Sym, DailyClose[]>;
    this.u = 0;
    this.a = Math.log(MARKETS.XAUUSD.px0) - XAG_HEDGE_B * Math.log(MARKETS.XAGUSD.px0);
    this.buildWarmup();
  }

  /** Daily warm-up history so G3 (500 d) and G4 (180 d) have data from the first bar. */
  private buildWarmup(): void {
    const r = new Rng(hashSeed(this.seed, "warmup"));
    const n = this.opts.warmupDays;
    const startDay = Math.floor(this.opts.startMs / DAY) * DAY;
    const lp: Record<string, number> = {};
    const regime: Record<string, number> = {};
    for (const s of ALL_SYMBOLS) {
      lp[s] = Math.log(MARKETS[s].px0);
      regime[s] = 0;
      this.daily[s] = [];
    }
    let u = 0;
    const theta = Math.LN2 / 6; // residual half-life ≈ 6 days
    const uSd = 0.03;
    const days: number[] = [];
    for (let d = n; d >= 1; d--) {
      const t = startDay - d * DAY;
      const dow = new Date(t).getUTCDay();
      if (dow === 0 || dow === 6) continue;
      days.push(t);
    }
    for (const t of days) {
      let rx = 0;
      for (const s of ALL_SYMBOLS) {
        if (s === "XAGUSD" || s === "DXY") continue;
        const sig = MARKETS[s].annVol / Math.sqrt(252);
        if (r.next() < 1 / 15) regime[s] = r.next() < 0.4 ? 0 : r.next() < 0.5 ? 1 : -1;
        const ret = (regime[s] ?? 0) * 0.25 * sig + sig * r.normal();
        lp[s] = (lp[s] ?? 0) + ret;
        if (s === "XAUUSD") rx = ret;
        this.daily[s].push({ t, c: Math.exp(lp[s] ?? 0) });
      }
      const du = this.opts.cointegrated
        ? -theta * u + uSd * Math.sqrt(2 * theta) * r.normal()
        : 0.012 * r.normal();
      const dDxy = -0.25 * rx * (0.07 / 0.16) + (MARKETS.DXY.annVol / Math.sqrt(252)) * r.normal();
      u += du + this.opts.dxyLeakIntoSpread * dDxy;
      lp.DXY = (lp.DXY ?? 0) + dDxy;
      lp.XAGUSD = ((lp.XAUUSD ?? 0) - this.a - u) / XAG_HEDGE_B;
      this.daily.XAGUSD.push({ t, c: Math.exp(lp.XAGUSD) });
      this.daily.DXY.push({ t, c: Math.exp(lp.DXY) });
    }
    this.u = u;
    for (const s of ALL_SYMBOLS) {
      const sigma = MARKETS[s].annVol / Math.sqrt(TRADING_MINUTES_PER_YEAR);
      this.st[s] = {
        lp: lp[s] ?? Math.log(MARKETS[s].px0),
        h: sigma * sigma,
        sigma,
        regime: 0,
        anchor: lp[s] ?? 0,
      };
    }
  }

  get now(): number {
    return this.t;
  }

  private isClosed(t: number): boolean {
    const d = new Date(t);
    const dow = d.getUTCDay();
    const hr = d.getUTCHours();
    if (dow === 6) return true;
    if (dow === 0 && hr < 22) return true;
    if (dow === 5 && hr >= 21) return true;
    return false;
  }

  private newsAt(t: number): { ev: MacroEvent; minsSince: number } | null {
    for (const ev of this.calendar) {
      const m = (t - ev.t) / MIN;
      if (m >= 0 && m <= 60) return { ev, minsSince: m };
      if (ev.t > t) break;
    }
    return null;
  }

  /** Advance one M1 bar; returns bars for every symbol stamped at bar close. */
  private hIdx = 0;
  get exhausted(): boolean {
    const h = this.opts.historical;
    return !!h && h.length > 0 && this.hIdx >= h.length;
  }
  next(): Tick {
    let gap = false;
    const hist = this.opts.historical;
    const hb = hist && hist.length ? hist[Math.min(this.hIdx, hist.length - 1)]! : null;
    if (hb) {
      this.hIdx++;
      gap = hb.t + MIN - this.t > 10 * MIN;
      this.t = hb.t + MIN;
    } else {
      this.t += MIN;
      while (this.isClosed(this.t)) {
        this.t += MIN;
        gap = true;
      }
    }
    const t = this.t;
    const hour = new Date(t).getUTCHours();
    const news = this.newsAt(t);
    const bars: Partial<Record<Sym, Bar>> = {};
    let rXau = 0;
    for (const s of ALL_SYMBOLS) {
      if (s === "XAGUSD" || s === "DXY") continue;
      const ss = this.st[s];
      const isGold = s === "XAUUSD";
      const switchP = isGold ? 1 / (60 * 30) : 1 / (1380 * 8);
      if (this.rng.next() < switchP) {
        const x = this.rng.next();
        ss.regime = isGold ? (x < 0.6 ? 0 : x < 0.8 ? 1 : -1) : x < 0.3 ? 0 : x < 0.65 ? 1 : -1;
      }
      let volMult = 1;
      let drift = ss.regime * (isGold ? 0.03 : 0.035) * ss.sigma;
      let jump = 0;
      if (isGold && news) {
        volMult = 1 + 2.2 * Math.exp(-news.minsSince / 12);
        if (news.minsSince < 1) jump += NEWS_SPIKE_PER_S * news.ev.s;
        if (this.opts.plantedEdge && news.minsSince >= 3 && news.minsSince < 3 + DRIFT_HORIZON_MIN)
          drift += (PLANTED_BETA[news.ev.kind] * news.ev.s) / DRIFT_HORIZON_MIN;
      }
      if (isGold && ss.regime === 0 && this.opts.plantedEdge) drift += (ss.anchor - ss.lp) / 180;
      const eps = Math.sqrt(ss.h) * volMult * this.rng.normal();
      if (this.rng.next() < 1 / 500)
        jump += (this.rng.next() < 0.5 ? -1 : 1) * this.rng.range(3, 8) * Math.sqrt(ss.h);
      if (gap) jump += this.rng.normal() * ss.sigma * 25;
      const r = drift + eps + jump;
      ss.h = ss.sigma * ss.sigma * 0.01 + 0.05 * eps * eps + 0.94 * ss.h;
      const o = Math.exp(ss.lp);
      ss.lp += r;
      ss.anchor += (ss.lp - ss.anchor) / 720;
      if (isGold) rXau = r;
      bars[s] = this.mkBar(
        s,
        t,
        o,
        Math.exp(ss.lp),
        Math.sqrt(ss.h) * volMult,
        hour,
        news?.minsSince ?? null,
      );
    }
    if (hb) {
      const g = this.st.XAUUSD;
      rXau = Math.log(hb.c / Math.exp(g.lp));
      g.lp = Math.log(hb.c);
      bars.XAUUSD = { ...hb };
    }
    // dollar index: partly the inverse of gold, partly its own noise
    const dx = this.st.DXY;
    const eDxy = Math.sqrt(dx.h) * this.rng.normal();
    const rDxy = -0.25 * rXau * (0.07 / 0.16) + eDxy;
    dx.h = dx.sigma * dx.sigma * 0.01 + 0.05 * eDxy * eDxy + 0.94 * dx.h;
    const dxO = Math.exp(dx.lp);
    dx.lp += rDxy;
    bars.DXY = this.mkBar("DXY", t, dxO, Math.exp(dx.lp), Math.sqrt(dx.h), hour, null);
    // silver: cointegrated with gold through an OU residual (half-life ≈ 6 trading days)
    const theta = Math.LN2 / (6 * 1380);
    const du = this.opts.cointegrated
      ? -theta * this.u + 0.03 * Math.sqrt(2 * theta) * this.rng.normal()
      : (0.012 * this.rng.normal()) / Math.sqrt(1380);
    this.u += du + this.opts.dxyLeakIntoSpread * rDxy;
    const ag = this.st.XAGUSD;
    const agO = Math.exp(ag.lp);
    ag.lp = (this.st.XAUUSD.lp - this.a - this.u) / XAG_HEDGE_B;
    bars.XAGUSD = this.mkBar(
      "XAGUSD",
      t,
      agO,
      Math.exp(ag.lp),
      Math.abs(ag.lp - Math.log(agO)) + ag.sigma,
      hour,
      null,
    );
    this.seq++;
    return { t, seq: this.seq, bars };
  }

  private mkBar(
    s: Sym,
    t: number,
    o: number,
    c: number,
    sig: number,
    hour: number,
    newsMins: number | null,
  ): Bar {
    const m = MARKETS[s];
    const wig = () => Math.abs(this.rng.normal()) * sig * 0.6;
    const h = Math.max(o, c) * Math.exp(wig());
    const l = Math.min(o, c) * Math.exp(-wig());
    const volRatio = Math.min(3, Math.max(0.6, sig / this.st[s].sigma));
    const newsMult = newsMins !== null && newsMins < 6 ? 1 + 3 * Math.exp(-newsMins / 1.5) : 1;
    const spread =
      m.baseSpread *
      (HOUR_SPREAD_PROFILE[hour] ?? 1) *
      (0.7 + 0.3 * volRatio) *
      newsMult *
      Math.exp(0.08 * this.rng.normal()) *
      this.opts.spreadMultiplier;
    return { t: t - MIN, o, h, l, c, spread };
  }
}
