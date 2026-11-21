/**
 * Shared risk gateway: nine deterministic checks in fixed order. The first FAIL rejects; every
 * evaluated check (passes included) emits a GatewayEvent for the audit trail.
 */
import { D, ZERO, Decimal, minD, sumD } from "./money";
import { usdPerPoint } from "./markets";
import type {
  AgentCode,
  GatewayCheck,
  GatewayEvent,
  OrderRequest,
  Position,
  RejectCode,
  Sym,
} from "./types";

export interface RiskLimits {
  floorRatio: number;
  maxRiskPctEquity: number;
  cushionDivisorTrade: number;
  cushionDivisorOpen: number;
  dailyLossPct: number;
  weeklyLossPct: number;
  spreadMult: number;
  weekendCutoffMin: number;
}
/** The book's original limits (§7), kept for reference and comparison. */
export const BOOK_LIMITS: RiskLimits = {
  floorRatio: 0.92,
  maxRiskPctEquity: 0.015,
  cushionDivisorTrade: 8,
  cushionDivisorOpen: 3,
  dailyLossPct: 0.02,
  weeklyLossPct: 0.04,
  spreadMult: 2,
  weekendCutoffMin: 30,
};
/** Operator-tightened defaults: 6% floor, 1% per-trade cap, 1% daily / 2.5% weekly brakes. */
export const DEFAULT_LIMITS: RiskLimits = {
  floorRatio: 0.94,
  maxRiskPctEquity: 0.01,
  cushionDivisorTrade: 10,
  cushionDivisorOpen: 4,
  dailyLossPct: 0.01,
  weeklyLossPct: 0.025,
  spreadMult: 1.5,
  weekendCutoffMin: 60,
};

export interface AccountState {
  agent: AgentCode;
  starting: Decimal;
  equity: Decimal;
  hwm: Decimal;
  floor: Decimal;
  realized: Decimal;
  unrealized: Decimal;
  dayStartEquity: Decimal;
  weekStartEquity: Decimal;
  dayKey: number;
  weekKey: number;
  lockedUntil: number | null;
  lockCode: RejectCode | null;
}
export const cushion = (a: AccountState): Decimal => Decimal.max(a.equity.minus(a.floor), ZERO);

export function newAccount(
  agent: AgentCode,
  starting: Decimal.Value,
  limits: RiskLimits = DEFAULT_LIMITS,
): AccountState {
  const s = D(starting);
  return {
    agent,
    starting: s,
    equity: s,
    hwm: s,
    floor: s.times(limits.floorRatio),
    realized: ZERO,
    unrealized: ZERO,
    dayStartEquity: s,
    weekStartEquity: s,
    dayKey: -1,
    weekKey: -1,
    lockedUntil: null,
    lockCode: null,
  };
}

/** Mark equity; HWM and floor ratchet up only (TIPP form of CPPI). */
export function markAccount(a: AccountState, equity: Decimal, limits: RiskLimits): void {
  a.equity = equity;
  if (equity.gt(a.hwm)) a.hwm = equity;
  const f = a.hwm.times(limits.floorRatio);
  if (f.gt(a.floor)) a.floor = f;
}

/** Per-trade cap = min(request, maxRiskPct × equity, cushion / divisor). */
export function perTradeCap(a: AccountState, request: Decimal, limits: RiskLimits): Decimal {
  return minD(
    request,
    a.equity.times(limits.maxRiskPctEquity),
    cushion(a).div(limits.cushionDivisorTrade),
  );
}
/** Cushion factor used by agents to scale their requested risk down as the floor nears. */
export function cushionFactor(a: AccountState, limits: RiskLimits): number {
  const full = a.hwm.times(1 - limits.floorRatio);
  if (full.lte(0)) return 0;
  return Math.max(0, Math.min(1, cushion(a).div(full).toNumber()));
}

export function orderRisk(
  o: Pick<OrderRequest, "symbol" | "side" | "qty" | "limitPx" | "stopPx" | "decisionPx">,
): Decimal {
  if (o.stopPx === null) return ZERO;
  const entry = o.limitPx ?? o.decisionPx;
  return D(Math.abs(entry - o.stopPx))
    .times(o.qty)
    .times(usdPerPoint(o.symbol));
}

