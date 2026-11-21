/**
 * HermesEngine — one deterministic module for the live simulator, backtests and validation runs.
 * Given (feed seed, params, limits) every run produces identical output.
 */
import { D, Decimal, ZERO, sumD } from "./money";
import { MARKETS, usdPerPoint } from "./markets";
import { SyntheticFeed, type FeedOptions } from "./feed";
import { MarketState } from "./market";
import { buildEventHistory, isTier1Blackout, type EventObservation } from "./calendar";
import {
  DEFAULT_LIMITS,
  evaluateOrder,
  lossBrakeBreach,
  markAccount,
  newAccount,
  type AccountState,
  type GatewayResult,
  type RiskLimits,
} from "./gateway";
import { G1Agent } from "./agents/g1";
import { G2Agent } from "./agents/g2";
import { G3Agent } from "./agents/g3";
import { G4Agent } from "./agents/g4";
import type { Agent, AgentIntent, ParamValues } from "./agents/base";
import type {
  AgentCode,
  EngineEvent,
  ExitReason,
  GatewayEvent,
  Order,
  OrderRequest,
  Position,
  Sym,
  Tick,
  Trade,
} from "./types";
import { AGENT_CODES } from "./types";

const MIN = 60_000;
const DAY = 86_400_000;

export const WHITELIST: Record<AgentCode, Sym[]> = {
  G1: ["XAUUSD"],
  G2: ["XAUUSD"],
  G3: ["XAUUSD", "XAGUSD", "NAS100", "US500", "AUDNZD"],
  G4: ["XAUUSD", "NAS100", "GBPJPY", "BTCUSD", "EURUSD", "XAGUSD", "US500"],
};
export const GOLD_AGENTS: AgentCode[] = ["G1", "G2", "G4"];

export interface EngineConfig {
  feed: FeedOptions;
  params: Record<AgentCode, ParamValues>;
  budgets: Record<AgentCode, number>; // fraction of total risk budget
  probation: Partial<Record<AgentCode, boolean>>;
  enabled: Record<AgentCode, boolean>;
  startingEquity: Record<AgentCode, Decimal.Value>;
  limits?: RiskLimits;
  tailInjection?: { every: number; mult: number } | null; // validation: 10× gap loss once every 300 trades
}
export interface EquityPoint {
  t: number;
  equity: number;
  hwm: number;
  floor: number;
  openRisk: number;
  goldExposure: number;
  byAgent: Record<AgentCode, number>;
}
export interface StepOutput {
  orders: Order[];
  gateway: GatewayEvent[];
  trades: Trade[];
  events: EngineEvent[];
}

function weekKey(t: number): number {
  return Math.floor((t + 4 * DAY - 22 * 3_600_000) / (7 * DAY)); // weeks roll Sunday 22:00 GMT
}
function dayKey(t: number): number {
  return Math.floor((t - 22 * 3_600_000) / DAY);
}
function minutesToWeekendClose(t: number): number {
  const d = new Date(t);
  const dow = d.getUTCDay();
  const daysToFri = (5 - dow + 7) % 7;
  const close = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + daysToFri, 21, 0);
  const m = (close - t) / MIN;
  return m < 0 ? m + 7 * 1440 : m;
}

export class HermesEngine {
  readonly feed: SyntheticFeed;
  readonly market: MarketState;
  readonly eventHistory: EventObservation[];
  readonly accounts: Record<AgentCode, AccountState>;
  readonly agents: Record<AgentCode, Agent>;
  readonly positions: Position[] = [];
  readonly working: Order[] = [];
  readonly orders = new Map<string, Order>();
  readonly trades: Trade[] = [];
  readonly equityCurve: EquityPoint[] = [];
  killArmed = false;
  private cfg: EngineConfig;
  private limits: RiskLimits;
  private seen = new Set<string>();
  private idCounter = 0;
  private out: StepOutput = { orders: [], gateway: [], trades: [], events: [] };
  private tradeCount = 0;
  bars = 0;

