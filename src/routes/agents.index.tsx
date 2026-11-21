import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownUp } from "lucide-react";
import { useSim } from "@/lib/hermes/store";
import { tradesQ, useAgents } from "@/lib/hermes/queries";
import { fmtGmt, fmtPct, fmtUsd, signClass } from "@/lib/hermes/format";
import { mean, sd } from "@/engine/stats";
import type { AgentCode } from "@/engine/types";
import { Num, PageHeader, Panel, Sparkline, StatusPill } from "@/components/hermes/ui";
import { agentSpark } from "@/components/hermes/widgets";

export const Route = createFileRoute("/agents/")({
  head: () => ({
    meta: [
      { title: "Agents — HermesAgents" },
      {
        name: "description",
        content:
          "G1–G4: status, budget, P&L, live Sharpe with t-statistic, last trade and next scheduled check.",
      },
      { property: "og:title", content: "Agents — HermesAgents" },
      {
        property: "og:description",
        content: "Four independent XAUUSD agents and their live statistics.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AgentsList,
});

type Key = "code" | "status" | "budget" | "pnl" | "sharpe" | "last";
function AgentsList() {
  useSim((s) => s.version);
  const engine = useSim((s) => s.engine);
  const agents = useAgents();
  const trades = useQuery(tradesQ);
  const nav = useNavigate();
  const [sort, setSort] = useState<{ k: Key; dir: 1 | -1 }>({ k: "code", dir: 1 });
  const rows = useMemo(
    () =>
      (agents.data ?? []).map((a) => {
        const mine = (trades.data ?? []).filter((t) => t.agent_id === a.id);
        const byDay = new Map<number, number>();
        for (const t of mine)
          byDay.set(
            Math.floor(new Date(t.closed_at).getTime() / 86_400_000),
            (byDay.get(Math.floor(new Date(t.closed_at).getTime() / 86_400_000)) ?? 0) +
              Number(t.net_pnl) / 25000,
          );
        const d = [...byDay.values()];
        const s = sd(d);
        const sharpe = s > 0 ? (mean(d) / s) * Math.sqrt(252) : 0;
        const t = s > 0 ? (mean(d) / s) * Math.sqrt(d.length) : 0;
        const acct = engine?.accounts[a.code as AgentCode];
        const last = mine[0];
        const next =
          a.code === "G1"
            ? "regime gate · every M15 close"
            : a.code === "G2"
              ? (engine?.feed.calendar.find((e) => e.t > engine.now)?.id ?? "—")
              : a.code === "G3"
                ? "Engle–Granger gate · weekly"
                : "rebalance · next daily close";
        return {
          a,
          pnl: acct ? acct.equity.minus(acct.starting).toNumber() + mine.reduce((x, t) => x, 0) : 0,
          total: mine.reduce((x, t) => x + Number(t.net_pnl), 0),
          sharpe,
          t,
          n: d.length,
          last,
          next,
        };
      }),
    [agents.data, trades.data, engine, engine?.bars],
  );
  const sorted = [...rows].sort((x, y) => {
    const v = (r: (typeof rows)[number]) =>
      ({
        code: r.a.code,
        status: r.a.status,
        budget: Number(r.a.budget_pct),
        pnl: r.total,
        sharpe: r.sharpe,
        last: r.last ? new Date(r.last.closed_at).getTime() : 0,
      })[sort.k];
    const a = v(x);
    const b = v(y);
    return (
      (typeof a === "number" && typeof b === "number"
        ? a - b
        : String(a).localeCompare(String(b))) * sort.dir
    );
  });
  const H = ({ k, children }: { k: Key; children: string }) => (
    <th className="t-label px-3 py-2 text-left">
      <button
        onClick={() => setSort((s) => ({ k, dir: s.k === k ? (s.dir === 1 ? -1 : 1) : 1 }))}
        className="inline-flex items-center gap-1 hover:text-ink-0"
      >
        {children}
        <ArrowDownUp className="size-3 opacity-50" />
      </button>
    </th>
  );
  return (
    <div>
      <PageHeader
        title="Agents"
        sub="Each agent is one complete strategy on its own account behind the shared gateway. Sharpe uses daily net P&L from the persisted trade log."
      />
      <Panel bodyClass="p-0">
        <table className="w-full text-[13px]">
          <thead className="border-b border-line-0">
            <tr>
              <H k="code">Agent</H>
              <H k="status">Status</H>
              <H k="budget">Budget</H>
              <H k="pnl">Net P&amp;L (log)</H>
              <th className="t-label px-3 text-left">Session</th>
              <H k="sharpe">Sharpe (t)</H>
              <H k="last">Last trade</H>
              <th className="t-label px-3 text-left">Next scheduled check</th>
            </tr>
          </thead>
          <tbody>
            {agents.isLoading && (
              <tr>
                <td colSpan={8} className="p-3">
                  <div className="h-24 animate-pulse rounded bg-surface-2" />
                </td>
              </tr>
            )}
            {sorted.map((r) => (
              <tr
                key={r.a.id}
                tabIndex={0}
                onKeyDown={(e) =>
                  e.key === "Enter" && nav({ to: "/agents/$code", params: { code: r.a.code } })
                }
                onClick={() => nav({ to: "/agents/$code", params: { code: r.a.code } })}
                className="row-t cursor-pointer border-t border-line-0 hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none"
              >
                <td className="px-3">
                  <span className="t-num mr-2 text-gold-400">{r.a.code}</span>
                  {r.a.name}
                </td>
                <td className="px-3">
                  <StatusPill status={r.a.status} />
                </td>
                <td className="t-num px-3">{fmtPct(Number(r.a.budget_pct), 1)}</td>
                <td className={`px-3 ${signClass(r.total)}`}>
                  <Num
                    value={fmtUsd(r.total, 2, true)}
                    formula="Σ net_pnl over persisted trades"
                    inputs={`${(trades.data ?? []).filter((t) => t.agent_id === r.a.id).length} trades`}
                    flash={false}
                  />
                </td>
                <td className="px-3">
                  {engine && (
                    <Sparkline
                      data={agentSpark(engine, r.a.code as AgentCode, 60)}
                      width={90}
                      height={22}
                    />
                  )}
                </td>
                <td className="px-3">
                  <Num
                    value={`${r.sharpe.toFixed(2)} (${r.t.toFixed(2)})`}
                    formula="SR = mean/sd × √252; t = mean/sd × √n"
                    inputs={`${r.n} trading days`}
                    flash={false}
                  />
                </td>
                <td className="t-num px-3 text-ink-2">
                  {r.last ? fmtGmt(r.last.closed_at, "MM-dd HH:mm") : "—"}
                </td>
                <td className="t-mono px-3 text-[12px] text-ink-2">{r.next}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
