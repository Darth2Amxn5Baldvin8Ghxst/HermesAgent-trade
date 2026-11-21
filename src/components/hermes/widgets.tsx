import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
  ComposedChart,
} from "recharts";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { fmtGmt, fmtPct, fmtTime, fmtUsd } from "@/lib/hermes/format";
import { useSim, type FeedItem } from "@/lib/hermes/store";
import type { HermesEngine, EquityPoint } from "@/engine/engine";
import { DEFAULT_LIMITS, cushion, type RiskLimits } from "@/engine/gateway";
import type { AgentCode } from "@/engine/types";
import { ChartCard, Label, Num, Sparkline, StatusPill } from "./ui";

const DAY = 86_400_000;
export const RANGES = {
  "1D": DAY,
  "1W": 7 * DAY,
  "1M": 30 * DAY,
  "3M": 91 * DAY,
  YTD: -1,
  ALL: Infinity,
} as const;
export type RangeKey = keyof typeof RANGES;

export function downsample<T>(xs: readonly T[], max = 600): T[] {
  if (xs.length <= max) return [...xs];
  const step = xs.length / max;
  return Array.from({ length: max }, (_, i) => xs[Math.floor(i * step)]!);
}
function filterRange(pts: readonly EquityPoint[], r: RangeKey): EquityPoint[] {
  const last = pts[pts.length - 1];
  if (!last) return [];
  const span = RANGES[r];
  if (span === Infinity) return [...pts];
  const from = span === -1 ? Date.UTC(new Date(last.t).getUTCFullYear(), 0, 1) : last.t - span;
  return pts.filter((p) => p.t >= from);
}

