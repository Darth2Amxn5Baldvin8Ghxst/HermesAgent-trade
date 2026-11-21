/**
 * Seeded US CPI / NFP calendar. The planted response model is shared by the synthetic feed and the
 * historical event table, so G2's fitted β has a true value the pipeline can recover (validation step 8).
 */
import { Rng, hashSeed } from "./rng";

export type MacroKind = "CPI" | "NFP";
export interface MacroEvent {
  id: string;
  kind: MacroKind;
  t: number; // release, epoch ms UTC (13:30 GMT)
  consensusTs: number;
  consensus: number;
  actual: number;
  sdPast: number;
  s: number; // standardised surprise
  void: boolean; // look-ahead consensus → event voided
}
export interface EventObservation {
  id: string;
  kind: MacroKind;
  t: number;
  s: number;
  ret: Record<5 | 15 | 30 | 60, number>; // XAU log return from release+3m over w minutes
  absMove60: number; // |XAU log return| release → release+60m
}
export const G2_WINDOWS = [5, 15, 30, 60] as const;

/** True drift per unit surprise (log return fully realised by +45 min). Hot CPI / strong NFP → gold down. */
export const PLANTED_BETA: Record<MacroKind, number> = { CPI: -0.0016, NFP: -0.0013 };
export const NEWS_SPIKE_PER_S = -0.0018;
export const DRIFT_HORIZON_MIN = 45;
export const NEWS_SIGMA_PER_MIN = 0.00027 * 2.2;

const DAY = 86_400_000;
const releaseTime = (y: number, m: number, d: number) => Date.UTC(y, m, d, 13, 30);
function firstFriday(y: number, m: number): number {
  for (let d = 1; d <= 7; d++) if (new Date(Date.UTC(y, m, d)).getUTCDay() === 5) return d;
  return 1;
}
function cpiDay(y: number, m: number): number {
  let d = 12;
  while ([0, 6].includes(new Date(Date.UTC(y, m, d)).getUTCDay())) d++;
  return d;
}
const SD_SURPRISE: Record<MacroKind, number> = { CPI: 0.1, NFP: 60 };
const CONS_LEVEL: Record<MacroKind, number> = { CPI: 0.3, NFP: 180 };

export function buildCalendar(seed: number, fromMs: number, toMs: number): MacroEvent[] {
  const out: MacroEvent[] = [];
  const from = new Date(fromMs);
  const rng = new Rng(hashSeed(seed, "calendar"));
  for (let y = from.getUTCFullYear(), m = from.getUTCMonth(); Date.UTC(y, m, 1) <= toMs; m++) {
    if (m > 11) {
      m = 0;
      y++;
    }
    for (const kind of ["NFP", "CPI"] as const) {
      const d = kind === "NFP" ? firstFriday(y, m) : cpiDay(y, m);
      const t = releaseTime(y, m, d);
      const z = rng.normal();
      const lookAhead = rng.next() < 0.04;
      if (t < fromMs || t > toMs) continue;
      const sdPast = SD_SURPRISE[kind];
      const consensus = CONS_LEVEL[kind] + rng.normal() * sdPast * 0.5;
      out.push({
        id: `${kind}-${y}-${String(m + 1).padStart(2, "0")}`,
        kind,
        t,
        consensusTs: lookAhead ? t + 5 * 60_000 : t - 18 * 3_600_000,
        consensus,
        actual: consensus + z * sdPast,
        sdPast,
        s: z,
        void: lookAhead,
      });
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

/** Past events (before the sim start) with realised XAU windows drawn from the planted model. */
export function buildEventHistory(
  seed: number,
  beforeMs: number,
  years = 10,
  beta: Record<MacroKind, number> = PLANTED_BETA,
): EventObservation[] {
  const rng = new Rng(hashSeed(seed, "event-history"));
  const evs = buildCalendar(seed ^ 0x5bd1e995, beforeMs - years * 365 * DAY, beforeMs - DAY).filter(
    (e) => !e.void,
  );
  return evs.map((e) => {
    const ret = {} as Record<5 | 15 | 30 | 60, number>;
    let cum = 0;
    let prevW = 0;
    for (const w of G2_WINDOWS) {
      const drift =
        (beta[e.kind] *
          e.s *
          (Math.min(w, DRIFT_HORIZON_MIN) - Math.min(prevW, DRIFT_HORIZON_MIN))) /
        DRIFT_HORIZON_MIN;
      cum += drift + rng.normal() * NEWS_SIGMA_PER_MIN * Math.sqrt(w - prevW);
      ret[w] = cum;
      prevW = w;
    }
    const absMove60 = Math.abs(
      NEWS_SPIKE_PER_S * e.s + ret[60] + rng.normal() * NEWS_SIGMA_PER_MIN * Math.sqrt(3),
    );
    return { id: e.id, kind: e.kind, t: e.t, s: e.s, ret, absMove60 };
  });
}

export function isTier1Blackout(
  t: number,
  events: readonly MacroEvent[],
  beforeMin = 30,
  afterMin = 60,
): MacroEvent | null {
  for (const e of events) {
    if (t >= e.t - beforeMin * 60_000 && t <= e.t + afterMin * 60_000) return e;
  }
  return null;
}
