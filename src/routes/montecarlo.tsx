import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { BOOK_MC, type McSummary, type TailScenario } from "@/engine/montecarlo";
import { runMcPool } from "@/lib/hermes/mc";
import { mcQ, qk } from "@/lib/hermes/queries";
import { useMcCache } from "@/lib/hermes/store";
import { fmtGmt } from "@/lib/hermes/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { ChartCard, Label, Num, PageHeader, Panel, StatusPill } from "@/components/hermes/ui";

const TAILS: TailScenario[] = ["NONE", "10X_1_IN_300", "25X_1_IN_300"];
const BOOK_TABLE: Record<
  TailScenario,
  { label: string; median: number; pLose: number; tolMedian: number; tolP: number }
> = {
  NONE: {
    label: "No tail events (as published)",
    median: 0.4,
    pLose: 0.02,
    tolMedian: 0.05,
    tolP: 0.03,
  },
  "10X_1_IN_300": {
    label: "1 trade in 300 gaps to 10× the average loss",
    median: 1.13,
    pLose: 0.58,
    tolMedian: 0.1,
    tolP: 0.03,
  },
  "25X_1_IN_300": {
    label: "1 trade in 300 gaps to 25× the average loss",
    median: 2.69,
    pLose: 0.88,
    tolMedian: 0.15,
    tolP: 0.03,
  },
};
const Form = z.object({
  nTrades: z.coerce.number().int().min(10).max(5000),
  nRuns: z.coerce.number().int().min(100).max(100000),
  winRate: z.coerce.number().min(0.01).max(0.99),
  avgWinPct: z.coerce.number().positive().max(10),
  avgLossPct: z.coerce.number().positive().max(10),
  tail: z.enum(["NONE", "10X_1_IN_300", "25X_1_IN_300"]),
  seed: z.coerce
    .number()
    .int()
    .min(0)
    .max(2 ** 31 - 1),
});
type FormT = z.infer<typeof Form>;