  constructor(cfg: EngineConfig) {
    this.cfg = cfg;
    this.limits = cfg.limits ?? DEFAULT_LIMITS;
    this.feed = new SyntheticFeed(cfg.feed);
    this.market = new MarketState(this.feed.daily);
    this.eventHistory = buildEventHistory(cfg.feed.seed, cfg.feed.startMs);
    this.accounts = {} as Record<AgentCode, AccountState>;
    for (const c of AGENT_CODES)
      this.accounts[c] = newAccount(c, cfg.startingEquity[c], this.limits);
    this.agents = {
      G1: new G1Agent(cfg.params.G1),
      G2: new G2Agent(cfg.params.G2),
      G3: new G3Agent(cfg.params.G3),
      G4: new G4Agent(cfg.params.G4),
    };
  }

  get now(): number {
    return this.market.t || this.feed.now;
  }
  setLimits(l: RiskLimits): void {
    this.limits = l;
  }
  setBudgets(b: Record<AgentCode, number>, probation: Partial<Record<AgentCode, boolean>>): void {
    this.cfg.budgets = b;
    this.cfg.probation = probation;
  }
  /** Re-instantiate one agent with new parameters (Agents → Parameters edits). */
  updateParams(c: AgentCode, params: ParamValues): void {
    this.cfg.params[c] = params;
    const ctor = { G1: G1Agent, G2: G2Agent, G3: G3Agent, G4: G4Agent }[c];
    this.agents[c] = new ctor(params);
  }
  restoreAccount(c: AgentCode, hwm: Decimal.Value, floor: Decimal.Value): void {
    const a = this.accounts[c];
    const h = D(hwm);
    const f = D(floor);
    if (h.gt(a.hwm)) a.hwm = h;
    if (f.gt(a.floor)) a.floor = f;
  }
  setEnabled(e: Record<AgentCode, boolean>): void {
    this.cfg.enabled = e;
  }
  private budgetMult(c: AgentCode): number {
    const base = (this.cfg.budgets[c] ?? 0.25) * AGENT_CODES.length;
    return base * (this.cfg.probation[c] ? 0.25 : 1);
  }
  private nextId(prefix: string): string {
    this.idCounter++;
    return `${prefix}-${this.cfg.feed.seed.toString(36)}-${this.idCounter.toString(36).padStart(6, "0")}`;
  }
  private emit(e: EngineEvent): void {
    this.out.events.push(e);
  }

  /** Advance one M1 bar. */
  step(): StepOutput {
    this.out = { orders: [], gateway: [], trades: [], events: [] };
    const tick = this.feed.next();
    const closed = this.market.onTick(tick);
    this.bars++;
    this.rollPeriods(tick.t);
    this.processWorking(tick);
    this.processPositions(tick);
    this.markAll();
    this.sweepBrakes(tick.t);
    if (!this.killArmed) {
      for (const c of AGENT_CODES) {
        if (!this.cfg.enabled[c]) continue;
        const acct = this.accounts[c];
        if (acct.lockedUntil !== null && tick.t < acct.lockedUntil) continue;
        const intents = this.agents[c].onBar(
          {
            t: tick.t,
            market: this.market,
            calendar: this.feed.calendar,
            eventHistory: this.eventHistory,
            account: acct,
            positions: this.positions.filter((p) => p.agent === c),
            working: this.working.filter((o) => o.agent === c),
            limits: this.limits,
            budgetMult: this.budgetMult(c),
            newClientId: () => this.nextId(c),
          },
          closed,
        );
        for (const it of intents) this.apply(c, it);
      }
    }
    if (tick.seq % 15 === 0) this.snapshot(tick.t);
    return this.out;
  }

