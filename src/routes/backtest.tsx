import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { datasetsQ, settingsQ, useAgents, useSteps } from "@/lib/hermes/queries";
import { gridOf, paramsOf } from "@/lib/hermes/bootstrap";
import { saveParams } from "@/lib/hermes/actions";
import { runInWorker } from "@/lib/hermes/workerClient";
import { useGridCache } from "@/lib/hermes/store";
import { fmtGmt } from "@/lib/hermes/format";
import { plateauMask, type BacktestMetrics, type BacktestSpec } from "@/engine/backtest";
import { quotesToBars } from "@/engine/broker";
import { MARKETS } from "@/engine/markets";
import { REAL_FEEDS, fetchRealGoldM1, type RealFeedId } from "@/lib/hermes/marketdata.functions";
import type { AgentCode, Bar } from "@/engine/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { ChartCard, Label, Num, PageHeader, Panel, StatusPill } from "@/components/hermes/ui";
import { Heatmap } from "@/components/hermes/Heatmap";

type RunResult = {
  metrics: BacktestMetrics;
  dailyEquity: { t: number; equity: number }[];
  hash: string;
  baseline: { p: number; t: number; meanStrat: number; meanRandom: number; n: number } | null;
};
const METRICS: (keyof BacktestMetrics)[] = [
  "sharpe",
  "maxDdPct",
  "hitRate",
  "profitFactor",
  "expectancyR",
  "trades",
];

