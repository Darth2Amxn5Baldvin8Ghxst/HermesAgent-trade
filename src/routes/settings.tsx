import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Json, TablesUpdate } from "@/integrations/supabase/types";
import {
  accountsQ,
  audit,
  auditQ,
  invalidateAll,
  qk,
  useAgents,
  useSettings,
} from "@/lib/hermes/queries";
import { limitsOf } from "@/lib/hermes/bootstrap";
import { RiskLimitsSchema } from "@/lib/hermes/schemas";
import { useSim } from "@/lib/hermes/store";
import { fmtGmt, fmtUsd } from "@/lib/hermes/format";
import { LiveBrokerAdapter, type ConnectionTest } from "@/engine/broker";
import { overseerModelStatus } from "@/lib/hermes/overseer.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label, PageHeader, Panel, StatusPill } from "@/components/hermes/ui";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — HermesAgents" },
      {
        name: "description",
        content:
          "Accounts, broker adapters, global risk limits, density, theme, kill-switch policy, overseer model and workspace reset.",
      },
      { property: "og:title", content: "Settings — HermesAgents" },
      { property: "og:description", content: "Operator settings for the HermesAgents console." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Settings,
});

const LIMIT_LABELS: Record<string, string> = {
  floorRatio: "Floor ratio (× HWM)",
  maxRiskPctEquity: "Per-trade max (fraction of equity)",
  cushionDivisorTrade: "Per-trade cushion divisor",
  cushionDivisorOpen: "Open-risk cushion divisor",
  dailyLossPct: "Daily loss brake",
  weeklyLossPct: "Weekly loss brake",
  spreadMult: "Spread × hourly median",
  weekendCutoffMin: "Weekend cutoff (min)",
};

