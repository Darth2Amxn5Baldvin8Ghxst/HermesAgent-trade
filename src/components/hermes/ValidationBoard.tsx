import type { TablesUpdate } from "@/integrations/supabase/types";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import {
  STEPS,
  OVERALL_PASS_BAR,
  nextStatuses,
  type Evidence,
  type StepStatus,
  type PreRegistration,
} from "@/engine/validation";
import { BOOK_SECTIONS } from "@/content/book";
import { audit, qk, tradesQ, type AgentRow, type StepRow } from "@/lib/hermes/queries";
import { gridOf, paramsOf } from "@/lib/hermes/bootstrap";
import { runInWorker } from "@/lib/hermes/workerClient";
import { setAgentStatus } from "@/lib/hermes/actions";
import { PreRegSchema } from "@/lib/hermes/schemas";
import { fmtGmt } from "@/lib/hermes/format";
import { sha256 } from "@/engine/rng";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Label, StatusPill } from "./ui";
import { cn } from "@/lib/utils";

const COLS: StepStatus[] = ["LOCKED", "IN_PROGRESS", "PASSED", "FAILED"];
type EvidenceJson = { result?: Evidence; preRegistration?: PreRegistration };
const ev = (s: StepRow): EvidenceJson =>
  s.evidence && typeof s.evidence === "object" ? (s.evidence as EvidenceJson) : {};