export function EquityChart({ engine, height = 240 }: { engine: HermesEngine; height?: number }) {
  const [range, setRange] = useState<RangeKey>("1W");
  const pts = downsample(filterRange(engine.equityCurve, range)).map((p) => ({
    t: p.t,
    equity: +p.equity.toFixed(2),
    hwm: +p.hwm.toFixed(2),
    floor: +p.floor.toFixed(2),
    cushion: [p.floor, p.equity] as [number, number],
  }));
  const last = pts[pts.length - 1];
  const lo = Math.min(...pts.map((p) => p.floor)) * 0.998;
  const hi = Math.max(...pts.map((p) => Math.max(p.hwm, p.equity))) * 1.002;
  return (
    <ChartCard
      name="equity-curve"
      title="Portfolio equity · HWM · floor"
      data={pts.map(({ cushion: _c, ...r }) => ({ ...r, time: fmtGmt(r.t) }))}
      actions={
        <div className="flex gap-0.5">
          {(Object.keys(RANGES) as RangeKey[]).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={cn(
                "t-num h-6 rounded px-1.5 text-[10px]",
                range === r ? "bg-surface-3 text-gold-400" : "text-ink-2 hover:text-ink-0",
              )}
            >
              {r}
            </button>
          ))}
        </div>
      }
    >
      {pts.length < 2 ? (
        <div
          className="grid animate-pulse place-items-center rounded-md bg-surface-2"
          style={{ height }}
        >
          <span className="t-label">accumulating equity samples…</span>
        </div>
      ) : (
        <div style={{ height }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={pts} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="var(--border-0)" vertical={false} />
              <XAxis
                dataKey="t"
                type="number"
                domain={["dataMin", "dataMax"]}
                tickFormatter={(t: number) => fmtGmt(t, range === "1D" ? "HH:mm" : "MM-dd")}
                stroke="var(--ink-3)"
                fontSize={10}
                tickLine={false}
                axisLine={false}
                minTickGap={40}
              />
              <YAxis
                domain={[lo, hi]}
                tickFormatter={(v: number) => `$${(v / 1000).toFixed(1)}k`}
                stroke="var(--ink-3)"
                fontSize={10}
                tickLine={false}
                axisLine={false}
                width={52}
              />
              <RTooltip
                contentStyle={{
                  background: "var(--surface-1)",
                  border: "1px solid var(--border-1)",
                  borderRadius: 8,
                  fontFamily: "var(--font-mono)",
                  fontSize: 12,
                }}
                labelFormatter={(t: number) => fmtGmt(t)}
                formatter={(v: number | [number, number], k: string) =>
                  Array.isArray(v) ? [fmtUsd(v[1] - v[0], 0), "cushion"] : [fmtUsd(v, 2), k]
                }
              />
              <Area
                dataKey="cushion"
                stroke="none"
                fill="var(--gold-500)"
                fillOpacity={0.08}
                isAnimationActive={false}
              />
              <Line
                dataKey="hwm"
                stroke="var(--ink-2)"
                strokeDasharray="4 4"
                dot={false}
                strokeWidth={1}
                isAnimationActive={false}
              />
              <Line
                dataKey="floor"
                stroke="var(--breach)"
                strokeDasharray="2 3"
                dot={false}
                strokeWidth={1}
                isAnimationActive={false}
              />
              <Line
                dataKey="equity"
                stroke="var(--gold-400)"
                dot={false}
                strokeWidth={1.5}
                isAnimationActive={false}
              />
              {last && <ReferenceLine y={last.floor} stroke="var(--breach)" strokeOpacity={0.4} />}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  );
}

export function RiskMeter({
  engine,
  limits = DEFAULT_LIMITS,
}: {
  engine: HermesEngine;
  limits?: RiskLimits;
}) {
  const tot = engine.totals();
  const span = tot.hwm.minus(tot.floor).toNumber() || 1;
  const pos = Math.max(0, Math.min(1, tot.equity.minus(tot.floor).toNumber() / span));
  const cush = tot.equity.minus(tot.floor);
  const cap = Math.min(
    tot.equity.toNumber() * limits.maxRiskPctEquity,
    cush.toNumber() / limits.cushionDivisorTrade,
  );
  const openLimit = cush.toNumber() / limits.cushionDivisorOpen;
  const open = engine.openRisk().toNumber();
  const seg = [
    {
      label: "Floor",
      w: 0,
      tip: `floor = HWM × ${limits.floorRatio} = ${fmtUsd(tot.floor.toNumber(), 0)}`,
    },
  ];
  void seg;
  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <Label>Risk meter · floor → HWM</Label>
        <Num
          value={fmtPct(cush.div(tot.hwm).toNumber())}
          formula="cushion % = (equity − floor) / HWM"
          inputs={`(${fmtUsd(tot.equity.toNumber(), 0)} − ${fmtUsd(tot.floor.toNumber(), 0)}) / ${fmtUsd(tot.hwm.toNumber(), 0)}`}
        />
      </div>
      <div className="relative h-3 rounded-full bg-surface-3">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-breach/70 via-warn/60 to-pos/60"
          style={{ width: `${pos * 100}%` }}
        />
        <div
          className="absolute -top-1 h-5 w-0.5 bg-ink-0"
          style={{ left: `calc(${pos * 100}% - 1px)` }}
          title="equity"
        />
      </div>
      <div className="grid grid-cols-3 gap-3 text-[12px]">
        <div>
          <Label>Per-trade cap</Label>
          <Num
            value={fmtUsd(cap, 0)}
            formula="min(1.5% × equity, cushion / 8)"
            inputs={`1.5% × ${fmtUsd(tot.equity.toNumber(), 0)}; ${fmtUsd(cush.toNumber(), 0)} / ${limits.cushionDivisorTrade}`}
          />
          <span className="ml-1 text-ink-2">{fmtPct(cap / tot.equity.toNumber())}</span>
        </div>
        <div>
          <Label>Open risk / limit</Label>
          <Num
            value={`${fmtUsd(open, 0)} / ${fmtUsd(openLimit, 0)}`}
            formula="Σ risk at stop ≤ cushion / 3"
            inputs={`${engine.positions.length} positions; cushion ${fmtUsd(cush.toNumber(), 0)}`}
            className={open > openLimit ? "text-neg" : ""}
          />
        </div>
        <div>
          <Label>Floor</Label>
          <Num
            value={fmtUsd(tot.floor.toNumber(), 0)}
            formula="HWM × 0.92, ratchets up only"
            inputs={`HWM ${fmtUsd(tot.hwm.toNumber(), 0)}`}
          />
        </div>
      </div>
    </div>
  );
}

