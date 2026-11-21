/**
 * BrokerAdapter: the only surface the UI uses to trade. SimBrokerAdapter wraps HermesEngine;
 * LiveBrokerAdapter is a typed interface whose methods throw until a broker backend is wired in.
 */
import type { HermesEngine } from "./engine";
import type { AgentCode, Order, OrderRequest, Position, Sym, Trade } from "./types";

export class NotImplementedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotImplementedError";
  }
}
export interface Quote {
  symbol: Sym;
  bid: number;
  ask: number;
  t: number;
}
export interface ConnectionTest {
  ok: boolean;
  latencyMs: number;
  message: string;
}
export interface BrokerAdapter {
  readonly id: string;
  readonly label: string;
  readonly kind: "SIM" | "LIVE";
  testConnection(): Promise<ConnectionTest>;
  quote(symbol: Sym): Promise<Quote>;
  submit(agent: AgentCode, orders: OrderRequest[]): Promise<Order[]>;
  cancel(orderId: string): Promise<void>;
  closePosition(positionId: string): Promise<Trade | null>;
  positions(agent?: AgentCode): Promise<Position[]>;
  flattenAll(): Promise<Trade[]>;
}

export class SimBrokerAdapter implements BrokerAdapter {
  readonly id = "sim";
  readonly label = "SimBrokerAdapter (in-browser engine)";
  readonly kind = "SIM" as const;
  constructor(private engine: () => HermesEngine | null) {}
  private e(): HermesEngine {
    const e = this.engine();
    if (!e) throw new Error("Simulation engine not running");
    return e;
  }
  async testConnection(): Promise<ConnectionTest> {
    const t0 = performance.now();
    const e = this.engine();
    return {
      ok: !!e,
      latencyMs: Math.round((performance.now() - t0) * 1000) / 1000,
      message: e
        ? `Engine at ${new Date(e.now).toISOString()} · ${e.bars} bars`
        : "Engine not started",
    };
  }
  async quote(symbol: Sym): Promise<Quote> {
    const e = this.e();
    return { symbol, bid: e.market.bid(symbol), ask: e.market.ask(symbol), t: e.now };
  }
  async submit(agent: AgentCode, orders: OrderRequest[]): Promise<Order[]> {
    return this.e().submit(agent, orders);
  }
  async cancel(orderId: string): Promise<void> {
    const e = this.e();
    const i = e.working.findIndex((o) => o.id === orderId);
    if (i >= 0) {
      e.working[i]!.state = "CANCELLED";
      e.working.splice(i, 1);
    }
  }
  async closePosition(positionId: string): Promise<Trade | null> {
    const e = this.e();
    const p = e.positions.find((x) => x.id === positionId);
    if (!p) return null;
    const half = e.market.spread(p.symbol) / 2;
    const px = p.side === "LONG" ? e.market.mid(p.symbol) - half : e.market.mid(p.symbol) + half;
    return e.closePosition(p, px, "MANUAL");
  }
  async positions(agent?: AgentCode): Promise<Position[]> {
    return this.e().positions.filter((p) => !agent || p.agent === agent);
  }
  async flattenAll(): Promise<Trade[]> {
    return this.e().kill();
  }
}

export interface LiveBrokerConfig {
  name: string;
  endpoint: string;
  accountId: string;
}
const NOT_WIRED = "Connect a broker backend";
export class LiveBrokerAdapter implements BrokerAdapter {
  readonly id = "live";
  readonly kind = "LIVE" as const;
  readonly label: string;
  constructor(private cfg: LiveBrokerConfig) {
    this.label = `LiveBrokerAdapter (${cfg.name || "unconfigured"})`;
  }
  async testConnection(): Promise<ConnectionTest> {
    if (!this.cfg.endpoint)
      return {
        ok: false,
        latencyMs: 0,
        message: "No endpoint configured. Connect a broker backend.",
      };
    const t0 = performance.now();
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5000);
      const res = await fetch(this.cfg.endpoint, {
        method: "HEAD",
        signal: ctrl.signal,
        mode: "no-cors",
      });
      clearTimeout(timer);
      return {
        ok: true,
        latencyMs: Math.round(performance.now() - t0),
        message: `Endpoint reachable (${res.type}). Trading methods are not wired: ${NOT_WIRED}.`,
      };
    } catch (e) {
      return {
        ok: false,
        latencyMs: Math.round(performance.now() - t0),
        message: `Endpoint unreachable: ${e instanceof Error ? e.message : "unknown error"}`,
      };
    }
  }
  quote(): Promise<Quote> {
    return Promise.reject(new NotImplementedError(NOT_WIRED));
  }
  submit(): Promise<Order[]> {
    return Promise.reject(new NotImplementedError(NOT_WIRED));
  }
  cancel(): Promise<void> {
    return Promise.reject(new NotImplementedError(NOT_WIRED));
  }
  closePosition(): Promise<Trade | null> {
    return Promise.reject(new NotImplementedError(NOT_WIRED));
  }
  positions(): Promise<Position[]> {
    return Promise.reject(new NotImplementedError(NOT_WIRED));
  }
  flattenAll(): Promise<Trade[]> {
    return Promise.reject(new NotImplementedError(NOT_WIRED));
  }
}

/** Historical feed from imported CSV (timestamp, bid, ask) → M1 bars for XAUUSD. */
export interface HistoricalQuote {
  t: number;
  bid: number;
  ask: number;
}
export function quotesToBars(
  q: readonly HistoricalQuote[],
): { t: number; o: number; h: number; l: number; c: number; spread: number }[] {
  const out: { t: number; o: number; h: number; l: number; c: number; spread: number }[] = [];
  const sorted = [...q].sort((a, b) => a.t - b.t);
  for (const x of sorted) {
    const m = Math.floor(x.t / 60000) * 60000;
    const mid = (x.bid + x.ask) / 2;
    const last = out[out.length - 1];
    if (last && last.t === m) {
      last.h = Math.max(last.h, mid);
      last.l = Math.min(last.l, mid);
      last.c = mid; // last-quote sampling; never interpolate missing minutes
      last.spread = x.ask - x.bid;
    } else out.push({ t: m, o: mid, h: mid, l: mid, c: mid, spread: x.ask - x.bid });
  }
  return out;
}
