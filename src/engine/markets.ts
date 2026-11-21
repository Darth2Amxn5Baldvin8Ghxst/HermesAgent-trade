import type { Sym } from "./types";

export interface MarketSpec {
  sym: Sym;
  px0: number;
  annVol: number;
  baseSpread: number; // London-session typical spread, price units
  commissionPerUnit: number; // account ccy per unit per side
  swapPerUnitDay: number; // account ccy per unit per overnight (cost, both sides)
  slippageFrac: number; // expected slippage as fraction of spread for market orders/stops
  maxQty: number; // broker/prop size limit (units)
  digits: number;
  unitLabel: string;
}

export const MARKETS: Record<Sym, MarketSpec> = {
  XAUUSD: {
    sym: "XAUUSD",
    px0: 2650,
    annVol: 0.16,
    baseSpread: 0.22,
    commissionPerUnit: 0.035,
    swapPerUnitDay: 0.18,
    slippageFrac: 0.25,
    maxQty: 500,
    digits: 2,
    unitLabel: "oz",
  },
  XAGUSD: {
    sym: "XAGUSD",
    px0: 31,
    annVol: 0.28,
    baseSpread: 0.022,
    commissionPerUnit: 0.0008,
    swapPerUnitDay: 0.003,
    slippageFrac: 0.3,
    maxQty: 40000,
    digits: 3,
    unitLabel: "oz",
  },
  EURUSD: {
    sym: "EURUSD",
    px0: 1.08,
    annVol: 0.07,
    baseSpread: 0.00008,
    commissionPerUnit: 0.000035,
    swapPerUnitDay: 0.00006,
    slippageFrac: 0.2,
    maxQty: 3_000_000,
    digits: 5,
    unitLabel: "EUR",
  },
  NAS100: {
    sym: "NAS100",
    px0: 21000,
    annVol: 0.22,
    baseSpread: 1.2,
    commissionPerUnit: 0,
    swapPerUnitDay: 2.6,
    slippageFrac: 0.3,
    maxQty: 60,
    digits: 1,
    unitLabel: "idx",
  },
  GBPJPY: {
    sym: "GBPJPY",
    px0: 195,
    annVol: 0.1,
    baseSpread: 0.025,
    commissionPerUnit: 0.0000035,
    swapPerUnitDay: 0.0003,
    slippageFrac: 0.25,
    maxQty: 3_000_000,
    digits: 3,
    unitLabel: "GBP",
  },
  BTCUSD: {
    sym: "BTCUSD",
    px0: 90000,
    annVol: 0.55,
    baseSpread: 25,
    commissionPerUnit: 0,
    swapPerUnitDay: 45,
    slippageFrac: 0.4,
    maxQty: 20,
    digits: 1,
    unitLabel: "BTC",
  },
  DXY: {
    sym: "DXY",
    px0: 104,
    annVol: 0.07,
    baseSpread: 0.012,
    commissionPerUnit: 0,
    swapPerUnitDay: 0,
    slippageFrac: 0.2,
    maxQty: 0,
    digits: 3,
    unitLabel: "idx",
  },
  US500: {
    sym: "US500",
    px0: 6000,
    annVol: 0.17,
    baseSpread: 0.5,
    commissionPerUnit: 0,
    swapPerUnitDay: 0.8,
    slippageFrac: 0.3,
    maxQty: 200,
    digits: 1,
    unitLabel: "idx",
  },
  AUDNZD: {
    sym: "AUDNZD",
    px0: 1.09,
    annVol: 0.06,
    baseSpread: 0.00025,
    commissionPerUnit: 0.000035,
    swapPerUnitDay: 0.00004,
    slippageFrac: 0.25,
    maxQty: 3_000_000,
    digits: 5,
    unitLabel: "AUD",
  },
};

/** P&L in USD per unit of price move. GBPJPY/AUDNZD/EURUSD quote ccy approximated to USD at fixed rates. */
export function usdPerPoint(sym: Sym): number {
  if (sym === "GBPJPY") return 1 / 150; // JPY → USD
  if (sym === "AUDNZD") return 0.6; // NZD → USD
  return 1;
}

/** Session spread multiplier by GMT hour (Asian wide, London/NY tight, roll-over widest). */
export const HOUR_SPREAD_PROFILE: number[] = [
  1.7, 1.6, 1.6, 1.5, 1.5, 1.4, 1.3, 1.05, 1.0, 1.0, 1.0, 1.0, 1.0, 0.95, 0.9, 0.95, 1.0, 1.15,
  1.25, 1.3, 1.4, 1.6, 2.4, 1.9,
];
export const TRADING_MINUTES_PER_YEAR = 252 * 1380;
