/** G4 — Vol-Targeted Trend Sleeve (book §6). */
import { D, Decimal, ZERO } from "../money";
import { MARKETS, usdPerPoint } from "../markets";
import { ewmaVol } from "../stats";
import { logReturns, sma } from "../market";
import { cushion } from "../gateway";
import type { Sym } from "../types";
import {
  num,
  type Agent,
  type AgentEnv,
  type AgentIntent,
  type Diag,
  type ParamValues,
} from "./base";

/** Mean of sign(close − MA_n) over the three horizons ∈ {−1, −1/3, 1/3, 1}. */
export function trendSignal(closes: readonly number[], horizons: readonly number[]): number | null {
  const last = closes[closes.length - 1];
  if (last === undefined) return null;
  let s = 0;
  for (const n of horizons) {
    const m = sma(closes, n);
    if (m === null) return null;
    s += last > m ? 1 : -1;
  }
  return s / horizons.length;
}
/** Kissell band: trade only when |target − current| > band × |current| (or opening from flat). */
export function outsideBand(current: number, target: number, band: number): boolean {
  if (current === 0) return target !== 0;
  if (Math.sign(current) !== Math.sign(target)) return true;
  return Math.abs(target - current) > band * Math.abs(current);
}

export class G4Agent implements Agent {
  readonly code = "G4" as const;
  private p: ParamValues;
  private signals: Partial<Record<Sym, number>> = {};
  private targets: Partial<Record<Sym, number>> = {};
  private prevClose: Partial<Record<Sym, number>> = {};
  private last = "";
  constructor(params: ParamValues) {
    this.p = params;
  }
  universe(): Sym[] {
    const u = this.p.universe;
    return Array.isArray(u) && u.every((x) => typeof x === "string")
      ? (u as Sym[])
      : ["XAUUSD", "NAS100", "GBPJPY", "BTCUSD", "EURUSD"];
  }
  onBar(env: AgentEnv, closed: { d1: Set<string> }): AgentIntent[] {
    const out: AgentIntent[] = [];
    const uni = this.universe();
    const horizons = [num(this.p, "ma1", 20), num(this.p, "ma2", 50), num(this.p, "ma3", 180)];
    const N = uni.length;
    const annualBudget = num(this.p, "targetVol", 0.06) / Math.sqrt(N); // equal-vol, zero-correlation forecast
    const orders = [];
    const openRiskBudget = cushion(env.account).div(env.limits.cushionDivisorOpen).times(0.9);
    let plannedRisk = ZERO;
    for (const sym of uni) {
      if (!closed.d1.has(sym)) continue;
      const closes = env.market.d1(sym).map((d) => d.c);
      const sig = trendSignal(closes, horizons);
      if (sig === null) continue;
      this.signals[sym] = sig;
      // forecast excludes today's return, so today's loss is judged against yesterday's forecast
      const volD = ewmaVol(logReturns(closes.slice(-121, -1)), 0.94);
      if (volD <= 0) continue;
      const px = env.market.mid(sym);
      const pos = env.positions.find((p) => p.symbol === sym);
      const current = pos ? (pos.side === "LONG" ? 1 : -1) * pos.qty.toNumber() : 0;
      // daily loss beyond lossHalveMult × forecast daily vol halves that position
      const pc = this.prevClose[sym];
      this.prevClose[sym] = closes[closes.length - 1] ?? px;
      if (pos && pc !== undefined) {
        const move = (px - pc) * (pos.side === "LONG" ? 1 : -1);
        if (move < -num(this.p, "lossHalveMult", 3) * volD * pc) {
          out.push({ type: "CLOSE", positionId: pos.id, reason: "STOP", fraction: 0.5 });
          this.last = `${sym}: daily loss > ${num(this.p, "lossHalveMult", 3)}σ → halved`;
          continue;
        }
      }
      const dailyBudgetUsd = env.account.equity.times(
        (annualBudget / Math.sqrt(252)) * env.budgetMult,
      );
      const notional = dailyBudgetUsd.times(sig).div(volD);
      const target = notional.div(D(px).times(usdPerPoint(sym))).toNumber();
      this.targets[sym] = target;
      if (!outsideBand(current, target, num(this.p, "band", 0.25))) continue;
      if (pos) out.push({ type: "CLOSE", positionId: pos.id, reason: "SIGNAL" });
      const side = target > 0 ? "LONG" : "SHORT";
      const stopDist = 4 * volD * px; // protective stop; the halving rule acts first on daily closes
      let qty: Decimal = D(Math.abs(target));
      let risk = qty.times(stopDist).times(usdPerPoint(sym));
      const room = openRiskBudget
        .minus(plannedRisk)
        .minus(pos ? ZERO : env.positions.reduce((a, p) => a.plus(p.riskAtStop), ZERO));
      if (risk.gt(room)) {
        if (room.lte(0)) continue;
        qty = qty.times(room.div(risk));
        risk = room;
      }
      const dp = MARKETS[sym].digits >= 3 ? 0 : 2;
      qty = qty.toDecimalPlaces(dp, 1);
      if (qty.lte(0)) continue;
      plannedRisk = plannedRisk.plus(risk);
      orders.push({
        clientOrderId: env.newClientId(),
        agent: "G4" as const,
        symbol: sym,
        side: side as "LONG" | "SHORT",
        type: "MARKET" as const,
        qty,
        limitPx: null,
        stopPx: side === "LONG" ? px - stopDist : px + stopDist,
        targetPx: null,
        expiresAt: null,
        maxHoldMs: null,
        hardExitAt: null,
        decisionPx: px,
        requestedRisk: qty.times(stopDist).times(usdPerPoint(sym)),
        tag: `signal ${sig > 0 ? "+" : ""}${sig.toFixed(2)} σd=${(volD * 100).toFixed(2)}%`,
      });
      this.last = `${sym}: rebalance ${current.toFixed(2)} → ${target.toFixed(2)}`;
    }
    for (const o of orders) out.push({ type: "SUBMIT", orders: [o] });
    return out;
  }
  diagnostics(): Diag {
    const d: Diag = { last: this.last };
    for (const s of this.universe()) {
      d[`sig_${s}`] = this.signals[s] !== undefined ? +this.signals[s]!.toFixed(3) : null;
    }
    return d;
  }
}
