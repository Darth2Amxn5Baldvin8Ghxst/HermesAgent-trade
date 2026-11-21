/** Operator actions that write state: every one leaves an audit row with before/after. */
import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { AGENT_CODES, type AgentCode } from "@/engine/types";
import { canPromoteToLive } from "@/engine/validation";
import { useSim } from "./store";
import { audit, qk, type AgentRow, type StepRow } from "./queries";

export function syncEngineFromAgents(agents: AgentRow[]): void {
  const e = useSim.getState().engine;
  if (!e) return;
  const by = Object.fromEntries(agents.map((a) => [a.code, a]));
  e.setBudgets(
    Object.fromEntries(AGENT_CODES.map((c) => [c, Number(by[c]?.budget_pct ?? 0.25)])) as Record<
      AgentCode,
      number
    >,
    Object.fromEntries(AGENT_CODES.map((c) => [c, by[c]?.status === "PROBATION"])),
  );
  e.setEnabled(
    Object.fromEntries(AGENT_CODES.map((c) => [c, by[c]?.status !== "HALTED"])) as Record<
      AgentCode,
      boolean
    >,
  );
}

export async function setAgentStatus(
  qc: QueryClient,
  agent: AgentRow,
  status: string,
  reason: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("agents")
    .update({ status })
    .eq("id", agent.id)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  await audit(
    `AGENT_STATUS_${status}`,
    "agents",
    agent.id,
    { status: agent.status },
    { status, reason },
  );
  const list =
    (qc.getQueryData(qk.agents) as AgentRow[] | undefined)?.map((a) =>
      a.id === agent.id ? data : a,
    ) ?? [];
  syncEngineFromAgents(list);
  qc.invalidateQueries({ queryKey: qk.agents });
  qc.invalidateQueries({ queryKey: qk.audit });
}

export async function promoteToProbation(
  qc: QueryClient,
  agent: AgentRow,
  steps: StepRow[],
): Promise<void> {
  const mine = steps.filter((s) => s.agent_id === agent.id).sort((a, b) => a.step - b.step);
  if (!canPromoteToLive(mine.map((s) => ({ status: s.status as "PASSED", signed: !!s.signed_by }))))
    throw new Error("All 10 validation steps must be PASSED and signed");
  await setAgentStatus(qc, agent, "PROBATION", "Validation gate complete: live at 25% of budget");
}

export async function saveParams(
  qc: QueryClient,
  agent: AgentRow,
  values: Record<string, unknown>,
  grid: Record<string, number[]>,
): Promise<void> {
  const before = agent.params;
  const after = { values, grid } as Json;
  const { error } = await supabase.from("agents").update({ params: after }).eq("id", agent.id);
  if (error) throw new Error(error.message);
  await audit("AGENT_PARAMS_UPDATE", "agents", agent.id, before, after);
  useSim.getState().engine?.updateParams(agent.code as AgentCode, values as never);
  qc.invalidateQueries({ queryKey: qk.agents });
  qc.invalidateQueries({ queryKey: qk.audit });
}