export const Route = createFileRoute("/montecarlo")({
  validateSearch: (s: Record<string, unknown>): { seed?: number; tail?: string } => ({
    ...(s.seed !== undefined && Number.isFinite(Number(s.seed)) ? { seed: Number(s.seed) } : {}),
    ...(typeof s.tail === "string" ? { tail: s.tail } : {}),
  }),
  head: () => ({
    meta: [
      { title: "Monte Carlo Lab — HermesAgents" },
      {
        name: "description",
        content:
          "Reproduce the strategy book's 20,000-run Monte Carlo of 631 trades with rare gap losses.",
      },
      { property: "og:title", content: "Monte Carlo Lab — HermesAgents" },
      {
        property: "og:description",
        content: "Tail-injected Monte Carlo of Sonic-shaped trade sequences, run in your browser.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: MonteCarlo,
});

function MonteCarlo() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/montecarlo" });
  const qc = useQueryClient();
  const runs = useQuery(mcQ);
  const cache = useMcCache();
  const [summary, setSummary] = useState<McSummary | null>(null);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [table, setTable] = useState<Partial<Record<TailScenario, McSummary>>>({});
  const tailInit = TAILS.includes(search.tail as TailScenario)
    ? (search.tail as TailScenario)
    : "NONE";
  const { register, handleSubmit, formState, getValues } = useForm<FormT>({
    resolver: zodResolver(Form),
    defaultValues: {
      nTrades: BOOK_MC.nTrades,
      nRuns: BOOK_MC.nRuns,
      winRate: BOOK_MC.winRate,
      avgWinPct: BOOK_MC.avgWinPct,
      avgLossPct: BOOK_MC.avgLossPct,
      tail: tailInit,
      seed: search.seed ?? BOOK_MC.seed,
    },
  });

  const exec = async (v: FormT, persist = true): Promise<McSummary> => {
    const cfg = { ...v, months: 23, tailEvery: 300 };
    const res = await runMcPool(cfg, (s, done) => {
      setSummary(s);
      setProgress(done / v.nRuns);
    });
    const isBook =
      v.nTrades === BOOK_MC.nTrades &&
      v.winRate === BOOK_MC.winRate &&
      v.avgWinPct === BOOK_MC.avgWinPct &&
      v.avgLossPct === BOOK_MC.avgLossPct;
    if (isBook) cache.set(v.tail, res);
    if (persist) {
      const { error } = await supabase.from("monte_carlo_runs").insert({
        seed: v.seed,
        n_trades: v.nTrades,
        n_runs: v.nRuns,
        win_rate: v.winRate,
        avg_win_pct: v.avgWinPct,
        avg_loss_pct: v.avgLossPct,
        tail_scenario: v.tail,
        median_max_dd_pct: res.medianMaxDd,
        p95_max_dd_pct: res.p95MaxDd,
        p99_max_dd_pct: res.p99MaxDd,
        p_losing_month: res.pLosingMonth,
        finished_at: new Date().toISOString(),
        results: {
          ddHist: res.ddHist,
          terminalHist: res.terminalHist,
          paths: res.paths.slice(0, 40),
          medianTerminal: res.medianTerminal,
        } as unknown as Json,
      });
      if (error) toast.error(`Run not saved: ${error.message}`);
      qc.invalidateQueries({ queryKey: qk.mc });
    }
    return res;
  };
  const onRun = handleSubmit(async (v) => {
    setBusy(true);
    setProgress(0);
    navigate({ search: { seed: v.seed, tail: v.tail }, replace: true });
    try {
      await exec(v);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Monte Carlo failed");
    } finally {
      setBusy(false);
    }
  });
  const reproduce = async () => {
    setBusy(true);
    const out: Partial<Record<TailScenario, McSummary>> = {};
    try {
      for (const t of TAILS) {
        out[t] = await exec({
          ...getValues(),
          nTrades: BOOK_MC.nTrades,
          winRate: BOOK_MC.winRate,
          avgWinPct: BOOK_MC.avgWinPct,
          avgLossPct: BOOK_MC.avgLossPct,
          nRuns: BOOK_MC.nRuns,
          tail: t,
        });
        setTable({ ...out });
      }
      toast.success("Book table reproduced from 3 × 20,000 runs");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Monte Carlo failed");
    } finally {
      setBusy(false);
    }
  };
  const s = summary;
  const fan = s
    ? s.paths[0]!.map((_, i) =>
        Object.fromEntries([
          ["i", i],
          ...s.paths.slice(0, 100).map((p, k) => [`p${k}`, p[i] ?? null]),
        ]),
      )
    : [];
  const fld = (name: keyof FormT, label: string, step = "any") => (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Input
        type="number"
        step={step}
        {...register(name)}
        className="t-mono h-8 border-line-1 bg-surface-0"
      />
      {formState.errors[name] && (
        <p className="text-[11px] text-neg">{formState.errors[name]?.message}</p>
      )}
    </div>
  );
  return (
    <div>
      <PageHeader
        title="Monte Carlo Lab"
        sub="Independent trades with fixed win and loss sizes (book §1). Equity is additive in % of the starting balance; each run's seed derives from (seed, run index), so the URL reproduces the result exactly."
      >
        <Button variant="terminal" onClick={reproduce} disabled={busy}>
          Reproduce book table
        </Button>
      </PageHeader>
      <div className="grid gap-4 xl:grid-cols-[320px_1fr]">
        <Panel title="Configuration">
          <form onSubmit={onRun} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              {fld("nTrades", "Trades", "1")}
              {fld("nRuns", "Runs (≤ 100k)", "1")}
              {fld("winRate", "Win rate")}
              {fld("seed", "Seed", "1")}
              {fld("avgWinPct", "Avg win %")}
              {fld("avgLossPct", "Avg loss %")}
            </div>
            <div className="space-y-1">
              <Label>Tail scenario</Label>
              <select
                {...register("tail")}
                className="t-mono h-8 w-full rounded-md border border-line-1 bg-surface-0 px-2 text-[12px]"
              >
                {TAILS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <Button type="submit" variant="gold" className="w-full" disabled={busy}>
              {busy ? "Running…" : "Run in worker pool"}
            </Button>
            {(busy || progress > 0) && <Progress value={progress * 100} className="h-1.5" />}
          </form>
        </Panel>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
            {[
              [
                "Median max DD",
                s ? `${s.medianMaxDd.toFixed(3)}%` : "—",
                "median over runs of max(peak − equity)",
              ],
              [
                "P95 max DD",
                s ? `${s.p95MaxDd.toFixed(3)}%` : "—",
                "95th percentile of max drawdown",
              ],
              [
                "P99 max DD",
                s ? `${s.p99MaxDd.toFixed(3)}%` : "—",
                "99th percentile of max drawdown",
              ],
              [
                "P(losing month)",
                s ? `${(s.pLosingMonth * 100).toFixed(1)}%` : "—",
                "share of runs with any of 23 months < 0",
              ],
              [
                "Median terminal",
                s ? `${s.medianTerminal.toFixed(2)}%` : "—",
                "median Σ trade returns",
              ],
            ].map(([l, v, f]) => (
              <Panel key={l} bodyClass="p-3">
                <Label>{l}</Label>
                <div className="mt-1 text-[20px]">
                  <Num
                    value={v!}
                    formula={f!}
                    inputs={s ? `${s.runs.toLocaleString()} runs` : "no run yet"}
                  />
                </div>
              </Panel>
            ))}
          </div>
          <Panel title="Book table (page 2) · reproduced">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left">
                  <th className="t-label py-1">Scenario</th>
                  <th className="t-label">Book median DD</th>
                  <th className="t-label">Engine</th>
                  <th className="t-label">Book P(lose)</th>
                  <th className="t-label">Engine</th>
                  <th className="t-label">Within tolerance</th>
                </tr>
              </thead>
              <tbody>
                {TAILS.map((t) => {
                  const r = table[t] ?? cache.results[t];
                  const b = BOOK_TABLE[t];
                  const ok = r
                    ? Math.abs(r.medianMaxDd - b.median) <= b.tolMedian &&
                      Math.abs(r.pLosingMonth - b.pLose) <= b.tolP
                    : null;
                  return (
                    <tr key={t} className="border-t border-line-0 odd:bg-surface-2/40">
                      <td className="py-2 pr-3 text-ink-1">{b.label}</td>
                      <td className="t-num">{b.median.toFixed(2)}%</td>
                      <td className="t-num text-gold-400">
                        {r ? `${r.medianMaxDd.toFixed(3)}%` : "—"}
                      </td>
                      <td className="t-num">{(b.pLose * 100).toFixed(0)}%</td>
                      <td className="t-num text-gold-400">
                        {r ? `${(r.pLosingMonth * 100).toFixed(1)}%` : "—"}
                      </td>
                      <td>
                        {ok === null ? (
                          <span className="text-ink-3">run it</span>
                        ) : (
                          <StatusPill status={ok ? "PASS" : "FAIL"} />
                        )}
                        <span className="ml-2 text-[11px] text-ink-3">
                          ±{b.tolMedian}pp DD, ±{b.tolP * 100}pp P
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Panel>
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard
              name="mc-max-dd"
              title="Max drawdown distribution (%)"
              data={s?.ddHist ?? []}
            >
              <div className="h-52">
                <ResponsiveContainer>
                  <BarChart data={s?.ddHist ?? []}>
                    <CartesianGrid stroke="var(--border-0)" vertical={false} />
                    <XAxis
                      dataKey="x"
                      tickFormatter={(v: number) => v.toFixed(2)}
                      stroke="var(--ink-3)"
                      fontSize={10}
                    />
                    <YAxis stroke="var(--ink-3)" fontSize={10} width={40} />
                    <RTooltip
                      contentStyle={{
                        background: "var(--surface-1)",
                        border: "1px solid var(--border-1)",
                      }}
                    />
                    <Bar dataKey="n" fill="var(--gold-500)" isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </ChartCard>
            <ChartCard
              name="mc-terminal"
              title="Terminal equity distribution (% of start)"
              data={s?.terminalHist ?? []}
            >
              <div className="h-52">
                <ResponsiveContainer>
                  <BarChart data={s?.terminalHist ?? []}>
                    <CartesianGrid stroke="var(--border-0)" vertical={false} />
                    <XAxis
                      dataKey="x"
                      tickFormatter={(v: number) => v.toFixed(1)}
                      stroke="var(--ink-3)"
                      fontSize={10}
                    />
                    <YAxis stroke="var(--ink-3)" fontSize={10} width={40} />
                    <RTooltip
                      contentStyle={{
                        background: "var(--surface-1)",
                        border: "1px solid var(--border-1)",
                      }}
                    />
                    <Bar dataKey="n" fill="var(--info)" isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </ChartCard>
          </div>
          <ChartCard
            name="mc-fan"
            title="Fan chart · 100 sampled equity paths (% of start)"
            data={fan.slice(0, 200)}
          >
            <div className="h-64">
              <ResponsiveContainer>
                <LineChart data={fan}>
                  <CartesianGrid stroke="var(--border-0)" vertical={false} />
                  <XAxis dataKey="i" stroke="var(--ink-3)" fontSize={10} />
                  <YAxis stroke="var(--ink-3)" fontSize={10} width={40} />
                  {s?.paths.slice(0, 100).map((_, k) => (
                    <Line
                      key={k}
                      dataKey={`p${k}`}
                      dot={false}
                      stroke="var(--gold-500)"
                      strokeOpacity={0.18}
                      strokeWidth={1}
                      isAnimationActive={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>
          <Panel title="Persisted runs">
            <div className="max-h-64 overflow-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-left">
                    <th className="t-label">Finished</th>
                    <th className="t-label">Seed</th>
                    <th className="t-label">Scenario</th>
                    <th className="t-label">Runs</th>
                    <th className="t-label">Median DD</th>
                    <th className="t-label">P95</th>
                    <th className="t-label">P(lose)</th>
                  </tr>
                </thead>
                <tbody>
                  {(runs.data ?? []).map((r) => (
                    <tr
                      key={r.id}
                      className="cursor-pointer border-t border-line-0 hover:bg-surface-2"
                      onClick={() =>
                        navigate({ search: { seed: Number(r.seed), tail: r.tail_scenario } })
                      }
                    >
                      <td className="t-num py-1 text-ink-2">
                        {r.finished_at ? fmtGmt(r.finished_at) : "—"}
                      </td>
                      <td className="t-num">{r.seed}</td>
                      <td className="t-mono">{r.tail_scenario}</td>
                      <td className="t-num">{r.n_runs.toLocaleString()}</td>
                      <td className="t-num">{Number(r.median_max_dd_pct).toFixed(3)}%</td>
                      <td className="t-num">{Number(r.p95_max_dd_pct).toFixed(3)}%</td>
                      <td className="t-num">{(Number(r.p_losing_month) * 100).toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
