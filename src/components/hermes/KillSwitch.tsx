import { useEffect, useState } from "react";
import { Power } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useSim } from "@/lib/hermes/store";
import { audit, qk, useSettings } from "@/lib/hermes/queries";
import { cn } from "@/lib/utils";

const PHRASE = "FLATTEN ALL";

export async function executeKill(qc: ReturnType<typeof useQueryClient>): Promise<void> {
  const { engine, persister } = useSim.getState();
  if (!engine) throw new Error("Engine not running");
  const before = {
    positions: engine.positions.length,
    working: engine.working.length,
    equity: engine.totals().equity.toNumber(),
    armed: engine.killArmed,
  };
  const out = engine.drain();
  persister?.enqueue(out);
  const trades = engine.kill();
  const ev = engine.drain();
  persister?.enqueue(ev);
  useSim.getState().pushEvents(ev.events, ev.gateway);
  await persister?.flush(engine);
  await supabase
    .from("operator_settings")
    .update({ kill_armed: true })
    .neq("id", "00000000-0000-0000-0000-000000000000");
  await audit("KILL_SWITCH_FLATTEN_ALL", "portfolio", null, before, {
    positions: engine.positions.length,
    working: engine.working.length,
    flattened: trades.length,
    equity: engine.totals().equity.toNumber(),
    armed: true,
  });
  for (const k of [qk.settings, qk.trades, qk.positions, qk.accounts, qk.audit])
    qc.invalidateQueries({ queryKey: k });
}

export function KillSwitch() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [holding, setHolding] = useState(false);
  const [busy, setBusy] = useState(false);
  const settings = useSettings();
  const armed = useSim((s) => s.engine?.killArmed ?? false);
  useSim((s) => s.version);
  const qc = useQueryClient();
  const holdPolicy = settings.data?.kill_policy === "hold10";

  const fire = async () => {
    setBusy(true);
    try {
      await executeKill(qc);
      toast.error("Kill switch armed — every simulated position flattened");
      setOpen(false);
      setText("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Kill switch failed");
    } finally {
      setBusy(false);
      setHolding(false);
    }
  };
  useEffect(() => {
    if (!holding) return;
    const t = setTimeout(fire, 10_000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holding]);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={cn(
          "no-print fixed right-5 bottom-14 z-40 grid size-14 place-items-center rounded-full bg-breach text-ink-0 shadow-xl transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-ink-0",
          armed && "ring-2 ring-neg ring-offset-2 ring-offset-surface-0",
        )}
        aria-label="Kill switch"
        title="Kill switch — flatten everything"
      >
        <svg className="absolute inset-0 -rotate-90" viewBox="0 0 60 60" aria-hidden="true">
          {(armed || holding) && (
            <circle
              cx="30"
              cy="30"
              r="28"
              fill="none"
              stroke="var(--ink-0)"
              strokeWidth="2"
              strokeDasharray="176"
              className={holding ? "kill-ring" : ""}
              opacity={0.8}
            />
          )}
        </svg>
        <Power className="size-6" />
      </button>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) {
            setHolding(false);
            setText("");
          }
        }}
      >
        <DialogContent className="border-breach/50 bg-surface-1">
          <DialogHeader>
            <DialogTitle className="text-neg">Kill switch</DialogTitle>
            <DialogDescription className="text-ink-1">
              Human-only. Cancels every working order, flattens every simulated position across
              G1–G4, and makes the gateway reject everything until you disarm it. An audit row is
              written.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="t-label">Type {PHRASE} to confirm</div>
            <Input
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={PHRASE}
              className="t-mono border-line-1 bg-surface-0"
              aria-label="Confirmation phrase"
            />
            {holdPolicy && (
              <p className="text-[12px] text-ink-2">
                Arming policy: 10-second hold. The switch fires after the countdown unless you
                cancel.
              </p>
            )}
            <Button
              variant="breach"
              className="w-full"
              disabled={text !== PHRASE || busy || holding}
              onClick={() => (holdPolicy ? setHolding(true) : fire())}
            >
              {holding
                ? "Firing in 10 s — close to cancel"
                : busy
                  ? "Flattening…"
                  : "Flatten all accounts"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
