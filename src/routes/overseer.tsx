import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import {
  audit,
  decisionsQ,
  qk,
  reportsQ,
  settingsQ,
  tradesQ,
  useAgents,
} from "@/lib/hermes/queries";
import { buildReportCard, type ReportCard } from "@/lib/hermes/reportCard";
import { syncEngineFromAgents } from "@/lib/hermes/actions";
import { useSim } from "@/lib/hermes/store";
import { fmtGmt, fmtPct } from "@/lib/hermes/format";
import { applyLlmCut, runOverseer, type OverseerDecision } from "@/engine/overseer";
import type { AgentCode } from "@/engine/types";
import { overseerLlmReview } from "@/lib/hermes/overseer.functions";
import { Button } from "@/components/ui/button";
import { ChartCard, Label, Num, PageHeader, Panel, StatusPill } from "@/components/hermes/ui";
import { ReportCardView } from "@/components/hermes/ReportCardView";

export const Route = createFileRoute("/overseer")({
  head: () => ({
    meta: [
      { title: "Overseer — HermesAgents" },
      {
        name: "description",
        content:
          "Budget allocation by report card: shrink toward equal, probation, cut fast / add slowly, gold cap and tail ranking.",
      },
      { property: "og:title", content: "Overseer — HermesAgents" },
      {
        property: "og:description",
        content: "Every budget decision logged with its inputs and stated reason.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Overseer,
});

const GOLD_SHARE: Record<AgentCode, number> = { G1: 1, G2: 1, G3: 0.5, G4: 0.2 };

function Overseer() {
  const agents = useAgents();
  const trades = useQuery(tradesQ);
  const decisions = useQuery(decisionsQ);
  const reports = useQuery(reportsQ);
  const settings = useQuery(settingsQ);
  const engine = useSim((s) => s.engine);
  const qc = useQueryClient();
  const review = useServerFn(overseerLlmReview);
  const [proposal, setProposal] = useState<{
    decisions: OverseerDecision[];
    goldShare: number;
    shrinkage: number;
    model: string;
    llmNote: string | null;
    cards: Record<string, ReportCard | null>;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  const cards = useMemo(
    () =>
      Object.fromEntries(
        (agents.data ?? []).map((a) => [
          a.code,
          buildReportCard(
            (trades.data ?? []).filter((t) => t.agent_id === a.id),
            25000,
            engine,
          ),
        ]),
      ),
    [agents.data, trades.data, engine],
  );

  const propose = async () => {
    if (!agents.data) return;
    setBusy(true);
    try {
      const inputs = agents.data.map((a) => {
        const rc = cards[a.code];
        const r = rc?.dailyReturns ?? [];
        const lastDec = (decisions.data ?? []).find((d) => d.agent_id === a.id && d.applied);
        return {
          code: a.code as AgentCode,
          status: a.status,
          budget: Number(a.budget_pct),
          dailyReturns: r,
          expectedDailyPnl: rc?.expectedDailyPnl ?? 0,
          sigmaExpectedDaily: rc?.sigmaExpectedDaily ?? 0,
          realizedPnl: rc?.realizedPnl ?? 0,
          windowDays: Math.max(1, Math.ceil((rc?.days ?? 0) / 2)),
          maxDdPct: rc?.maxDdPct ?? 0,
          goldShareOfRisk: GOLD_SHARE[a.code as AgentCode],
          factors: { gold: [], dxy: [], nas: [] },
          lastAction: ((lastDec?.decision as { action?: string } | null)?.action ?? null) as
            OverseerDecision["action"] | null,
        };
      });
      const out = runOverseer(inputs);
      let model = "rule-engine-fallback";
      let llmNote: string | null = null;
      if (settings.data?.overseer_use_llm) {
        const res = await review({
          data: {
            agents: out.decisions.map((d) => ({
              code: d.code,
              ruleBudget: d.budgetTo,
              summary: {
                z: d.z,
                sharpe: d.sharpeAnnual,
                alphaT: d.alphaT,
                probation: d.probation,
                tail: d.tailScore,
              },
            })),
          },
        });
        model = res.model;
        llmNote = res.error;
        if (res.budgets)
          for (const d of out.decisions) {
            const l = res.budgets.find((b) => b.code === d.code);
            const cut = applyLlmCut(d.budgetTo, l?.budget);
            if (cut < d.budgetTo) {
              d.reason += ` DeepSeek cut: ${l?.reason ?? ""}`;
              d.budgetTo = cut;
            }
          }
      }
      setProposal({ ...out, model, llmNote, cards });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Proposal failed");
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!proposal || !agents.data) return;
    setBusy(true);
    try {
      for (const d of proposal.decisions) {
        const a = agents.data.find((x) => x.code === d.code)!;
        const rc = proposal.cards[d.code];
        const input = {
          z: d.z,
          sharpeAnnual: d.sharpeAnnual,
          sharpeT: d.sharpeTStat,
          ambiguityPenalty: d.ambiguityPenalty,
          alpha: d.alpha,
          alphaT: d.alphaT,
          betas: d.betas,
          probation: d.probation,
          requiredMonths: Number.isFinite(d.requiredMonths) ? d.requiredMonths : null,
          liveMonths: d.liveMonths,
          tailScore: d.tailScore,
          report: rc ? { ...rc, dailyReturns: undefined } : null,
        };
        const decision = {
          action: d.action,
          budget_from: d.budgetFrom,
          budget_to: d.budgetTo,
          reason: d.reason,
        };
        const changed = Math.abs(d.budgetTo - d.budgetFrom) > 1e-6;
        const auditId = await audit(
          `OVERSEER_${d.action}`,
          "agents",
          a.id,
          { budget_pct: d.budgetFrom },
          { budget_pct: d.budgetTo, reason: d.reason, model: proposal.model },
          "overseer",
        );
        const { error } = await supabase.from("overseer_decisions").insert({
          agent_id: a.id,
          input: input as unknown as Json,
          decision: decision as Json,
          model: proposal.model,
          applied: true,
          audit_id: auditId,
        });
        if (error) throw new Error(error.message);
        if (changed) {
          const { error: e2 } = await supabase
            .from("agents")
            .update({ budget_pct: +d.budgetTo.toFixed(4) })
            .eq("id", a.id);
          if (e2) throw new Error(e2.message);
        }
        if (rc) {
          await supabase.from("report_cards").insert({
            agent_id: a.id,
            period_start: rc.periodStart,
            period_end: rc.periodEnd,
            return_pct: rc.returnPct,
            volatility_pct: rc.volatilityPct,
            pct_positive_months: rc.pctPositiveMonths,
            best_month_pct: rc.bestMonthPct,
            worst_month_pct: rc.worstMonthPct,
            skew: rc.skew,
            kurtosis: rc.kurtosis,
            max_dd_pct: rc.maxDdPct,
            dd_duration_days: rc.ddDurationDays,
            dd_recovery_days: rc.ddRecoveryDays,
            var_95_pct: rc.var95Pct,
            cost_split: rc.costSplit as unknown as Json,
            alpha_vs_gold: rc.alpha,
            z_score: rc.z,
            budget_after_pct: +d.budgetTo.toFixed(4),
          });
        }
      }
      const { data: fresh } = await supabase.from("agents").select("*").order("code");
      if (fresh) syncEngineFromAgents(fresh);
      for (const k of [qk.agents, qk.decisions, qk.audit, qk.reports])
        qc.invalidateQueries({ queryKey: k });
      setProposal(null);
      toast.success("Reallocation applied and logged");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Apply failed");
    } finally {
      setBusy(false);
    }
  };

  const total = (agents.data ?? []).reduce((a, x) => a + Number(x.budget_pct), 0) || 1;
  const goldShare =
    (agents.data ?? []).reduce(
      (a, x) => a + Number(x.budget_pct) * GOLD_SHARE[x.code as AgentCode],
      0,
    ) / total;
  const tail = (agents.data ?? [])
    .map((a) => ({
      code: a.code,
      maxDd: cards[a.code]?.maxDdPct ?? 0,
      skew: cards[a.code]?.skew ?? 0,
      score: (cards[a.code]?.maxDdPct ?? 0) - (cards[a.code]?.skew ?? 0),
    }))
    .sort((a, b) => a.score - b.score);
  return (
    <div>
      <PageHeader
        title="Overseer"
        sub="Sets each agent's risk budget from measured performance. It may cut risk on judgement but never raise it beyond the deterministic rules, and it never places orders."
      >
        <Button variant="gold" onClick={propose} disabled={busy}>
          Propose reallocation (dry run)
        </Button>
      </PageHeader>
      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <Panel title="Budget allocation">
          <div className="flex h-40 gap-1.5">
            {(agents.data ?? []).map((a) => (
              <motion.div
                key={a.id}
                layout
                transition={{ duration: 0.32 }}
                style={{ flexGrow: Number(a.budget_pct) }}
                className="flex min-w-[70px] flex-col justify-between rounded-lg border border-line-gold bg-gradient-to-b from-gold-500/20 to-surface-2 p-3"
              >
                <div className="flex items-center justify-between">
                  <span className="t-num text-gold-400">{a.code}</span>
                  <StatusPill status={a.status} />
                </div>
                <div>
                  <Num
                    value={fmtPct(Number(a.budget_pct), 1)}
                    className="text-[22px]"
                    formula="budget_pct (fraction of total risk budget)"
                    inputs={a.status === "PROBATION" ? "effective × 0.25 on probation" : "full"}
                  />
                  <div className="truncate text-[11px] text-ink-2">{a.name}</div>
                </div>
              </motion.div>
            ))}
          </div>
        </Panel>
        <Panel title="Guardrails">
          <div className="space-y-3 text-[12px]">
            <div className="flex justify-between">
              <span>Gold share of budget (G1 + G2 + G4)</span>
              <Num
                value={fmtPct(goldShare, 0)}
                className={goldShare > 0.5 ? "text-neg" : "text-pos"}
                formula="Σ budget × gold share / Σ budget"
                inputs="G1 1.0, G2 1.0, G3 0.5, G4 0.2"
              />
            </div>
            <div className="flex justify-between">
              <span>Live gold share of open risk</span>
              <Num
                value={fmtPct(engine?.goldExposure() ?? 0, 0)}
                formula="XAUUSD risk at stop / total open risk"
              />
            </div>
            <Label>Ambiguity penalty · 1 / (1 + t)</Label>
            {(proposal?.decisions ?? []).map((d) => (
              <div key={d.code} className="flex justify-between t-num">
                <span>{d.code}</span>
                <span>
                  {d.ambiguityPenalty.toFixed(3)} (t {d.sharpeTStat.toFixed(2)})
                </span>
              </div>
            ))}
            {!proposal && <div className="text-ink-3">Run a proposal to compute penalties.</div>}
          </div>
        </Panel>
      </div>
      {proposal && (
        <Panel
          className="mt-4 border-line-gold"
          title={`Proposal · model ${proposal.model}${proposal.llmNote ? ` (${proposal.llmNote})` : ""}`}
          actions={
            <>
              <Button size="xs" variant="quiet" onClick={() => setProposal(null)}>
                Discard
              </Button>
              <Button size="xs" variant="gold" onClick={apply} disabled={busy}>
                Apply
              </Button>
            </>
          }
        >
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-left">
                {["Agent", "Action", "Budget", "z", "Sharpe", "α t", "Probation", "Reason"].map(
                  (h) => (
                    <th key={h} className="t-label py-1">
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {proposal.decisions.map((d) => (
                <tr key={d.code} className="border-t border-line-0 align-top">
                  <td className="t-num py-2 text-gold-400">{d.code}</td>
                  <td className="t-mono">{d.action}</td>
                  <td className="t-num">
                    {fmtPct(d.budgetFrom, 1)} →{" "}
                    <span
                      className={
                        d.budgetTo < d.budgetFrom
                          ? "text-neg"
                          : d.budgetTo > d.budgetFrom
                            ? "text-pos"
                            : ""
                      }
                    >
                      {fmtPct(d.budgetTo, 1)}
                    </span>
                  </td>
                  <td className="t-num">{d.z.toFixed(2)}</td>
                  <td className="t-num">{d.sharpeAnnual.toFixed(2)}</td>
                  <td className="t-num">{d.alphaT.toFixed(2)}</td>
                  <td className="t-num">
                    {d.probation
                      ? `yes (${d.liveMonths.toFixed(1)}/${Number.isFinite(d.requiredMonths) ? d.requiredMonths.toFixed(0) : "∞"} mo)`
                      : "no"}
                  </td>
                  <td className="max-w-md text-ink-1">{d.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="t-num mt-2 text-[11px] text-ink-2">
            shrinkage weight on equal δ = {proposal.shrinkage.toFixed(2)} · post-decision gold share{" "}
            {fmtPct(proposal.goldShare, 0)}
          </div>
        </Panel>
      )}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {(agents.data ?? []).map((a) => (
          <Panel key={a.id} title={`${a.code} weekly report card`}>
            <ReportCardView rc={cards[a.code] ?? null} budgetAfter={Number(a.budget_pct)} compact />
          </Panel>
        ))}
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_380px]">
        <Panel title="Decision timeline" bodyClass="p-0">
          <ol className="max-h-[520px] overflow-auto">
            {(decisions.data ?? []).length === 0 && (
              <li className="py-8 text-center text-[12px] text-ink-3">
                No decisions yet. Propose and apply a reallocation.
              </li>
            )}
            {(decisions.data ?? []).map((d) => {
              const a = agents.data?.find((x) => x.id === d.agent_id);
              const dec = d.decision as {
                action?: string;
                budget_from?: number;
                budget_to?: number;
                reason?: string;
              };
              return (
                <li key={d.id} className="relative border-t border-line-0 py-3 pr-4 pl-8">
                  <span className="absolute top-4 left-3 size-2 rounded-full bg-gold-500" />
                  <div className="flex flex-wrap items-center gap-2 text-[12px]">
                    <span className="t-num text-gold-400">{a?.code}</span>
                    <span className="t-mono">{dec.action}</span>
                    <span className="t-num">
                      {fmtPct(dec.budget_from ?? 0, 1)} → {fmtPct(dec.budget_to ?? 0, 1)}
                    </span>
                    <StatusPill status={d.applied ? "PASS" : "LOCKED"} />
                    <span className="t-mono text-ink-3">{d.model}</span>
                    <span className="t-num ml-auto text-[11px] text-ink-3">{fmtGmt(d.ts)}</span>
                  </div>
                  <p className="mt-1 text-[12px] text-ink-1">{dec.reason}</p>
                  <details className="mt-1">
                    <summary className="t-label cursor-pointer">input snapshot</summary>
                    <pre className="t-mono mt-1 max-h-40 overflow-auto text-[10px] text-ink-2">
                      {JSON.stringify(d.input, null, 2)}
                    </pre>
                  </details>
                  {d.audit_id && (
                    <Link
                      to="/settings"
                      hash="audit"
                      className="text-[11px] text-gold-400 hover:underline"
                    >
                      audit {d.audit_id.slice(0, 8)} →
                    </Link>
                  )}
                </li>
              );
            })}
          </ol>
        </Panel>
        <ChartCard name="tail-rank" title="Tail rank · max DD − skew (lower is better)" data={tail}>
          <div className="h-56">
            <ResponsiveContainer>
              <BarChart data={tail}>
                <CartesianGrid stroke="var(--border-0)" vertical={false} />
                <XAxis dataKey="code" stroke="var(--ink-3)" fontSize={11} />
                <YAxis stroke="var(--ink-3)" fontSize={10} width={36} />
                <RTooltip
                  contentStyle={{
                    background: "var(--surface-1)",
                    border: "1px solid var(--border-1)",
                  }}
                />
                <Bar dataKey="score" fill="var(--warn)" isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 text-[11px] text-ink-2">
            {(reports.data ?? []).length} persisted report cards.
          </div>
        </ChartCard>
      </div>
    </div>
  );
}
