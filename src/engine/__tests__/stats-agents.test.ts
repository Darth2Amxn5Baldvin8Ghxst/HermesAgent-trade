import { describe, expect, it } from "vitest";
import { Rng } from "../rng";
import {
  ar1VarianceRatio,
  bonferroni,
  bonferroniAlpha,
  engleGranger,
  signTestTheta,
  varianceRatio,
} from "../stats";
import { g1HardExit, inG1EntryWindow, mergeLevels, passesCostGate, G1Agent } from "../agents/g1";
import { g2EntryBlock, surpriseZ } from "../agents/g2";
import { g3Gate, G3_PAIRS } from "../agents/g3";
import { outsideBand, trendSignal } from "../agents/g4";
import { HermesEngine, defaultConfig } from "../engine";
import { D } from "../money";
import type { MacroEvent } from "../calendar";

describe("G1 — Lo–MacKinlay variance ratio", () => {
  it("matches the AR(1) closed form VR(q) = 1 + 2Σ(1−k/q)ρ^k", () => {
    const rng = new Rng(42);
    for (const rho of [-0.3, 0.2]) {
      const r: number[] = [];
      let prev = 0;
      for (let i = 0; i < 200_000; i++) {
        prev = rho * prev + rng.normal();
        r.push(prev);
      }
      for (const q of [2, 4, 8])
        expect(varianceRatio(r, q).vr).toBeCloseTo(ar1VarianceRatio(rho, q), 1);
    }
  });
  it("is ≈ 1 for white noise", () => {
    const rng = new Rng(1);
    const r = Array.from({ length: 100_000 }, () => rng.normal());
    expect(Math.abs(varianceRatio(r, 4).vr - 1)).toBeLessThan(0.03);
  });
});

describe("G1 rules", () => {
  it("merges levels within 0.25×ATR into zones", () => {
    const z = mergeLevels(
      [
        { px: 100, src: "PDL" },
        { px: 100.2, src: "ASL" },
        { px: 103, src: "PDH" },
      ],
      0.25,
    );
    expect(z).toHaveLength(2);
    expect(z[0]).toMatchObject({ lo: 100, hi: 100.2 });
    expect(z[0]!.sources).toEqual(["PDL", "ASL"]);
  });
  it("time stop = min(fill + 6h, 16:00 GMT); 0 = session end", () => {
    const t = Date.UTC(2026, 0, 6, 8, 0);
    expect(g1HardExit(t, 6)).toBe(Date.UTC(2026, 0, 6, 14, 0));
    expect(g1HardExit(Date.UTC(2026, 0, 6, 12, 0), 6)).toBe(Date.UTC(2026, 0, 6, 16, 0));
    expect(g1HardExit(t, 0)).toBe(Date.UTC(2026, 0, 6, 16, 0));
  });
  it("entry window 07:00–16:00 GMT excluding 13:30–14:00", () => {
    expect(inG1EntryWindow(Date.UTC(2026, 0, 6, 6, 59))).toBe(false);
    expect(inG1EntryWindow(Date.UTC(2026, 0, 6, 7, 0))).toBe(true);
    expect(inG1EntryWindow(Date.UTC(2026, 0, 6, 13, 45))).toBe(false);
    expect(inG1EntryWindow(Date.UTC(2026, 0, 6, 14, 0))).toBe(true);
    expect(inG1EntryWindow(Date.UTC(2026, 0, 6, 16, 0))).toBe(false);
  });
  it("cost gate requires target ≥ 4× round-trip cost", () => {
    expect(passesCostGate(1.0, 0.2, 0.01, 0.03, 4).ok).toBe(true); // rt = 0.25
    expect(passesCostGate(0.99, 0.2, 0.01, 0.03, 4).ok).toBe(false);
  });
  it("three stop-outs in one session end G1 for the day", () => {
    const a = new G1Agent({ maxStopsPerSession: 3 });
    const t = Date.UTC(2026, 0, 6, 10, 0);
    (a as unknown as { sessionDay: number }).sessionDay = Math.floor(t / 86_400_000);
    for (let i = 0; i < 3; i++) a.onTrade({ exitReason: "STOP", closedAt: t } as never);
    expect(a.diagnostics().stopsToday).toBe(3);
  });
  it("unfilled limit orders expire after their order life with no chase", () => {
    const e = new HermesEngine(
      defaultConfig(3, { enabled: { G1: false, G2: false, G3: false, G4: false } }),
    );
    e.run(60 * 9); // to 09:00 Monday
    const mid = e.market.mid("XAUUSD");
    const [o] = e.submit("G1", [
      {
        clientOrderId: "exp-1",
        agent: "G1",
        symbol: "XAUUSD",
        side: "LONG",
        type: "LIMIT",
        qty: D(1),
        limitPx: mid - 200,
        stopPx: mid - 210,
        targetPx: mid - 190,
        expiresAt: e.now + 60 * 60_000,
        maxHoldMs: null,
        hardExitAt: null,
        decisionPx: mid,
        requestedRisk: D(10),
      },
    ]);
    expect(o!.state).toBe("ACCEPTED");
    e.run(61);
    expect(e.orders.get(o!.id)!.state).toBe("EXPIRED");
    expect(e.working).toHaveLength(0);
  });
});

