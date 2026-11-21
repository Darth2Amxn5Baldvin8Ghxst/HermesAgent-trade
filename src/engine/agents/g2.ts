/** G2 — Gold Macro-Release Drift (book §4). */
import { D } from "../money";
import { usdPerPoint } from "../markets";
import { cushionFactor, perTradeCap } from "../gateway";
import { G2_WINDOWS, type EventObservation, type MacroEvent, type MacroKind } from "../calendar";
import { bonferroniAlpha, median, ols, signTestTheta } from "../stats";
import {
  num,
  type Agent,
  type AgentEnv,
  type AgentIntent,
  type Diag,
  type ParamValues,
} from "./base";

export interface WindowFit {
  w: number;
  beta: number;
  t: number;
  p: number;
  theta: number;
  n: number;
  significant: boolean;
}
export interface ReleaseModel {
  kind: MacroKind;
  fits: WindowFit[];
  bestWindow: number | null; // strongest out-of-sample β among significant windows
  bestBeta: number;
  stopLog: number; // stopMult × median |60-min move| (log units)
  sdSurprise: number;
}

/** Standardised surprise; voided if consensus was not timestamped strictly before the release. */
export function surpriseZ(
  ev: Pick<MacroEvent, "actual" | "consensus" | "sdPast" | "consensusTs" | "t">,
): number | null {
  if (!(ev.consensusTs < ev.t)) return null;
  if (ev.sdPast <= 0) return null;
  return (ev.actual - ev.consensus) / ev.sdPast;
}

export function fitRelease(
  obs: readonly EventObservation[],
  kind: MacroKind,
  alpha = 0.05,
  stopMult = 1.5,
): ReleaseModel {
  const xs = obs.filter((o) => o.kind === kind);
  const split = Math.floor(xs.length * 0.7);
  const ins = xs.slice(0, split);
  const oos = xs.slice(split);
  const thr = bonferroniAlpha(alpha, G2_WINDOWS.length);
  const fits: WindowFit[] = G2_WINDOWS.map((w) => {
    const y = ins.map((o) => o.ret[w]);
    const s = ins.map((o) => o.s);
    if (y.length < 8) return { w, beta: 0, t: 0, p: 1, theta: 0, n: y.length, significant: false };
    const r = ols(y, [s]);
    const beta = r.beta[1] ?? 0;
    const nPos = ins.filter((o) => Math.sign(o.ret[w]) === Math.sign(beta * o.s)).length;
    return {
      w,
      beta,
      t: r.t[1] ?? 0,
      p: r.p[1] ?? 1,
      theta: signTestTheta(nPos, ins.length),
      n: ins.length,
      significant: (r.p[1] ?? 1) < thr,
    };
  });
  let bestWindow: number | null = null;
  let bestT = 0;
  let bestBeta = 0;
  for (const f of fits) {
    if (!f.significant || oos.length < 5) continue;
    const r = ols(
      oos.map((o) => o.ret[f.w as 5 | 15 | 30 | 60]),
      [oos.map((o) => o.s)],
    );
    const tt = (r.t[1] ?? 0) * Math.sign(f.beta);
    if (tt > bestT && f.w <= 60) {
      bestT = tt;
      bestWindow = f.w;
      bestBeta = f.beta;
    }
  }
  const sds = xs.map((o) => o.s);
  return {
    kind,
    fits,
    bestWindow,
    bestBeta,
    stopLog: stopMult * median(xs.map((o) => o.absMove60)),
    sdSurprise: sds.length ? Math.sqrt(sds.reduce((a, v) => a + v * v, 0) / sds.length) : 1,
  };
}

/** Entry gate at release + delay: returns null when tradable, otherwise the reason. */
export function g2EntryBlock(
  t: number,
  ev: MacroEvent,
  s: number | null,
  spread: number,
  medSpread: number,
  p: { entryDelayMin: number; minSurprise: number; spreadMult: number },
): string | null {
  if (s === null) return "VOID: consensus timestamp not before release";
  const target = ev.t + p.entryDelayMin * 60_000;
  if (t < target || t >= target + 60_000) return "not at release + delay";
  if (Math.abs(s) < p.minSurprise) return `|s| ${Math.abs(s).toFixed(2)} < ${p.minSurprise}`;
  if (spread > p.spreadMult * medSpread) return "spread above 2× hourly median";
  return null;
}

