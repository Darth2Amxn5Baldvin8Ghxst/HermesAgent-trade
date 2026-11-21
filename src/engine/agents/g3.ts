/** G3 — Gold/Silver Spread Reversion (book §5), with the book's fallback pairs. */
import { D, Decimal } from "../money";
import { usdPerPoint } from "../markets";
import { cushionFactor, perTradeCap } from "../gateway";
import { engleGranger, mean, ols, sd, adfStat, DF_CRIT_5 } from "../stats";
import type { Sym } from "../types";
import {
  num,
  type Agent,
  type AgentEnv,
  type AgentIntent,
  type Diag,
  type ParamValues,
} from "./base";

const DAY = 86_400_000;
export type Pair = { y: Sym; x: Sym | null; label: string };
/** Book order: XAU/XAG, then NAS100 vs US500, then AUDNZD. Never XAUUSD vs XAUEUR. */
export const G3_PAIRS: Pair[] = [
  { y: "XAUUSD", x: "XAGUSD", label: "XAUUSD/XAGUSD" },
  { y: "NAS100", x: "US500", label: "NAS100/US500" },
  { y: "AUDNZD", x: null, label: "AUDNZD" },
];

export interface G3Gate {
  pair: Pair;
  passed: boolean;
  hedge: number;
  intercept: number;
  adfResidual: number;
  adfY: number;
  adfX: number;
  dxyR2: number;
  reason: string;
}
/** Weekly gate: unit roots in both legs, cointegrated residual (EG 5%), and residual not a disguised dollar bet. */
export function g3Gate(
  pair: Pair,
  lnY: number[],
  lnX: number[] | null,
  lnDxy: number[],
  r2Max = 0.25,
): G3Gate {
  let hedge = 0;
  let intercept = 0;
  let resid: number[];
  let adfResidual: number;
  let adfY = adfStat(lnY);
  let adfX = 0;
  let coint: boolean;
  if (lnX) {
    const eg = engleGranger(lnY, lnX);
    hedge = eg.hedgeRatio;
    intercept = eg.intercept;
    resid = eg.residuals;
    adfResidual = eg.adfResidual;
    adfY = eg.adfY;
    adfX = eg.adfX;
    coint = eg.cointegrated;
  } else {
    resid = lnY.map((v) => v - mean(lnY));
    adfResidual = adfStat(lnY);
    coint = adfResidual < DF_CRIT_5;
  }
  const dr = resid.slice(1).map((v, i) => v - resid[i]!);
  const dx = lnDxy.slice(-resid.length);
  const dd = dx.slice(1).map((v, i) => v - dx[i]!);
  const n = Math.min(dr.length, dd.length);
  // fail closed: without enough dollar-index data the hidden-direction check cannot pass
  const dxyR2 = n > 10 ? ols(dr.slice(-n), [dd.slice(-n)]).r2 : 1;
  const passed = coint && dxyR2 <= r2Max;
  const reason =
    dxyR2 > r2Max
      ? `disguised dollar bet (R²=${dxyR2.toFixed(2)})`
      : !coint
        ? lnX && !(adfY > DF_CRIT_5 && adfX > DF_CRIT_5)
          ? "leg without unit root"
          : "not cointegrated at 5%"
        : dxyR2 > r2Max
          ? `disguised dollar bet (R²=${dxyR2.toFixed(2)})`
          : "cointegrated";
  return { pair, passed, hedge, intercept, adfResidual, adfY, adfX, dxyR2, reason };
}