  private rollPeriods(t: number): void {
    const dk = dayKey(t);
    const wk = weekKey(t);
    for (const c of AGENT_CODES) {
      const a = this.accounts[c];
      if (a.dayKey !== dk) {
        a.dayKey = dk;
        a.dayStartEquity = a.equity;
        if (a.lockCode === "DAILY_LOSS_BRAKE") {
          a.lockedUntil = null;
          a.lockCode = null;
        }
      }
      if (a.weekKey !== wk) {
        a.weekKey = wk;
        a.weekStartEquity = a.equity;
        if (a.lockCode === "WEEKLY_LOSS_BRAKE") {
          a.lockedUntil = null;
          a.lockCode = null;
        }
      }
    }
    // overnight swap at 21:00 GMT rollover, triple on Wednesday
    const d = new Date(t);
    if (d.getUTCHours() === 21 && d.getUTCMinutes() === 0) {
      const mult = d.getUTCDay() === 3 ? 3 : 1;
      for (const p of this.positions)
        p.swap = p.swap.plus(p.qty.times(MARKETS[p.symbol].swapPerUnitDay * mult));
    }
  }

  private apply(c: AgentCode, it: AgentIntent): void {
    if (it.type === "CLOSE") {
      const p = this.positions.find((x) => x.id === it.positionId);
      if (p) this.closePosition(p, this.exitPx(p, "MARKET"), it.reason, it.fraction ?? 1);
      return;
    }
    if (it.type === "CANCEL") {
      const i = this.working.findIndex((o) => o.id === it.orderId);
      if (i >= 0) {
        const o = this.working[i]!;
        o.state = "CANCELLED";
        this.working.splice(i, 1);
        this.out.orders.push(o);
      }
      return;
    }
    this.submit(c, it.orders);
  }

  /** Gateway → broker. Basket legs (G3) are accepted or rejected together. */
  submit(c: AgentCode, reqs: OrderRequest[]): Order[] {
    const acct = this.accounts[c];
    const results: GatewayResult[] = [];
    let pending = ZERO;
    let allOk = true;
    const t = this.now;
    for (const r of reqs) {
      const blackout = isTier1Blackout(t, this.feed.calendar);
      const res = evaluateOrder(
        r,
        {
          t,
          account: acct,
          openPositions: this.positions.filter((p) => p.agent === c),
          pendingRisk: pending,
          seenClientIds: this.seen,
          killArmed: this.killArmed,
          whitelist: WHITELIST[c],
          maxQty: MARKETS[r.symbol].maxQty,
          spread: this.market.spread(r.symbol),
          hourlyMedianSpread: this.market.hourlyMedianSpread(r.symbol),
          blackout: blackout ? { eventId: blackout.id, ownedByG2: t >= blackout.t } : null,
          minutesToWeekendClose: minutesToWeekendClose(t),
          mark: (s) => this.market.mid(s),
        },
        this.limits,
      );
      this.out.gateway.push(...res.events);
      results.push(res);
      if (res.accepted) pending = pending.plus(res.risk);
      else {
        allOk = false;
        break;
      }
    }
    const made: Order[] = [];
    reqs.forEach((r, i) => {
      const res = results[i];
      const accepted = allOk && !!res?.accepted;
      const o: Order = {
        ...r,
        id: this.nextId("O"),
        submittedAt: t,
        state: accepted ? "ACCEPTED" : "REJECTED",
        rejectReason: accepted ? null : (res?.code ?? "BASKET_LEG_REJECTED"),
        arrivalMid: this.market.mid(r.symbol),
        spreadAtSubmit: this.market.spread(r.symbol),
        fillPx: null,
        filledQty: ZERO,
        filledAt: null,
        horizonPx: null,
      };
      this.orders.set(o.id, o);
      made.push(o);
      if (!accepted) {
        this.emit({
          kind: "REJECT",
          t,
          agent: c,
          text: `${r.side} ${r.symbol} rejected: ${o.rejectReason}`,
          ref: r.clientOrderId,
        });
        this.out.orders.push(o);
        return;
      }
      if (r.type === "MARKET") this.fillOrder(o, this.entryPxMarket(o), t);
      else {
        this.working.push(o);
        this.emit({
          kind: "ORDER",
          t,
          agent: c,
          text: `${r.side} LIMIT ${r.symbol} @ ${r.limitPx?.toFixed(MARKETS[r.symbol].digits)} (${r.tag ?? ""})`,
          ref: r.clientOrderId,
        });
        this.out.orders.push(o);
      }
    });
    return made;
  }

