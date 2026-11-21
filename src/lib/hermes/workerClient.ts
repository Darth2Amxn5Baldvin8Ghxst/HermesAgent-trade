/** Small worker pool for Monte Carlo chunks, backtests and validation evidence runs. */
import type { WorkerRequest } from "@/workers/engine.worker";

type Pending = {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  onProgress?: ((f: number, label?: string) => void) | undefined;
};
let seq = 0;
const pending = new Map<number, Pending>();
const pool: Worker[] = [];
let rr = 0;

function spawn(): Worker {
  const w = new Worker(new URL("../../workers/engine.worker.ts", import.meta.url), {
    type: "module",
  });
  w.onmessage = (
    ev: MessageEvent<{
      id: number;
      type: string;
      result?: unknown;
      progress?: number;
      label?: string;
      error?: string;
    }>,
  ) => {
    const p = pending.get(ev.data.id);
    if (!p) return;
    if (ev.data.type === "progress") p.onProgress?.(ev.data.progress ?? 0, ev.data.label);
    else if (ev.data.type === "error") {
      pending.delete(ev.data.id);
      p.reject(new Error(ev.data.error ?? "worker error"));
    } else {
      pending.delete(ev.data.id);
      p.resolve(ev.data.result);
    }
  };
  return w;
}
export const poolSize = (): number =>
  Math.max(
    1,
    Math.min(4, (typeof navigator !== "undefined" && navigator.hardwareConcurrency) || 2) - 0,
  );

type DistOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export function runInWorker<T>(
  req: DistOmit<WorkerRequest, "id">,
  onProgress?: (f: number, label?: string) => void,
): Promise<T> {
  if (pool.length < poolSize()) pool.push(spawn());
  const w = pool[rr++ % pool.length]!;
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject, onProgress });
    w.postMessage({ ...req, id });
  });
}