export class G3Agent implements Agent {
  readonly code = "G3" as const;
  private p: ParamValues;
  private gate: G3Gate | null = null;
  private lastGateDay = -99;
  private z = 0;
  private openedAt: number | null = null;
  private activePair: string | null = null;
  private entrySign = 0;
  private legCount = 0;
  private last = "";
  constructor(params: ParamValues) {
    this.p = params;
  }
  private runGate(env: AgentEnv): void {
    const L = num(this.p, "lookbackDays", 500);
    const ln = (s: Sym) =>
      env.market
        .d1(s)
        .slice(-L)
        .map((d) => Math.log(d.c));
    const dxy = ln("DXY");
    for (const pair of G3_PAIRS) {
      const g = g3Gate(
        pair,
        ln(pair.y),
        pair.x ? ln(pair.x) : null,
        dxy,
        num(this.p, "dxyR2Max", 0.25),
      );
      this.gate = g;
      if (g.passed) return;
    }
  }
  private residual(env: AgentEnv, y: number, x: number | null): number {
    const g = this.gate!;
    return x === null ? Math.log(y) : Math.log(y) - g.intercept - g.hedge * Math.log(x);
  }
  onBar(env: AgentEnv, closed: { h1: Set<string>; d1: Set<string> }): AgentIntent[] {
    const day = Math.floor(env.t / DAY);
    const gateDue = this.gate === null || (closed.d1.size > 0 && day - this.lastGateDay >= 7);
    const out: AgentIntent[] = [];
    // a basket leg was stopped out alone: close the survivor so no leg is left unhedged
    if (this.legCount > 1 && env.positions.length > 0 && env.positions.length < this.legCount) {
      for (const p of env.positions) out.push({ type: "CLOSE", positionId: p.id, reason: "STOP" });
      this.resetBasket();
      this.last = "partner leg stopped → basket closed";
      return out;
    }
    if (env.positions.length === 0 && this.openedAt !== null) this.resetBasket();
    if (gateDue) {
      this.runGate(env);
      this.lastGateDay = day;
      const switched =
        env.positions.length > 0 && this.activePair !== null && this.gate?.pair.label !== this.activePair;
      if ((!this.gate?.passed || switched) && env.positions.length) {
        for (const p of env.positions)
          out.push({ type: "CLOSE", positionId: p.id, reason: "REGIME" });
        this.resetBasket();
        this.last = switched ? "active pair no longer selected → basket closed" : "gate failed → closed and stood down";
        return out;
      }
    }
    const g = this.gate;
    if (!g?.passed) {
      this.last = `gate closed: ${g?.reason ?? "warming up"}`;
      return out;
    }
    const pair = g.pair;
    if (!closed.h1.has(pair.y)) return out;
    const win = num(this.p, "zWindowDays", 20);
    const dY = env.market.d1(pair.y).slice(-win);
    const dX = pair.x ? env.market.d1(pair.x).slice(-win) : null;
    const resid = dY.map((d, i) => this.residual(env, d.c, dX ? (dX[i]?.c ?? d.c) : null));
    const mu = mean(resid);
    const s = sd(resid);
    if (s <= 0) return out;
    const y = env.market.mid(pair.y);
    const x = pair.x ? env.market.mid(pair.x) : null;
    this.z = (this.residual(env, y, x) - mu) / s;
    const az = Math.abs(this.z);
    if (env.positions.length) {
      const held = this.openedAt !== null ? (env.t - this.openedAt) / DAY : 0;
      // signed exit: a jump through the band counts as reaching it
      const zEx = num(this.p, "zExit", 0.5);
      const reachedExit = this.entrySign > 0 ? this.z <= zEx : this.entrySign < 0 ? this.z >= -zEx : az <= zEx;
      const reason =
        reachedExit
          ? "TARGET"
          : az >= num(this.p, "zStop", 3.5)
            ? "STOP"
            : held >= (num(this.p, "timeStopDays", 5) * 7) / 5
              ? "TIME"
              : null;
      if (reason) {
        for (const p of env.positions) out.push({ type: "CLOSE", positionId: p.id, reason });
        this.resetBasket();
        this.last = `exit ${reason} at z=${this.z.toFixed(2)}`;
      }
      return out;
    }
    if (az < num(this.p, "zEntry", 2)) return out;
    // risk at z = zStop: residual moves (zStop − |z|)·σ in log units against the basket
    const delta = (num(this.p, "zStop", 3.5) - az) * s;
    if (delta <= 0) return out;
    const request = env.account.equity.times(
      num(this.p, "riskPct", 0.005) * cushionFactor(env.account, env.limits) * env.budgetMult,
    );
    const risk = perTradeCap(env.account, request, env.limits);
    // protective per-leg stops sit at STOP_MULT × the z-stop move; size so the sum of real
    // stop-to-entry losses across legs equals the gateway-approved risk
    const STOP_MULT = 1.5;
    const nLegs = pair.x ? 2 : 1;
    const notionalY = risk.div(delta * STOP_MULT * nLegs);
    const yRich = this.z > 0;
    const basketId = env.newClientId();
    const hedge = Math.abs(g.hedge) || 1;
    const shareY = pair.x ? 1 / (1 + hedge) : 1;
    const legs = [];
    const mkLeg = (
      sym: Sym,
      side: "LONG" | "SHORT",
      px: number,
      notional: Decimal,
      share: number,
      stopFrac: number,
    ) => {
      const qty = notional
        .div(D(px).times(usdPerPoint(sym)))
        .toDecimalPlaces(sym === "XAUUSD" || sym === "NAS100" || sym === "US500" ? 2 : 0, 1);
      return {
        clientOrderId: env.newClientId(),
        agent: "G3" as const,
        symbol: sym,
        side,
        type: "MARKET" as const,
        qty,
        limitPx: null,
        stopPx: side === "LONG" ? px * (1 - stopFrac) : px * (1 + stopFrac),
        targetPx: null,
        expiresAt: null,
        maxHoldMs: null,
        hardExitAt: null,
        decisionPx: px,
        requestedRisk: qty.times(px).times(usdPerPoint(sym)).times(stopFrac),
        basketId,
        tag: `${pair.label} z=${this.z.toFixed(2)} b=${hedge.toFixed(3)}`,
      };
    };
    // catastrophic per-leg stops at 3× the z-stop distance; the basket exits on z rules
    legs.push(mkLeg(pair.y, yRich ? "SHORT" : "LONG", y, notionalY, shareY, STOP_MULT * delta));
    if (pair.x && x !== null)
      legs.push(
        mkLeg(
          pair.x,
          yRich ? "LONG" : "SHORT",
          x,
          notionalY.times(hedge),
          1 - shareY,
          (STOP_MULT * delta) / hedge,
        ),
      );
    if (legs.some((l) => l.qty.lte(0))) return out;
    this.openedAt = env.t;
    this.activePair = pair.label;
    this.entrySign = yRich ? 1 : -1;
    this.legCount = legs.length;
    this.last = `entry z=${this.z.toFixed(2)}: ${yRich ? "sell" : "buy"} ${pair.y}${pair.x ? `, ${yRich ? "buy" : "sell"} ${pair.x}` : ""}`;
    out.push({ type: "SUBMIT", orders: legs });
    return out;
  }
  private resetBasket(): void {
    this.openedAt = null;
    this.activePair = null;
    this.entrySign = 0;
    this.legCount = 0;
  }
  onTrade(): void {
    /* basket exits are driven by z, not individual leg fills */
  }
  diagnostics(): Diag {
    const g = this.gate;
    return {
      pair: g?.pair.label ?? null,
      gate: g?.passed ?? false,
      gateReason: g?.reason ?? "warming up",
      hedge: g ? +g.hedge.toFixed(4) : null,
      adfResidual: g ? +g.adfResidual.toFixed(3) : null,
      dxyR2: g ? +g.dxyR2.toFixed(3) : null,
      z: +this.z.toFixed(3),
      last: this.last,
    };
  }
}
