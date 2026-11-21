import { useMemo, useState } from "react";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";
import { useSim, useGridCache } from "@/lib/hermes/store";
import { auditQ, gatewayQ, settingsQ, tradesQ, useAgents, useSteps } from "@/lib/hermes/queries";
import { gridOf, paramsOf } from "@/lib/hermes/bootstrap";
import { saveParams, setAgentStatus } from "@/lib/hermes/actions";
import { buildReportCard } from "@/lib/hermes/reportCard";
import { fmtGmt, fmtHold, fmtUsd, signClass } from "@/lib/hermes/format";
import { MARKETS } from "@/engine/markets";
import type { AgentCode, Sym } from "@/engine/types";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label, Num, PageHeader, Panel, Sparkline, StatusPill } from "@/components/hermes/ui";
import { agentSpark } from "@/components/hermes/widgets";
import { ReportCardView } from "@/components/hermes/ReportCardView";
import { ValidationBoard } from "@/components/hermes/ValidationBoard";
import { Heatmap } from "@/components/hermes/Heatmap";

const CODES = ["G1", "G2", "G3", "G4"];
export const Route = createFileRoute("/agents/$code")({
  loader: ({ params }) => {
    if (!CODES.includes(params.code)) throw notFound();
    return { code: params.code };
  },
  head: ({ loaderData }) => ({
    meta: loaderData
      ? [
          { title: `${loaderData.code} — Agent detail · HermesAgents` },
          {
            name: "description",
            content: `Parameters, positions, trades, report card, validation gate and audit trail for agent ${loaderData.code}.`,
          },
          { property: "og:title", content: `${loaderData.code} — HermesAgents agent` },
          { property: "og:description", content: `Live detail for agent ${loaderData.code}.` },
          { property: "og:type", content: "website" },
          { name: "twitter:card", content: "summary_large_image" },
        ]
      : [{ title: "Agent unavailable — HermesAgents" }, { name: "robots", content: "noindex" }],
  }),
  component: AgentDetail,
});

const ParamValue = z.coerce.number().finite();

