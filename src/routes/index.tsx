import { createFileRoute } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useSim } from "@/lib/hermes/store";
import { useAgents, useSettings, useSteps } from "@/lib/hermes/queries";
import { limitsOf } from "@/lib/hermes/bootstrap";
import { promoteToProbation } from "@/lib/hermes/actions";
import { canPromoteToLive } from "@/engine/validation";
import type { AgentCode } from "@/engine/types";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PageHeader, Panel } from "@/components/hermes/ui";
import {
  ActivityFeed,
  AgentStatusCard,
  EquityChart,
  GoldGauge,
  LossBrakes,
  RiskMeter,
} from "@/components/hermes/widgets";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Command Center — HermesAgents" },
      {
        name: "description",
        content:
          "Live equity, drawdown floor, risk meter, gold exposure and gateway activity for the four XAUUSD agents.",
      },
      { property: "og:title", content: "Command Center — HermesAgents" },
      {
        property: "og:description",
        content:
          "Live equity, drawdown floor, risk meter and gold exposure for four XAUUSD agents.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CommandCenter,
});

function CommandCenter() {
  useSim((s) => s.version);
  const engine = useSim((s) => s.engine);
  const agents = useAgents();
  const steps = useSteps();
  const settings = useSettings();
  const qc = useQueryClient();
  const limits = limitsOf(settings.data?.risk_limits);
  if (!engine || !agents.data) {
    return (
      <div className="space-y-4">
        <div className="h-9 w-72 animate-pulse rounded bg-surface-2" />
        <div className="grid grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-36 animate-pulse rounded-xl bg-surface-1" />
          ))}
        </div>
        <div className="h-72 animate-pulse rounded-xl bg-surface-1" />
      </div>
    );
  }
  return (
    <div>
      <PageHeader
        title="Command Center"
        sub="Four agents on separate simulated accounts behind one shared risk gateway. Every number below is computed by the engine running in this tab."
      />
      <div className="grid gap-4 xl:grid-cols-[1fr_480px]">
        <div className="min-w-0 space-y-4">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {agents.data.map((a, i) => (
              <motion.div
                key={a.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03, duration: 0.22 }}
              >
                <AgentStatusCard
                  engine={engine}
                  code={a.code as AgentCode}
                  name={a.name}
                  status={a.status}
                  budget={Number(a.budget_pct)}
                />
              </motion.div>
            ))}
          </div>
          <EquityChart engine={engine} />
          <div className="grid gap-4 lg:grid-cols-[1fr_220px_240px]">
            <Panel title="Risk strip">
              <RiskMeter engine={engine} limits={limits} />
            </Panel>
            <Panel title="Gold exposure">
              <GoldGauge value={engine.goldExposure()} />
            </Panel>
            <Panel title="Brakes">
              <LossBrakes engine={engine} limits={limits} />
            </Panel>
          </div>
          <Panel title="Promotion · validation-gated">
            <div className="grid gap-3 md:grid-cols-4">
              {agents.data.map((a) => {
                const mine = (steps.data ?? []).filter((s) => s.agent_id === a.id);
                const ok = canPromoteToLive(
                  mine.map((s) => ({ status: s.status as "PASSED", signed: !!s.signed_by })),
                );
                const passed = mine.filter((s) => s.status === "PASSED" && s.signed_by).length;
                const btn = (
                  <Button
                    variant={ok ? "gold" : "terminal"}
                    size="sm"
                    className="w-full"
                    disabled={!ok || a.status === "PROBATION" || a.status === "LIVE"}
                    onClick={() =>
                      promoteToProbation(qc, a, steps.data ?? []).then(
                        () => toast.success(`${a.code} promoted to PROBATION at 25% budget`),
                        (e: unknown) =>
                          toast.error(e instanceof Error ? e.message : "Promotion failed"),
                      )
                    }
                  >
                    Promote {a.code} to PROBATION
                  </Button>
                );
                return (
                  <div key={a.id} className="space-y-1.5">
                    {ok ? (
                      btn
                    ) : (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="block">{btn}</span>
                        </TooltipTrigger>
                        <TooltipContent className="border border-line-1 bg-surface-1 text-ink-0">
                          Locked: {passed}/10 validation steps passed and signed.
                        </TooltipContent>
                      </Tooltip>
                    )}
                    <div className="t-num text-center text-[11px] text-ink-2">
                      {passed}/10 signed
                    </div>
                  </div>
                );
              })}
            </div>
          </Panel>
        </div>
        <Panel title="Activity · gateway, orders, fills, brakes" bodyClass="p-2">
          <ActivityFeed />
        </Panel>
      </div>
    </div>
  );
}