  private entryPxMarket(o: Order): number {
    const m = MARKETS[o.symbol];
    const half = this.market.spread(o.symbol) / 2;
    const slip = this.market.spread(o.symbol) * m.slippageFrac;
    const mid = this.market.mid(o.symbol);
    return o.side === "LONG" ? mid + half + slip : mid - half - slip;
  }

  private fillOrder(o: Order, px: number, t: number): void {
    const m = MARKETS[o.symbol];
    const mid = this.market.mid(o.symbol);
    const half = this.market.spread(o.symbol) / 2;
    const dir = o.side === "LONG" ? 1 : -1;
    o.state = "FILLED";
    o.fillPx = px;
    o.filledQty = o.qty;
    o.filledAt = t;
    const upp = usdPerPoint(o.symbol);
    const entryMid = o.type === "LIMIT" ? px - dir * half : mid;
    const slip = o.type === "MARKET" ? Math.max(0, (px - mid) * dir - half) : 0;
    const riskAtStop = o.basketId
      ? o.requestedRisk
      : D(Math.abs(px - (o.stopPx ?? px)))
          .times(o.qty)
          .times(upp);
    const pos: Position = {
      id: this.nextId("P"),
      orderId: o.id,
      clientOrderId: o.clientOrderId,
      agent: o.agent,
      symbol: o.symbol,
      side: o.side,
      qty: o.qty,
      entryPx: px,
      entryMid,
      stopPx: o.stopPx ?? px,
      targetPx: o.targetPx,
      riskAtStop,
      openedAt: t,
      timeStopAt:
        o.hardExitAt !== null || o.maxHoldMs !== null
          ? Math.min(o.hardExitAt ?? Infinity, o.maxHoldMs !== null ? t + o.maxHoldMs : Infinity)
          : null,
      decisionPx: o.decisionPx,
      arrivalMid: o.arrivalMid,
      entrySpreadCost: D(half).times(o.qty).times(upp),
      entrySlippage: D(slip).times(o.qty).times(upp),
      commission: o.qty.times(m.commissionPerUnit),
      swap: ZERO,
      mae: px,
      mfe: px,
      ...(o.basketId ? { basketId: o.basketId } : {}),
    };
    this.positions.push(pos);
    this.out.orders.push(o);
    this.emit({
      kind: "FILL",
      t,
      agent: o.agent,
      text: `${o.side} ${o.qty.toString()} ${o.symbol} filled @ ${px.toFixed(m.digits)}`,
      ref: o.clientOrderId,
    });
  }

  private processWorking(tick: Tick): void {
    for (let i = this.working.length - 1; i >= 0; i--) {
      const o = this.working[i]!;
      const b = tick.bars[o.symbol];
      if (!b || o.limitPx === null) continue;
      const half = b.spread / 2;
      const expired = o.expiresAt !== null && tick.t >= o.expiresAt;
      const touched =
        !expired && (o.side === "LONG" ? b.l + half <= o.limitPx : b.h - half >= o.limitPx);
      if (touched) {
        this.working.splice(i, 1);
        this.fillOrder(o, o.limitPx, tick.t);
        continue;
      }
      if (o.expiresAt !== null && tick.t >= o.expiresAt) {
        this.working.splice(i, 1);
        o.state = "EXPIRED";
        o.horizonPx = b.c;
        this.out.orders.push(o);
        this.emit({
          kind: "EXPIRE",
          t: tick.t,
          agent: o.agent,
          text: `${o.side} LIMIT ${o.symbol} expired unfilled (no chase)`,
          ref: o.clientOrderId,
        });
      }
    }
  }

  private exitPx(p: Position, kind: "MARKET" | "STOP"): number {
    const half = this.market.spread(p.symbol) / 2;
    const slip =
      kind === "MARKET" || kind === "STOP"
        ? this.market.spread(p.symbol) * MARKETS[p.symbol].slippageFrac
        : 0;
    const mid = this.market.mid(p.symbol);
    return p.side === "LONG" ? mid - half - slip : mid + half + slip;
  }