describe("G2", () => {
  it("Bonferroni over 4 windows", () => {
    expect(bonferroniAlpha(0.05, 4)).toBe(0.0125);
    expect(bonferroni(0.01, 4)).toBe(0.04);
    expect(bonferroni(0.4, 4)).toBe(1);
  });
  it("Aldridge sign test θ = (N⁺/N − 0.5)/√(0.25/N)", () => {
    expect(signTestTheta(60, 100)).toBeCloseTo(2, 10);
    expect(signTestTheta(50, 100)).toBe(0);
  });
  it("surprise z-score, voided on look-ahead consensus", () => {
    expect(
      surpriseZ({ actual: 0.5, consensus: 0.3, sdPast: 0.1, consensusTs: 0, t: 1 }),
    ).toBeCloseTo(2, 10);
    expect(
      surpriseZ({ actual: 0.5, consensus: 0.3, sdPast: 0.1, consensusTs: 2, t: 1 }),
    ).toBeNull();
    expect(
      surpriseZ({ actual: 0.5, consensus: 0.3, sdPast: 0.1, consensusTs: 1, t: 1 }),
    ).toBeNull();
  });
  it("enters only at release + 3 min, |s| ≥ 1, spread ≤ 2× median", () => {
    const ev = { t: Date.UTC(2026, 1, 6, 13, 30) } as MacroEvent;
    const p = { entryDelayMin: 3, minSurprise: 1, spreadMult: 2 };
    expect(g2EntryBlock(ev.t + 3 * 60_000, ev, 1.4, 0.3, 0.2, p)).toBeNull();
    expect(g2EntryBlock(ev.t + 2 * 60_000, ev, 1.4, 0.3, 0.2, p)).toMatch(/release/);
    expect(g2EntryBlock(ev.t + 3 * 60_000, ev, 0.8, 0.3, 0.2, p)).toMatch(/\|s\|/);
    expect(g2EntryBlock(ev.t + 3 * 60_000, ev, 1.4, 0.5, 0.2, p)).toMatch(/spread/);
    expect(g2EntryBlock(ev.t + 3 * 60_000, ev, null, 0.3, 0.2, p)).toMatch(/VOID/);
  });
});

function pair(seed: number, cointegrated: boolean, dxyLeak = 0) {
  const rng = new Rng(seed);
  const n = 500;
  let x = Math.log(30);
  let u = 0;
  let dxy = Math.log(104);
  const X: number[] = [];
  const Y: number[] = [];
  const DXY: number[] = [];
  let yInd = Math.log(2600);
  for (let i = 0; i < n; i++) {
    x += 0.015 * rng.normal();
    const dd = 0.004 * rng.normal();
    dxy += dd;
    u = 0.85 * u + 0.01 * rng.normal() + dxyLeak * dd;
    yInd += 0.012 * rng.normal();
    X.push(x);
    Y.push(cointegrated ? 4.8 + 0.9 * x + u : yInd);
    DXY.push(dxy);
  }
  return { X, Y, DXY };
}
describe("G3 — Engle–Granger gate", () => {
  it("passes on a synthetic cointegrated pair", () => {
    const { X, Y, DXY } = pair(11, true);
    expect(engleGranger(Y, X).cointegrated).toBe(true);
    expect(g3Gate(G3_PAIRS[0]!, Y, X, DXY).passed).toBe(true);
  });
  it("fails on a synthetic independent pair", () => {
    const { X, Y, DXY } = pair(12, false);
    expect(engleGranger(Y, X).cointegrated).toBe(false);
    expect(g3Gate(G3_PAIRS[0]!, Y, X, DXY).passed).toBe(false);
  });
  it("rejects a disguised dollar bet when DXY drives the residual", () => {
    const { X, Y, DXY } = pair(13, true, 2.5);
    const g = g3Gate(G3_PAIRS[0]!, Y, X, DXY);
    expect(g.dxyR2).toBeGreaterThan(0.25);
    expect(g.passed).toBe(false);
    expect(g.reason).toMatch(/dollar/);
  });
});

describe("G4", () => {
  it("signal ∈ {−1, −1/3, 1/3, 1}", () => {
    const rng = new Rng(5);
    const allowed = new Set([-1, -1 / 3, 1 / 3, 1].map((v) => v.toFixed(6)));
    for (let k = 0; k < 200; k++) {
      let p = 100;
      const c = Array.from({ length: 200 }, () => (p *= Math.exp(0.02 * rng.normal())));
      const s = trendSignal(c, [20, 50, 180]);
      expect(allowed.has(s!.toFixed(6))).toBe(true);
    }
    expect(trendSignal([1, 2, 3], [20, 50, 180])).toBeNull();
  });
  it("trades only outside the 25% rebalance band", () => {
    expect(outsideBand(100, 124, 0.25)).toBe(false);
    expect(outsideBand(100, 126, 0.25)).toBe(true);
    expect(outsideBand(100, 76, 0.25)).toBe(false);
    expect(outsideBand(100, 74, 0.25)).toBe(true);
    expect(outsideBand(100, -10, 0.25)).toBe(true);
    expect(outsideBand(0, 5, 0.25)).toBe(true);
  });
});
