import { useMemo, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import Papa from "papaparse";
import { toast } from "sonner";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Download, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  agentsQ,
  datasetsQ,
  gatewayQ,
  ordersQ,
  qk,
  tradesQ,
  audit,
  type TradeRow,
} from "@/lib/hermes/queries";
import { useSim } from "@/lib/hermes/store";
import { PriceRowSchema } from "@/lib/hermes/schemas";
import { downloadText, fmtGmt, fmtHold, fmtUsd, signClass, toCsv } from "@/lib/hermes/format";
import { MARKETS } from "@/engine/markets";
import type { Sym } from "@/engine/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label, PageHeader, Panel, StatusPill } from "@/components/hermes/ui";
import { CandleChart } from "@/components/hermes/CandleChart";
import { cn } from "@/lib/utils";

const CHIPS: Record<string, string[]> = {
  G1: [
    "Aldridge Ch6 · Handa-Schwartz limit entry",
    "Aldridge Ch7 · variance ratio",
    "Aldridge Ch10 · S/R as liquidity",
    "Kissell Ch2 · session effects",
  ],
  G2: ["Aldridge Ch12 · event arbitrage", "DeFusco Ch7 · event study", "Kissell Ch12 · event days"],
  G3: ["Aldridge Ch13 · pairs", "DeFusco Ch10 · Engle–Granger", "Stefanini Ch7 · hidden direction"],
  G4: [
    "Stefanini Ch13 · trend following",
    "Kissell Ch13 · rebalance band",
    "Aldridge Ch14 · vol targeting",
  ],
};
const COLS = [
  "time",
  "agent",
  "symbol",
  "side",
  "qty",
  "entry",
  "exit",
  "hold",
  "gross",
  "spread",
  "comm",
  "slip",
  "swap",
  "net",
  "R",
  "exit",
  "reject",
];
const GRID =
  "grid-cols-[120px_44px_72px_52px_70px_84px_84px_64px_76px_64px_60px_60px_56px_80px_56px_60px_1fr]";

interface Row {
  id: string;
  kind: "TRADE" | "REJECT";
  t: number;
  agent: string;
  symbol: string;
  side: string;
  qty: number;
  entry: number | null;
  exit: number | null;
  hold: number | null;
  gross: number | null;
  spread: number | null;
  comm: number | null;
  slip: number | null;
  swap: number | null;
  net: number | null;
  r: number | null;
  reason: string | null;
  reject: string | null;
  trade: TradeRow | null;
  clientOrderId: string | null;
}

