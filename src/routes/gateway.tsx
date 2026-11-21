import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useSim } from "@/lib/hermes/store";
import { gatewayQ, ordersQ, useSettings } from "@/lib/hermes/queries";
import { limitsOf } from "@/lib/hermes/bootstrap";
import { fmtGmt, fmtPct, fmtUsd } from "@/lib/hermes/format";
import { CHECK_INFO, REJECTION_CODES } from "@/engine/rejectionCodes";
import { cushion } from "@/engine/gateway";
import { GATEWAY_CHECKS, type GatewayCheck, type RejectCode } from "@/engine/types";
import { quantile } from "@/engine/stats";
import { cn } from "@/lib/utils";
import { ChartCard, Label, Num, PageHeader, Panel, StatusPill } from "@/components/hermes/ui";

interface Ev {
  key: string;
  clientOrderId: string;
  agent: string;
  seq: number;
  check: string;
  result: "PASS" | "FAIL";
  code: string | null;
  detail: Record<string, unknown>;
  t: number;
}

export const Route = createFileRoute("/gateway")({
  validateSearch: (
    s: Record<string, unknown>,
  ): { check?: string; code?: string; order?: string } => ({
    ...(typeof s.check === "string" ? { check: s.check } : {}),
    ...(typeof s.code === "string" ? { code: s.code } : {}),
    ...(typeof s.order === "string" ? { order: s.order } : {}),
  }),
  head: () => ({
    meta: [
      { title: "Risk Gateway — HermesAgents" },
      {
        name: "description",
        content:
          "Nine deterministic checks every order passes, with the live pass/fail chain and rejection statistics.",
      },
      { property: "og:title", content: "Risk Gateway — HermesAgents" },
      {
        property: "og:description",
        content:
          "Drawdown floor, per-trade cap, open risk, loss brakes, hygiene, market checks and kill switch.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Gateway,
});

function Gateway() {
  useSim((s) => s.version);
  const engine = useSim((s) => s.engine);
  const live = useSim((s) => s.gatewayLive);
  const db = useQuery(gatewayQ);
  const orders = useQuery(ordersQ);
  const settings = useSettings();
  const limits = limitsOf(settings.data?.risk_limits);
  const search = Route.useSearch();
  const nav = useNavigate({ from: "/gateway" });
  const [open, setOpen] = useState<Set<string>>(new Set(search.order ? [search.order] : []));

  const events = useMemo<Ev[]>(() => {
    const m = new Map<string, Ev>();
    for (const r of db.data ?? []) {
      const d = (r.detail ?? {}) as Record<string, unknown>;
      m.set(`${r.client_order_id}:${r.seq}`, {
        key: r.id,
        clientOrderId: r.client_order_id,
        agent: r.agent_code,
        seq: r.seq,
        check: r.check,
        result: r.result as "PASS",
        code: typeof d.code === "string" ? d.code : null,
        detail: d,
        t: new Date(r.occurred_at).getTime(),
      });
    }
    for (const g of live)
      m.set(`${g.clientOrderId}:${g.seq}`, {
        key: `${g.clientOrderId}:${g.seq}`,
        clientOrderId: g.clientOrderId,
        agent: g.agent,
        seq: g.seq,
        check: g.check,
        result: g.result,
        code: g.code,
        detail: g.detail,
        t: g.t,
      });
    return [...m.values()];
  }, [db.data, live]);

  const groups = useMemo(() => {
    const by = new Map<string, Ev[]>();
    for (const e of events) {
      const arr = by.get(e.clientOrderId) ?? [];
      arr.push(e);
      by.set(e.clientOrderId, arr);
    }
    let gs = [...by.entries()].map(([id, evs]) => {
      const sorted = evs.sort((a, b) => a.seq - b.seq);
      const fail = sorted.find((e) => e.result === "FAIL");
      return { id, evs: sorted, agent: sorted[0]!.agent, t: sorted[0]!.t, fail };
    });
    if (search.check) gs = gs.filter((g) => g.evs.some((e) => e.check === search.check));
    if (search.code) gs = gs.filter((g) => g.fail?.code === search.code);
    if (search.order) gs = gs.filter((g) => g.id === search.order);
    return gs.sort((a, b) => b.t - a.t).slice(0, 200);
  }, [events, search.check, search.code, search.order]);

  const rejByCode = useMemo(() => {
    const c: Record<string, number> = {};
    for (const e of events) if (e.result === "FAIL" && e.code) c[e.code] = (c[e.code] ?? 0) + 1;
    return Object.entries(c)
      .map(([code, n]) => ({ code, n }))
      .sort((a, b) => b.n - a.n);
  }, [events]);

  const exec = useMemo(() => {
    const filled = (orders.data ?? []).filter(
      (o) => o.state === "FILLED" && o.fill_px !== null && o.decision_px !== null,
    );
    const lat = filled.map(
      (o) => (new Date(o.filled_at!).getTime() - new Date(o.submitted_at).getTime()) / 60000,
    );
    const slip = filled.map(
      (o) => (Number(o.fill_px) - Number(o.decision_px)) * (o.side === "LONG" ? 1 : -1),
    );
    return {
      n: filled.length,
      latP50: quantile(lat, 0.5),
      slipP50: quantile(slip, 0.5),
      slipP95: quantile(slip, 0.95),
    };
  }, [orders.data]);

  const checkStatus = (
    c: GatewayCheck,
  ): { threshold: string; value: string; ok: boolean; formula: string } => {
    if (!engine) return { threshold: "—", value: "—", ok: true, formula: "" };
    const accts = Object.values(engine.accounts);
    const worst = accts.reduce((w, a) => (cushion(a).lt(cushion(w)) ? a : w));
    switch (c) {
      case "DRAWDOWN_FLOOR":
        return {
          threshold: `equity > HWM × ${limits.floorRatio}`,
          value: `${worst.agent} ${fmtUsd(worst.equity.toNumber(), 0)} vs ${fmtUsd(worst.floor.toNumber(), 0)}`,
          ok: accts.every((a) => a.equity.gt(a.floor)),
          formula: "worst account by cushion",
        };
      case "PER_TRADE_CAP": {
        const cap = Math.min(
          worst.equity.toNumber() * limits.maxRiskPctEquity,
          cushion(worst).toNumber() / limits.cushionDivisorTrade,
        );
        return {
          threshold: `≤ min(req, ${limits.maxRiskPctEquity * 100}% eq, cushion/${limits.cushionDivisorTrade})`,
          value: `${worst.agent} cap ${fmtUsd(cap, 0)}`,
          ok: cap > 0,
          formula: "min(1.5% × equity, cushion / 8)",
        };
      }
      case "TOTAL_OPEN_RISK": {
        const rows = accts.map((a) => ({
          a,
          open: engine.openRisk(a.agent).toNumber(),
          lim: cushion(a).toNumber() / limits.cushionDivisorOpen,
        }));
        const w = rows.reduce((x, y) => (y.open / (y.lim || 1) > x.open / (x.lim || 1) ? y : x));
        return {
          threshold: `Σ open ≤ cushion/${limits.cushionDivisorOpen}`,
          value: `${w.a.agent} ${fmtUsd(w.open, 0)} / ${fmtUsd(w.lim, 0)}`,
          ok: rows.every((r) => r.open <= r.lim + 0.01),
          formula: "highest utilisation account",
        };
      }
      case "LOSS_BRAKE": {
        const locked = accts.filter((a) => a.lockedUntil !== null && engine.now < a.lockedUntil);
        const day = Math.max(
          ...accts.map((a) => a.dayStartEquity.minus(a.equity).div(a.dayStartEquity).toNumber()),
        );
        return {
          threshold: `day < ${limits.dailyLossPct * 100}%, week < ${limits.weeklyLossPct * 100}%`,
          value: locked.length
            ? `${locked.map((a) => a.agent).join(",")} locked`
            : `worst day ${fmtPct(Math.max(0, day))}`,
          ok: locked.length === 0,
          formula: "(period start equity − equity) / period start equity",
        };
      }
      case "ORDER_HYGIENE":
        return {
          threshold: "stop · no grid · whitelist · size",
          value: `${engine.positions.length} open positions`,
          ok: engine.positions.every((p) => Number.isFinite(p.stopPx)),
          formula: "every open position carries a stop",
        };
      case "MARKET_CHECK": {
        const sp = engine.market.spread("XAUUSD");
        const med = engine.market.hourlyMedianSpread("XAUUSD");
        return {
          threshold: `spread ≤ ${limits.spreadMult}× hourly median`,
          value: `XAU ${sp.toFixed(3)} / ${(med * limits.spreadMult).toFixed(3)}`,
          ok: sp <= med * limits.spreadMult,
          formula: "XAUUSD spread vs median for this GMT hour",
        };
      }
      case "EXECUTION":
        return {
          threshold: "unique client order ID",
          value: `${engine.orders.size} IDs issued`,
          ok: true,
          formula: "idempotent IDs; atomic checkpoint every 2 s",
        };
      case "LOGGING":
        return {
          threshold: "decision · arrival · fill · horizon",
          value: `${engine.trades.length} trades logged`,
          ok: true,
          formula: "implementation-shortfall fields on every order",
        };
      case "KILL_SWITCH":
        return {
          threshold: "human-only",
          value: engine.killArmed ? "ARMED" : "safe",
          ok: !engine.killArmed,
          formula: "armed → every order rejects",
        };
    }
  };
  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div>
      <PageHeader
        title="Risk Gateway"
        sub="Every order from every agent passes the same nine checks in this order; the first failure rejects it. Click a check to filter the stream."
      />
      <div className="grid gap-4 xl:grid-cols-[420px_1fr]">
        <Panel title="Checks · live" bodyClass="p-2">
          <ol className="space-y-1">
            {GATEWAY_CHECKS.map((c, i) => {
              const s = checkStatus(c);
              const active = search.check === c;
              return (
                <li key={c}>
                  <button
                    onClick={() => nav({ search: active ? {} : { check: c } })}
                    className={cn(
                      "w-full rounded-md border px-3 py-2 text-left transition-colors",
                      active
                        ? "border-line-gold bg-surface-2"
                        : "border-transparent hover:bg-surface-2",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[13px]">
                        <span className="t-num mr-2 text-ink-3">{i + 1}</span>
                        {CHECK_INFO[c].title}
                      </span>
                      <StatusPill status={s.ok ? "PASS" : "FAIL"} />
                    </div>
                    <div className="mt-1 flex justify-between gap-2 text-[11px]">
                      <span className="text-ink-2">{s.threshold}</span>
                      <Num
                        value={s.value}
                        formula={CHECK_INFO[c].rule}
                        inputs={s.formula}
                        className="text-ink-1"
                        flash={false}
                      />
                    </div>
                  </button>
                </li>
              );
            })}
          </ol>
        </Panel>
        <Panel
          title={`Event stream · last ${groups.length} orders`}
          actions={
            (search.check || search.code || search.order) && (
              <button
                onClick={() => nav({ search: {} })}
                className="text-[11px] text-gold-400 hover:underline"
              >
                clear filter ({search.check ?? search.code ?? search.order})
              </button>
            )
          }
          bodyClass="p-2"
        >
          <div className="mb-2 flex flex-wrap gap-1 px-1">
            {(Object.keys(REJECTION_CODES) as RejectCode[]).map((c) => (
              <button
                key={c}
                onClick={() => nav({ search: search.code === c ? {} : { code: c } })}
                className={cn(
                  "t-mono rounded border px-1.5 py-0.5 text-[10px]",
                  search.code === c
                    ? "border-breach/60 text-neg"
                    : "border-line-0 text-ink-2 hover:text-ink-0",
                )}
              >
                {c}
              </button>
            ))}
          </div>
          <div className="max-h-[560px] space-y-px overflow-auto">
            {groups.length === 0 && (
              <div className="t-label py-10 text-center">
                {db.isLoading ? "loading…" : "No gateway events match"}
              </div>
            )}
            {groups.map((g) => (
              <div key={g.id} className={cn("rounded-md", g.fail && "bg-breach/5")}>
                <button
                  onClick={() => toggle(g.id)}
                  className="flex w-full items-center gap-3 px-2 py-1.5 text-left hover:bg-surface-2"
                >
                  <ChevronRight
                    className={cn(
                      "size-3.5 text-ink-3 transition-transform",
                      open.has(g.id) && "rotate-90",
                    )}
                  />
                  <span className="t-num text-[11px] text-ink-3">{fmtGmt(g.t, "MM-dd HH:mm")}</span>
                  <span className="t-num text-[11px] text-gold-400">{g.agent}</span>
                  <span className="t-mono min-w-0 flex-1 truncate text-[12px] text-ink-1">
                    {g.id}
                  </span>
                  {g.fail ? (
                    <span className="t-mono text-[11px] text-neg">{g.fail.code}</span>
                  ) : (
                    <span className="t-label text-pos">accepted</span>
                  )}
                </button>
                {g.fail?.code && (
                  <div className="px-9 pb-1 text-[12px] text-ink-2">
                    {REJECTION_CODES[g.fail.code as RejectCode]?.explain}
                  </div>
                )}
                {open.has(g.id) && (
                  <div className="space-y-px px-9 pb-2">
                    {g.evs.map((e) => (
                      <div
                        key={e.key}
                        className="flex items-center gap-3 rounded border border-line-0 px-2 py-1"
                      >
                        <span className="t-num w-4 text-[11px] text-ink-3">{e.seq}</span>
                        <span className="t-mono w-40 text-[11px]">{e.check}</span>
                        <StatusPill status={e.result} />
                        <span className="t-mono min-w-0 flex-1 truncate text-[11px] text-ink-2">
                          {Object.entries(e.detail)
                            .filter(([k]) => k !== "code")
                            .map(
                              ([k, v]) =>
                                `${k}=${typeof v === "number" ? +v.toFixed(4) : String(v)}`,
                            )
                            .join("  ")}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Panel>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1fr_1fr]">
        <ChartCard name="rejections-by-code" title="Rejections by code" data={rejByCode}>
          <div className="h-56">
            <ResponsiveContainer>
              <BarChart data={rejByCode} layout="vertical" margin={{ left: 40 }}>
                <CartesianGrid stroke="var(--border-0)" horizontal={false} />
                <XAxis type="number" stroke="var(--ink-3)" fontSize={10} />
                <YAxis
                  type="category"
                  dataKey="code"
                  stroke="var(--ink-3)"
                  fontSize={10}
                  width={120}
                />
                <RTooltip
                  contentStyle={{
                    background: "var(--surface-1)",
                    border: "1px solid var(--border-1)",
                  }}
                />
                <Bar dataKey="n" fill="var(--neg)" isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
        <Panel title="Execution quality · per broker">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Broker</Label>
              <span className="t-mono text-[12px]">SimBrokerAdapter</span>
            </div>
            <div className="flex items-center justify-between">
              <Label>Filled orders</Label>
              <Num value={String(exec.n)} />
            </div>
            <div className="flex items-center justify-between">
              <Label>P50 fill latency</Label>
              <Num
                value={`${exec.latP50.toFixed(1)} min`}
                formula="median(filled_at − submitted_at)"
                inputs="limit orders wait for the touch"
              />
            </div>
            <div className="flex items-center justify-between">
              <Label>P50 slippage vs decision</Label>
              <Num
                value={exec.slipP50.toFixed(4)}
                formula="median((fill − decision) × side)"
                inputs="price units"
              />
            </div>
            <div className="flex items-center justify-between">
              <Label>P95 slippage vs decision</Label>
              <Num
                value={exec.slipP95.toFixed(4)}
                formula="95th pct((fill − decision) × side)"
                inputs="price units"
              />
            </div>
          </div>
        </Panel>
        <Panel title="Broker comparison">
          <p className="text-[13px] text-ink-1">
            Quoted-versus-filled comparison across brokers becomes meaningful once a
            LiveBrokerAdapter is wired (Settings → Broker adapter). In SIM mode the only broker is
            the in-browser engine, so every order above was routed to it.
          </p>
        </Panel>
      </div>
    </div>
  );
}