export class G2Agent implements Agent {
  readonly code = "G2" as const;
  private p: ParamValues;
  private models: Record<MacroKind, ReleaseModel> | null = null;
  private traded = new Set<string>();
  private last = "";
  constructor(params: ParamValues) {
    this.p = params;
  }
  model(env: Pick<AgentEnv, "eventHistory">): Record<MacroKind, ReleaseModel> {
    if (!this.models) {
      const a = num(this.p, "alpha", 0.05);
      const sm = num(this.p, "stopMult", 1.5);
      this.models = {
        CPI: fitRelease(env.eventHistory, "CPI", a, sm),
        NFP: fitRelease(env.eventHistory, "NFP", a, sm),
      };
    }
    return this.models;
  }
  onBar(env: AgentEnv): AgentIntent[] {
    const models = this.model(env);
    const delay = num(this.p, "entryDelayMin", 3);
    const ev = env.calendar.find(
      (e) => env.t >= e.t + delay * 60_000 && env.t < e.t + (delay + 1) * 60_000,
    );
    if (!ev || this.traded.has(ev.id)) return [];
    this.traded.add(ev.id);
    const m = models[ev.kind];
    const s = surpriseZ(ev);
    const block = g2EntryBlock(
      env.t,
      ev,
      s,
      env.market.spread("XAUUSD"),
      env.market.hourlyMedianSpread("XAUUSD"),
      {
        entryDelayMin: delay,
        minSurprise: num(this.p, "minSurprise", 1),
        spreadMult: num(this.p, "spreadMult", 2),
      },
    );
    if (block || s === null) {
      this.last = `${ev.id}: ${block}`;
      return [];
    }
    if (m.bestWindow === null) {
      this.last = `${ev.id}: no window significant after Bonferroni`;
      return [];
    }
    if (env.positions.length) {
      this.last = `${ev.id}: one position per event`;
      return [];
    }
    const dir = Math.sign(m.bestBeta * s);
    const mid = env.market.mid("XAUUSD");
    const stopDist = m.stopLog * mid;
    const side = dir > 0 ? "LONG" : "SHORT";
    const request = env.account.equity.times(
      num(this.p, "riskPct", 0.0025) * cushionFactor(env.account, env.limits) * env.budgetMult,
    );
    const risk = perTradeCap(env.account, request, env.limits);
    const qty = risk.div(D(stopDist).times(usdPerPoint("XAUUSD"))).toDecimalPlaces(2, 1);
    if (qty.lte(0)) return [];
    const exitMin = Math.min(m.bestWindow, num(this.p, "maxHoldMin", 60));
    this.last = `${ev.id}: s=${s.toFixed(2)} → ${side}, exit at +${exitMin}m`;
    return [
      {
        type: "SUBMIT",
        orders: [
          {
            clientOrderId: env.newClientId(),
            agent: "G2",
            symbol: "XAUUSD",
            side,
            type: "MARKET",
            qty,
            limitPx: null,
            stopPx: side === "LONG" ? mid - stopDist : mid + stopDist,
            targetPx: null,
            expiresAt: null,
            maxHoldMs: exitMin * 60_000,
            hardExitAt: env.t + exitMin * 60_000,
            decisionPx: mid,
            requestedRisk: D(stopDist).times(qty).times(usdPerPoint("XAUUSD")),
            tag: `${ev.kind} s=${s.toFixed(2)} w=${m.bestWindow}`,
          },
        ],
      },
    ];
  }
  diagnostics(): Diag {
    const m = this.models;
    return {
      cpiBestWindow: m?.CPI.bestWindow ?? null,
      cpiBeta: m ? +m.CPI.bestBeta.toFixed(5) : null,
      nfpBestWindow: m?.NFP.bestWindow ?? null,
      nfpBeta: m ? +m.NFP.bestBeta.toFixed(5) : null,
      eventsTraded: this.traded.size,
      last: this.last,
    };
  }
}