function Settings() {
  const settings = useSettings();
  const agents = useAgents();
  const accounts = useQuery(accountsQ);
  const auditLog = useQuery(auditQ);
  const qc = useQueryClient();
  const modelStatus = useServerFn(overseerModelStatus);
  const ds = useQuery({ queryKey: ["deepseek-status"], queryFn: () => modelStatus() });
  const s = settings.data;
  const limits = limitsOf(s?.risk_limits);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [confirmLimits, setConfirmLimits] = useState("");
  const [live, setLive] = useState({ name: "", endpoint: "", accountId: "" });
  const [tests, setTests] = useState<Record<string, ConnectionTest>>({});
  const [reset, setReset] = useState({ seed: "", phrase: "" });
  useEffect(() => {
    const l = (s?.live_adapter ?? {}) as { name?: string; endpoint?: string; accountId?: string };
    setLive({ name: l.name ?? "", endpoint: l.endpoint ?? "", accountId: l.accountId ?? "" });
    setReset((r) => ({ ...r, seed: String(s?.sim_seed ?? 20261109) }));
  }, [s?.live_adapter, s?.sim_seed]);

  const update = async (patch: TablesUpdate<"operator_settings">, action: string) => {
    if (!s) return;
    const before = Object.fromEntries(
      Object.keys(patch).map((k) => [k, (s as Record<string, unknown>)[k]]),
    );
    const { error } = await supabase.from("operator_settings").update(patch).eq("id", s.id);
    if (error) return toast.error(error.message);
    await audit(action, "operator_settings", s.id, before, patch);
    qc.invalidateQueries({ queryKey: qk.settings });
    qc.invalidateQueries({ queryKey: qk.audit });
    toast.success("Saved");
  };
  const saveLimits = async () => {
    const next = {
      ...limits,
      ...Object.fromEntries(Object.entries(draft).map(([k, v]) => [k, Number(v)])),
    };
    const p = RiskLimitsSchema.safeParse(next);
    if (!p.success) return toast.error(p.error.issues[0]?.message ?? "Invalid limits");
    if (confirmLimits !== "CONFIRM LIMITS") return toast.error("Type CONFIRM LIMITS to apply");
    await update({ risk_limits: p.data as unknown as Json }, "RISK_LIMITS_UPDATE");
    useSim.getState().engine?.setLimits(p.data);
    setDraft({});
    setConfirmLimits("");
  };
  const testAdapter = async (id: "sim" | "live") => {
    const adapter = id === "sim" ? useSim.getState().broker : new LiveBrokerAdapter(live);
    const r = await adapter.testConnection();
    setTests((t) => ({ ...t, [id]: r }));
  };
  const doReset = async () => {
    const seed = Number(reset.seed);
    if (!Number.isInteger(seed) || seed < 0)
      return toast.error("Seed must be a non-negative integer");
    if (reset.phrase !== "RESET") return toast.error("Type RESET to confirm");
    const { error } = await supabase.rpc("reset_my_workspace", { _seed: seed });
    if (error) return toast.error(error.message);
    useSim.getState().reset();
    invalidateAll(qc);
    setReset({ seed: String(seed), phrase: "" });
    toast.success(`Workspace reseeded with seed ${seed}`);
  };
  const setAccount = async (id: string, patch: TablesUpdate<"accounts">) => {
    const before = accounts.data?.find((a) => a.id === id);
    const { error } = await supabase.from("accounts").update(patch).eq("id", id);
    if (error) return toast.error(error.message);
    await audit(
      "ACCOUNT_UPDATE",
      "accounts",
      id,
      before ? { broker: before.broker, currency: before.currency } : null,
      patch,
    );
    qc.invalidateQueries({ queryKey: qk.accounts });
    toast.success("Account updated");
  };
  if (!s) return <div className="h-96 animate-pulse rounded-xl bg-surface-1" />;
  const seg = (value: string, options: [string, string][], onPick: (v: string) => void) => (
    <div className="flex gap-1 rounded-md bg-surface-0 p-1">
      {options.map(([v, l]) => (
        <button
          key={v}
          onClick={() => onPick(v)}
          className={`flex-1 rounded px-2 py-1 text-[12px] ${value === v ? "bg-surface-3 text-ink-0" : "text-ink-2"}`}
        >
          {l}
        </button>
      ))}
    </div>
  );
  return (
    <div>
      <PageHeader
        title="Settings"
        sub="Every change here writes an audit row with the before and after values."
      />
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Accounts">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-left">
                {["Agent", "Broker", "Currency", "Start", "Equity", "HWM", "Floor"].map((h) => (
                  <th key={h} className="t-label py-1">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(accounts.data ?? []).map((a) => {
                const ag = agents.data?.find((x) => x.id === a.agent_id);
                return (
                  <tr key={a.id} className="row-t border-t border-line-0">
                    <td className="t-num text-gold-400">{ag?.code}</td>
                    <td>
                      <select
                        value={a.broker.startsWith("LIVE") ? "LIVE" : "SIM"}
                        onChange={(e) =>
                          setAccount(a.id, {
                            broker:
                              e.target.value === "LIVE"
                                ? `LIVE:${live.name || "unconfigured"}`
                                : "SIM",
                          })
                        }
                        className="t-mono h-7 rounded border border-line-1 bg-surface-0 px-1 text-[11px]"
                      >
                        <option>SIM</option>
                        <option>LIVE</option>
                      </select>
                    </td>
                    <td>
                      <select
                        value={a.currency}
                        onChange={(e) => setAccount(a.id, { currency: e.target.value })}
                        className="t-mono h-7 rounded border border-line-1 bg-surface-0 px-1 text-[11px]"
                      >
                        {["USD", "EUR", "GBP"].map((c) => (
                          <option key={c}>{c}</option>
                        ))}
                      </select>
                    </td>
                    <td className="t-num">{fmtUsd(Number(a.starting_equity), 0)}</td>
                    <td className="t-num">{fmtUsd(Number(a.equity), 0)}</td>
                    <td className="t-num">{fmtUsd(Number(a.high_water_mark), 0)}</td>
                    <td className="t-num">{fmtUsd(Number(a.floor), 0)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-ink-2">
            Capital is assigned at seeding (25,000 per agent). Change it with a workspace reseed so
            the floor and HWM restart cleanly.
          </p>
        </Panel>
        <Panel title="Broker adapters">
          <div className="space-y-4">
            <div className="rounded-md border border-line-0 p-3">
              <div className="flex items-center justify-between">
                <span className="t-mono text-[12px]">SimBrokerAdapter</span>
                <StatusPill status="LIVE" />
              </div>
              <Button
                size="xs"
                variant="terminal"
                className="mt-2"
                onClick={() => testAdapter("sim")}
              >
                Test connection
              </Button>
              {tests.sim && (
                <div className="t-mono mt-1 text-[11px] text-ink-2">
                  {tests.sim.ok ? "OK" : "FAIL"} · {tests.sim.latencyMs} ms · {tests.sim.message}
                </div>
              )}
            </div>
            <div className="space-y-2 rounded-md border border-line-0 p-3">
              <div className="flex items-center justify-between">
                <span className="t-mono text-[12px]">LiveBrokerAdapter</span>
                <StatusPill status={live.endpoint ? "IN_PROGRESS" : "LOCKED"} />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Input
                  value={live.name}
                  onChange={(e) => setLive({ ...live, name: e.target.value })}
                  placeholder="broker name"
                  className="h-8 border-line-1 bg-surface-0 text-[12px]"
                />
                <Input
                  value={live.endpoint}
                  onChange={(e) => setLive({ ...live, endpoint: e.target.value })}
                  placeholder="https://bridge.example/api"
                  className="h-8 border-line-1 bg-surface-0 text-[12px]"
                />
                <Input
                  value={live.accountId}
                  onChange={(e) => setLive({ ...live, accountId: e.target.value })}
                  placeholder="account id"
                  className="h-8 border-line-1 bg-surface-0 text-[12px]"
                />
              </div>
              <div className="flex items-center gap-2 text-[12px]">
                <span className="text-ink-2">API key</span>
                <Input
                  disabled
                  value="••••••••••••"
                  className="h-8 w-40 border-line-1 bg-surface-0"
                  aria-label="Broker API key (stored as an encrypted backend secret)"
                />
                <StatusPill status="LOCKED" className="ml-1" />
                <span className="text-ink-3">Not connected</span>
              </div>
              <div className="flex gap-2">
                <Button
                  size="xs"
                  variant="terminal"
                  onClick={() =>
                    update({ live_adapter: live as unknown as Json }, "LIVE_ADAPTER_CONFIG")
                  }
                >
                  Save
                </Button>
                <Button size="xs" variant="terminal" onClick={() => testAdapter("live")}>
                  Test connection
                </Button>
              </div>
              {tests.live && (
                <div className="t-mono text-[11px] text-ink-2">
                  {tests.live.ok ? "OK" : "FAIL"} · {tests.live.latencyMs} ms · {tests.live.message}
                </div>
              )}
              <p className="text-[11px] text-ink-3">
                Trading methods throw “Connect a broker backend” until one class is implemented; no
                screen changes are needed.
              </p>
            </div>
          </div>
        </Panel>
        <Panel title="Global risk limits">
          <div className="grid grid-cols-2 gap-3">
            {Object.entries(limits).map(([k, v]) => (
              <div key={k} className="space-y-1">
                <Label>{LIMIT_LABELS[k] ?? k}</Label>
                <Input
                  value={draft[k] ?? String(v)}
                  onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
                  className="t-mono h-8 border-line-1 bg-surface-0"
                />
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <Input
              value={confirmLimits}
              onChange={(e) => setConfirmLimits(e.target.value)}
              placeholder="type CONFIRM LIMITS"
              className="t-mono h-8 border-line-1 bg-surface-0"
            />
            <Button
              size="sm"
              variant="gold"
              onClick={saveLimits}
              disabled={!Object.keys(draft).length}
            >
              Apply limits
            </Button>
          </div>
          <p className="mt-2 text-[11px] text-ink-2">
            The book says limits change only in code, outside trading hours. Applying here takes
            effect on the next gateway evaluation and is audited.
          </p>
        </Panel>
        <Panel title="Display, kill switch & overseer">
          <div className="space-y-4">
            <div className="space-y-1">
              <Label>Density</Label>
              {seg(
                s.density,
                [
                  ["comfortable", "Comfortable"],
                  ["compact", "Compact (Bloomberg)"],
                ],
                (v) => update({ density: v }, "DENSITY_UPDATE"),
              )}
            </div>
            <div className="space-y-1">
              <Label>Theme</Label>
              {seg(
                s.theme,
                [
                  ["dark", "Dark"],
                  ["ultra", "Ultra-Dark"],
                  ["light", "Light-institutional"],
                ],
                (v) => update({ theme: v }, "THEME_UPDATE"),
              )}
            </div>
            <div className="space-y-1">
              <Label>Kill switch arming policy</Label>
              {seg(
                s.kill_policy,
                [
                  ["immediate", "Immediate"],
                  ["hold10", "10-second hold"],
                ],
                (v) => update({ kill_policy: v }, "KILL_POLICY_UPDATE"),
              )}
            </div>
            <div className="flex items-center justify-between rounded-md border border-line-0 p-3">
              <div>
                <div className="text-[13px]">DeepSeek overseer review</div>
                <div className="text-[11px] text-ink-2">
                  Optional. May only cut budgets. Without a key the rule engine decides (model =
                  rule-engine-fallback).
                </div>
              </div>
              <div className="flex items-center gap-2">
                <StatusPill status={ds.data?.deepseekConnected ? "OK" : "LOCKED"} />
                <span className="text-[11px] text-ink-2">
                  {ds.data?.deepseekConnected ? "Connected" : "Not connected"}
                </span>
                <Switch
                  checked={s.overseer_use_llm}
                  onCheckedChange={(v) => update({ overseer_use_llm: v }, "OVERSEER_LLM_TOGGLE")}
                />
              </div>
            </div>
          </div>
        </Panel>
        <Panel title="Seed / reset">
          <p className="text-[12px] text-ink-1">
            Deletes this operator's agents, accounts, orders, trades, gateway events, snapshots,
            decisions and Monte Carlo runs, then reseeds four agents in RESEARCH with equal budgets
            and a fresh synthetic feed. The audit log is kept.
          </p>
          <div className="mt-3 flex gap-2">
            <Input
              value={reset.seed}
              onChange={(e) => setReset({ ...reset, seed: e.target.value })}
              placeholder="seed"
              className="t-mono h-8 w-36 border-line-1 bg-surface-0"
            />
            <Input
              value={reset.phrase}
              onChange={(e) => setReset({ ...reset, phrase: e.target.value })}
              placeholder="type RESET"
              className="t-mono h-8 border-line-1 bg-surface-0"
            />
            <Button size="sm" variant="breach" onClick={doReset}>
              Reseed workspace
            </Button>
          </div>
        </Panel>
        <Panel id="audit" title="Audit log" bodyClass="p-0">
          <div className="max-h-[420px] overflow-auto">
            {(auditLog.data ?? []).map((a) => (
              <details key={a.id} className="border-t border-line-0 px-3 py-2">
                <summary className="flex cursor-pointer items-center gap-3 text-[12px]">
                  <span className="t-num text-ink-3">{fmtGmt(a.ts)}</span>
                  <span className="t-mono">{a.action}</span>
                  <span className="ml-auto truncate text-ink-2">{a.actor}</span>
                </summary>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <pre className="t-mono overflow-auto text-[10px] text-ink-2">
                    {JSON.stringify(a.before, null, 2)}
                  </pre>
                  <pre className="t-mono overflow-auto text-[10px] text-ink-1">
                    {JSON.stringify(a.after, null, 2)}
                  </pre>
                </div>
              </details>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}