function AgentDetail() {
  const { code } = Route.useLoaderData();
  useSim((s) => s.version);
  const engine = useSim((s) => s.engine);
  const agents = useAgents();
  const steps = useSteps();
  const trades = useQuery(tradesQ);
  const gw = useQuery(gatewayQ);
  const auditLog = useQuery(auditQ);
  const settings = useQuery(settingsQ);
  const grids = useGridCache((s) => s.runs);
  const qc = useQueryClient();
  const agent = agents.data?.find((a) => a.code === code);
  const mine = useMemo(
    () => (trades.data ?? []).filter((t) => t.agent_id === agent?.id),
    [trades.data, agent?.id],
  );
  const rc = useMemo(() => buildReportCard(mine, 25000, engine), [mine, engine]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [gridDraft, setGridDraft] = useState<Record<string, string>>({});
  if (!agent) return <div className="h-40 animate-pulse rounded-xl bg-surface-1" />;
  const values = paramsOf(agent);
  const grid = gridOf(agent);
  const c = code as AgentCode;
  const acct = engine?.accounts[c];
  const diag = engine?.agents[c].diagnostics() ?? {};
  const positions = engine?.positions.filter((p) => p.agent === c) ?? [];
  const step7 = (steps.data ?? []).find((s) => s.agent_id === agent.id && s.step === 7);
  const gridRun = grids[code];

  const onSave = async () => {
    const nextV: Record<string, unknown> = { ...values };
    const nextG: Record<string, number[]> = { ...grid };
    try {
      for (const [k, v] of Object.entries(draft)) nextV[k] = ParamValue.parse(v);
      for (const [k, v] of Object.entries(gridDraft))
        nextG[k] = z
          .array(ParamValue)
          .min(1)
          .parse(
            v
              .split(",")
              .map((x) => x.trim())
              .filter(Boolean),
          );
    } catch {
      toast.error("Every parameter and grid value must be a number");
      return;
    }
    try {
      await saveParams(qc, agent, nextV, nextG);
      setDraft({});
      setGridDraft({});
      toast.success(`${code} parameters saved; engine module reloaded`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    }
  };
  const promote = async (k: string) => {
    if (!gridRun || (gridRun.paramA !== k && gridRun.paramB !== k)) return;
    let best: [number, number] | null = null;
    gridRun.grid.forEach((row, i) =>
      row.forEach((v, j) => {
        if (gridRun.plateau[i]?.[j] && (!best || v > gridRun.grid[best[0]]![best[1]]!))
          best = [i, j];
      }),
    );
    if (!best) return toast.error("No plateau cell in the last grid run");
    const [i, j] = best as [number, number];
    const nextV = {
      ...values,
      [gridRun.paramA]: gridRun.valuesA[i]!,
      [gridRun.paramB]: gridRun.valuesB[j]!,
    };
    await saveParams(qc, agent, nextV, grid);
    toast.success(
      `Promoted plateau cell ${gridRun.paramA}=${gridRun.valuesA[i]}, ${gridRun.paramB}=${gridRun.valuesB[j]}`,
    );
  };
  const agentAudit = (auditLog.data ?? []).filter(
    (a) =>
      a.entity_id === agent.id ||
      (a.entity === "validation_steps" &&
        (steps.data ?? []).some((s) => s.id === a.entity_id && s.agent_id === agent.id)),
  );
  const agentGw = (gw.data ?? []).filter((g) => g.agent_code === code).slice(0, 300);

  return (
    <div>
      <PageHeader title={`${code} · ${agent.name}`} sub={agent.description}>
        <StatusPill status={agent.status} />
        <Button
          variant="terminal"
          size="sm"
          onClick={() =>
            setAgentStatus(
              qc,
              agent,
              agent.status === "HALTED" ? "RESEARCH" : "HALTED",
              "operator toggle",
            ).then(
              () => toast.success("Status updated"),
              (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed"),
            )
          }
        >
          {agent.status === "HALTED" ? "Resume (RESEARCH)" : "Halt agent"}
        </Button>
      </PageHeader>
      <Tabs defaultValue="overview">
        <TabsList className="mb-4 bg-surface-1">
          {["overview", "parameters", "positions", "trades", "report", "validation", "audit"].map(
            (t) => (
              <TabsTrigger
                key={t}
                value={t}
                className="capitalize data-[state=active]:bg-surface-3"
              >
                {t === "report" ? "Report Card" : t}
              </TabsTrigger>
            ),
          )}
        </TabsList>
        <TabsContent value="overview" className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-3">
            <Panel title="Live P&L">
              {acct ? (
                <div className="space-y-2">
                  <Num
                    value={fmtUsd(acct.equity.minus(acct.starting).toNumber(), 2, true)}
                    className={`text-[28px] ${signClass(acct.equity.minus(acct.starting).toNumber())}`}
                    formula="equity − session start"
                    inputs={`equity ${fmtUsd(acct.equity.toNumber())}`}
                  />
                  <Sparkline
                    data={engine ? agentSpark(engine, c, 120) : []}
                    width={320}
                    height={56}
                  />
                  <div className="t-num text-[12px] text-ink-2">
                    HWM {fmtUsd(acct.hwm.toNumber())} · floor {fmtUsd(acct.floor.toNumber())}
                  </div>
                </div>
              ) : (
                <div className="h-24 animate-pulse rounded bg-surface-2" />
              )}
            </Panel>
            <Panel title="Engine diagnostics">
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                {Object.entries(diag).map(([k, v]) => (
                  <div key={k} className="min-w-0">
                    <div className="t-label truncate">{k}</div>
                    <div className="t-mono truncate text-[12px]" title={String(v)}>
                      {String(v)}
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
            <Panel title="Edge & sources">
              <p className="text-[13px] text-ink-1">{agent.edge_source}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {agent.book_sources.map((s) => (
                  <span
                    key={s}
                    className="rounded-full border border-line-gold px-2 py-0.5 text-[11px] text-gold-300"
                  >
                    {s}
                  </span>
                ))}
              </div>
              <Link
                to="/book"
                className="mt-3 inline-block text-[12px] text-gold-400 hover:underline"
              >
                Read the rules in the Strategy Book →
              </Link>
            </Panel>
          </div>
          <Panel title="Report card snippet">
            <ReportCardView rc={rc} budgetAfter={Number(agent.budget_pct)} />
          </Panel>
        </TabsContent>
        <TabsContent value="parameters">
          <Panel
            title="Parameters · start value and test grid"
            actions={
              <Button
                variant="gold"
                size="xs"
                onClick={onSave}
                disabled={!Object.keys(draft).length && !Object.keys(gridDraft).length}
              >
                Save & reload engine
              </Button>
            }
          >
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left">
                  <th className="t-label py-1">Parameter</th>
                  <th className="t-label">Current</th>
                  <th className="t-label">Test grid</th>
                  <th className="t-label">Plateau</th>
                  <th className="t-label" />
                </tr>
              </thead>
              <tbody>
                {Object.entries(values)
                  .filter(([, v]) => typeof v === "number")
                  .map(([k, v]) => {
                    const inGrid = gridRun && (gridRun.paramA === k || gridRun.paramB === k);
                    const plateauOk = !!gridRun && gridRun.plateau.flat().some(Boolean);
                    const canPromote = !!inGrid && plateauOk && step7?.status === "PASSED";
                    return (
                      <tr key={k} className="row-t border-t border-line-0">
                        <td className="t-mono pr-3">{k}</td>
                        <td>
                          <Input
                            value={draft[k] ?? String(v)}
                            onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
                            className="t-mono h-7 w-28 border-line-1 bg-surface-0 text-[12px]"
                            aria-label={`${k} value`}
                          />
                        </td>
                        <td>
                          {grid[k] ? (
                            <Input
                              value={gridDraft[k] ?? grid[k]!.join(", ")}
                              onChange={(e) => setGridDraft({ ...gridDraft, [k]: e.target.value })}
                              className="t-mono h-7 w-48 border-line-1 bg-surface-0 text-[12px]"
                              aria-label={`${k} grid`}
                            />
                          ) : (
                            <span className="text-ink-3">—</span>
                          )}
                        </td>
                        <td>
                          {inGrid ? (
                            <Heatmap
                              small
                              valuesA={gridRun.valuesA}
                              valuesB={gridRun.valuesB}
                              grid={gridRun.grid}
                              plateau={gridRun.plateau}
                              paramA={gridRun.paramA}
                              paramB={gridRun.paramB}
                            />
                          ) : grid[k] ? (
                            <Link
                              to="/backtest"
                              search={{ agent: code }}
                              className="text-[11px] text-gold-400 hover:underline"
                            >
                              run grid
                            </Link>
                          ) : null}
                        </td>
                        <td>
                          {grid[k] && (
                            <Button
                              size="xs"
                              variant="terminal"
                              disabled={!canPromote}
                              title={
                                canPromote
                                  ? "Apply the best plateau cell"
                                  : "Needs a plateau in the last grid run and validation step 7 PASSED"
                              }
                              onClick={() => promote(k)}
                            >
                              Promote
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
            <p className="mt-3 text-[12px] text-ink-2">
              Promote is locked unless the parameter sits on a flat plateau of the latest grid run
              and validation step 7 (Robustness) is PASSED.
            </p>
          </Panel>
        </TabsContent>
        <TabsContent value="positions">
          <Panel title={`Open positions · ${positions.length}`} bodyClass="p-0">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left">
                  {[
                    "Symbol",
                    "Side",
                    "Qty",
                    "Entry",
                    "Stop",
                    "Target",
                    "Risk at stop",
                    "Cushion-relative",
                    "Opened",
                    "Time stop",
                  ].map((h) => (
                    <th key={h} className="t-label px-3 py-2">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {positions.length === 0 && (
                  <tr>
                    <td colSpan={10} className="py-8 text-center text-ink-3">
                      Flat.
                    </td>
                  </tr>
                )}
                {positions.map((p) => {
                  const cush = acct ? acct.equity.minus(acct.floor).toNumber() : 1;
                  const dg = MARKETS[p.symbol as Sym].digits;
                  return (
                    <tr key={p.id} className="row-t t-mono border-t border-line-0">
                      <td className="px-3">{p.symbol}</td>
                      <td className={p.side === "LONG" ? "text-pos" : "text-neg"}>{p.side}</td>
                      <td>{p.qty.toString()}</td>
                      <td>{p.entryPx.toFixed(dg)}</td>
                      <td>{p.stopPx.toFixed(dg)}</td>
                      <td>{p.targetPx?.toFixed(dg) ?? "—"}</td>
                      <td>{fmtUsd(p.riskAtStop.toNumber())}</td>
                      <td>
                        <Num
                          value={`${((p.riskAtStop.toNumber() / cush) * 100).toFixed(1)}%`}
                          formula="risk at stop / cushion"
                          inputs={`${fmtUsd(p.riskAtStop.toNumber())} / ${fmtUsd(cush)}`}
                          flash={false}
                        />
                      </td>
                      <td className="text-ink-2">{fmtGmt(p.openedAt, "MM-dd HH:mm")}</td>
                      <td className="text-ink-2">
                        {p.timeStopAt ? fmtGmt(p.timeStopAt, "MM-dd HH:mm") : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Panel>
        </TabsContent>
        <TabsContent value="trades">
          <Panel title={`Trades · ${mine.length}`} bodyClass="p-0">
            <div className="max-h-[560px] overflow-auto">
              <table className="w-full text-[12px]">
                <thead className="sticky top-0 bg-surface-1">
                  <tr className="text-left">
                    {[
                      "Closed",
                      "Symbol",
                      "Side",
                      "Hold",
                      "Net",
                      "R",
                      "Exit",
                      "Delay",
                      "Execution",
                      "Missed fill",
                    ].map((h) => (
                      <th key={h} className="t-label px-3 py-2">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {mine.map((t) => (
                    <tr key={t.id} className="t-mono border-t border-line-0 hover:bg-surface-2">
                      <td className="px-3 py-1.5 text-ink-2">
                        <Link to="/trades" search={{ id: t.id }}>
                          {fmtGmt(t.closed_at, "MM-dd HH:mm")}
                        </Link>
                      </td>
                      <td>{t.symbol}</td>
                      <td>{t.side}</td>
                      <td>{fmtHold(t.hold_seconds)}</td>
                      <td className={signClass(Number(t.net_pnl))}>
                        {Number(t.net_pnl).toFixed(2)}
                      </td>
                      <td>{Number(t.r_multiple).toFixed(2)}</td>
                      <td>{t.exit_reason}</td>
                      <td>{Number(t.delay_cost).toFixed(2)}</td>
                      <td>{Number(t.execution_cost).toFixed(2)}</td>
                      <td>{Number(t.missed_fill_cost).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </TabsContent>
        <TabsContent value="report">
          <Panel title="Report card · Stefanini template">
            <ReportCardView rc={rc} budgetAfter={Number(agent.budget_pct)} />
          </Panel>
        </TabsContent>
        <TabsContent value="validation">
          <ValidationBoard
            agents={[agent]}
            steps={steps.data ?? []}
            seed={Number(settings.data?.sim_seed ?? 20261109)}
          />
        </TabsContent>
        <TabsContent value="audit">
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Operator & overseer actions" bodyClass="p-0">
              <div className="max-h-[520px] overflow-auto">
                {agentAudit.length === 0 && (
                  <div className="py-8 text-center text-[12px] text-ink-3">No actions yet.</div>
                )}
                {agentAudit.map((a) => (
                  <div key={a.id} className="border-t border-line-0 px-3 py-2">
                    <div className="flex justify-between">
                      <span className="t-mono text-[12px]">{a.action}</span>
                      <span className="t-num text-[11px] text-ink-3">{fmtGmt(a.ts)}</span>
                    </div>
                    <div className="text-[11px] text-ink-2">{a.actor}</div>
                  </div>
                ))}
              </div>
            </Panel>
            <Panel title="Gateway pass / fail" bodyClass="p-0">
              <div className="max-h-[520px] overflow-auto">
                {agentGw.map((g) => (
                  <div
                    key={g.id}
                    className="flex items-center gap-2 border-t border-line-0 px-3 py-1"
                  >
                    <span className="t-num text-[11px] text-ink-3">
                      {fmtGmt(g.occurred_at, "MM-dd HH:mm")}
                    </span>
                    <span className="t-mono flex-1 truncate text-[11px]">
                      {g.client_order_id} · {g.seq}. {g.check}
                    </span>
                    <StatusPill status={g.result} />
                  </div>
                ))}
              </div>
            </Panel>
          </div>
          <Label className="mt-3">Book sources: {agent.book_sources.join(" · ")}</Label>
        </TabsContent>
      </Tabs>
    </div>
  );
}
