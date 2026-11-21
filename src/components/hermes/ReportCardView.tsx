import type { ReportCard } from "@/lib/hermes/reportCard";
import { fmtUsd } from "@/lib/hermes/format";
import { Label, Num } from "./ui";
import { cn } from "@/lib/utils";

export function ReportCardView({
  rc,
  budgetAfter,
  compact = false,
}: {
  rc: ReportCard | null;
  budgetAfter?: number | null;
  compact?: boolean;
}) {
  if (!rc)
    return (
      <div className="py-6 text-center text-[12px] text-ink-3">
        No closed trades yet — the report card fills in as the simulator trades.
      </div>
    );
  const cells: [string, string, string, string?][] = [
    [
      "Return",
      `${rc.returnPct.toFixed(2)}%`,
      "Π(1 + daily r) − 1",
      rc.returnPct >= 0 ? "text-pos" : "text-neg",
    ],
    ["Volatility", `${rc.volatilityPct.toFixed(2)}%`, "SD(daily r) × √252"],
    [
      "% positive months",
      `${(rc.pctPositiveMonths * 100).toFixed(0)}%`,
      "months with r > 0 / months",
    ],
    ["Best month", `${rc.bestMonthPct.toFixed(2)}%`, "max monthly return"],
    ["Worst month", `${rc.worstMonthPct.toFixed(2)}%`, "min monthly return"],
    ["Skew", rc.skew.toFixed(3), "third standardised moment of daily r"],
    ["Kurtosis", rc.kurtosis.toFixed(3), "excess fourth moment of daily r"],
    ["Max DD", `${rc.maxDdPct.toFixed(2)}%`, "max (peak − equity)/peak", "text-neg"],
    ["DD duration", `${rc.ddDurationDays} d`, "trading days peak → trough"],
    [
      "DD recovery",
      rc.ddRecoveryDays === null ? "open" : `${rc.ddRecoveryDays} d`,
      "trading days trough → new high",
    ],
    ["VaR 95 (hist.)", `${rc.var95Pct.toFixed(3)}%`, "−5th percentile of daily r"],
    [
      "α vs gold/DXY/NAS",
      `${(rc.alpha * 1e4).toFixed(2)} bp · t ${rc.alphaT.toFixed(2)}`,
      "intercept of r on gold, DXY, NAS100; Newey–West t",
    ],
    [
      "z realised vs expected",
      rc.z.toFixed(2),
      "(Σ OOS pnl − n·E[pnl]) / (σ·√n), E and σ from the first half",
      Math.abs(rc.z) > 1 ? (rc.z > 0 ? "text-pos" : "text-neg") : "",
    ],
    [
      "Budget after",
      budgetAfter != null ? `${(budgetAfter * 100).toFixed(1)}%` : "—",
      "overseer decision",
    ],
  ];
  const cs = rc.costSplit;
  return (
    <div className="space-y-3">
      <div
        className={cn(
          "grid gap-2",
          compact ? "grid-cols-2" : "grid-cols-2 md:grid-cols-4 xl:grid-cols-7",
        )}
      >
        {cells.map(([l, v, f, tone]) => (
          <div key={l} className="rounded-md border border-line-0 bg-surface-2/50 px-2.5 py-2">
            <Label>{l}</Label>
            <div className={cn("mt-0.5 text-[14px]", tone)}>
              <Num
                value={v}
                formula={f}
                inputs={`${rc.days} trading days, ${rc.trades} trades, ${rc.periodStart} → ${rc.periodEnd}`}
                flash={false}
              />
            </div>
          </div>
        ))}
      </div>
      <div className="rounded-md border border-line-0 px-3 py-2">
        <Label>Cost split · Kissell implementation shortfall</Label>
        <div className="t-num mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-1">
          <span>delay {fmtUsd(cs.delay)}</span>
          <span>execution {fmtUsd(cs.execution)}</span>
          <span>missed-fill {fmtUsd(cs.missed_fill)}</span>
          <span className="text-ink-3">|</span>
          <span>spread {fmtUsd(cs.spread)}</span>
          <span>commission {fmtUsd(cs.commission)}</span>
          <span>slippage {fmtUsd(cs.slippage)}</span>
          <span>swap {fmtUsd(cs.swap)}</span>
        </div>
      </div>
    </div>
  );
}
