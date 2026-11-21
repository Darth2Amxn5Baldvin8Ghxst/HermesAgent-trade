import { createFileRoute } from "@tanstack/react-router";
import { useSim, useEngineVersion } from "@/lib/hermes/store";
import { fmtGmt, fmtUsd, signClass } from "@/lib/hermes/format";
import { usdPerPoint } from "@/engine/markets";
import { G1Agent } from "@/engine/agents/g1";
import { Label, PageHeader, Panel, StatusPill } from "@/components/hermes/ui";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/planned")({
  head: () => ({
    meta: [
      { title: "Trade Pipeline — HermesAgents" },
      {
        name: "description",
        content:
          "Every open position, resting order and upcoming setup each agent is watching, with stops, targets and exit deadlines.",
      },
      { property: "og:title", content: "Trade Pipeline — HermesAgents" },
      {
        property: "og:description",
        content: "What the agents hold, what is waiting to fill, and what they plan to trade next.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Planned,
});

const th = "px-3 py-2 text-left t-label text-ink-2";
const td = "px-3 py-1.5 tabular-nums";

function Planned() {
  useEngineVersion();
  const engine = useSim((s) => s.engine);
  if (!engine)
    return (
      <div className="p-6">
        <PageHeader title="Trade Pipeline" sub="Start the simulator to see the agents' pipeline." />
      </div>
    );
  const now = engine.now;
  const m = engine.market;
  const g1 = engine.agents.G1 instanceof G1Agent ? engine.agents.G1 : null;
  const zones = g1?.watchZones ?? [];
  const g1d = engine.agents.G1.diagnostics();
  const g3d = engine.agents.G3.diagnostics();
  const g4d = engine.agents.G4.diagnostics();
  const g2d = engine.agents.G2.diagnostics();
  // only public facts about upcoming releases: time, type, consensus — never the actual figure
  const events = engine.feed.calendar
    .filter((e) => e.t > now && !e.void)
    .slice(0, 8);
  const xau = m.mid("XAUUSD");

  return (
    <div className="space-y-4 p-6">
      <PageHeader
        title="Trade Pipeline"
        sub={`Simulated time ${fmtGmt(now)} GMT. Held positions, orders waiting to fill, and setups each agent will act on if its rules are met. Nothing here is a guaranteed trade.`}
      />

      <Panel title={`1 · Open positions (${engine.positions.length})`} bodyClass="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr>
              {["Agent", "Market", "Side", "Qty", "Entry", "Now", "Stop", "Target", "Risk at stop", "Open P&L", "Exit by"].map((h) => (
                <th key={h} className={th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {engine.positions.map((p) => {
              const px = m.mid(p.symbol);
              const pnl = (px - p.entryPx) * (p.side === "LONG" ? 1 : -1) * p.qty.toNumber() * usdPerPoint(p.symbol);
              return (
                <tr key={p.id} className="border-t border-line-0">
                  <td className={td}>{p.agent}</td>
                  <td className={td}>{p.symbol}</td>
                  <td className={td}>{p.side}</td>
                  <td className={td}>{p.qty.toString()}</td>
                  <td className={td}>{p.entryPx.toFixed(2)}</td>
                  <td className={td}>{px.toFixed(2)}</td>
                  <td className={td}>{p.stopPx.toFixed(2)}</td>
                  <td className={td}>{p.targetPx?.toFixed(2) ?? "rule-based"}</td>
                  <td className={td}>{fmtUsd(p.riskAtStop.toNumber())}</td>
                  <td className={cn(td, signClass(pnl))}>{fmtUsd(pnl, 2, true)}</td>
                  <td className={td}>{p.timeStopAt ? fmtGmt(p.timeStopAt, "MM-dd HH:mm") : "signal exit"}</td>
                </tr>
              );
            })}
            {!engine.positions.length && <Empty cols={11} text="No open positions." />}
          </tbody>
        </table>
      </Panel>

      <Panel title={`2 · Orders waiting to fill (${engine.working.length})`} bodyClass="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr>
              {["Agent", "Market", "Side", "Qty", "Limit", "Distance", "Stop", "Target", "Risk", "Expires", "Setup"].map((h) => (
                <th key={h} className={th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {engine.working.map((o) => (
              <tr key={o.id} className="border-t border-line-0">
                <td className={td}>{o.agent}</td>
                <td className={td}>{o.symbol}</td>
                <td className={td}>{o.side}</td>
                <td className={td}>{o.qty.toString()}</td>
                <td className={td}>{o.limitPx?.toFixed(2) ?? "market"}</td>
                <td className={td}>{o.limitPx ? (o.limitPx - m.mid(o.symbol)).toFixed(2) : "—"}</td>
                <td className={td}>{o.stopPx?.toFixed(2) ?? "—"}</td>
                <td className={td}>{o.targetPx?.toFixed(2) ?? "—"}</td>
                <td className={td}>{fmtUsd(o.requestedRisk.toNumber())}</td>
                <td className={td}>{o.expiresAt ? fmtGmt(o.expiresAt, "HH:mm") : "—"}</td>
                <td className={td}>{o.tag}</td>
              </tr>
            ))}
            {!engine.working.length && <Empty cols={11} text="No resting orders." />}
          </tbody>
        </table>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="3 · G1 — levels being watched">
          <div className="mb-2 flex items-center gap-2 text-xs">
            <StatusPill status={g1d.gate === true || g1d.gate === "OPEN" ? "OPEN" : "CLOSED"} />
            <span className="text-ink-2">Gold {xau.toFixed(2)} · {String(g1d.blocked ?? "ready")}</span>
          </div>
          <table className="w-full text-xs">
            <tbody>
              {zones.map((z, i) => {
                const side = xau > z.hi ? "buy near" : xau < z.lo ? "sell near" : "inside";
                return (
                  <tr key={i} className="border-t border-line-0">
                    <td className={td}>{z.lo.toFixed(2)}–{z.hi.toFixed(2)}</td>
                    <td className={td}>{side}</td>
                    <td className={td}>{(Math.min(Math.abs(xau - z.hi), Math.abs(xau - z.lo))).toFixed(2)} away</td>
                    <td className={cn(td, "text-ink-2")}>{z.sources.join(", ")}</td>
                  </tr>
                );
              })}
              {!zones.length && <Empty cols={4} text="No zones yet (warming up)." />}
            </tbody>
          </table>
        </Panel>

        <Panel title="4 · G2 — upcoming releases">
          <p className="mb-2 text-xs text-ink-2">
            Trades only if the surprise is large enough and spread is normal. Last: {String(g2d.last || "—")}
          </p>
          <table className="w-full text-xs">
            <tbody>
              {events.map((e) => (
                <tr key={e.id} className="border-t border-line-0">
                  <td className={td}>{fmtGmt(e.t, "MM-dd HH:mm")}</td>
                  <td className={td}>{e.kind}</td>
                  <td className={td}>consensus {e.consensus.toFixed(2)}</td>
                  <td className={cn(td, "text-ink-2")}>in {((e.t - now) / 3_600_000).toFixed(0)} h</td>
                </tr>
              ))}
              {!events.length && <Empty cols={4} text="No releases scheduled in the simulated calendar." />}
            </tbody>
          </table>
        </Panel>

        <Panel title="5 · G3 — pair spread">
          <dl className="grid grid-cols-2 gap-2 text-xs">
            <Kv k="Pair" v={g3d.pair ?? "none"} />
            <Kv k="Gate" v={g3d.gate ? "open" : String(g3d.gateReason)} />
            <Kv k="z-score now" v={g3d.z} />
            <Kv k="Plan" v={Math.abs(Number(g3d.z)) >= 2 ? "entry zone (|z| ≥ 2)" : `enters at |z| ≥ 2 (${(2 - Math.abs(Number(g3d.z))).toFixed(2)} to go)`} />
          </dl>
        </Panel>

        <Panel title="6 · G4 — trend targets">
          <table className="w-full text-xs">
            <tbody>
              {Object.entries(g4d)
                .filter(([k]) => k.startsWith("sig_"))
                .map(([k, v]) => {
                  const s = typeof v === "number" ? v : null;
                  return (
                    <tr key={k} className="border-t border-line-0">
                      <td className={td}>{k.slice(4)}</td>
                      <td className={cn(td, s !== null ? signClass(s) : "")}>{s === null ? "warming up" : s.toFixed(2)}</td>
                      <td className={cn(td, "text-ink-2")}>
                        {s === null ? "—" : s > 0 ? "hold / build long" : s < 0 ? "hold / build short" : "flat"}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
          <Label className="mt-2">Rebalanced at the daily close when the target moves more than 25%.</Label>
        </Panel>
      </div>
    </div>
  );
}

function Empty({ cols, text }: { cols: number; text: string }) {
  return (
    <tr>
      <td colSpan={cols} className="px-3 py-4 text-center text-xs text-ink-2">{text}</td>
    </tr>
  );
}
function Kv({ k, v }: { k: string; v: unknown }) {
  return (
    <>
      <dt className="text-ink-2">{k}</dt>
      <dd className="tabular-nums">{String(v ?? "—")}</dd>
    </>
  );
}
