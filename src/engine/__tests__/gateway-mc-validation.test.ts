import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  DEFAULT_LIMITS,
  BOOK_LIMITS,
  perTradeCap,
  evaluateOrder,
  markAccount,
  newAccount,
  type GatewayContext,
} from "../gateway";
import { D, ZERO } from "../money";
import { GATEWAY_CHECKS, type OrderRequest } from "../types";
import { BOOK_MC, runMonteCarlo, simulateChunk, summarize } from "../montecarlo";
import { STEPS, nextStatuses, runStep, canPromoteToLive } from "../validation";
import { HermesEngine, defaultConfig } from "../engine";
import { runBacktest } from "../backtest";
import { plateauMask } from "../backtest";

const mkOrder = (o: Partial<OrderRequest>): OrderRequest => ({
  clientOrderId: "c1",
  agent: "G1",
  symbol: "XAUUSD",
  side: "LONG",
  type: "LIMIT",
  qty: D(1),
  limitPx: 2650,
  stopPx: 2640,
  targetPx: 2658,
  expiresAt: null,
  maxHoldMs: null,
  hardExitAt: null,
  decisionPx: 2651,
  requestedRisk: D(10),
  ...o,
});

describe("Risk gateway (property-based)", () => {
  it("no order is accepted without passing all nine checks in order; failures stop at the first FAIL", () => {
    fc.assert(
      fc.property(
        fc.record({
          equity: fc.double({ min: 20000, max: 30000, noNaN: true }),
          hwmUp: fc.double({ min: 0, max: 5000, noNaN: true }),
          qty: fc.double({ min: 0, max: 800, noNaN: true }),
          stopDist: fc.double({ min: -5, max: 40, noNaN: true }),
          req: fc.double({ min: 0, max: 800, noNaN: true }),
          kill: fc.boolean(),
          spread: fc.double({ min: 0.05, max: 1, noNaN: true }),
          wl: fc.boolean(),
          dup: fc.boolean(),
          weekend: fc.double({ min: 0, max: 5000, noNaN: true }),
          blackout: fc.boolean(),
        }),
        (x) => {
          const a = newAccount("G1", x.equity + x.hwmUp);
          markAccount(a, D(x.equity), DEFAULT_LIMITS);
          const seen = new Set<string>(x.dup ? ["c1"] : []);
          const ctx: GatewayContext = {
            t: 0,
            account: a,
            openPositions: [],
            pendingRisk: ZERO,
            seenClientIds: seen,
            killArmed: x.kill,
            whitelist: x.wl ? ["XAUUSD"] : ["EURUSD"],
            maxQty: 500,
            spread: x.spread,
            hourlyMedianSpread: 0.25,
            blackout: x.blackout ? { eventId: "CPI", ownedByG2: false } : null,
            minutesToWeekendClose: x.weekend,
            mark: () => 2650,
          };
          const r = evaluateOrder(
            mkOrder({
              qty: D(x.qty.toFixed(2)),
              stopPx: 2650 - x.stopDist,
              requestedRisk: D(x.req.toFixed(2)),
            }),
            ctx,
          );
          const names = r.events.map((e) => e.check);
          expect(names).toEqual(GATEWAY_CHECKS.slice(0, names.length));
          if (r.accepted) {
            expect(r.events).toHaveLength(9);
            expect(r.events.every((e) => e.result === "PASS")).toBe(true);
          } else {
            expect(r.events[r.events.length - 1]!.result).toBe("FAIL");
            expect(r.events.slice(0, -1).every((e) => e.result === "PASS")).toBe(true);
          }
          if (x.kill) expect(r.accepted).toBe(false);
        },
      ),
      { numRuns: 1500 },
    );
  });
  it("the floor is monotone non-decreasing under any equity path", () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 1000, max: 60000, noNaN: true }), {
          minLength: 1,
          maxLength: 200,
        }),
        (path) => {
          const a = newAccount("G4", 25000);
          let prev = a.floor;
          for (const e of path) {
            markAccount(a, D(e), DEFAULT_LIMITS);
            expect(a.floor.gte(prev)).toBe(true);
            expect(a.floor.eq(a.hwm.times(DEFAULT_LIMITS.floorRatio))).toBe(true);
            prev = a.floor;
          }
        },
      ),
    );
  });
  it("per-trade cap is 1.0% at a fresh high and 0.5% after a 4% drawdown", () => {
    const a = newAccount("G1", 100000, BOOK_LIMITS);
    const ctx = (acct = a): GatewayContext => ({
      t: 0,
      account: acct,
      openPositions: [],
      pendingRisk: ZERO,
      seenClientIds: new Set(),
      killArmed: false,
      whitelist: ["XAUUSD"],
      maxQty: 500,
      spread: 0.2,
      hourlyMedianSpread: 0.25,
      blackout: null,
      minutesToWeekendClose: 999,
      mark: () => 2650,
    });
    expect(
      evaluateOrder(mkOrder({ requestedRisk: D(5000) }), ctx(), BOOK_LIMITS).cap.toNumber(),
    ).toBeCloseTo(1000, 6);
    markAccount(a, D(96000), BOOK_LIMITS);
    expect(
      evaluateOrder(mkOrder({ clientOrderId: "c2", requestedRisk: D(5000) }), ctx(), BOOK_LIMITS).cap.toNumber(),
    ).toBeCloseTo(500, 6);
  });
  it("tightened limits: 6% floor, cap 0.6% at a fresh high, 0.2% after a 4% drawdown, 1%/2.5% brakes", () => {
    expect(DEFAULT_LIMITS.floorRatio).toBe(0.94);
    expect(DEFAULT_LIMITS.dailyLossPct).toBe(0.01);
    expect(DEFAULT_LIMITS.weeklyLossPct).toBe(0.025);
    const a = newAccount("G1", 100000, DEFAULT_LIMITS);
    expect(perTradeCap(a, D(5000), DEFAULT_LIMITS).toNumber()).toBeCloseTo(600, 6);
    markAccount(a, D(96000), DEFAULT_LIMITS);
    expect(perTradeCap(a, D(5000), DEFAULT_LIMITS).toNumber()).toBeCloseTo(200, 6);
  });
});