  private processPositions(tick: Tick): void {
    for (const p of [...this.positions]) {
      const b = tick.bars[p.symbol];
      if (!b) continue;
      const half = b.spread / 2;
      const bidL = b.l - half;
      const bidH = b.h - half;
      const askL = b.l + half;
      const askH = b.h + half;
      if (p.side === "LONG") {
        p.mae = Math.min(p.mae, bidL);
        p.mfe = Math.max(p.mfe, bidH);
      } else {
        p.mae = Math.max(p.mae, askH);
        p.mfe = Math.min(p.mfe, askL);
      }
      const slip = b.spread * MARKETS[p.symbol].slippageFrac;
      const stopHit = p.side === "LONG" ? bidL <= p.stopPx : askH >= p.stopPx;
      if (stopHit) {
        const gapOpen = p.side === "LONG" ? b.o - half < p.stopPx : b.o + half > p.stopPx;
        const base = gapOpen ? (p.side === "LONG" ? b.o - half : b.o + half) : p.stopPx;
        let px = p.side === "LONG" ? base - slip : base + slip;
        const inj = this.cfg.tailInjection;
        if (inj && (this.tradeCount + 1) % inj.every === 0) {
          const dist = Math.abs(p.entryPx - p.stopPx) * (inj.mult - 1);
          px = p.side === "LONG" ? px - dist : px + dist;
        }
        this.closePosition(p, px, "STOP", 1, tick.t);
        continue;
      }
      if (p.targetPx !== null && (p.side === "LONG" ? bidH >= p.targetPx : askL <= p.targetPx)) {
        this.closePosition(p, p.targetPx, "TARGET", 1, tick.t);
        continue;
      }
      if (p.timeStopAt !== null && tick.t >= p.timeStopAt)
        this.closePosition(p, this.exitPx(p, "MARKET"), "TIME", 1, tick.t);
    }
  }

  closePosition(
    p: Position,
    px: number,
    reason: ExitReason,
    fraction = 1,
    t = this.now,
  ): Trade | null {
    const idx = this.positions.indexOf(p);
    if (idx < 0) return null;
    const m = MARKETS[p.symbol];
    const upp = usdPerPoint(p.symbol);
    const dir = p.side === "LONG" ? 1 : -1;
    const qty =
      fraction >= 1 ? p.qty : p.qty.times(fraction).toDecimalPlaces(m.digits >= 3 ? 0 : 2, 1);
    if (qty.lte(0)) return null;
    const share = qty.div(p.qty);
    const half = this.market.spread(p.symbol) / 2;
    const mid = this.market.mid(p.symbol);
    const exitMid =
      reason === "TARGET" ? px + dir * half : reason === "STOP" ? px + dir * half : mid;
    const exitSlip = Math.max(0, (exitMid - px) * dir - half);
    const gross = D(exitMid - p.entryMid)
      .times(dir)
      .times(qty)
      .times(upp);
    const spreadCost = p.entrySpreadCost.times(share).plus(D(half).times(qty).times(upp));
    const commission = p.commission.times(share).plus(qty.times(m.commissionPerUnit));
    const slippage = p.entrySlippage.times(share).plus(D(exitSlip).times(qty).times(upp));
    const swap = p.swap.times(share);
    const net = gross.minus(spreadCost).minus(commission).minus(slippage).minus(swap);
    const risk = p.riskAtStop.times(share);
    const ord = this.orders.get(p.orderId);
    if (ord) ord.horizonPx = mid;
    const trade: Trade = {
      id: this.nextId("T"),
      orderId: p.orderId,
      clientOrderId: p.clientOrderId,
      agent: p.agent,
      symbol: p.symbol,
      side: p.side,
      qty,
      entryPx: p.entryPx,
      exitPx: px,
      stopPx: p.stopPx,
      targetPx: p.targetPx,
      openedAt: p.openedAt,
      closedAt: t,
      holdSeconds: Math.round((t - p.openedAt) / 1000),
      gross,
      spreadCost,
      commission,
      slippage,
      swap,
      net,
      rMultiple: risk.gt(0) ? net.div(risk).toNumber() : 0,
      exitReason: reason,
      maePx: p.mae,
      mfePx: p.mfe,
      decisionPx: p.decisionPx,
      arrivalMid: p.arrivalMid,
      horizonPx: mid,
      delayCost: D(p.arrivalMid - p.decisionPx)
        .times(dir)
        .times(qty)
        .times(upp),
      executionCost: D(p.entryPx - p.arrivalMid)
        .times(dir)
        .times(qty)
        .times(upp),
      missedFillCost: ZERO,
      riskAtStop: risk,
    };
    if (fraction >= 1) this.positions.splice(idx, 1);
    else {
      p.qty = p.qty.minus(qty);
      p.riskAtStop = p.riskAtStop.minus(risk);
      p.entrySpreadCost = p.entrySpreadCost.minus(p.entrySpreadCost.times(share));
      p.entrySlippage = p.entrySlippage.minus(p.entrySlippage.times(share));
      p.commission = p.commission.minus(p.commission.times(share));
      p.swap = p.swap.minus(swap);
    }
    const acct = this.accounts[p.agent];
    acct.realized = acct.realized.plus(net);
    this.trades.push(trade);
    this.tradeCount++;
    this.out.trades.push(trade);
    this.agents[p.agent].onTrade?.(trade);
    this.emit({
      kind: "EXIT",
      t,
      agent: p.agent,
      text: `${p.symbol} ${reason} net ${net.gte(0) ? "+" : ""}${net.toFixed(2)} (${trade.rMultiple.toFixed(2)}R)`,
      ref: p.clientOrderId,
    });
    return trade;
  }

