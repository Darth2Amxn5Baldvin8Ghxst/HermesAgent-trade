import { summarize, type McChunk, type McConfig, type McSummary } from "@/engine/montecarlo";
import { runInWorker, poolSize } from "./workerClient";

/** Runs a Monte Carlo across the worker pool, streaming partial summaries as chunks complete. */
export async function runMcPool(
  cfg: McConfig,
  onPartial: (s: McSummary, done: number) => void,
): Promise<McSummary> {
  const chunk = Math.max(500, Math.ceil(cfg.nRuns / (poolSize() * 4)));
  const jobs: { start: number; count: number }[] = [];
  for (let s = 0; s < cfg.nRuns; s += chunk)
    jobs.push({ start: s, count: Math.min(chunk, cfg.nRuns - s) });
  const done: (McChunk & { start: number })[] = [];
  let finished = 0;
  await Promise.all(
    jobs.map((j) =>
      runInWorker<McChunk>({
        type: "mc",
        cfg,
        start: j.start,
        count: j.count,
        samplePaths: j.start === 0 ? 100 : 0,
      }).then((c) => {
        done.push({ ...c, start: j.start });
        finished += j.count;
        done.sort((a, b) => a.start - b.start);
        onPartial(summarize(done), finished);
      }),
    ),
  );
  return summarize(done.sort((a, b) => a.start - b.start));
}
