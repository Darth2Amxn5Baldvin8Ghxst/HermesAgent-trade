import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { RefreshCw } from "lucide-react";
import { fetchMarketUniverse } from "@/lib/hermes/marketdata.functions";
import { mean, sd, maxDrawdown } from "@/engine/stats";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel } from "@/components/hermes/ui";
import { fmtGmt } from "@/lib/hermes/format";

export const Route = createFileRoute("/markets")({
  head: () => ({
    meta: [
      { title: "Real Markets — HermesAgents" },
      { name: "description", content: "One year of real daily data across metals, FX, indices, energy, rates and crypto from free public sources." },
      { property: "og:title", content: "Real Markets — HermesAgents" },
      { property: "og:description", content: "Real market data feeding backtests and parameter tuning." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Markets,
});

type Data = Awaited<ReturnType<typeof fetchMarketUniverse>>;

function Spark({ v }: { v: number[] }) {
  if (v.length < 2) return null;
  const lo = Math.min(...v), hi = Math.max(...v);
  const pts = v.map((x, i) => `${(i / (v.length - 1)) * 120},${28 - ((x - lo) / (hi - lo || 1)) * 26}`).join(" ");
  const up = v[v.length - 1]! >= v[0]!;
  return (
    <svg width="120" height="30" aria-hidden>
      <polyline points={pts} fill="none" strokeWidth="1.25" className={up ? "stroke-pos" : "stroke-neg"} />
    </svg>
  );
}

function Markets() {
  const load = useServerFn(fetchMarketUniverse);
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      setData(await load());
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-4">
      <PageHeader
        title="Real Markets"
        sub="Free public data, no keys: Yahoo Finance daily bars for every market class; Binance and Yahoo minute bars for gold in Backtest Studio."
      >
        <Button variant="terminal" size="sm" onClick={run} disabled={busy}>
          <RefreshCw className={busy ? "animate-spin" : ""} /> {data ? "Refresh" : "Load real data"}
        </Button>
      </PageHeader>
      {err && <Panel title="Error"><p className="text-[12px] text-neg">{err}</p></Panel>}
      <Panel title={data ? `Fetched ${fmtGmt(data.fetchedAt)}` : "Not loaded yet"}>
        {!data ? (
          <p className="text-[12px] text-ink-2">
            Press “Load real data” to fetch one year of daily closes. To tune an agent on real gold minute bars, open{" "}
            <Link to="/backtest" className="text-gold-400 underline">Backtest Studio</Link> and pick a “Real ·” feed.
          </p>
        ) : (
          <table className="w-full text-[12px]">
            <thead className="text-ink-3">
              <tr className="text-left">
                <th className="py-1">Market</th><th>Class</th><th className="text-right">Last</th>
                <th className="text-right">1y return</th><th className="text-right">Ann. vol</th>
                <th className="text-right">Max drop</th><th className="pl-4">Trend</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => {
                const c = r.closes.map((x) => x.c);
                const rets = c.slice(1).map((v, i) => Math.log(v / c[i]!));
                const ret = c.length > 1 ? (c[c.length - 1]! / c[0]! - 1) * 100 : null;
                return (
                  <tr key={r.sym} className="border-t border-line-1">
                    <td className="py-1.5">{r.name} <span className="t-mono text-ink-3">{r.sym}</span></td>
                    <td className="text-ink-2">{r.cls}</td>
                    {r.error || c.length < 2 ? (
                      <td colSpan={5} className="text-neg">{r.error ?? "no data returned"}</td>
                    ) : (
                      <>
                        <td className="t-num text-right">{c[c.length - 1]!.toFixed(c[c.length - 1]! < 10 ? 4 : 2)}</td>
                        <td className={`t-num text-right ${ret! >= 0 ? "text-pos" : "text-neg"}`}>{ret!.toFixed(1)}%</td>
                        <td className="t-num text-right">{(sd(rets) * Math.sqrt(252) * 100).toFixed(1)}%</td>
                        <td className="t-num text-right">{(maxDrawdown(c).maxDd * 100).toFixed(1)}%</td>
                        <td className="pl-4"><Spark v={c} /></td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {data && <p className="mt-2 text-[11px] text-ink-3">Mean daily log return across loaded markets: {(mean(data.rows.flatMap((r) => r.closes.slice(1).map((x, i) => Math.log(x.c / r.closes[i]!.c)))) * 100).toFixed(3)}%</p>}
      </Panel>
    </div>
  );
}
