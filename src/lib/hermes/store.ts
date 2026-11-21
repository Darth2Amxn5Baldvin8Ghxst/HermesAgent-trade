/** Ephemeral client state (zustand): the live engine, run loop controls and the activity feed. */
import { create } from "zustand";
import { HermesEngine, type EngineConfig } from "@/engine/engine";
import { SimBrokerAdapter } from "@/engine/broker";
import type { EngineEvent, GatewayEvent } from "@/engine/types";
import type { Persister } from "./persist";

export const SPEEDS = [1, 10, 60, 100, 600] as const;
export type Speed = (typeof SPEEDS)[number];

export interface FeedItem extends EngineEvent {
  id: number;
}
interface SimStore {
  engine: HermesEngine | null;
  persister: Persister | null;
  running: boolean;
  speed: Speed;
  version: number;
  feed: FeedItem[];
  gatewayLive: GatewayEvent[];
  broker: SimBrokerAdapter;
  lastError: string | null;
  init: (cfg: EngineConfig, persister: Persister) => HermesEngine;
  setRunning: (r: boolean) => void;
  setSpeed: (s: Speed) => void;
  bump: () => void;
  pushEvents: (e: EngineEvent[], g: GatewayEvent[]) => void;
  reset: () => void;
}
let fid = 0;
export const useSim = create<SimStore>((set, get) => ({
  engine: null,
  persister: null,
  running: false,
  speed: 60,
  version: 0,
  feed: [],
  gatewayLive: [],
  broker: new SimBrokerAdapter(() => get().engine),
  lastError: null,
  init: (cfg, persister) => {
    const engine = new HermesEngine(cfg);
    set({ engine, persister, feed: [], gatewayLive: [], version: get().version + 1 });
    return engine;
  },
  setRunning: (running) => set({ running }),
  setSpeed: (speed) => set({ speed }),
  bump: () => set({ version: get().version + 1 }),
  pushEvents: (e, g) => {
    if (!e.length && !g.length) return;
    const feed = [...e.map((x) => ({ ...x, id: ++fid })).reverse(), ...get().feed].slice(0, 300);
    const gatewayLive = [...g, ...get().gatewayLive].slice(0, 1800);
    set({ feed, gatewayLive });
  },
  reset: () => set({ engine: null, persister: null, running: false, feed: [], gatewayLive: [] }),
}));

/** Subscribe to engine changes at UI refresh cadence (~10 Hz). */
export const useEngineVersion = () => useSim((s) => s.version);
export const useEngine = () => useSim((s) => s.engine);

import type { McSummary, TailScenario } from "@/engine/montecarlo";
/** Latest book-parameter Monte Carlo results, used by verified-in-code tooltips in the book. */
export const useMcCache = create<{
  results: Partial<Record<TailScenario, McSummary>>;
  set: (t: TailScenario, r: McSummary) => void;
}>((set, get) => ({
  results: {},
  set: (t, r) => set({ results: { ...get().results, [t]: r } }),
}));

/** Last grid run per agent (Backtest Studio) — drives plateau thumbnails and the Promote lock. */
export interface GridRun {
  agent: string;
  paramA: string;
  paramB: string;
  valuesA: number[];
  valuesB: number[];
  metric: string;
  grid: number[][];
  plateau: boolean[][];
  ranAt: number;
}
export const useGridCache = create<{ runs: Record<string, GridRun>; set: (r: GridRun) => void }>(
  (set, get) => ({
    runs: {},
    set: (r) => set({ runs: { ...get().runs, [r.agent]: r } }),
  }),
);