  private markAll(): void {
    for (const c of AGENT_CODES) {
      const a = this.accounts[c];
      const unreal = sumD(
        this.positions
          .filter((p) => p.agent === c)
          .map((p) =>
            D(this.market.mid(p.symbol) - p.entryMid)
              .times(p.side === "LONG" ? 1 : -1)
              .times(p.qty)
              .times(usdPerPoint(p.symbol))
              .minus(p.entrySpreadCost)
              .minus(p.commission)
              .minus(p.swap),
          ),
      );
      a.unrealized = unreal;
      markAccount(a, a.starting.plus(a.realized).plus(unreal), this.limits);
    }
  }

  private sweepBrakes(t: number): void {
    for (const c of AGENT_CODES) {
      const a = this.accounts[c];
      if (a.lockedUntil !== null && t < a.lockedUntil) continue;
      const code = lossBrakeBreach(a, this.limits);
      if (!code) continue;
      for (const p of this.positions.filter((x) => x.agent === c))
        this.closePosition(p, this.exitPx(p, "MARKET"), "BRAKE", 1, t);
      for (const o of this.working.filter((x) => x.agent === c)) this.cancelOrder(o);
      a.lockCode = code;
      a.lockedUntil =
        code === "DAILY_LOSS_BRAKE"
          ? (dayKey(t) + 1) * DAY + 22 * 3_600_000
          : (weekKey(t) + 1) * 7 * DAY - 4 * DAY + 22 * 3_600_000;
      this.markAll();
      this.emit({
        kind: "BRAKE",
        t,
        agent: c,
        text: `${code}: ${c} flattened and locked until ${new Date(a.lockedUntil).toISOString().slice(0, 16)}Z`,
      });
    }
  }

  private cancelOrder(o: Order): void {
    const i = this.working.indexOf(o);
    if (i >= 0) this.working.splice(i, 1);
    o.state = "CANCELLED";
    this.out.orders.push(o);
  }

