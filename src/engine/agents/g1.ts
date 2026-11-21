/** G1 — Gold Session-Liquidity Reversion (book §3). */
import { D } from "../money";
import { MARKETS, usdPerPoint } from "../markets";
import { atr, ewmaSigma, lastSwing, logReturns, sma } from "../market";
import { varianceRatio } from "../stats";
import { cushionFactor, perTradeCap } from "../gateway";
import { isTier1Blackout } from "../calendar";
import type { Bar, Trade } from "../types";
import {
  num,
  type Agent,
  type AgentEnv,
  type AgentIntent,
  type Diag,
  type ParamValues,
} from "./base";

const H = 3_600_000;
const DAY = 86_400_000;
export interface Zone {
  lo: number;
  hi: number;
  sources: string[];
}
/** Merge levels within `tol` into zones (sorted ascending). */
export function mergeLevels(levels: { px: number; src: string }[], tol: number): Zone[] {
  const xs = [...levels].sort((a, b) => a.px - b.px);
  const zones: Zone[] = [];
  for (const l of xs) {
    const z = zones[zones.length - 1];
    if (z && l.px - z.hi <= tol) {
      z.hi = Math.max(z.hi, l.px);
      z.sources.push(l.src);
    } else zones.push({ lo: l.px, hi: l.px, sources: [l.src] });
  }
  return zones;
}
/** Entry window: 07:00–16:00 GMT, excluding 13:30–14:00 (US cash open settle). */
export function inG1EntryWindow(t: number): boolean {
  const d = new Date(t);
  const m = d.getUTCHours() * 60 + d.getUTCMinutes();
  if (m < 7 * 60 || m >= 16 * 60) return false;
  if (m >= 13 * 60 + 30 && m < 14 * 60) return false;
  return true;
}
/** Cost gate: target distance ≥ multiple × round-trip cost (spread + 2×commission + expected slippage). */
export function passesCostGate(
  targetDist: number,
  spread: number,
  commissionPerUnit: number,
  slippage: number,
  multiple: number,
): { ok: boolean; roundTrip: number } {
  const roundTrip = spread + 2 * commissionPerUnit + slippage;
  return { ok: targetDist >= multiple * roundTrip, roundTrip };
}
/** Hard exit: min(fill + hold, 16:00 GMT same day). hold = 0 → session end only. */
export function g1HardExit(t: number, holdH: number): number {
  const d = new Date(t);
  const sessionEnd = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 16, 0);
  return holdH > 0 ? Math.min(t + holdH * H, sessionEnd) : sessionEnd;
}

