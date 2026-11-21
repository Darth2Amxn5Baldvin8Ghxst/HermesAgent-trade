import { createFileRoute } from "@tanstack/react-router";
import { useAgents, useSettings, useSteps } from "@/lib/hermes/queries";
import { PageHeader } from "@/components/hermes/ui";
import { ValidationBoard } from "@/components/hermes/ValidationBoard";

export const Route = createFileRoute("/validation")({
  head: () => ({
    meta: [
      { title: "Validation Gate — HermesAgents" },
      {
        name: "description",
        content:
          "Ten ordered evidence steps, SHA-256 artifacts and human signatures before any agent touches real capital.",
      },
      { property: "og:title", content: "Validation Gate — HermesAgents" },
      {
        property: "og:description",
        content: "Pre-registration to probation: the ten-step gate with evidence and signatures.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Validation,
});

function Validation() {
  const agents = useAgents();
  const steps = useSteps();
  const settings = useSettings();
  return (
    <div>
      <PageHeader
        title="Validation Gate"
        sub="No agent trades real money until all ten steps pass in order. A failure sends the agent back to research, not to a parameter tweak. Evidence runs execute the engine in a background worker."
      />
      {agents.isLoading || steps.isLoading ? (
        <div className="h-96 animate-pulse rounded-xl bg-surface-1" />
      ) : (
        <ValidationBoard
          agents={agents.data ?? []}
          steps={steps.data ?? []}
          seed={Number(settings.data?.sim_seed ?? 20261109)}
        />
      )}
    </div>
  );
}