  /** Human-only kill switch: arm, cancel working orders, flatten every position. */
  kill(): Trade[] {
    this.killArmed = true;
    const t = this.now;
    for (const o of [...this.working]) this.cancelOrder(o);
    const closed: Trade[] = [];
    for (const p of [...this.positions]) {
      const tr = this.closePosition(p, this.exitPx(p, "MARKET"), "KILL", 1, t);
      if (tr) closed.push(tr);
    }
    this.markAll();
    this.emit({
      kind: "KILL",
      t,
      agent: null,
      text: `KILL SWITCH: ${closed.length} positions flattened, all orders cancelled`,
    });
    return closed;
  }
  disarm(): void {
    this.killArmed = false;
  }
  drain(): StepOutput {
    const o = this.out;
    this.out = { orders: [], gateway: [], trades: [], events: [] };
    return o;
  }

  openRisk(c?: AgentCode): Decimal {
    return sumD(this.positions.filter((p) => !c || p.agent === c).map((p) => p.riskAtStop));
  }
  /** Gold share of total open risk (G1+G2+G4 XAUUSD legs + G3 gold leg). */
  goldExposure(): number {
    const total = this.openRisk();
    if (total.lte(0)) return 0;
    const gold = sumD(this.positions.filter((p) => p.symbol === "XAUUSD").map((p) => p.riskAtStop));
    return gold.div(total).toNumber();
  }
  totals(): { equity: Decimal; hwm: Decimal; floor: Decimal; starting: Decimal } {
    const a = AGENT_CODES.map((c) => this.accounts[c]);
    return {
      equity: sumD(a.map((x) => x.equity)),
      hwm: sumD(a.map((x) => x.hwm)),
      floor: sumD(a.map((x) => x.floor)),
      starting: sumD(a.map((x) => x.starting)),
    };
  }
  private snapshot(t: number): void {
    const tot = this.totals();
    const byAgent = {} as Record<AgentCode, number>;
    for (const c of AGENT_CODES) byAgent[c] = this.accounts[c].equity.toNumber();
    this.equityCurve.push({
      t,
      equity: tot.equity.toNumber(),
      hwm: tot.hwm.toNumber(),
      floor: tot.floor.toNumber(),
      openRisk: this.openRisk().toNumber(),
      goldExposure: this.goldExposure(),
      byAgent,
    });
    if (this.equityCurve.length > 20000)
      this.equityCurve.splice(0, this.equityCurve.length - 20000);
  }
  run(bars: number): void {
    for (let i = 0; i < bars && !this.feed.exhausted; i++) this.step();
  }
}

export function defaultParams(): Record<AgentCode, ParamValues> {
  return {
    G1: {
      q: 4,
      k: 1.0,
      targetRatio: 0.8,
      orderLifeMin: 60,
      timeStopH: 6,
      riskPct: 0.0025,
      zoneMergeAtr: 0.25,
      entryOffsetAtr: 0.1,
      vrSessions: 10,
      slopeMax: 0.5,
      costMultiple: 4,
      maxStopsPerSession: 3,
      spreadMult: 2,
    },
    G2: {
      entryDelayMin: 3,
      minSurprise: 1,
      stopMult: 1.5,
      maxHoldMin: 60,
      riskPct: 0.0025,
      alpha: 0.05,
      spreadMult: 2,
    },
    G3: {
      lookbackDays: 500,
      zEntry: 2.0,
      zExit: 0.5,
      zStop: 3.5,
      timeStopDays: 5,
      riskPct: 0.005,
      dxyR2Max: 0.25,
      zWindowDays: 20,
    },
    G4: {
      ma1: 20,
      ma2: 50,
      ma3: 180,
      targetVol: 0.06,
      band: 0.25,
      lossHalveMult: 3,
      universe: ["XAUUSD", "NAS100", "GBPJPY", "BTCUSD", "EURUSD"],
    },
  };
}
export const SIM_START_MS = Date.UTC(2026, 0, 5, 0, 0);
export function defaultConfig(seed: number, over: Partial<EngineConfig> = {}): EngineConfig {
  return {
    feed: { seed, startMs: SIM_START_MS },
    params: defaultParams(),
    budgets: { G1: 0.25, G2: 0.25, G3: 0.25, G4: 0.25 },
    probation: {},
    enabled: { G1: true, G2: true, G3: true, G4: true },
    startingEquity: { G1: 25000, G2: 25000, G3: 25000, G4: 25000 },
    ...over,
  };
}