export interface GatewayContext {
  t: number;
  account: AccountState;
  openPositions: readonly Position[]; // this account
  pendingRisk: Decimal; // risk from basket legs evaluated earlier in the same submission
  seenClientIds: Set<string>;
  killArmed: boolean;
  whitelist: readonly Sym[];
  maxQty: number;
  spread: number;
  hourlyMedianSpread: number;
  blackout: { eventId: string; ownedByG2: boolean } | null;
  minutesToWeekendClose: number;
  mark: (sym: Sym) => number;
}
export interface GatewayResult {
  accepted: boolean;
  code: RejectCode | null;
  events: GatewayEvent[];
  risk: Decimal;
  cap: Decimal;
}

type Detail = GatewayEvent["detail"];
type CheckFn = () => { ok: true; detail: Detail } | { ok: false; code: RejectCode; detail: Detail };

export function evaluateOrder(
  o: OrderRequest,
  ctx: GatewayContext,
  limits: RiskLimits = DEFAULT_LIMITS,
): GatewayResult {
  const a = ctx.account;
  const risk = o.basketId ? o.requestedRisk : orderRisk(o);
  const cap = perTradeCap(a, o.requestedRisk, limits);
  const cush = cushion(a);
  const openRisk = sumD(ctx.openPositions.map((p) => p.riskAtStop)).plus(ctx.pendingRisk);
  const n = (d: Decimal) => Number(d.toFixed(2));
  const checks: [GatewayCheck, CheckFn][] = [
    [
      "DRAWDOWN_FLOOR",
      () =>
        a.equity.gt(a.floor)
          ? { ok: true, detail: { equity: n(a.equity), floor: n(a.floor), hwm: n(a.hwm) } }
          : {
              ok: false,
              code: "DRAWDOWN_FLOOR",
              detail: { equity: n(a.equity), floor: n(a.floor) },
            },
    ],
    [
      "PER_TRADE_CAP",
      () => {
        const detail = {
          risk: n(risk),
          cap: n(cap),
          request: n(o.requestedRisk),
          pctEquityCap: n(a.equity.times(limits.maxRiskPctEquity)),
          cushionCap: n(cush.div(limits.cushionDivisorTrade)),
        };
        return risk.lte(cap.times(1.0001))
          ? { ok: true, detail }
          : { ok: false, code: "PER_TRADE_CAP", detail };
      },
    ],
    [
      "TOTAL_OPEN_RISK",
      () => {
        const limit = cush.div(limits.cushionDivisorOpen);
        const detail = { openRisk: n(openRisk), newRisk: n(risk), limit: n(limit) };
        return openRisk.plus(risk).lte(limit.times(1.0001))
          ? { ok: true, detail }
          : { ok: false, code: "TOTAL_OPEN_RISK", detail };
      },
    ],
    [
      "LOSS_BRAKE",
      () => {
        const dayLoss = a.dayStartEquity.minus(a.equity).div(a.dayStartEquity).toNumber();
        const weekLoss = a.weekStartEquity.minus(a.equity).div(a.weekStartEquity).toNumber();
        const detail = {
          dayLossPct: +(dayLoss * 100).toFixed(3),
          weekLossPct: +(weekLoss * 100).toFixed(3),
          locked: a.lockedUntil !== null && ctx.t < a.lockedUntil,
        };
        if (a.lockedUntil !== null && ctx.t < a.lockedUntil)
          return { ok: false, code: a.lockCode ?? "DAILY_LOSS_BRAKE", detail };
        if (weekLoss >= limits.weeklyLossPct)
          return { ok: false, code: "WEEKLY_LOSS_BRAKE", detail };
        if (dayLoss >= limits.dailyLossPct) return { ok: false, code: "DAILY_LOSS_BRAKE", detail };
        return { ok: true, detail };
      },
    ],
    [
      "ORDER_HYGIENE",
      () => {
        const entry = o.limitPx ?? o.decisionPx;
        const stopOk =
          o.stopPx !== null &&
          Number.isFinite(o.stopPx) &&
          (o.side === "LONG" ? o.stopPx < entry : o.stopPx > entry);
        if (!stopOk) return { ok: false, code: "NO_STOP", detail: { stopPx: o.stopPx, entry } };
        if (!ctx.whitelist.includes(o.symbol))
          return { ok: false, code: "SYMBOL_NOT_WHITELISTED", detail: { symbol: o.symbol } };
        const same = ctx.openPositions.find(
          (p) => p.symbol === o.symbol && p.side === o.side && p.basketId === undefined,
        );
        if (same) {
          const m = ctx.mark(o.symbol);
          const losing = same.side === "LONG" ? m < same.entryPx : m > same.entryPx;
          return {
            ok: false,
            code: "AVERAGING_DOWN",
            detail: {
              existing: same.clientOrderId,
              losing,
              kind: losing ? "AVERAGING_INTO_LOSER" : "GRID_ADD",
            },
          };
        }
        if (o.qty.lte(0) || o.qty.gt(ctx.maxQty))
          return {
            ok: false,
            code: "SIZE_OVER_LIMIT",
            detail: { qty: o.qty.toNumber(), maxQty: ctx.maxQty },
          };
        return {
          ok: true,
          detail: { stopPx: o.stopPx, qty: o.qty.toNumber(), maxQty: ctx.maxQty },
        };
      },
    ],
    [
      "MARKET_CHECK",
      () => {
        const limit = ctx.hourlyMedianSpread * limits.spreadMult;
        if (ctx.spread > limit)
          return { ok: false, code: "SPREAD_WIDE", detail: { spread: ctx.spread, limit } };
        if (ctx.blackout && !(o.agent === "G2" && ctx.blackout.ownedByG2))
          return { ok: false, code: "NEWS_BLACKOUT", detail: { event: ctx.blackout.eventId } };
        if (ctx.minutesToWeekendClose <= limits.weekendCutoffMin)
          return {
            ok: false,
            code: "WEEKEND_CUTOFF",
            detail: { minutesToClose: ctx.minutesToWeekendClose },
          };
        return {
          ok: true,
          detail: {
            spread: ctx.spread,
            limit,
            minutesToClose: Math.round(ctx.minutesToWeekendClose),
          },
        };
      },
    ],
    [
      "EXECUTION",
      () => {
        if (ctx.seenClientIds.has(o.clientOrderId))
          return {
            ok: false,
            code: "DUPLICATE_CLIENT_ID",
            detail: { clientOrderId: o.clientOrderId },
          };
        return { ok: true, detail: { clientOrderId: o.clientOrderId, checkpoint: "atomic" } };
      },
    ],
    [
      "LOGGING",
      () => ({
        ok: true,
        detail: { decisionPx: o.decisionPx, arrivalMid: ctx.mark(o.symbol), spread: ctx.spread },
      }),
    ],
    [
      "KILL_SWITCH",
      () =>
        ctx.killArmed
          ? { ok: false, code: "KILL_ARMED", detail: { armed: true } }
          : { ok: true, detail: { armed: false } },
    ],
  ];
  const events: GatewayEvent[] = [];
  let seq = 0;
  for (const [check, fn] of checks) {
    const r = fn();
    seq++;
    events.push({
      clientOrderId: o.clientOrderId,
      agent: o.agent,
      seq,
      check,
      result: r.ok ? "PASS" : "FAIL",
      code: r.ok ? null : r.code,
      detail: r.detail,
      t: ctx.t,
    });
    if (!r.ok) return { accepted: false, code: r.code, events, risk, cap };
  }
  ctx.seenClientIds.add(o.clientOrderId);
  return { accepted: true, code: null, events, risk, cap };
}

/** Loss-brake sweep run every bar: returns the code if the account must be flattened and locked. */
export function lossBrakeBreach(a: AccountState, limits: RiskLimits): RejectCode | null {
  const dayLoss = a.dayStartEquity.minus(a.equity).div(a.dayStartEquity).toNumber();
  const weekLoss = a.weekStartEquity.minus(a.equity).div(a.weekStartEquity).toNumber();
  if (weekLoss >= limits.weeklyLossPct) return "WEEKLY_LOSS_BRAKE";
  if (dayLoss >= limits.dailyLossPct) return "DAILY_LOSS_BRAKE";
  return null;
}