export const Route = createFileRoute("/backtest")({
  validateSearch: (s: Record<string, unknown>): { agent?: string } =>
    typeof s.agent === "string" ? { agent: s.agent } : {},
  head: () => ({
    meta: [
      { title: "Backtest Studio — HermesAgents" },
      {
        name: "description",
        content:
          "Parameter grids, plateau heatmaps, random-entry baselines, 2× spread and tail-injection reruns on the shared engine.",
      },
      { property: "og:title", content: "Backtest Studio — HermesAgents" },
      { property: "og:description", content: "Only parameters on a flat plateau can be promoted." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Backtest,
});

const realCache = new Map<string, Bar[]>();
async function loadDataset(name: string, days = 30): Promise<Bar[]> {
  if (name in REAL_FEEDS) {
    const key = `${name}:${days}`;
    const hit = realCache.get(key);
    if (hit) return hit;
    const r = await fetchRealGoldM1({ data: { feed: name as RealFeedId, days: Math.min(days, 60) } });
    if (!r.bars.length) throw new Error("The data provider returned no bars");
    // Real feeds carry no quoted spread: use the book's XAUUSD base spread, scaled to price level.
    const k = MARKETS.XAUUSD.baseSpread / MARKETS.XAUUSD.px0;
    const bars = r.bars.map((b) => ({ ...b, spread: b.c * k }));
    realCache.set(key, bars);
    return bars;
  }
  const rows: { ts: string; bid: number; ask: number }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("price_data")
      .select("ts,bid,ask")
      .eq("dataset", name)
      .order("ts")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []).map((r) => ({ ts: r.ts, bid: Number(r.bid), ask: Number(r.ask) })));
    if (!data || data.length < 1000 || rows.length >= 200_000) break;
  }
  return quotesToBars(rows.map((r) => ({ t: new Date(r.ts).getTime(), bid: r.bid, ask: r.ask })));
}

function Backtest() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/backtest" });
  const agents = useAgents();
  const steps = useSteps();
  const settings = useQuery(settingsQ);
  const datasets = useQuery(datasetsQ);
  const qc = useQueryClient();
  const gridCache = useGridCache();
  const code = (
    ["G1", "G2", "G3", "G4"].includes(search.agent ?? "") ? search.agent : "G1"
  ) as AgentCode;
  const agent = agents.data?.find((a) => a.code === code);
  const grid = agent ? gridOf(agent) : {};
  const keys = Object.keys(grid);
  const [pa, setPa] = useState<string | null>(null);
  const [pb, setPb] = useState<string | null>(null);
  const paramA = pa && keys.includes(pa) ? pa : (keys[0] ?? "");
  const paramB = pb && keys.includes(pb) ? pb : (keys[1] ?? keys[0] ?? "");
  const [days, setDays] = useState(60);
  const [feed, setFeed] = useState("synthetic");
  const [metric, setMetric] = useState<keyof BacktestMetrics>("sharpe");
  const [cells, setCells] = useState<(BacktestMetrics | null)[][]>([]);
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState(0);
  const [sel, setSel] = useState<[number, number] | null>(null);
  const [cmp, setCmp] = useState<{ base?: RunResult; wide?: RunResult; tail?: RunResult }>({});
  const seed = Number(settings.data?.sim_seed ?? 20261109);
  const run = gridCache.runs[code];
  const va = grid[paramA] ?? [];
  const vb = grid[paramB] ?? [];

  const spec = async (
    params: Record<string, unknown>,
    extra: Partial<BacktestSpec> = {},
  ): Promise<BacktestSpec> => ({
    agent: code,
    params: params as BacktestSpec["params"],
    seed,
    days,
    ...(feed !== "synthetic" ? { historical: await loadDataset(feed, days) } : {}),
    ...extra,
  });

  const runGrid = async () => {
    if (!agent || !va.length || !vb.length) return;
    setBusy(true);
    setSel(null);
    setProg(0);
    const out: (BacktestMetrics | null)[][] = va.map(() => vb.map(() => null));
    setCells(out.map((r) => [...r]));
    let done = 0;
    try {
      const base = paramsOf(agent);
      const hist = feed !== "synthetic" ? await loadDataset(feed, days) : null;
      await Promise.all(
        va.flatMap((a, i) =>
          vb.map(async (b, j) => {
            const s: BacktestSpec = {
              agent: code,
              params: { ...base, [paramA]: a, [paramB]: b },
              seed,
              days,
              ...(hist ? { historical: hist } : {}),
            };
            const r = await runInWorker<RunResult>({ type: "backtest", spec: s });
            out[i]![j] = r.metrics;
            done++;
            setProg(done / (va.length * vb.length));
            setCells(out.map((row) => [...row]));
          }),
        ),
      );
      const g = out.map((row) => row.map((m) => (m ? Number(m[metric]) : NaN)));
      gridCache.set({
        agent: code,
        paramA,
        paramB,
        valuesA: va,
        valuesB: vb,
        metric,
        grid: g,
        plateau: plateauMask(metric === "maxDdPct" ? g.map((r) => r.map((v) => -v)) : g),
        ranAt: Date.now(),
      });
      toast.success(`Grid complete · ${va.length * vb.length} backtests`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Grid failed");
    } finally {
      setBusy(false);
    }
  };
  const runCompare = async () => {
    if (!agent) return;
    setBusy(true);
    try {
      const p =
        sel && run
          ? {
              ...paramsOf(agent),
              [run.paramA]: run.valuesA[sel[0]]!,
              [run.paramB]: run.valuesB[sel[1]]!,
            }
          : paramsOf(agent);
      const [base, wide, tail] = await Promise.all([
        runInWorker<RunResult>({ type: "backtest", spec: await spec(p), baseline: true }),
        runInWorker<RunResult>({ type: "backtest", spec: await spec(p, { spreadMultiplier: 2 }) }),
        runInWorker<RunResult>({
          type: "backtest",
          spec: await spec(p, { tailInjection: { every: 300, mult: 10 } }),
        }),
      ]);
      setCmp({ base, wide, tail });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Backtest failed");
    } finally {
      setBusy(false);
    }
  };
  const plateauOk = !!(sel && run?.plateau[sel[0]]?.[sel[1]]);
  const promote = async () => {
    if (!agent || !sel || !run || !plateauOk) return;
    await saveParams(
      qc,
      agent,
      {
        ...paramsOf(agent),
        [run.paramA]: run.valuesA[sel[0]]!,
        [run.paramB]: run.valuesB[sel[1]]!,
      },
      grid,
    );
    toast.success(
      `Promoted ${run.paramA}=${run.valuesA[sel[0]]}, ${run.paramB}=${run.valuesB[sel[1]]} to ${code}`,
    );
  };
  const g = run?.grid ?? cells.map((r) => r.map((m) => (m ? Number(m[metric]) : NaN)));
  const pm = run?.plateau ?? g.map((r) => r.map(() => false));
  const curve = (cmp.base?.dailyEquity ?? []).map((d, i) => ({
    t: d.t,
    base: d.equity,
    wide: cmp.wide?.dailyEquity[i]?.equity ?? null,
    tail: cmp.tail?.dailyEquity[i]?.equity ?? null,
  }));
  const step7 = steps.data?.find((s) => s.agent_id === agent?.id && s.step === 7);
  const sel2 = (v: string, set: (s: string) => void, label: string) => (
    <div className="space-y-1">
      <Label>{label}</Label>
      <select
        value={v}
        onChange={(e) => set(e.target.value)}
        className="t-mono h-8 w-full rounded-md border border-line-1 bg-surface-0 px-2 text-[12px]"
      >
        {keys.map((k) => (
          <option key={k}>{k}</option>
        ))}
      </select>
    </div>
  );
  return (
    <div>
      <PageHeader
        title="Backtest Studio"
        sub="Grids run the same engine module as the live simulator in a worker pool. Only cells on a flat plateau (3×3 median filter) can be promoted."
      />
      <div className="grid gap-4 xl:grid-cols-[300px_1fr]">
        <Panel title="Setup">
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Agent</Label>
              <div className="grid grid-cols-4 gap-1">
                {(["G1", "G2", "G3", "G4"] as const).map((c) => (
                  <button
                    key={c}
                    onClick={() => {
                      navigate({ search: { agent: c } });
                      setCells([]);
                      setCmp({});
                      setSel(null);
                    }}
                    className={`t-num h-8 rounded-md border text-[12px] ${c === code ? "border-line-gold text-gold-400" : "border-line-1 text-ink-2"}`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1">
              <Label>Feed</Label>
              <select
                value={feed}
                onChange={(e) => setFeed(e.target.value)}
                className="t-mono h-8 w-full rounded-md border border-line-1 bg-surface-0 px-2 text-[12px]"
              >
                <option value="synthetic">Synthetic · seed {seed}</option>
                {(Object.keys(REAL_FEEDS) as RealFeedId[]).map((k) => (
                  <option key={k} value={k}>
                    {REAL_FEEDS[k].label} · max {REAL_FEEDS[k].maxDays}d
                  </option>
                ))}
                {(datasets.data ?? []).map((d) => (
                  <option key={d.dataset} value={d.dataset}>
                    Imported · {d.dataset}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label>Days (synthetic / real)</Label>
              <Input
                type="number"
                min={10}
                max={365}
                value={days}
                onChange={(e) => setDays(Math.max(10, Math.min(365, Number(e.target.value) || 60)))}
                className="t-mono h-8 border-line-1 bg-surface-0"
              />
            </div>
            {sel2(paramA, setPa, "Param A (rows)")}
            {sel2(paramB, setPb, "Param B (cols)")}
            <div className="space-y-1">
              <Label>Cell metric</Label>
              <select
                value={metric}
                onChange={(e) => setMetric(e.target.value as keyof BacktestMetrics)}
                className="t-mono h-8 w-full rounded-md border border-line-1 bg-surface-0 px-2 text-[12px]"
              >
                {METRICS.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </div>
            <Button variant="gold" className="w-full" disabled={busy || !agent} onClick={runGrid}>
              Run grid · {va.length * vb.length} cells
            </Button>
            <Button
              variant="terminal"
              className="w-full"
              disabled={busy || !agent}
              onClick={runCompare}
            >
              Run baseline · 2× spread · tail
            </Button>
            {busy && <Progress value={prog * 100} className="h-1.5" />}
          </div>
        </Panel>
        <div className="space-y-4">
          <Panel
            title={`Plateau heatmap · ${metric}${run ? ` · ${fmtGmt(run.ranAt)}` : ""}`}
            actions={
              <Button
                size="xs"
                variant={plateauOk ? "gold" : "terminal"}
                disabled={!plateauOk}
                onClick={promote}
                title={
                  plateauOk
                    ? "Write these values to the agent"
                    : "Select a gold-outlined plateau cell"
                }
              >
                Promote to Agents
              </Button>
            }
          >
            {g.length ? (
              <div className="flex flex-wrap items-start gap-6">
                <Heatmap
                  valuesA={run?.valuesA ?? va}
                  valuesB={run?.valuesB ?? vb}
                  grid={g}
                  plateau={pm}
                  paramA={run?.paramA ?? paramA}
                  paramB={run?.paramB ?? paramB}
                  selected={sel}
                  onSelect={(i, j) => setSel([i, j])}
                  fmt={(v) => (Number.isFinite(v) ? v.toFixed(metric === "trades" ? 0 : 2) : "…")}
                />
                {sel && cells[sel[0]]?.[sel[1]] && (
                  <div className="grid grid-cols-2 gap-3 text-[12px]">
                    {METRICS.map((m) => (
                      <div key={m}>
                        <Label>{m}</Label>
                        <Num value={Number(cells[sel[0]]![sel[1]]![m]).toFixed(3)} flash={false} />
                      </div>
                    ))}
                    <div className="col-span-2">
                      <StatusPill status={plateauOk ? "PASS" : "FAIL"} />{" "}
                      <span className="ml-1 text-ink-2">
                        {plateauOk ? "on plateau" : "isolated / below median — not promotable"}
                      </span>
                    </div>
                    <div className="col-span-2 text-ink-3">
                      Validation step 7: {step7?.status ?? "—"}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="py-12 text-center text-[12px] text-ink-3">
                Run a grid to render the heatmap.
              </div>
            )}
          </Panel>
          <div className="grid gap-4 md:grid-cols-3">
            {(["base", "wide", "tail"] as const).map((k) => {
              const r = cmp[k];
              return (
                <Panel
                  key={k}
                  title={
                    k === "base"
                      ? "Base run · random baseline"
                      : k === "wide"
                        ? "2× spread rerun"
                        : "Tail injection · 10× loss / 300 trades"
                  }
                >
                  {r ? (
                    <div className="grid grid-cols-2 gap-2 text-[12px]">
                      {METRICS.map((m) => (
                        <div key={m}>
                          <Label>{m}</Label>
                          <Num value={Number(r.metrics[m]).toFixed(3)} flash={false} />
                        </div>
                      ))}
                      {k === "base" && r.baseline && (
                        <div className="col-span-2 rounded border border-line-0 p-2">
                          <Label>Paired t-test vs random</Label>
                          <div className="t-num">
                            p = {r.baseline.p.toFixed(4)} · t = {r.baseline.t.toFixed(2)} · n ={" "}
                            {r.baseline.n}
                          </div>
                          <div className="t-num text-ink-2">
                            mean R {r.baseline.meanStrat.toFixed(3)} vs{" "}
                            {r.baseline.meanRandom.toFixed(3)}
                          </div>
                        </div>
                      )}
                      <div
                        className="t-mono col-span-2 truncate text-[10px] text-ink-3"
                        title={r.hash}
                      >
                        sha256 {r.hash.slice(0, 24)}…
                      </div>
                    </div>
                  ) : (
                    <div className="py-6 text-center text-[12px] text-ink-3">—</div>
                  )}
                </Panel>
              );
            })}
          </div>
          <ChartCard
            name="backtest-equity"
            title="Daily equity · base vs 2× spread vs tail"
            data={curve}
          >
            <div className="h-60">
              <ResponsiveContainer>
                <LineChart data={curve}>
                  <CartesianGrid stroke="var(--border-0)" vertical={false} />
                  <XAxis
                    dataKey="t"
                    tickFormatter={(t: number) => fmtGmt(t, "MM-dd")}
                    stroke="var(--ink-3)"
                    fontSize={10}
                  />
                  <YAxis domain={["auto", "auto"]} stroke="var(--ink-3)" fontSize={10} width={56} />
                  <RTooltip
                    contentStyle={{
                      background: "var(--surface-1)",
                      border: "1px solid var(--border-1)",
                    }}
                    labelFormatter={(t: number) => fmtGmt(t)}
                  />
                  <Line
                    dataKey="base"
                    stroke="var(--gold-400)"
                    dot={false}
                    isAnimationActive={false}
                  />
                  <Line dataKey="wide" stroke="var(--info)" dot={false} isAnimationActive={false} />
                  <Line dataKey="tail" stroke="var(--neg)" dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>
        </div>
      </div>
    </div>
  );
}