describe("Monte Carlo", () => {
  it("published params, tail = NONE: median max DD within 0.05% of 0.40%", () => {
    const r = runMonteCarlo(BOOK_MC);
    expect(Math.abs(r.medianMaxDd - 0.4)).toBeLessThanOrEqual(0.05);
    expect(r.pLosingMonth).toBeLessThan(0.05);
  });
  it("tail scenarios reproduce the book's table", () => {
    const t10 = runMonteCarlo({ ...BOOK_MC, tail: "10X_1_IN_300" });
    const t25 = runMonteCarlo({ ...BOOK_MC, tail: "25X_1_IN_300" });
    expect(Math.abs(t10.medianMaxDd - 1.13)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(t10.pLosingMonth - 0.58)).toBeLessThanOrEqual(0.03);
    expect(Math.abs(t25.medianMaxDd - 2.69)).toBeLessThanOrEqual(0.15);
    expect(Math.abs(t25.pLosingMonth - 0.88)).toBeLessThanOrEqual(0.03);
  });
  it("is chunking-independent (worker pool determinism)", () => {
    const cfg = { ...BOOK_MC, nRuns: 2000 };
    const one = summarize([simulateChunk(cfg, 0, 2000)]);
    const four = summarize([0, 500, 1000, 1500].map((s) => simulateChunk(cfg, s, 500)));
    expect(four.medianMaxDd).toBe(one.medianMaxDd);
    expect(four.pLosingMonth).toBe(one.pLosingMonth);
  });
});

describe("Determinism", () => {
  it("same (data, params, seed) → identical outputs", async () => {
    const a = await runBacktest({ agent: "G1", params: {}, seed: 99, days: 8 });
    const b = await runBacktest({ agent: "G1", params: {}, seed: 99, days: 8 });
    expect(a.hash).toBe(b.hash);
    const e1 = new HermesEngine(defaultConfig(5));
    const e2 = new HermesEngine(defaultConfig(5));
    e1.run(3000);
    e2.run(3000);
    expect(e1.totals().equity.toString()).toBe(e2.totals().equity.toString());
  });
  it("kill switch flattens every position", () => {
    const e = new HermesEngine(defaultConfig(20261109));
    e.run(1440 * 6);
    e.kill();
    expect(e.positions).toHaveLength(0);
    expect(e.working).toHaveLength(0);
    expect(e.killArmed).toBe(true);
  });
});

describe("Plateau filter", () => {
  it("rejects an isolated peak and accepts a flat region", () => {
    const g = [
      [1, 1, 1, 0],
      [1, 1, 1, 0],
      [1, 1, 1, 5],
    ];
    const m = plateauMask(g);
    expect(m[1]![1]).toBe(true);
    expect(m[2]![3]).toBe(false);
  });
});

describe("Validation gate", () => {
  const ctx = {
    agent: "G2" as const,
    params: {},
    grid: { minSurprise: [0.75, 1, 1.5], stopMult: [1, 1.5, 2] },
    seed: 20261109,
    preRegistration: {
      hypothesis: "Gold drifts after US CPI/NFP surprises for 5–60 minutes.",
      rules: "Enter at release+3m if |s|≥1; exit at best OOS window.",
      grid: {},
      variantCount: 9,
    },
    shadowTrades: [],
    priorSteps: [],
    oosDays: 20,
    designDays: 8,
  };
  it("each evidence runner returns the exact pass bar from §5.5", async () => {
    for (const s of [1, 2, 3, 8, 10]) {
      const ev = await runStep(s, ctx);
      expect(ev.bar).toBe(STEPS[s - 1]!.bar);
      expect(ev.hash).toMatch(/^[0-9a-f]{64}$/);
    }
  }, 60_000);
  it("seeded fixture: pre-register, clean data, one codebase and simulation recovery pass; probation is locked", async () => {
    expect((await runStep(1, ctx)).passed).toBe(true);
    expect((await runStep(2, ctx)).passed).toBe(true);
    expect((await runStep(3, ctx)).passed).toBe(true);
    expect((await runStep(8, ctx)).passed).toBe(true);
    expect((await runStep(10, ctx)).passed).toBe(false);
  }, 60_000);
  it("PASSED unlocks the next step; FAILED locks every later step", () => {
    const s0 = Array.from({ length: 10 }, (_, i) => (i === 0 ? "IN_PROGRESS" : "LOCKED")) as (
      "LOCKED" | "IN_PROGRESS" | "PASSED" | "FAILED"
    )[];
    const s1 = nextStatuses(s0, 1, true);
    expect(s1.slice(0, 2)).toEqual(["PASSED", "IN_PROGRESS"]);
    const s2 = nextStatuses(nextStatuses(s1, 2, true), 3, false);
    expect(s2[2]).toBe("FAILED");
    expect(s2.slice(3).every((x) => x === "LOCKED")).toBe(true);
  });
  it("promotion requires all 10 steps PASSED and signed", () => {
    const all = Array.from({ length: 10 }, () => ({ status: "PASSED" as const, signed: true }));
    expect(canPromoteToLive(all)).toBe(true);
    expect(canPromoteToLive(all.map((s, i) => (i === 9 ? { ...s, signed: false } : s)))).toBe(
      false,
    );
  });
});