export class G1Agent implements Agent {
  readonly code = "G1" as const;
  private p: ParamValues;
  private vr = 1;
  private vrZ = 0;
  private slopeRatio = 0;
  private gate = false;
  private zones: Zone[] = [];
  private atrH1 = 0;
  private sigmaPx = 0;
  private stopsToday = 0;
  private sessionDay = -1;
  private lastBlock = "";
  constructor(params: ParamValues) {
    this.p = params;
  }
  onTrade(tr: Trade): void {
    if (tr.exitReason === "STOP" && Math.floor(tr.closedAt / DAY) === this.sessionDay)
      this.stopsToday++;
  }
  private recompute(env: AgentEnv): void {
    const m15 = env.market.m15("XAUUSD");
    const h1 = env.market.h1("XAUUSD");
    const q = num(this.p, "q", 4);
    const sessions = num(this.p, "vrSessions", 10);
    const r = logReturns(m15.slice(-Math.round(sessions * 92)).map((b) => b.c));
    const v = varianceRatio(r, q);
    this.vr = v.vr;
    this.vrZ = v.z;
    const closes = h1.map((b) => b.c);
    const ma = sma(closes, 50);
    const maPrev = sma(closes.slice(0, -1), 50);
    const last = closes[closes.length - 1] ?? 0;
    const sig = ewmaSigma(h1.slice(-120));
    this.sigmaPx = sig * last;
    this.slopeRatio =
      ma !== null && maPrev !== null && this.sigmaPx > 0 ? (ma - maPrev) / this.sigmaPx : 0;
    this.gate =
      r.length > q * 10 && this.vr < 1 && Math.abs(this.slopeRatio) < num(this.p, "slopeMax", 0.5);
    this.atrH1 = atr(h1, 14);
    this.zones = this.buildZones(env, h1);
  }
  private buildZones(env: AgentEnv, h1: readonly Bar[]): Zone[] {
    const t = env.t;
    const today = Math.floor(t / DAY) * DAY;
    const prev = h1.filter((b) => b.t >= today - DAY && b.t < today);
    const asian = h1.filter((b) => b.t >= today && b.t < today + 6 * H);
    const levels: { px: number; src: string }[] = [];
    if (prev.length) {
      levels.push(
        { px: Math.max(...prev.map((b) => b.h)), src: "PDH" },
        { px: Math.min(...prev.map((b) => b.l)), src: "PDL" },
      );
    }
    if (asian.length >= 5 && t >= today + 6 * H) {
      levels.push(
        { px: Math.max(...asian.map((b) => b.h)), src: "ASH" },
        { px: Math.min(...asian.map((b) => b.l)), src: "ASL" },
      );
    }
    const sw = lastSwing(h1.slice(-60));
    if (sw.high !== null) levels.push({ px: sw.high, src: "SWH" });
    if (sw.low !== null) levels.push({ px: sw.low, src: "SWL" });
    return mergeLevels(levels, num(this.p, "zoneMergeAtr", 0.25) * this.atrH1);
  }
  onBar(env: AgentEnv, closed: { m15: Set<string>; h1: Set<string> }): AgentIntent[] {
    const t = env.t;
    const day = Math.floor(t / DAY);
    if (day !== this.sessionDay) {
      this.sessionDay = day;
      this.stopsToday = 0;
    }
    if (closed.h1.has("XAUUSD") || closed.m15.has("XAUUSD") || this.zones.length === 0)
      this.recompute(env);
    const block = this.blockReason(env);
    this.lastBlock = block ?? "";
    if (block) return [];
    const mid = env.market.mid("XAUUSD");
    const spread = env.market.spread("XAUUSD");
    const k = num(this.p, "k", 1);
    const ratio = num(this.p, "targetRatio", 0.8);
    const offset = num(this.p, "entryOffsetAtr", 0.1) * this.atrH1;
    const today = env.market.h1("XAUUSD").filter((b) => b.t >= Math.floor(t / DAY) * DAY);
    const sessHi = Math.max(...today.map((b) => b.h), mid);
    const sessLo = Math.min(...today.map((b) => b.l), mid);
    const sessionMid = (sessHi + sessLo) / 2;
    for (const z of this.zones) {
      const support = mid > z.hi && mid - z.hi < this.atrH1;
      const resistance = mid < z.lo && z.lo - mid < this.atrH1;
      if (!support && !resistance) continue;
      const side = support ? "LONG" : "SHORT";
      const limitPx = support ? z.hi + offset : z.lo - offset;
      if (support ? limitPx >= mid : limitPx <= mid) continue;
      const stopPx = support ? z.lo - k * this.sigmaPx : z.hi + k * this.sigmaPx;
      const stopDist = Math.abs(limitPx - stopPx);
      if (stopDist <= 0) continue;
      let targetDist = ratio * stopDist;
      const toMid = support ? sessionMid - limitPx : limitPx - sessionMid;
      if (toMid <= 0) continue; // session midpoint already behind entry: no reversion left
      targetDist = Math.min(targetDist, toMid);
      const spec = MARKETS.XAUUSD;
      const medSpread = env.market.hourlyMedianSpread("XAUUSD");
      const gate = passesCostGate(
        targetDist,
        medSpread,
        spec.commissionPerUnit,
        medSpread * spec.slippageFrac,
        num(this.p, "costMultiple", 4),
      );
      if (!gate.ok) {
        this.lastBlock = `cost gate: target ${targetDist.toFixed(2)} < ${num(this.p, "costMultiple", 4)}× ${gate.roundTrip.toFixed(2)}`;
        continue;
      }
      const targetPx = support ? limitPx + targetDist : limitPx - targetDist;
      const request = env.account.equity.times(
        num(this.p, "riskPct", 0.0025) * cushionFactor(env.account, env.limits) * env.budgetMult,
      );
      const risk = perTradeCap(env.account, request, env.limits);
      const qty = risk.div(D(stopDist).times(usdPerPoint("XAUUSD"))).toDecimalPlaces(2, 1);
      if (qty.lte(0)) return [];
      const lifeMin = num(this.p, "orderLifeMin", 60);
      return [
        {
          type: "SUBMIT",
          orders: [
            {
              clientOrderId: env.newClientId(),
              agent: "G1",
              symbol: "XAUUSD",
              side,
              type: "LIMIT",
              qty,
              limitPx,
              stopPx,
              targetPx,
              expiresAt: t + lifeMin * 60_000,
              maxHoldMs: num(this.p, "timeStopH", 6) > 0 ? num(this.p, "timeStopH", 6) * H : null,
              hardExitAt: g1HardExit(t, 0), // 16:00 GMT; the 6h clock starts at fill via maxHoldMs
              decisionPx: mid,
              requestedRisk: D(stopDist).times(qty).times(usdPerPoint("XAUUSD")),
              tag: `${z.sources.join("+")} ${side === "LONG" ? "support" : "resistance"}`,
            },
          ],
        },
      ];
    }
    void spread;
    return [];
  }
  private blockReason(env: AgentEnv): string | null {
    if (env.positions.length || env.working.length) return "position or order working";
    if (!this.gate)
      return `regime gate closed (VR=${this.vr.toFixed(3)}, slope/σ=${this.slopeRatio.toFixed(2)})`;
    if (!inG1EntryWindow(env.t)) return "outside 07:00–16:00 GMT entry window";
    if (isTier1Blackout(env.t, env.calendar)) return "tier-1 release window (G2 owns it)";
    if (this.stopsToday >= num(this.p, "maxStopsPerSession", 3))
      return "session brake: 3 stop-outs";
    if (
      env.market.spread("XAUUSD") >
      num(this.p, "spreadMult", 2) * env.market.hourlyMedianSpread("XAUUSD")
    )
      return "spread above 2× hourly median";
    if (this.atrH1 <= 0 || this.sigmaPx <= 0) return "warming up";
    return null;
  }
  /** Current liquidity zones G1 is watching (read-only, for the planned-trades view). */
  get watchZones(): readonly Zone[] {
    return this.zones;
  }
  diagnostics(): Diag {
    return {
      vr: +this.vr.toFixed(4),
      vrZ: +this.vrZ.toFixed(2),
      slopeRatio: +this.slopeRatio.toFixed(3),
      gate: this.gate,
      zones: this.zones.length,
      atrH1: +this.atrH1.toFixed(2),
      sigmaH1Px: +this.sigmaPx.toFixed(2),
      stopsToday: this.stopsToday,
      blocked: this.lastBlock,
    };
  }
}
