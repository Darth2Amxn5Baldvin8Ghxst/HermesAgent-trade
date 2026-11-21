/// <reference lib="webworker" />
import { simulateChunk, type McConfig } from "@/engine/montecarlo";
import { runBacktest, randomBaseline, type BacktestSpec } from "@/engine/backtest";
import { runStep, type ValidationContext } from "@/engine/validation";

export type WorkerRequest =
  | { type: "mc"; id: number; cfg: McConfig; start: number; count: number; samplePaths: number }
  | { type: "backtest"; id: number; spec: BacktestSpec; baseline?: boolean }
  | { type: "validate"; id: number; step: number; ctx: Omit<ValidationContext, "onProgress"> };

const post = (m: unknown, transfer: Transferable[] = []) =>
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(m, transfer);

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  try {
    if (msg.type === "mc") {
      const ch = simulateChunk(msg.cfg, msg.start, msg.count, msg.samplePaths);
      post({ id: msg.id, type: "result", result: ch }, [
        ch.maxDd.buffer,
        ch.terminal.buffer,
        ch.losingMonth.buffer,
      ]);
    } else if (msg.type === "backtest") {
      const r = await runBacktest(msg.spec, (f) =>
        post({ id: msg.id, type: "progress", progress: f }),
      );
      const baseline = msg.baseline ? randomBaseline(r, msg.spec.seed) : null;
      post({
        id: msg.id,
        type: "result",
        result: {
          metrics: r.metrics,
          trades: r.trades,
          dailyEquity: r.dailyEquity,
          dailyReturns: r.dailyReturns,
          hash: r.hash,
          baseline: baseline
            ? {
                p: baseline.test.p,
                t: baseline.test.t,
                meanStrat:
                  baseline.strat.reduce((a, b) => a + b, 0) / Math.max(1, baseline.strat.length),
                meanRandom:
                  baseline.random.reduce((a, b) => a + b, 0) / Math.max(1, baseline.random.length),
                n: baseline.strat.length,
              }
            : null,
        },
      });
    } else if (msg.type === "validate") {
      const ev2 = await runStep(msg.step, {
        ...msg.ctx,
        onProgress: (f, label) => post({ id: msg.id, type: "progress", progress: f, label }),
      });
      post({ id: msg.id, type: "result", result: ev2 });
    }
  } catch (e) {
    post({ id: msg.id, type: "error", error: e instanceof Error ? e.message : String(e) });
  }
};
