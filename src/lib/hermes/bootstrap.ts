/** Boots the live simulator from persisted state and runs the frame loop. */
import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { defaultConfig, defaultParams, SIM_START_MS } from "@/engine/engine";
import { DEFAULT_LIMITS, type RiskLimits } from "@/engine/gateway";
import { AGENT_CODES, type AgentCode } from "@/engine/types";
import type { ParamValues } from "@/engine/agents/base";
import { Persister } from "./persist";
import { useSim } from "./store";
import { accountsQ, agentsQ, qk, settingsQ, snapshotsQ, type AgentRow } from "./queries";
import { ParamsSchema, RiskLimitsSchema } from "./schemas";

export function paramsOf(a: AgentRow): ParamValues {
  const p = ParamsSchema.safeParse(a.params);
  return p.success ? (p.data.values as ParamValues) : defaultParams()[a.code as AgentCode];
}
export function gridOf(a: AgentRow): Record<string, number[]> {
  const p = ParamsSchema.safeParse(a.params);
  return p.success ? p.data.grid : {};
}
export function limitsOf(raw: unknown): RiskLimits {
  const p = RiskLimitsSchema.safeParse(raw);
  return p.success ? p.data : DEFAULT_LIMITS;
}

export function useHermesBootstrap(userId: string | null): void {
  const qc = useQueryClient();
  const agents = useQuery({ ...agentsQ, enabled: !!userId });
  const accounts = useQuery({ ...accountsQ, enabled: !!userId });
  const settings = useQuery({ ...settingsQ, enabled: !!userId });
  const snaps = useQuery({ ...snapshotsQ, enabled: !!userId });
  const ensured = useRef(false);
  const engine = useSim((s) => s.engine);

  // operators created before the workspace trigger existed get their workspace once
  useEffect(() => {
    if (!userId || ensured.current || !agents.data || agents.data.length > 0) return;
    ensured.current = true;
    supabase.rpc("ensure_my_workspace").then(() => {
      qc.invalidateQueries({ queryKey: qk.agents });
      qc.invalidateQueries({ queryKey: qk.accounts });
      qc.invalidateQueries({ queryKey: qk.settings });
    });
  }, [userId, agents.data, qc]);

  useEffect(() => {
    if (
      engine ||
      !agents.data?.length ||
      !accounts.data?.length ||
      settings.data === undefined ||
      !snaps.data
    )
      return;
    const byCode = Object.fromEntries(agents.data.map((a) => [a.code, a])) as Record<
      AgentCode,
      AgentRow
    >;
    if (!AGENT_CODES.every((c) => byCode[c])) return;
    const acct = (c: AgentCode) => accounts.data!.find((x) => x.agent_id === byCode[c].id)!;
    const seed = Number(settings.data?.sim_seed ?? 20261109);
    const last = snaps.data[0];
    const startMs = last ? Math.floor(new Date(last.ts).getTime() / 60000) * 60000 : SIM_START_MS;
    const cfg = defaultConfig(seed, {
      feed: { seed, startMs },
      params: Object.fromEntries(AGENT_CODES.map((c) => [c, paramsOf(byCode[c])])) as Record<
        AgentCode,
        ParamValues
      >,
      budgets: Object.fromEntries(
        AGENT_CODES.map((c) => [c, Number(byCode[c].budget_pct)]),
      ) as Record<AgentCode, number>,
      probation: Object.fromEntries(AGENT_CODES.map((c) => [c, byCode[c].status === "PROBATION"])),
      enabled: Object.fromEntries(
        AGENT_CODES.map((c) => [c, byCode[c].status !== "HALTED"]),
      ) as Record<AgentCode, boolean>,
      startingEquity: Object.fromEntries(
        AGENT_CODES.map((c) => [c, String(acct(c).equity)]),
      ) as Record<AgentCode, string>,
      limits: limitsOf(settings.data?.risk_limits),
    });
    const persister = new Persister({
      agentId: Object.fromEntries(AGENT_CODES.map((c) => [c, byCode[c].id])) as Record<
        AgentCode,
        string
      >,
      accountId: Object.fromEntries(AGENT_CODES.map((c) => [c, acct(c).id])) as Record<
        AgentCode,
        string
      >,
      realizedBase: Object.fromEntries(
        AGENT_CODES.map((c) => [c, Number(acct(c).realized_pnl)]),
      ) as Record<AgentCode, number>,
    });
    const e = useSim.getState().init(cfg, persister);
    for (const c of AGENT_CODES)
      e.restoreAccount(c, String(acct(c).high_water_mark), String(acct(c).floor));
    if (settings.data?.kill_armed) e.killArmed = true;
    // prime indicators with a short warm-up so the first screen already shows a ticking market
    for (let i = 0; i < 240; i++) {
      const out = e.step();
      persister.enqueue(out);
      useSim.getState().pushEvents(out.events, out.gateway);
    }
    useSim.getState().setRunning(true);
  }, [engine, agents.data, accounts.data, settings.data, snaps.data]);
}

/** requestAnimationFrame loop: speed × bars per second, UI refresh at ~10 Hz, persistence every 2 s. */
export function useSimLoop(): void {
  const qc = useQueryClient();
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    let lastBump = 0;
    let lastFlush = performance.now();
    let lastInv = 0;
    const frame = (now: number) => {
      const st = useSim.getState();
      const e = st.engine;
      const dt = Math.min(250, now - last);
      last = now;
      if (e && st.running && !e.killArmed) {
        acc += (dt / 1000) * st.speed;
        let n = Math.min(Math.floor(acc), 1200);
        acc -= n;
        const evs = [];
        const gws = [];
        const t0 = performance.now();
        while (n-- > 0 && performance.now() - t0 < 10) {
          const out = e.step();
          st.persister?.enqueue(out);
          if (out.events.length) evs.push(...out.events);
          if (out.gateway.length) gws.push(...out.gateway);
        }
        if (n > 0) acc = 0;
        if (evs.length || gws.length) st.pushEvents(evs, gws);
      }
      if (now - lastBump > 100) {
        lastBump = now;
        st.bump();
      }
      if (e && st.persister && now - lastFlush > 2000) {
        lastFlush = now;
        st.persister.flush(e).then((changed) => {
          if (changed && performance.now() - lastInv > 4000) {
            lastInv = performance.now();
            for (const k of [qk.trades, qk.orders, qk.gateway, qk.accounts, qk.positions])
              qc.invalidateQueries({ queryKey: k });
          }
        });
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [qc]);
}
