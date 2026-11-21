import Decimal from "decimal.js";

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_EVEN });

/** All currency, P&L, size and risk amounts flow through this type. */
export type Money = Decimal;
export const D = (v: Decimal.Value): Decimal => new Decimal(v);
export const ZERO = new Decimal(0);
export { Decimal };

export const sumD = (xs: readonly Decimal[]): Decimal => xs.reduce((a, b) => a.plus(b), ZERO);
export const minD = (...xs: Decimal[]): Decimal => Decimal.min(...xs);
export const maxD = (...xs: Decimal[]): Decimal => Decimal.max(...xs);
/** Display helper; never feed the result back into arithmetic. */
export const fmtMoney = (v: Decimal, dp = 2): string =>
  (v.isNegative() ? "−" : "") +
  "$" +
  v
    .abs()
    .toNumber()
    .toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
