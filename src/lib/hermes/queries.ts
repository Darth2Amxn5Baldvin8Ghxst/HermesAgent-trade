import { queryOptions, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";

export type Tbl<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];
export type AgentRow = Tbl<"agents">;
export type AccountRow = Tbl<"accounts">;
export type TradeRow = Tbl<"trades">;
export type OrderRow = Tbl<"orders">;
export type GatewayRow = Tbl<"gateway_events">;
export type StepRow = Tbl<"validation_steps">;
export type SettingsRow = Tbl<"operator_settings">;
export type DecisionRow = Tbl<"overseer_decisions">;
export type AuditRow = Tbl<"audit_log">;
export type McRow = Tbl<"monte_carlo_runs">;
export type ReportRow = Tbl<"report_cards">;
export type SnapshotRow = Tbl<"equity_snapshots">;
export type PositionRow = Tbl<"positions">;

async function must<T>(
  p: PromiseLike<{ data: T | null; error: { message: string } | null }>,
): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data as T;
}

export const qk = {
  agents: ["agents"] as const,
  accounts: ["accounts"] as const,
  settings: ["settings"] as const,
  trades: ["trades"] as const,
  orders: ["orders"] as const,
  gateway: ["gateway"] as const,
  steps: ["steps"] as const,
  decisions: ["decisions"] as const,
  audit: ["audit"] as const,
  mc: ["mc"] as const,
  reports: ["reports"] as const,
  snapshots: ["snapshots"] as const,
  positions: ["positions"] as const,
  datasets: ["datasets"] as const,
};

export const agentsQ = queryOptions({
  queryKey: qk.agents,
  queryFn: () => must(supabase.from("agents").select("*").order("code")),
});
export const accountsQ = queryOptions({
  queryKey: qk.accounts,
  queryFn: () => must(supabase.from("accounts").select("*")),
});
export const settingsQ = queryOptions({
  queryKey: qk.settings,
  queryFn: async () =>
    (await must(supabase.from("operator_settings").select("*").limit(1)))[0] ?? null,
});
export const tradesQ = queryOptions({
  queryKey: qk.trades,
  queryFn: () =>
    must(supabase.from("trades").select("*").order("closed_at", { ascending: false }).limit(1000)),
});
export const ordersQ = queryOptions({
  queryKey: qk.orders,
  queryFn: () =>
    must(
      supabase.from("orders").select("*").order("submitted_at", { ascending: false }).limit(1000),
    ),
});
export const gatewayQ = queryOptions({
  queryKey: qk.gateway,
  queryFn: () =>
    must(
      supabase
        .from("gateway_events")
        .select("*")
        .order("occurred_at", { ascending: false })
        .order("seq", { ascending: true })
        .limit(1000),
    ),
});
export const stepsQ = queryOptions({
  queryKey: qk.steps,
  queryFn: () => must(supabase.from("validation_steps").select("*").order("step")),
});
export const decisionsQ = queryOptions({
  queryKey: qk.decisions,
  queryFn: () =>
    must(
      supabase.from("overseer_decisions").select("*").order("ts", { ascending: false }).limit(200),
    ),
});
export const auditQ = queryOptions({
  queryKey: qk.audit,
  queryFn: () =>
    must(supabase.from("audit_log").select("*").order("ts", { ascending: false }).limit(500)),
});
export const mcQ = queryOptions({
  queryKey: qk.mc,
  queryFn: () =>
    must(
      supabase
        .from("monte_carlo_runs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50),
    ),
});
export const reportsQ = queryOptions({
  queryKey: qk.reports,
  queryFn: () =>
    must(
      supabase
        .from("report_cards")
        .select("*")
        .order("period_end", { ascending: false })
        .limit(200),
    ),
});
export const snapshotsQ = queryOptions({
  queryKey: qk.snapshots,
  queryFn: () =>
    must(
      supabase
        .from("equity_snapshots")
        .select("*")
        .is("account_id", null)
        .order("ts", { ascending: false })
        .limit(1000),
    ),
});
export const positionsQ = queryOptions({
  queryKey: qk.positions,
  queryFn: () => must(supabase.from("positions").select("*").eq("status", "OPEN")),
});
export const datasetsQ = queryOptions({
  queryKey: qk.datasets,
  queryFn: async () => {
    const rows = await must(
      supabase.from("price_data").select("dataset, ts").order("ts").limit(1000),
    );
    const m = new Map<string, { dataset: string; first: string; n: number }>();
    for (const r of rows) {
      const e = m.get(r.dataset);
      if (e) e.n++;
      else m.set(r.dataset, { dataset: r.dataset, first: r.ts, n: 1 });
    }
    return [...m.values()];
  },
});

export const useAgents = () => useQuery(agentsQ);
export const useAccounts = () => useQuery(accountsQ);
export const useSettings = () => useQuery(settingsQ);
export const useSteps = () => useQuery(stepsQ);

export function useInvalidate(): (...keys: (readonly string[])[]) => void {
  const qc = useQueryClient();
  return (...keys) => keys.forEach((k) => qc.invalidateQueries({ queryKey: k }));
}

/** Every operator action writes an audit row with before/after JSON and the actor. */
export async function audit(
  action: string,
  entity: string,
  entityId: string | null,
  before: unknown,
  after: unknown,
  actor?: string,
): Promise<string | null> {
  const { data: u } = await supabase.auth.getUser();
  const who = actor ?? `operator:${u.user?.email ?? "unknown"}`;
  const { data, error } = await supabase
    .from("audit_log")
    .insert({
      actor: who,
      action,
      entity,
      entity_id: entityId,
      before: (before ?? null) as Json,
      after: (after ?? null) as Json,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data?.id ?? null;
}
export function invalidateAll(qc: QueryClient): void {
  for (const k of Object.values(qk)) qc.invalidateQueries({ queryKey: k });
}
