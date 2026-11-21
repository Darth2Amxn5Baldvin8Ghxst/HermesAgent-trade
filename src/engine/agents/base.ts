import type Decimal from "decimal.js";
import type { AccountState, RiskLimits } from "../gateway";
import type { MarketState, Closed } from "../market";
import type { EventObservation, MacroEvent } from "../calendar";
import type { AgentCode, ExitReason, Order, OrderRequest, Position, Trade } from "../types";

export interface AgentEnv {
  t: number;
  market: MarketState;
  calendar: readonly MacroEvent[];
  eventHistory: readonly EventObservation[];
  account: AccountState;
  positions: readonly Position[];
  working: readonly Order[];
  limits: RiskLimits;
  /** budget_pct / (1/N), times 0.25 on probation; scales every risk request. */
  budgetMult: number;
  newClientId: () => string;
}
export type AgentIntent =
  | { type: "SUBMIT"; orders: OrderRequest[] }
  | { type: "CLOSE"; positionId: string; reason: ExitReason; fraction?: number }
  | { type: "CANCEL"; orderId: string };

export type Diag = Record<string, number | string | boolean | null>;

export interface Agent {
  readonly code: AgentCode;
  onBar(env: AgentEnv, closed: Closed): AgentIntent[];
  onTrade?(trade: Trade): void;
  diagnostics(): Diag;
}

export type ParamValues = Record<string, number | number[] | string[]>;
export const num = (p: ParamValues, k: string, dflt: number): number => {
  const v = p[k];
  return typeof v === "number" && Number.isFinite(v) ? v : dflt;
};
export const isDecimal = (v: unknown): v is Decimal =>
  typeof v === "object" && v !== null && "toNumber" in v;