export function GoldGauge({ value, cap = 0.5 }: { value: number; cap?: number }) {
  const r = 46;
  const c = Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  const capAngle = Math.PI * (1 - cap);
  return (
    <div className="flex flex-col items-center">
      <svg
        viewBox="0 0 120 70"
        className="w-40"
        role="img"
        aria-label={`Gold exposure ${(v * 100).toFixed(0)} percent`}
      >
        <path
          d="M14 62 A46 46 0 0 1 106 62"
          fill="none"
          stroke="var(--surface-3)"
          strokeWidth="9"
          strokeLinecap="round"
        />
        <path
          d="M14 62 A46 46 0 0 1 106 62"
          fill="none"
          stroke={v > cap ? "var(--neg)" : "var(--gold-500)"}
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={`${c * v} ${c}`}
        />
        <line
          x1={60 + Math.cos(capAngle) * 38}
          y1={62 - Math.sin(capAngle) * 38}
          x2={60 + Math.cos(capAngle) * 54}
          y2={62 - Math.sin(capAngle) * 54}
          stroke="var(--breach)"
          strokeWidth="2"
        />
        <text x="60" y="58" textAnchor="middle" className="t-num" fill="var(--ink-0)" fontSize="16">
          {(v * 100).toFixed(0)}%
        </text>
      </svg>
      <div className="t-label mt-1">Gold share of open risk · cap 50%</div>
    </div>
  );
}

export function LossBrakes({
  engine,
  limits = DEFAULT_LIMITS,
}: {
  engine: HermesEngine;
  limits?: RiskLimits;
}) {
  const rows = (["G1", "G2", "G3", "G4"] as AgentCode[]).map((c) => {
    const a = engine.accounts[c];
    const day = a.dayStartEquity.minus(a.equity).div(a.dayStartEquity).toNumber();
    const week = a.weekStartEquity.minus(a.equity).div(a.weekStartEquity).toNumber();
    return {
      c,
      day,
      week,
      locked: a.lockedUntil !== null && engine.now < a.lockedUntil,
      code: a.lockCode,
    };
  });
  const worstDay = Math.max(...rows.map((r) => r.day));
  const worstWeek = Math.max(...rows.map((r) => r.week));
  const pill = (label: string, used: number, limit: number) => {
    const ok = used < limit;
    return (
      <div
        className={cn(
          "flex items-center justify-between rounded-md border px-3 py-2",
          ok ? "border-pos/30" : "border-breach/60",
        )}
      >
        <span
          className={cn("text-[11px] font-semibold tracking-wide", ok ? "text-pos" : "text-neg")}
        >
          {label} {ok ? "OK" : "BREACH"}
        </span>
        <Num
          value={`${fmtPct(Math.max(0, limit - Math.max(0, used)))} left`}
          formula={`headroom = ${limit * 100}% − worst account loss`}
          inputs={`worst ${fmtPct(Math.max(0, used))}`}
          className="text-[12px] text-ink-1"
        />
      </div>
    );
  };
  return (
    <div className="space-y-2">
      <Label>Loss brakes</Label>
      {pill("DAILY", worstDay, limits.dailyLossPct)}
      {pill("WEEKLY", worstWeek, limits.weeklyLossPct)}
      {rows
        .filter((r) => r.locked)
        .map((r) => (
          <div key={r.c} className="text-[11px] text-neg">
            {r.c} locked · {r.code}
          </div>
        ))}
    </div>
  );
}

