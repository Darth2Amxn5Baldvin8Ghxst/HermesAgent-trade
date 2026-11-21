import type { GatewayCheck, RejectCode } from "./types";

export const REJECTION_CODES: Record<
  RejectCode,
  { check: GatewayCheck; title: string; explain: string }
> = {
  DRAWDOWN_FLOOR: {
    check: "DRAWDOWN_FLOOR",
    title: "Drawdown floor",
    explain:
      "Equity is at or below the floor (high-water mark × 0.92). No new risk until equity recovers above it.",
  },
  PER_TRADE_CAP: {
    check: "PER_TRADE_CAP",
    title: "Per-trade cap",
    explain: "Risk at the stop exceeds min(agent request, 1.5% of equity, cushion / 8).",
  },
  TOTAL_OPEN_RISK: {
    check: "TOTAL_OPEN_RISK",
    title: "Total open risk",
    explain:
      "Open risk at stops plus this order would exceed cushion / 3, so three full stop-outs could breach the floor.",
  },
  DAILY_LOSS_BRAKE: {
    check: "LOSS_BRAKE",
    title: "Daily loss brake",
    explain: "The account lost 2% today. It was flattened and is locked until the next day.",
  },
  WEEKLY_LOSS_BRAKE: {
    check: "LOSS_BRAKE",
    title: "Weekly loss brake",
    explain: "The account lost 4% this week. It was flattened and is locked until next week.",
  },
  NO_STOP: {
    check: "ORDER_HYGIENE",
    title: "No stop",
    explain: "Every order must carry a protective stop on the correct side at submission.",
  },
  AVERAGING_DOWN: {
    check: "ORDER_HYGIENE",
    title: "Averaging / grid",
    explain:
      "Adding to an open position in the same direction (averaging into a loser, grid or martingale) is forbidden.",
  },
  SYMBOL_NOT_WHITELISTED: {
    check: "ORDER_HYGIENE",
    title: "Symbol not whitelisted",
    explain: "This agent is not permitted to trade this symbol.",
  },
  SIZE_OVER_LIMIT: {
    check: "ORDER_HYGIENE",
    title: "Size over limit",
    explain: "Order size exceeds the broker / prop-firm limit for this symbol.",
  },
  SPREAD_WIDE: {
    check: "MARKET_CHECK",
    title: "Spread too wide",
    explain: "Quoted spread is more than 2× its median for this GMT hour.",
  },
  NEWS_BLACKOUT: {
    check: "MARKET_CHECK",
    title: "News blackout",
    explain: "Inside a tier-1 US release window (−30 / +60 min). Only G2 may trade its own window.",
  },
  WEEKEND_CUTOFF: {
    check: "MARKET_CHECK",
    title: "Weekend cutoff",
    explain: "No new risk in the 30 minutes before the weekend close (Fri 21:00 GMT).",
  },
  DUPLICATE_CLIENT_ID: {
    check: "EXECUTION",
    title: "Duplicate client ID",
    explain:
      "This client order ID was already used. Idempotency prevents a retry from doubling a position.",
  },
  KILL_ARMED: {
    check: "KILL_SWITCH",
    title: "Kill switch armed",
    explain: "The human-only kill switch is armed; every order is rejected.",
  },
};

export const CHECK_INFO: Record<GatewayCheck, { title: string; rule: string }> = {
  DRAWDOWN_FLOOR: {
    title: "Drawdown floor",
    rule: "equity > floor, floor = HWM × 0.92, ratchets up only",
  },
  PER_TRADE_CAP: {
    title: "Per-trade cap",
    rule: "risk_at_stop ≤ min(request, 1.5% × equity, cushion / 8)",
  },
  TOTAL_OPEN_RISK: { title: "Total open risk", rule: "Σ open risk + new ≤ cushion / 3" },
  LOSS_BRAKE: { title: "Loss brakes", rule: "daily loss < 2% and weekly loss < 4%" },
  ORDER_HYGIENE: {
    title: "Order hygiene",
    rule: "stop present, no averaging/grid/martingale, whitelist, size limit",
  },
  MARKET_CHECK: {
    title: "Market checks",
    rule: "spread ≤ 2× hourly median; no news blackout; no weekend cutoff",
  },
  EXECUTION: {
    title: "Execution",
    rule: "idempotent client order ID; atomic checkpoint of HWM / positions",
  },
  LOGGING: {
    title: "Logging",
    rule: "decision px, arrival mid, fill px, unfilled qty, horizon px recorded",
  },
  KILL_SWITCH: { title: "Kill switch", rule: "human-only switch; armed → everything rejects" },
};
