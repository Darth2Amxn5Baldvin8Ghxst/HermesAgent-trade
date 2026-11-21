import type Decimal from "decimal.js";

export type Sym =
  "XAUUSD" | "XAGUSD" | "EURUSD" | "NAS100" | "GBPJPY" | "BTCUSD" | "DXY" | "US500" | "AUDNZD";
export const ALL_SYMBOLS: Sym[] = [
  "XAUUSD",
  "XAGUSD",
  "EURUSD",
  "NAS100",
  "GBPJPY",
  "BTCUSD",
  "DXY",
  "US500",
  "AUDNZD",
];
export type AgentCode = "G1" | "G2" | "G3" | "G4";
export const AGENT_CODES: AgentCode[] = ["G1", "G2", "G3", "G4"];
export type Side = "LONG" | "SHORT";

export interface Bar {
  t: number; // bar open, epoch ms UTC
  o: number;
  h: number;
  l: number;
  c: number; // mid close
  spread: number; // quoted spread at close, price units
}
export interface Tick {
  t: number; // bar close time, epoch ms UTC
  seq: number; // monotone sequence id; same-timestamp events order by (t, seq)
  bars: Partial<Record<Sym, Bar>>;
}

export type OrderType = "LIMIT" | "MARKET";
export type OrderState = "PENDING" | "ACCEPTED" | "FILLED" | "REJECTED" | "CANCELLED" | "EXPIRED";
export type ExitReason =
  "TARGET" | "STOP" | "TIME" | "REGIME" | "MANUAL" | "KILL" | "SIGNAL" | "BRAKE";

export interface OrderRequest {
  clientOrderId: string;
  agent: AgentCode;
  symbol: Sym;
  side: Side;
  type: OrderType;
  qty: Decimal;
  limitPx: number | null;
  stopPx: number | null;
  targetPx: number | null;
  expiresAt: number | null; // epoch ms (GTD)
  maxHoldMs: number | null; // time stop measured from fill
  hardExitAt: number | null; // absolute exit time (session end / event window)
  decisionPx: number;
  requestedRisk: Decimal; // agent's requested risk at stop (account ccy)
  basketId?: string; // G3: both legs travel together
  tag?: string;
}

export interface Order extends OrderRequest {
  id: string;
  submittedAt: number;
  state: OrderState;
  rejectReason: string | null;
  arrivalMid: number;
  spreadAtSubmit: number;
  fillPx: number | null;
  filledQty: Decimal;
  filledAt: number | null;
  horizonPx: number | null;
}

export interface Position {
  id: string;
  orderId: string;
  clientOrderId: string;
  agent: AgentCode;
  symbol: Sym;
  side: Side;
  qty: Decimal;
  entryPx: number;
  entryMid: number;
  stopPx: number;
  targetPx: number | null;
  riskAtStop: Decimal;
  openedAt: number;
  timeStopAt: number | null;
  decisionPx: number;
  arrivalMid: number;
  entrySpreadCost: Decimal;
  entrySlippage: Decimal;
  commission: Decimal;
  swap: Decimal;
  mae: number;
  mfe: number;
  basketId?: string;
}

export interface Trade {
  id: string;
  orderId: string;
  clientOrderId: string;
  agent: AgentCode;
  symbol: Sym;
  side: Side;
  qty: Decimal;
  entryPx: number;
  exitPx: number;
  stopPx: number;
  targetPx: number | null;
  openedAt: number;
  closedAt: number;
  holdSeconds: number;
  gross: Decimal;
  spreadCost: Decimal;
  commission: Decimal;
  slippage: Decimal;
  swap: Decimal;
  net: Decimal;
  rMultiple: number;
  exitReason: ExitReason;
  maePx: number;
  mfePx: number;
  decisionPx: number;
  arrivalMid: number;
  horizonPx: number;
  delayCost: Decimal;
  executionCost: Decimal;
  missedFillCost: Decimal;
  riskAtStop: Decimal;
}

export type GatewayCheck =
  | "DRAWDOWN_FLOOR"
  | "PER_TRADE_CAP"
  | "TOTAL_OPEN_RISK"
  | "LOSS_BRAKE"
  | "ORDER_HYGIENE"
  | "MARKET_CHECK"
  | "EXECUTION"
  | "LOGGING"
  | "KILL_SWITCH";
export const GATEWAY_CHECKS: GatewayCheck[] = [
  "DRAWDOWN_FLOOR",
  "PER_TRADE_CAP",
  "TOTAL_OPEN_RISK",
  "LOSS_BRAKE",
  "ORDER_HYGIENE",
  "MARKET_CHECK",
  "EXECUTION",
  "LOGGING",
  "KILL_SWITCH",
];
export type RejectCode =
  | "DRAWDOWN_FLOOR"
  | "PER_TRADE_CAP"
  | "TOTAL_OPEN_RISK"
  | "DAILY_LOSS_BRAKE"
  | "WEEKLY_LOSS_BRAKE"
  | "NO_STOP"
  | "AVERAGING_DOWN"
  | "SYMBOL_NOT_WHITELISTED"
  | "SIZE_OVER_LIMIT"
  | "SPREAD_WIDE"
  | "NEWS_BLACKOUT"
  | "WEEKEND_CUTOFF"
  | "DUPLICATE_CLIENT_ID"
  | "KILL_ARMED";

export interface GatewayEvent {
  clientOrderId: string;
  agent: AgentCode;
  seq: number;
  check: GatewayCheck;
  result: "PASS" | "FAIL";
  code: RejectCode | null;
  detail: Record<string, number | string | boolean | null>;
  t: number;
}

export interface EngineEvent {
  kind:
    | "GATEWAY"
    | "ORDER"
    | "FILL"
    | "REJECT"
    | "EXIT"
    | "EXPIRE"
    | "BRAKE"
    | "KILL"
    | "REGIME"
    | "INFO";
  t: number;
  agent: AgentCode | null;
  text: string;
  ref?: string;
}
