/** Stefanini report card (Ch1) + Kissell cost split, computed from persisted trades and engine factor data. */
import { historicalVaR, kurtosis, maxDrawdown, mean, sd, skewness } from "@/engine/stats";
import { factorAlpha } from "@/engine/overseer";
import type { HermesEngine } from "@/engine/engine";
import type { TradeRow } from "./queries";

const DAY = 86_400_000;
export interface ReportCard {
  periodStart: string;
  periodEnd: string;
  days: number;
  trades: number;
  returnPct: number;
  volatilityPct: number;
  pctPositiveMonths: number;
  bestMonthPct: number;
  worstMonthPct: number;
  skew: number;
  kurtosis: number;
  maxDdPct: number;
  ddDurationDays: number;
  ddRecoveryDays: number | null;
  var95Pct: number;
  costSplit: {
    delay: number;
    execution: number;
    missed_fill: number;
    spread: number;
    commission: number;
    slippage: number;
    swap: number;
  };
  alpha: number;
  alphaT: number;
  betas: { gold: number; dxy: number; nas: number };
  z: number;
  dailyReturns: number[];
  realizedPnl: number;
  expectedDailyPnl: number;
  sigmaExpectedDaily: number;
}

export function buildReportCard(
  trades: TradeRow[],
  starting: number,
  engine: HermesEngine | null,
): ReportCard | null {
  if (!trades.length) return null;
  const byDay = new Map<number, number>();
  for (const t of trades) {
    const d = Math.floor(new Date(t.closed_at).getTime() / DAY);
    byDay.set(d, (byDay.get(d) ?? 0) + Number(t.net_pnl));
  }
  const d0 = Math.min(...byDay.keys());
  const d1 = Math.max(...byDay.keys());
  const pnl: number[] = [];
  const days: number[] = [];
  for (let d = d0; d <= d1; d++) {
    const wd = new Date(d * DAY).getUTCDay();
    if (wd === 0 || wd === 6) continue;
    pnl.push(byDay.get(d) ?? 0);
    days.push(d);
  }
  let eq = starting;
  const equity = [starting];
  const rets: number[] = [];
  for (const p of pnl) {
    rets.push(p / eq);
    eq += p;
    equity.push(eq);
  }
  const months = new Map<string, number>();
  days.forEach((d, i) => {
    const k = new Date(d * DAY).toISOString().slice(0, 7);
    months.set(k, (months.get(k) ?? 1) * (1 + rets[i]!));
  });
  const mr = [...months.values()].map((g) => g - 1);
  const dd = maxDrawdown(equity);
  // factor returns aligned by day from the engine's daily closes
  const fac = { gold: [] as number[], dxy: [] as number[], nas: [] as number[] };
  const aligned: number[] = [];
  if (engine) {
    const idx = (sym: "XAUUSD" | "DXY" | "NAS100") => {
      const m = new Map<number, number>();
      const d = engine.market.d1(sym);
      for (let i = 1; i < d.length; i++)
        m.set(Math.floor(d[i]!.t / DAY), Math.log(d[i]!.c / d[i - 1]!.c));
      return m;
    };
    const g = idx("XAUUSD");
    const x = idx("DXY");
    const n = idx("NAS100");
    days.forEach((d, i) => {
      if (g.has(d) && x.has(d) && n.has(d)) {
        fac.gold.push(g.get(d)!);
        fac.dxy.push(x.get(d)!);
        fac.nas.push(n.get(d)!);
        aligned.push(rets[i]!);
      }
    });
  }
  const fa = factorAlpha(
    aligned.length >= 10 ? aligned : rets,
    aligned.length >= 10 ? fac : { gold: [], dxy: [], nas: [] },
  );
  const half = Math.floor(pnl.length / 2);
  const ins = pnl.slice(0, half);
  const oos = pnl.slice(half);
  const exp = mean(ins);
  const sig = sd(ins);
  const realized = oos.reduce((a, b) => a + b, 0);
  const z =
    sig > 0 && oos.length ? (realized - exp * oos.length) / (sig * Math.sqrt(oos.length)) : 0;
  const sum = (k: keyof TradeRow) => trades.reduce((a, t) => a + Number(t[k] ?? 0), 0);
  return {
    periodStart: new Date(d0 * DAY).toISOString().slice(0, 10),
    periodEnd: new Date(d1 * DAY).toISOString().slice(0, 10),
    days: pnl.length,
    trades: trades.length,
    returnPct: (eq / starting - 1) * 100,
    volatilityPct: sd(rets) * Math.sqrt(252) * 100,
    pctPositiveMonths: mr.length ? mr.filter((r) => r > 0).length / mr.length : 0,
    bestMonthPct: mr.length ? Math.max(...mr) * 100 : 0,
    worstMonthPct: mr.length ? Math.min(...mr) * 100 : 0,
    skew: skewness(rets),
    kurtosis: kurtosis(rets),
    maxDdPct: dd.maxDd * 100,
    ddDurationDays: dd.troughIdx - dd.peakIdx,
    ddRecoveryDays: dd.recoveryIdx !== null ? dd.recoveryIdx - dd.troughIdx : null,
    var95Pct: historicalVaR(rets, 0.95) * 100,
    costSplit: {
      delay: sum("delay_cost"),
      execution: sum("execution_cost"),
      missed_fill: sum("missed_fill_cost"),
      spread: sum("spread_cost"),
      commission: sum("commission_cost"),
      slippage: sum("slippage_cost"),
      swap: sum("swap_cost"),
    },
    alpha: fa.alpha,
    alphaT: fa.alphaT,
    betas: fa.betas,
    z,
    dailyReturns: rets,
    realizedPnl: realized,
    expectedDailyPnl: exp,
    sigmaExpectedDaily: sig,
  };
}