const KIND_TONE: Record<string, string> = {
  REJECT: "text-neg",
  FILL: "text-pos",
  EXIT: "text-ink-0",
  BRAKE: "text-neg",
  KILL: "text-neg",
  ORDER: "text-info",
  EXPIRE: "text-ink-2",
  GATEWAY: "text-ink-1",
};
export function ActivityFeed() {
  const feed = useSim((s) => s.feed);
  const gw = useSim((s) => s.gatewayLive);
  const [sel, setSel] = useState<FeedItem | null>(null);
  const chain = useMemo(
    () =>
      sel?.ref ? gw.filter((g) => g.clientOrderId === sel.ref).sort((a, b) => a.seq - b.seq) : [],
    [sel, gw],
  );
  return (
    <>
      <div className="max-h-[640px] space-y-px overflow-y-auto">
        {feed.length === 0 &&
          Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-9 animate-pulse rounded bg-surface-2" />
          ))}
        {feed.slice(0, 120).map((f) => (
          <button
            key={f.id}
            onClick={() => setSel(f)}
            className="flex w-full items-start gap-3 rounded-md px-2 py-1.5 text-left hover:bg-surface-2"
          >
            <span className="t-num shrink-0 pt-px text-[11px] text-ink-3">{fmtTime(f.t)}</span>
            <span className={cn("t-label shrink-0 pt-0.5", KIND_TONE[f.kind])}>{f.kind}</span>
            {f.agent && <span className="t-num shrink-0 text-[11px] text-gold-400">{f.agent}</span>}
            <span className="min-w-0 flex-1 truncate text-[12px] text-ink-1">{f.text}</span>
          </button>
        ))}
      </div>
      <Sheet open={!!sel} onOpenChange={(o) => !o && setSel(null)}>
        <SheetContent className="w-[480px] border-line-1 bg-surface-1 sm:max-w-[480px]">
          <SheetHeader>
            <SheetTitle className="text-ink-0">
              {sel?.kind} · {sel?.agent ?? "portfolio"}
            </SheetTitle>
          </SheetHeader>
          {sel && (
            <div className="space-y-4 px-4 text-[13px]">
              <div className="t-num text-ink-2">{fmtGmt(sel.t, "yyyy-MM-dd HH:mm:ss")}</div>
              <p className="text-ink-0">{sel.text}</p>
              {sel.ref && (
                <div className="space-y-1">
                  <Label>Client order ID</Label>
                  <div className="t-mono text-ink-1">{sel.ref}</div>
                </div>
              )}
              {chain.length > 0 && (
                <div className="space-y-1">
                  <Label>Gateway chain</Label>
                  {chain.map((g) => (
                    <div
                      key={g.seq}
                      className="flex items-center justify-between rounded border border-line-0 px-2 py-1"
                    >
                      <span className="t-mono text-[12px]">
                        {g.seq}. {g.check}
                      </span>
                      <StatusPill status={g.result} />
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-3">
                {sel.ref && (
                  <Link
                    to="/gateway"
                    search={{ order: sel.ref }}
                    className="text-gold-400 hover:underline"
                  >
                    Open in Risk Gateway →
                  </Link>
                )}
                {sel.kind === "EXIT" && (
                  <Link to="/trades" className="text-gold-400 hover:underline">
                    Open Trade Log →
                  </Link>
                )}
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

export function agentSpark(engine: HermesEngine, c: AgentCode, n = 80): number[] {
  return downsample(engine.equityCurve.slice(-2000), n).map((p) => p.byAgent[c]);
}
export function AgentStatusCard({
  engine,
  code,
  name,
  status,
  budget,
}: {
  engine: HermesEngine;
  code: AgentCode;
  name: string;
  status: string;
  budget: number;
}) {
  const a = engine.accounts[code];
  const pnl = a.equity.minus(a.starting).toNumber();
  const total = engine.openRisk().toNumber();
  const goldRisk = engine.positions
    .filter((p) => p.agent === code && p.symbol === "XAUUSD")
    .reduce((s, p) => s + p.riskAtStop.toNumber(), 0);
  return (
    <Link
      to="/agents/$code"
      params={{ code }}
      className="card-t block p-4 transition-colors hover:border-line-gold"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="t-num text-[13px] text-gold-400">{code}</div>
          <div className="truncate text-[13px] text-ink-0">{name}</div>
        </div>
        <StatusPill status={status} />
      </div>
      <div className="mt-3 flex items-end justify-between gap-2">
        <div>
          <Label>Session P&amp;L</Label>
          <Num
            value={fmtUsd(pnl, 2, true)}
            className={pnl >= 0 ? "text-pos" : "text-neg"}
            formula="equity − session start equity"
            inputs={`realised ${fmtUsd(a.realized.toNumber())}, unrealised ${fmtUsd(a.unrealized.toNumber())}`}
          />
        </div>
        <Sparkline data={agentSpark(engine, code)} width={96} height={28} />
      </div>
      <div className="mt-2 flex justify-between text-[11px] text-ink-2">
        <span>
          budget{" "}
          <Num
            value={fmtPct(budget, 1)}
            className="text-ink-1"
            formula="budget_pct from overseer"
            inputs={status === "PROBATION" ? "probation → 25% effective" : "full"}
          />
        </span>
        <span>
          gold risk{" "}
          <Num
            value={total > 0 ? fmtPct(goldRisk / total, 0) : "0%"}
            className="text-ink-1"
            formula="agent XAUUSD risk / total open risk"
            inputs={`${fmtUsd(goldRisk, 0)} / ${fmtUsd(total, 0)}`}
          />
        </span>
      </div>
      <div className="mt-1 text-[11px] text-ink-3">cushion {fmtUsd(cushion(a).toNumber(), 0)}</div>
    </Link>
  );
}
export { AreaChart, Area };
