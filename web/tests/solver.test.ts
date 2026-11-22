import { describe, expect, it } from "vitest";
import { bsCall, normCdf } from "../src/analytic";
import { maxStableK, Params, solve, solveExplicit, solveImplicit, stabilityRatio } from "../src/solver";

const at = (sol: { s: Float64Array; snapshots: Float64Array[] }) => sol.snapshots[sol.snapshots.length - 1];

/** Max |V_num − V_BS| over nodes with S in [lo, hi]. */
function maxError(p: Params, sol: ReturnType<typeof solve>, lo: number, hi: number): number {
  const V = at(sol);
  let e = 0;
  sol.s.forEach((S, j) => {
    if (S >= lo && S <= hi) e = Math.max(e, Math.abs(V[j] - bsCall(S, p.K, p.r, p.sigma, p.T)));
  });
  return e;
}

describe("analytic formula", () => {
  it("normal CDF matches known values", () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 14);
    expect(normCdf(1)).toBeCloseTo(0.841344746068543, 12);
    expect(normCdf(-2)).toBeCloseTo(0.0227501319481792, 12);
    expect(normCdf(1.96)).toBeCloseTo(0.975002104851780, 12);
  });

  it("reproduces the textbook call price", () => {
    // Hull: S = K = 100, r = 5%, σ = 20%, T = 1 → 10.4506
    expect(bsCall(100, 100, 0.05, 0.2, 1)).toBeCloseTo(10.4506, 4);
    expect(bsCall(3, 2, 0.05, 0.4, 0)).toBe(1);
    expect(bsCall(0, 2, 0.05, 0.4, 1)).toBe(0);
  });
});

const base: Params = { sigma: 0.3, r: 0.05, K: 2, T: 1, sMax: 8, N: 200, M: 4000 };

describe("explicit scheme", () => {
  it("is stable below the limit and matches Black–Scholes", () => {
    expect(stabilityRatio(base)).toBeLessThan(1);
    const sol = solveExplicit(base);
    expect(maxError(base, sol, 1, 4)).toBeLessThan(2e-3);
  });

  it("blows up when the stability condition is violated", () => {
    const p = { ...base, M: 1000 }; // λ = k(σ²N² + r) ≈ 3.6
    expect(stabilityRatio(p)).toBeGreaterThan(1);
    const V = at(solveExplicit(p));
    const worst = Math.max(...Array.from(V, (v) => (Number.isFinite(v) ? Math.abs(v) : Infinity)));
    expect(worst).toBeGreaterThan(1e6);
  });

  it("stability limit k* = 1/(σ²N² + r) matches the ratio", () => {
    const p = { ...base, M: base.T / maxStableK(base) };
    expect(stabilityRatio(p)).toBeCloseTo(1, 12);
  });
});

describe("Crank–Nicolson scheme", () => {
  it("matches Black–Scholes", () => {
    const p = { ...base, M: 200 };
    expect(maxError(p, solveImplicit(p), 1, 4)).toBeLessThan(1e-3);
  });

  it("stays bounded where the explicit scheme would blow up", () => {
    const p = { ...base, N: 400, M: 50 };
    expect(stabilityRatio(p)).toBeGreaterThan(100);
    expect(maxError(p, solveImplicit(p), 1, 4)).toBeLessThan(5e-3);
  });

  it("converges at second order", () => {
    const coarse = { ...base, sMax: 10, N: 50, M: 25 };
    const fine = { ...coarse, N: 100, M: 50 };
    const e1 = maxError(coarse, solveImplicit(coarse), 1.5, 3);
    const e2 = maxError(fine, solveImplicit(fine), 1.5, 3);
    expect(e1 / e2).toBeGreaterThan(3);
  });

  it("enforces the boundary conditions", () => {
    const sol = solveImplicit(base);
    const V = at(sol);
    expect(V[0]).toBe(0);
    expect(V[base.N]).toBeCloseTo(base.sMax - base.K * Math.exp(-base.r * base.T), 12);
  });
});

describe("matches the notebook's coarse grid (T=10, σ=0.8, K=2, h=0.5, k=0.01)", () => {
  // Reference values from running the notebook (Computing_CW.ipynb).
  const p: Params = { sigma: 0.8, r: 0.05, K: 2, T: 10, sMax: 5, N: 10, M: 1000 };
  const explicitRef = [0, 0.31279958, 0.66889904, 1.0408571, 1.42154642, 1.80795312, 2.19848652, 2.59219051, 2.9884386, 3.38679422, 3.78693868];
  const implicitRef = [0, 0.31269406, 0.66876909, 1.04072669, 1.4214261, 1.80784833, 2.19840034, 2.59212471, 2.98839424, 3.38677188, 3.78693868];

  it("explicit", () => {
    at(solveExplicit(p)).forEach((v, j) => expect(v).toBeCloseTo(explicitRef[j], 7));
  });
  it("implicit", () => {
    at(solveImplicit(p)).forEach((v, j) => expect(v).toBeCloseTo(implicitRef[j], 7));
  });
});