export function ValidationBoard({
  agents,
  steps,
  seed,
}: {
  agents: AgentRow[];
  steps: StepRow[];
  seed: number;
}) {
  const [sel, setSel] = useState<{ agent: AgentRow; step: StepRow } | null>(null);
  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-line-gold bg-surface-1 px-4 py-2 text-[12px] text-gold-300">
        Pass bar · {OVERALL_PASS_BAR}
      </div>
      {agents.map((a) => {
        const mine = steps.filter((s) => s.agent_id === a.id).sort((x, y) => x.step - y.step);
        return (
          <section key={a.id}>
            <div className="mb-2 flex items-center gap-3">
              <span className="t-num text-gold-400">{a.code}</span>
              <span className="text-[14px]">{a.name}</span>
              <StatusPill status={a.status} />
              <span className="t-num ml-auto text-[12px] text-ink-2">
                {mine.filter((s) => s.status === "PASSED" && s.signed_by).length}/10 signed
              </span>
            </div>
            <div className="grid gap-3 md:grid-cols-4">
              {COLS.map((c) => (
                <div key={c} className="min-h-28 rounded-lg border border-line-0 bg-surface-1 p-2">
                  <div className="t-label mb-2 px-1">{c.replace("_", " ")}</div>
                  <div className="space-y-1.5">
                    {mine
                      .filter((s) => s.status === c)
                      .map((s) => (
                        <button
                          key={s.id}
                          onClick={() => setSel({ agent: a, step: s })}
                          className={cn(
                            "w-full rounded-md border bg-surface-2 p-2 text-left transition-colors hover:border-line-gold",
                            c === "FAILED" ? "border-breach/50" : "border-line-0",
                          )}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-[12px]">
                              <span className="t-num mr-1.5 text-ink-3">{s.step}</span>
                              {s.name}
                            </span>
                            {s.signed_by && <span className="t-label text-pos">signed</span>}
                          </div>
                          <div className="mt-1 line-clamp-2 text-[11px] leading-4 text-ink-2">
                            {STEPS[s.step - 1]?.bar}
                          </div>
                          {ev(s).result && (
                            <div
                              className={cn(
                                "t-label mt-1",
                                ev(s).result!.passed ? "text-pos" : "text-neg",
                              )}
                            >
                              evidence {ev(s).result!.passed ? "meets bar" : "fails bar"}
                            </div>
                          )}
                        </button>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        );
      })}
      <StepSheet sel={sel} onClose={() => setSel(null)} steps={steps} seed={seed} />
    </div>
  );
}

function StepSheet({
  sel,
  onClose,
  steps,
  seed,
}: {
  sel: { agent: AgentRow; step: StepRow } | null;
  onClose: () => void;
  steps: StepRow[];
  seed: number;
}) {
  const qc = useQueryClient();
  const trades = useQuery(tradesQ);
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState<{ f: number; label: string } | null>(null);
  const [confirm, setConfirm] = useState({ step: "", operator: "" });
  const step = sel ? (steps.find((s) => s.id === sel.step.id) ?? sel.step) : null;
  const agent = sel?.agent ?? null;
  const data = step ? ev(step) : {};
  const pre = data.preRegistration;
  const form = useForm<{ hypothesis: string; rules: string; variantCount: number }>({
    resolver: zodResolver(PreRegSchema),
    values: {
      hypothesis: pre?.hypothesis ?? "",
      rules:
        pre?.rules ??
        (agent
          ? (BOOK_SECTIONS.find((b) => b.engineModule?.includes(agent.code.toLowerCase()))?.title ??
            "")
          : ""),
      variantCount:
        pre?.variantCount ??
        (agent ? Object.values(gridOf(agent)).reduce((a, g) => a * g.length, 1) : 1),
    },
  });
  const mine = useMemo(
    () =>
      agent ? steps.filter((s) => s.agent_id === agent.id).sort((a, b) => a.step - b.step) : [],
    [agent, steps],
  );

  const writeStep = async (patch: Partial<StepRow>) => {
    const { error } = await supabase
      .from("validation_steps")
      .update(patch as never)
      .eq("id", step!.id);
    if (error) throw new Error(error.message);
  };
  const applyTransition = async (passed: boolean) => {
    const statuses = nextStatuses(
      mine.map((s) => s.status as StepStatus),
      step!.step,
      passed,
    );
    for (const s of mine) {
      const nextS = statuses[s.step - 1]!;
      if (nextS !== s.status) {
        const patch: TablesUpdate<"validation_steps"> = { status: nextS };
        if (nextS === "LOCKED") Object.assign(patch, { signed_by: null, signed_at: null });
        const { error } = await supabase.from("validation_steps").update(patch).eq("id", s.id);
        if (error) throw new Error(error.message);
      }
    }
    if (!passed && agent!.status !== "RESEARCH")
      await setAgentStatus(qc, agent!, "RESEARCH", `Validation step ${step!.step} failed`);
  };

  const savePre = form.handleSubmit(async (v) => {
    const reg: PreRegistration = {
      hypothesis: v.hypothesis,
      rules: v.rules,
      grid: gridOf(agent!),
      variantCount: v.variantCount,
    };
    const hash = await sha256(reg);
    await writeStep({
      evidence: { ...data, preRegistration: reg } as unknown as Json,
      artifact_hash: hash,
    });
    await audit(
      "VALIDATION_PREREGISTER",
      "validation_steps",
      step!.id,
      data.preRegistration ?? null,
      { ...reg, sha256: hash },
    );
    qc.invalidateQueries({ queryKey: qk.steps });
    toast.success(`Pre-registration hashed · ${hash.slice(0, 12)}…`);
  });

  const run = async () => {
    if (!agent || !step) return;
    setBusy(true);
    setProg({ f: 0, label: "starting" });
    try {
      const shadow = (trades.data ?? [])
        .filter((t) => t.agent_id === agent.id)
        .map((t) => ({ r: Number(t.r_multiple), closedAt: new Date(t.closed_at).getTime() }));
      const pre1 = ev(mine[0]!).preRegistration ?? null;
      const result = await runInWorker<Evidence>(
        {
          type: "validate",
          step: step.step,
          ctx: {
            agent: agent.code as "G1",
            params: paramsOf(agent),
            grid: gridOf(agent),
            seed,
            preRegistration: pre1,
            shadowTrades: shadow,
            priorSteps: mine.map((s) => ({
              step: s.step,
              status: s.status as StepStatus,
              signed: !!s.signed_by,
            })),
          },
        },
        (f, label) => setProg({ f, label: label ?? "" }),
      );
      const before = { status: step.status, evidence: data.result ?? null };
      await writeStep({
        evidence: { ...data, result } as unknown as Json,
        artifact_hash: result.hash,
        signed_by: null,
        signed_at: null,
      });
      if (!result.passed) await applyTransition(false);
      await audit("VALIDATION_EVIDENCE_RUN", "validation_steps", step.id, before, {
        passed: result.passed,
        hash: result.hash,
        metrics: result.metrics,
      });
      qc.invalidateQueries({ queryKey: qk.steps });
      if (result.passed)
        toast.success(`Step ${step.step} evidence meets the bar — sign to promote`);
      else toast.error(`Step ${step.step} failed — ${agent.code} returns to RESEARCH`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Evidence run failed");
    } finally {
      setBusy(false);
      setProg(null);
    }
  };

  const sign = async () => {
    if (!agent || !step) return;
    const { data: u } = await supabase.auth.getUser();
    const email = u.user?.email ?? "";
    if (
      confirm.step !== String(step.step) ||
      confirm.operator.trim().toLowerCase() !== email.toLowerCase()
    ) {
      toast.error("Type the step number and your operator email exactly");
      return;
    }
    setBusy(true);
    try {
      await writeStep({ status: "PASSED", signed_by: email, signed_at: new Date().toISOString() });
      await applyTransition(true);
      await audit(
        "VALIDATION_SIGN",
        "validation_steps",
        step.id,
        { status: step.status },
        { status: "PASSED", signed_by: email, hash: step.artifact_hash },
      );
      qc.invalidateQueries({ queryKey: qk.steps });
      toast.success(`Step ${step.step} signed by ${email}`);
      setConfirm({ step: "", operator: "" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Signing failed");
    } finally {
      setBusy(false);
    }
  };

  const resetGate = async () => {
    if (!agent) return;
    for (const s of mine)
      await supabase
        .from("validation_steps")
        .update({
          status: s.step === 1 ? "IN_PROGRESS" : "LOCKED",
          evidence: {} as Json,
          artifact_hash: null,
          signed_by: null,
          signed_at: null,
        })
        .eq("id", s.id);
    await audit(
      "VALIDATION_RESET",
      "agents",
      agent.id,
      { steps: mine.map((s) => s.status) },
      { steps: "reset" },
    );
    qc.invalidateQueries({ queryKey: qk.steps });
    toast.success(`${agent.code} gate reset — re-register before any run`);
  };

  const r = data.result;
  const canRun = step && (step.status === "IN_PROGRESS" || step.status === "FAILED") && !busy;
  const canSign = step && step.status === "IN_PROGRESS" && r?.passed && !busy;
  return (
    <Sheet open={!!sel} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-[600px] overflow-y-auto border-line-1 bg-surface-1 sm:max-w-[600px]">
        <SheetHeader>
          <SheetTitle className="text-ink-0">
            {agent?.code} · Step {step?.step} — {step?.name}
          </SheetTitle>
        </SheetHeader>
        {step && agent && (
          <div className="space-y-5 px-4 pb-10 text-[13px]">
            <div className="flex items-center gap-2">
              <StatusPill status={step.status} />
              {step.signed_by && (
                <span className="text-[12px] text-ink-2">
                  signed by {step.signed_by} · {step.signed_at ? fmtGmt(step.signed_at) : ""}
                </span>
              )}
            </div>
            <div>
              <Label>Pass bar</Label>
              <p className="mt-1 text-ink-1">{STEPS[step.step - 1]?.bar}</p>
            </div>
            {step.step === 1 && (
              <form onSubmit={savePre} className="space-y-2 rounded-lg border border-line-0 p-3">
                <Label>Pre-registration</Label>
                <Textarea
                  {...form.register("hypothesis")}
                  placeholder="Hypothesis"
                  className="border-line-1 bg-surface-0 text-[12px]"
                  rows={3}
                />
                {form.formState.errors.hypothesis && (
                  <p className="text-[11px] text-neg">{form.formState.errors.hypothesis.message}</p>
                )}
                <Textarea
                  {...form.register("rules")}
                  placeholder="Rules"
                  className="border-line-1 bg-surface-0 text-[12px]"
                  rows={3}
                />
                {form.formState.errors.rules && (
                  <p className="text-[11px] text-neg">{form.formState.errors.rules.message}</p>
                )}
                <div className="flex items-center gap-2">
                  <span className="text-[12px] text-ink-2">Variants</span>
                  <Input
                    type="number"
                    {...form.register("variantCount")}
                    className="t-mono h-8 w-24 border-line-1 bg-surface-0"
                  />
                </div>
                <Button
                  type="submit"
                  size="sm"
                  variant="terminal"
                  disabled={step.status !== "IN_PROGRESS" && step.status !== "FAILED"}
                >
                  Hash & save pre-registration
                </Button>
              </form>
            )}
            <div className="flex flex-wrap gap-2">
              <Button variant="gold" size="sm" disabled={!canRun} onClick={run}>
                {busy ? "Running…" : "Run evidence check"}
              </Button>
              {step.status === "FAILED" && (
                <Button variant="terminal" size="sm" onClick={resetGate}>
                  Back to research · reset gate
                </Button>
              )}
            </div>
            {prog && (
              <div className="space-y-1">
                <Progress value={prog.f * 100} className="h-1.5" />
                <div className="t-mono text-[11px] text-ink-2">{prog.label}</div>
              </div>
            )}
            {r && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>Evidence</Label>
                  <StatusPill status={r.passed ? "PASS" : "FAIL"} />
                  <span className="t-mono text-[11px] text-ink-3">{fmtGmt(r.ranAt)}</span>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {Object.entries(r.metrics).map(([k, v]) => (
                    <div key={k} className="rounded border border-line-0 px-2 py-1">
                      <div className="t-label truncate">{k}</div>
                      <div className="t-mono truncate text-[12px]" title={String(v)}>
                        {String(v)}
                      </div>
                    </div>
                  ))}
                </div>
                {r.notes.map((n, i) => (
                  <p key={i} className="text-[12px] text-ink-2">
                    {n}
                  </p>
                ))}
                <details className="rounded border border-line-0 p-2">
                  <summary className="t-label cursor-pointer">Evidence JSON</summary>
                  <pre className="t-mono mt-2 max-h-60 overflow-auto text-[11px] text-ink-1">
                    {JSON.stringify(data, null, 2)}
                  </pre>
                </details>
              </div>
            )}
            <div>
              <Label>Artifact SHA-256</Label>
              <div className="t-mono mt-1 break-all text-[11px] text-ink-1">
                {step.artifact_hash ?? "—"}
              </div>
            </div>
            <div className="space-y-2 rounded-lg border border-line-gold p-3">
              <Label>Sign and promote</Label>
              <p className="text-[12px] text-ink-2">
                Human signature required. Type the step number and your operator email.
              </p>
              <div className="flex gap-2">
                <Input
                  value={confirm.step}
                  onChange={(e) => setConfirm({ ...confirm, step: e.target.value })}
                  placeholder="step #"
                  className="t-mono h-8 w-20 border-line-1 bg-surface-0"
                />
                <Input
                  value={confirm.operator}
                  onChange={(e) => setConfirm({ ...confirm, operator: e.target.value })}
                  placeholder="operator email"
                  className="h-8 flex-1 border-line-1 bg-surface-0"
                />
              </div>
              <Button size="sm" variant="gold" disabled={!canSign} onClick={sign}>
                Sign step {step.step}
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
