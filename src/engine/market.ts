/** Multi-timeframe market state built from M1 ticks: M15/H1/D1 bars and the hourly spread profile. */
import { ewmaVol, median } from "./stats";
import { HOUR_SPREAD_PROFILE, MARKETS } from "./markets";
import { ALL_SYMBOLS, type Bar, type Sym, type Tick } from "./types";
import type { DailyClose } from "./feed";

const MIN = 60_000;
const H = 3_600_000;
const DAY = 86_400_000;
const NY_CLOSE_OFFSET = 21 * H;

interface Series {
  m15: Bar[];
  h1: Bar[];
  d1: DailyClose[];
  cur15: Bar | null;
  cur60: Bar | null;
  curDayKey: number;
  last: Bar | null;
  spreads: number[][]; // by GMT hour
}
export interface Closed {
  m15: Set<Sym>;
  h1: Set<Sym>;
  d1: Set<Sym>;
}

function roll(cur: Bar | null, b: Bar, bucket: number): Bar {
  if (!cur || cur.t !== bucket)
    return { t: bucket, o: b.o, h: b.h, l: b.l, c: b.c, spread: b.spread };
  cur.h = Math.max(cur.h, b.h);
  cur.l = Math.min(cur.l, b.l);
  cur.c = b.c;
  cur.spread = b.spread;
  return cur;
}
const cap = <T>(a: T[], n: number) => {
  if (a.length > n) a.splice(0, a.length - n);
};

export class MarketState {
  t = 0;
  seq = 0;
  readonly s: Record<Sym, Series>;
  constructor(daily: Record<Sym, DailyClose[]>) {
    this.s = {} as Record<Sym, Series>;
    for (const sym of ALL_SYMBOLS) {
      this.s[sym] = {
        m15: [],
        h1: [],
        d1: [...(daily[sym] ?? [])],
        cur15: null,
        cur60: null,
        curDayKey: -1,
        last: null,
        // seed hourly spread history from the broker profile so medians exist from bar one
        spreads: HOUR_SPREAD_PROFILE.map((m) =>
          Array.from({ length: 5 }, () => MARKETS[sym].baseSpread * m),
        ),
      };
    }
  }

  onTick(tick: Tick): Closed {
    const closed: Closed = { m15: new Set(), h1: new Set(), d1: new Set() };
    this.t = tick.t;
    this.seq = tick.seq;
    for (const sym of ALL_SYMBOLS) {
      const b = tick.bars[sym];
      if (!b) continue;
      const se = this.s[sym];
      const b15 = Math.floor(b.t / (15 * MIN)) * 15 * MIN;
      const b60 = Math.floor(b.t / H) * H;
      if (se.cur15 && se.cur15.t !== b15) {
        se.m15.push(se.cur15);
        cap(se.m15, 2400);
        closed.m15.add(sym);
      }
      if (se.cur60 && se.cur60.t !== b60) {
        se.h1.push(se.cur60);
        cap(se.h1, 1600);
        closed.h1.add(sym);
      }
      se.cur15 = roll(se.cur15, b, b15);
      se.cur60 = roll(se.cur60, b, b60);
      const dayKey = Math.floor((b.t - NY_CLOSE_OFFSET) / DAY);
      if (se.curDayKey !== -1 && dayKey !== se.curDayKey && se.last) {
        se.d1.push({ t: se.last.t, c: se.last.c });
        cap(se.d1, 900);
        closed.d1.add(sym);
      }
      se.curDayKey = dayKey;
      se.last = b;
      const hr = new Date(b.t).getUTCHours();
      const arr = se.spreads[hr]!;
      arr.push(b.spread);
      cap(arr, 400);
    }
    return closed;
  }

  last(sym: Sym): Bar | null {
    return this.s[sym].last;
  }
  mid(sym: Sym): number {
    return this.s[sym].last?.c ?? MARKETS[sym].px0;
  }
  spread(sym: Sym): number {
    return this.s[sym].last?.spread ?? MARKETS[sym].baseSpread;
  }
  bid(sym: Sym): number {
    return this.mid(sym) - this.spread(sym) / 2;
  }
  ask(sym: Sym): number {
    return this.mid(sym) + this.spread(sym) / 2;
  }
  hourlyMedianSpread(sym: Sym, t = this.t): number {
    return median(this.s[sym].spreads[new Date(t).getUTCHours()] ?? []);
  }
  m15(sym: Sym): Bar[] {
    return this.s[sym].m15;
  }
  h1(sym: Sym): Bar[] {
    return this.s[sym].h1;
  }
  d1(sym: Sym): DailyClose[] {
    return this.s[sym].d1;
  }
}

// ---------- indicators ----------
export function atr(bars: readonly Bar[], n = 14): number {
  if (bars.length < 2) return 0;
  const k = Math.min(n, bars.length - 1);
  let s = 0;
  for (let i = bars.length - k; i < bars.length; i++) {
    const b = bars[i]!;
    const pc = bars[i - 1]!.c;
    s += Math.max(b.h - b.l, Math.abs(b.h - pc), Math.abs(b.l - pc));
  }
  return s / k;
}
export const logReturns = (closes: readonly number[]): number[] =>
  closes.slice(1).map((c, i) => Math.log(c / closes[i]!));
/** EWMA (λ=0.94) σ of log returns from bar closes. */
export const ewmaSigma = (bars: readonly { c: number }[], lambda = 0.94): number =>
  ewmaVol(logReturns(bars.map((b) => b.c)), lambda);
/** Garman–Klass per-bar σ (log units). */
export function garmanKlass(bars: readonly Bar[], n = 20): number {
  const xs = bars.slice(-n);
  if (!xs.length) return 0;
  let s = 0;
  for (const b of xs) {
    const hl = Math.log(b.h / b.l);
    const co = Math.log(b.c / b.o);
    s += 0.5 * hl * hl - (2 * Math.LN2 - 1) * co * co;
  }
  return Math.sqrt(Math.max(s / xs.length, 0));
}
export function sma(values: readonly number[], n: number): number | null {
  if (values.length < n) return null;
  let s = 0;
  for (let i = values.length - n; i < values.length; i++) s += values[i]!;
  return s / n;
}
/** Last confirmed swing high/low (fractal: `w` lower highs / higher lows on each side). */
export function lastSwing(
  bars: readonly Bar[],
  w = 2,
): { high: number | null; low: number | null } {
  let high: number | null = null;
  let low: number | null = null;
  for (let i = bars.length - 1 - w; i >= w && (high === null || low === null); i--) {
    const b = bars[i]!;
    let isH = true;
    let isL = true;
    for (let k = 1; k <= w; k++) {
      if (bars[i - k]!.h >= b.h || bars[i + k]!.h >= b.h) isH = false;
      if (bars[i - k]!.l <= b.l || bars[i + k]!.l <= b.l) isL = false;
    }
    if (isH && high === null) high = b.h;
    if (isL && low === null) low = b.l;
  }
  return { high, low };
}