export const Route = createFileRoute("/trades")({
  validateSearch: (s: Record<string, unknown>): { id?: string } =>
    typeof s.id === "string" ? { id: s.id } : {},
  head: () => ({
    meta: [
      { title: "Trade Log — HermesAgents" },
      {
        name: "description",
        content:
          "Every simulated trade with its implementation-shortfall split, gateway chain and candle context.",
      },
      { property: "og:title", content: "Trade Log — HermesAgents" },
      {
        property: "og:description",
        content: "Trade log with delay, execution and missed-fill costs per trade.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Trades,
});

function Trades() {
  const trades = useQuery(tradesQ);
  const orders = useQuery(ordersQ);
  const agents = useQuery(agentsQ);
  const search = Route.useSearch();
  const nav = useNavigate({ from: "/trades" });
  const [agent, setAgent] = useState<string>("ALL");
  const [reason, setReason] = useState<string>("ALL");
  const [q, setQ] = useState("");
  const [showRejects, setShowRejects] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const code = (id: string) => agents.data?.find((a) => a.id === id)?.code ?? "?";

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = (trades.data ?? []).map((t) => ({
      id: t.id,
      kind: "TRADE",
      t: new Date(t.closed_at).getTime(),
      agent: code(t.agent_id),
      symbol: t.symbol,
      side: t.side,
      qty: Number(t.qty),
      entry: Number(t.entry_px),
      exit: Number(t.exit_px),
      hold: t.hold_seconds,
      gross: Number(t.gross_pnl),
      spread: Number(t.spread_cost),
      comm: Number(t.commission_cost),
      slip: Number(t.slippage_cost),
      swap: Number(t.swap_cost),
      net: Number(t.net_pnl),
      r: Number(t.r_multiple),
      reason: t.exit_reason,
      reject: null,
      trade: t,
      clientOrderId: t.client_order_id,
    }));
    if (showRejects) {
      for (const o of orders.data ?? []) {
        if (o.state !== "REJECTED") continue;
        out.push({
          id: o.id,
          kind: "REJECT",
          t: new Date(o.submitted_at).getTime(),
          agent: code(o.agent_id),
          symbol: o.symbol,
          side: o.side,
          qty: Number(o.qty),
          entry: o.limit_px !== null ? Number(o.limit_px) : Number(o.decision_px),
          exit: null,
          hold: null,
          gross: null,
          spread: null,
          comm: null,
          slip: null,
          swap: null,
          net: null,
          r: null,
          reason: null,
          reject: o.reject_reason,
          trade: null,
          clientOrderId: o.client_order_id,
        });
      }
    }
    return out
      .filter(
        (r) =>
          (agent === "ALL" || r.agent === agent) &&
          (reason === "ALL" || r.reason === reason || r.reject === reason) &&
          (!q ||
            `${r.symbol} ${r.clientOrderId ?? ""} ${r.reject ?? ""}`
              .toLowerCase()
              .includes(q.toLowerCase())),
      )
      .sort((a, b) => b.t - a.t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trades.data, orders.data, agents.data, agent, reason, q, showRejects]);

  const parent = useRef<HTMLDivElement>(null);
  const virt = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parent.current,
    estimateSize: () => 36,
    overscan: 12,
  });
  const [cursor, setCursor] = useState(0);
  const selected = rows.find((r) => r.id === search.id) ?? null;
  const exportCsv = () =>
    downloadText(
      `hermes-trades-${Date.now()}.csv`,
      toCsv(rows.map(({ trade: _t, ...r }) => ({ ...r, time: fmtGmt(r.t) }))),
    );
  const totals = rows.reduce(
    (a, r) => ({ net: a.net + (r.net ?? 0), n: a.n + (r.kind === "TRADE" ? 1 : 0) }),
    { net: 0, n: 0 },
  );

  return (
    <div>
      <PageHeader
        title="Trade Log"
        sub="Every simulated fill-to-exit, net of spread, commission, slippage and swap. Click a row for the candle context, the implementation-shortfall split and the gateway chain."
      >
        <Button variant="terminal" size="sm" onClick={() => setImportOpen(true)}>
          <Upload /> Import Price Data
        </Button>
        <Button variant="terminal" size="sm" onClick={exportCsv}>
          <Download /> Export CSV
        </Button>
      </PageHeader>
      <Panel bodyClass="p-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-line-0 p-3">
          <select
            value={agent}
            onChange={(e) => setAgent(e.target.value)}
            className="t-mono h-8 rounded-md border border-line-1 bg-surface-0 px-2 text-[12px]"
            aria-label="Agent filter"
          >
            {["ALL", "G1", "G2", "G3", "G4"].map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="t-mono h-8 rounded-md border border-line-1 bg-surface-0 px-2 text-[12px]"
            aria-label="Exit reason filter"
          >
            {[
              "ALL",
              "TARGET",
              "STOP",
              "TIME",
              "SIGNAL",
              "REGIME",
              "BRAKE",
              "KILL",
              "MANUAL",
              "TOTAL_OPEN_RISK",
              "PER_TRADE_CAP",
              "SPREAD_WIDE",
              "NEWS_BLACKOUT",
              "AVERAGING_DOWN",
              "KILL_ARMED",
            ].map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="symbol, client order ID, code…"
            className="h-8 w-64 border-line-1 bg-surface-0 text-[12px]"
          />
          <label className="flex items-center gap-2 text-[12px] text-ink-1">
            <input
              type="checkbox"
              checked={showRejects}
              onChange={(e) => setShowRejects(e.target.checked)}
            />{" "}
            include gateway rejections
          </label>
          <div className="ml-auto t-num text-[12px] text-ink-2">
            {totals.n} trades · net{" "}
            <span className={signClass(totals.net)}>{fmtUsd(totals.net, 2, true)}</span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <div className="min-w-[1280px]">
            <div className={cn("grid border-b border-line-0 px-3 py-2", GRID)}>
              {COLS.map((c, i) => (
                <div key={i} className="t-label">
                  {c}
                </div>
              ))}
            </div>
            <div
              ref={parent}
              tabIndex={0}
              className="h-[560px] overflow-auto outline-none focus-visible:ring-1 focus-visible:ring-gold-500"
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  const n = Math.min(rows.length - 1, cursor + 1);
                  setCursor(n);
                  virt.scrollToIndex(n);
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  const n = Math.max(0, cursor - 1);
                  setCursor(n);
                  virt.scrollToIndex(n);
                }
                if (e.key === "Enter" && rows[cursor]) nav({ search: { id: rows[cursor]!.id } });
                if (e.key === "Escape") nav({ search: {} });
              }}
            >
              {trades.isLoading &&
                Array.from({ length: 12 }).map((_, i) => (
                  <div key={i} className="mx-3 my-1 h-7 animate-pulse rounded bg-surface-2" />
                ))}
              {!trades.isLoading && rows.length === 0 && (
                <div className="t-label py-16 text-center">
                  No trades yet — the simulator writes them here as agents exit positions.
                </div>
              )}
              <div style={{ height: virt.getTotalSize(), position: "relative" }}>
                {virt.getVirtualItems().map((vi) => {
                  const r = rows[vi.index]!;
                  const d = (v: number | null) =>
                    v === null ? "" : v.toFixed(MARKETS[r.symbol as Sym]?.digits ?? 2);
                  const m = (v: number | null) => (v === null ? "" : v.toFixed(2));
                  return (
                    <button
                      key={r.id}
                      onClick={() => {
                        setCursor(vi.index);
                        nav({ search: { id: r.id } });
                      }}
                      className={cn(
                        "t-mono absolute left-0 grid w-full items-center px-3 text-left text-[12px] hover:bg-surface-2",
                        GRID,
                        vi.index % 2 && "bg-surface-2/30",
                        cursor === vi.index && "bg-surface-3",
                        r.kind === "REJECT" && "text-ink-2",
                      )}
                      style={{ top: vi.start, height: vi.size }}
                    >
                      <span className="text-ink-2">{fmtGmt(r.t, "MM-dd HH:mm")}</span>
                      <span className="text-gold-400">{r.agent}</span>
                      <span>{r.symbol}</span>
                      <span className={r.side === "LONG" ? "text-pos" : "text-neg"}>{r.side}</span>
                      <span>{r.qty.toFixed(2)}</span>
                      <span>{d(r.entry)}</span>
                      <span>{d(r.exit)}</span>
                      <span>{r.hold !== null ? fmtHold(r.hold) : ""}</span>
                      <span className={signClass(r.gross ?? 0)}>{m(r.gross)}</span>
                      <span className="text-ink-2">{m(r.spread)}</span>
                      <span className="text-ink-2">{m(r.comm)}</span>
                      <span className="text-ink-2">{m(r.slip)}</span>
                      <span className="text-ink-2">{m(r.swap)}</span>
                      <span className={signClass(r.net ?? 0)}>{m(r.net)}</span>
                      <span className={signClass(r.r ?? 0)}>
                        {r.r !== null ? r.r.toFixed(2) : ""}
                      </span>
                      <span className="text-ink-1">{r.reason ?? ""}</span>
                      <span className="truncate text-neg">{r.reject ?? ""}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </Panel>
      <TradeSheet row={selected} onClose={() => nav({ search: {} })} />
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} />
    </div>
  );
}

function TradeSheet({ row, onClose }: { row: Row | null; onClose: () => void }) {
  const gw = useQuery(gatewayQ);
  const engine = useSim((s) => s.engine);
  const t = row?.trade ?? null;
  const chain = (gw.data ?? [])
    .filter((g) => g.client_order_id === row?.clientOrderId)
    .sort((a, b) => a.seq - b.seq);
  const bars = useMemo(() => {
    if (!engine || !t) return [];
    const o = new Date(t.opened_at).getTime();
    const c = new Date(t.closed_at).getTime();
    const pad = Math.max(3 * 3_600_000, (c - o) * 0.5);
    const src = engine.market.m15(t.symbol as Sym);
    return src.filter((b) => b.t >= o - pad && b.t <= c + pad);
  }, [engine, t]);
  const levels = useMemo(
    () =>
      t
        ? [
            { price: Number(t.entry_px), label: "entry", color: "#E6B94F" },
            { price: Number(t.exit_px), label: "exit", color: "#B6BCC7" },
            { price: Number(t.stop_px), label: "stop", color: "#F87171" },
            ...(t.target_px !== null
              ? [{ price: Number(t.target_px), label: "target", color: "#34D399" }]
              : []),
          ]
        : [],
    [t],
  );
  const markers = useMemo(
    () =>
      t
        ? [
            {
              t: new Date(t.opened_at).getTime(),
              label: "IN",
              color: "#E6B94F",
              above: t.side === "SHORT",
            },
            {
              t: new Date(t.closed_at).getTime(),
              label: t.exit_reason,
              color: "#B6BCC7",
              above: t.side === "LONG",
            },
          ]
        : [],
    [t],
  );
  const wf = t
    ? [
        { k: "delay", v: -Number(t.delay_cost) },
        { k: "execution", v: -Number(t.execution_cost) },
        { k: "missed fill", v: -Number(t.missed_fill_cost) },
        { k: "spread", v: -Number(t.spread_cost) },
        { k: "commission", v: -Number(t.commission_cost) },
        { k: "slippage", v: -Number(t.slippage_cost) },
        { k: "swap", v: -Number(t.swap_cost) },
        { k: "net", v: Number(t.net_pnl) },
      ]
    : [];
  return (
    <Sheet open={!!row} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-[640px] overflow-y-auto border-line-1 bg-surface-1 sm:max-w-[640px]">
        <SheetHeader>
          <SheetTitle className="text-ink-0">
            {row?.agent} · {row?.symbol} {row?.side} {row?.kind === "REJECT" ? "· rejected" : ""}
          </SheetTitle>
        </SheetHeader>
        {row && (
          <div className="space-y-5 px-4 pb-8">
            <div className="t-mono text-[12px] text-ink-2">{row.clientOrderId}</div>
            {t && (
              <>
                {bars.length > 4 ? (
                  <CandleChart bars={bars} levels={levels} markers={markers} />
                ) : (
                  <div className="rounded-md border border-line-0 p-4 text-[12px] text-ink-2">
                    This trade is older than the engine's in-memory M15 window, so candles are not
                    available. Levels: entry {Number(t.entry_px)}, exit {Number(t.exit_px)}, stop{" "}
                    {Number(t.stop_px)}
                    {t.target_px !== null ? `, target ${Number(t.target_px)}` : ""}; MAE{" "}
                    {Number(t.mae_px)}, MFE {Number(t.mfe_px)}.
                  </div>
                )}
                <div>
                  <Label>Implementation shortfall · Kissell Ch3</Label>
                  <div className="mt-2 grid grid-cols-4 gap-2 text-[12px]">
                    {[
                      ["decision", t.decision_px],
                      ["arrival mid", t.arrival_mid],
                      ["fill", t.entry_px],
                      ["exit horizon", t.horizon_px],
                    ].map(([k, v]) => (
                      <div key={k as string} className="rounded border border-line-0 p-2">
                        <div className="t-label">{k as string}</div>
                        <div className="t-num">
                          {v === null
                            ? "—"
                            : Number(v).toFixed(MARKETS[t.symbol as Sym]?.digits ?? 2)}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 h-48">
                    <ResponsiveContainer>
                      <BarChart data={wf}>
                        <CartesianGrid stroke="var(--border-0)" vertical={false} />
                        <XAxis dataKey="k" stroke="var(--ink-3)" fontSize={10} />
                        <YAxis stroke="var(--ink-3)" fontSize={10} width={48} />
                        <RTooltip
                          contentStyle={{
                            background: "var(--surface-1)",
                            border: "1px solid var(--border-1)",
                          }}
                          formatter={(v: number) => fmtUsd(v, 2, true)}
                        />
                        <Bar dataKey="v" isAnimationActive={false}>
                          {wf.map((d) => (
                            <Cell key={d.k} fill={d.v >= 0 ? "var(--pos)" : "var(--neg)"} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="t-num mt-1 text-[12px] text-ink-2">
                    gross {fmtUsd(Number(t.gross_pnl), 2, true)} · R{" "}
                    {Number(t.r_multiple).toFixed(2)} · hold {fmtHold(t.hold_seconds)}
                  </div>
                </div>
              </>
            )}
            <div>
              <Label>Gateway event chain</Label>
              <div className="mt-2 space-y-px">
                {chain.length === 0 && (
                  <div className="text-[12px] text-ink-3">Not yet persisted.</div>
                )}
                {chain.map((g) => (
                  <div
                    key={g.id}
                    className="flex items-center gap-2 rounded border border-line-0 px-2 py-1"
                  >
                    <span className="t-num w-4 text-[11px] text-ink-3">{g.seq}</span>
                    <span className="t-mono flex-1 text-[11px]">{g.check}</span>
                    <StatusPill status={g.result} />
                  </div>
                ))}
              </div>
              {row.clientOrderId && (
                <Link
                  to="/gateway"
                  search={{ order: row.clientOrderId }}
                  className="mt-2 inline-block text-[12px] text-gold-400 hover:underline"
                >
                  Open in Risk Gateway →
                </Link>
              )}
            </div>
            <div>
              <Label>Book references</Label>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {(CHIPS[row.agent] ?? []).map((c) => (
                  <span
                    key={c}
                    className="rounded-full border border-line-gold px-2 py-0.5 text-[11px] text-gold-300"
                  >
                    {c}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function ImportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const datasets = useQuery({ ...datasetsQ, enabled: open });
  const [name, setName] = useState("xau-import");
  const [status, setStatus] = useState<string | null>(null);
  const onFile = (f: File) => {
    setStatus("Parsing…");
    Papa.parse<Record<string, string>>(f, {
      header: true,
      skipEmptyLines: true,
      complete: async (res) => {
        const good: { dataset: string; symbol: string; ts: string; bid: number; ask: number }[] =
          [];
        let bad = 0;
        for (const raw of res.data) {
          const p = PriceRowSchema.safeParse({
            timestamp: raw.timestamp ?? raw.time ?? raw.ts,
            bid: raw.bid,
            ask: raw.ask,
          });
          if (!p.success) {
            bad++;
            continue;
          }
          const ts = /^\d{10,13}$/.test(p.data.timestamp)
            ? new Date(Number(p.data.timestamp) * (p.data.timestamp.length === 10 ? 1000 : 1))
            : new Date(p.data.timestamp);
          good.push({
            dataset: name,
            symbol: "XAUUSD",
            ts: ts.toISOString(),
            bid: p.data.bid,
            ask: p.data.ask,
          });
        }
        if (!good.length) {
          setStatus(`No valid rows (${bad} rejected). Expected columns: timestamp, bid, ask.`);
          return;
        }
        for (let i = 0; i < good.length; i += 1000) {
          setStatus(
            `Writing ${Math.min(good.length, i + 1000).toLocaleString()} / ${good.length.toLocaleString()}…`,
          );
          const { error } = await supabase.from("price_data").insert(good.slice(i, i + 1000));
          if (error) {
            setStatus(`Write failed: ${error.message}`);
            toast.error(error.message);
            return;
          }
        }
        await audit("PRICE_DATA_IMPORT", "price_data", null, null, {
          dataset: name,
          rows: good.length,
          rejected: bad,
        });
        qc.invalidateQueries({ queryKey: qk.datasets });
        setStatus(
          `Imported ${good.length.toLocaleString()} quotes into “${name}” (${bad} rejected). Select it as the feed in Backtest Studio.`,
        );
        toast.success("Price data imported");
      },
      error: (err) => setStatus(`Parse error: ${err.message}`),
    });
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-line-1 bg-surface-1">
        <DialogHeader>
          <DialogTitle>Import price data</DialogTitle>
          <DialogDescription className="text-ink-1">
            CSV with columns timestamp, bid, ask (XAUUSD). Every row is validated; bars are built by
            last-quote sampling with no interpolation.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Dataset name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value.replace(/[^\w-]/g, ""))}
              className="t-mono border-line-1 bg-surface-0"
            />
          </div>
          <Input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
            className="border-line-1 bg-surface-0"
          />
          {status && <p className="text-[12px] text-ink-1">{status}</p>}
          {(datasets.data ?? []).length > 0 && (
            <div className="text-[12px] text-ink-2">
              Existing: {(datasets.data ?? []).map((d) => d.dataset).join(", ")}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
