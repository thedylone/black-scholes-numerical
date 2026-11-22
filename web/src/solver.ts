/**
 * Finite-difference solvers for the Black–Scholes PDE, ported from
 * Computing_CW.ipynb.
 *
 * Written in time to expiry τ = T − t, the PDE is
 *   −V_τ + ½σ²S²V_SS + rSV_S − rV = 0,
 * with V(S,0) = max(S − K, 0), V(0,τ) = 0 and V(S_max,τ) = S_max − K e^{−rτ}.
 *
 * Grid: S_j = j h (j = 0…N, h = S_max/N), τ_i = i k (i = 0…M, k = T/M).
 * Coefficients as in the notebook: α = σ²/(2h²), β = r/h.
 */

export type Scheme = "explicit" | "implicit";

export interface Params {
  sigma: number;
  r: number;
  K: number;
  T: number;
  /** Truncated far-field boundary, s_end in the notebook. */
  sMax: number;
  /** Number of price intervals (N + 1 nodes). */
  N: number;
  /** Number of time steps. */
  M: number;
}

export interface Solution {
  s: Float64Array;
  h: number;
  k: number;
  /** τ value of each stored snapshot. */
  taus: number[];
  /** V(S) at each stored τ; the last one is τ = T. */
  snapshots: Float64Array[];
}

/**
 * Explicit stability ratio. The explicit update keeps a positive weight on
 * V_{S,τ} only while 1/k − σ²S²/h² − r > 0 for every S up to S_max
 * (summary.tex), i.e. while λ = k(σ²S_max²/h² + r) = k(σ²N² + r) < 1.
 */
export function stabilityRatio(p: Params): number {
  const k = p.T / p.M;
  const h = p.sMax / p.N;
  return k * ((p.sigma * p.sigma * p.sMax * p.sMax) / (h * h) + p.r);
}

/** Largest stable time step k for the explicit scheme. */
export function maxStableK(p: Params): number {
  return 1 / (p.sigma * p.sigma * p.N * p.N + p.r);
}

function snapshotSteps(M: number, count: number): Set<number> {
  const steps = new Set<number>();
  const n = Math.min(count, M);
  for (let q = 0; q <= n; q++) steps.add(Math.round((q * M) / n));
  return steps;
}

function setup(p: Params) {
  const h = p.sMax / p.N;
  const k = p.T / p.M;
  const s = new Float64Array(p.N + 1);
  for (let j = 0; j <= p.N; j++) s[j] = j * h;
  const alpha = (p.sigma * p.sigma) / (2 * h * h);
  const beta = p.r / h;
  // Initial condition (payoff at expiry, τ = 0)
  const V = new Float64Array(p.N + 1);
  for (let j = 0; j <= p.N; j++) V[j] = Math.max(0, s[j] - p.K);
  return { h, k, s, alpha, beta, V };
}

/** Far-field boundary value at time-to-expiry τ. */
function upperBoundary(p: Params, tau: number): number {
  return p.sMax - p.K * Math.exp(-p.r * tau);
}

/**
 * Explicit scheme: forward difference in τ, central differences in S.
 *   V_{j}^{i+1} = k[(αS² − βS/2)V_{j−1} + (1/k − 2αS² − r)V_j + (αS² + βS/2)V_{j+1}]^i
 */
export function solveExplicit(p: Params, snapshots = 120): Solution {
  const init = setup(p);
  const { h, k, s, alpha, beta } = init;
  let V = init.V;
  let next = new Float64Array(p.N + 1);
  const keep = snapshotSteps(p.M, snapshots);
  const taus: number[] = [0];
  const snaps: Float64Array[] = [V.slice()];

  // Precompute the stencil weights for each interior node.
  const lo = new Float64Array(p.N + 1);
  const mid = new Float64Array(p.N + 1);
  const hi = new Float64Array(p.N + 1);
  for (let j = 1; j < p.N; j++) {
    const a = alpha * s[j] * s[j];
    const b = (beta * s[j]) / 2;
    lo[j] = k * (a - b);
    mid[j] = k * (1 / k - 2 * a - p.r);
    hi[j] = k * (a + b);
  }

  for (let i = 1; i <= p.M; i++) {
    const tau = i * k;
    next[0] = 0;
    next[p.N] = upperBoundary(p, tau);
    for (let j = 1; j < p.N; j++) {
      next[j] = lo[j] * V[j - 1] + mid[j] * V[j] + hi[j] * V[j + 1];
    }
    [V, next] = [next, V];
    if (keep.has(i)) {
      taus.push(tau);
      snaps.push(V.slice());
    }
  }
  return { s, h, k, taus, snapshots: snaps };
}

/**
 * Crank–Nicolson: every S-derivative (and the rV term) is averaged between
 * τ and τ + k. Each step solves the tridiagonal system
 *   (αS²/2 − βS/4)V_{j−1} + (−1/k − αS² − r/2)V_j + (αS²/2 + βS/4)V_{j+1} = B_j
 * with B_j built from the known level, exactly as A and B in the notebook,
 * using the Thomas algorithm instead of a dense solve.
 */
export function solveImplicit(p: Params, snapshots = 120): Solution {
  const { h, k, s, alpha, beta, V } = setup(p);
  const N = p.N;
  const keep = snapshotSteps(p.M, snapshots);
  const taus: number[] = [0];
  const snaps: Float64Array[] = [V.slice()];

  const A = new Float64Array(N + 1); // sub-diagonal
  const D = new Float64Array(N + 1); // diagonal
  const C = new Float64Array(N + 1); // super-diagonal
  for (let j = 1; j < N; j++) {
    const a = alpha * s[j] * s[j];
    const b = beta * s[j];
    A[j] = a / 2 - b / 4;
    D[j] = -1 / k - a - p.r / 2;
    C[j] = a / 2 + b / 4;
  }
  const B = new Float64Array(N + 1);
  const cp = new Float64Array(N + 1);
  const dp = new Float64Array(N + 1);

  for (let i = 0; i < p.M; i++) {
    const tauNext = (i + 1) * k;
    for (let j = 1; j < N; j++) {
      const a = alpha * s[j] * s[j];
      const b = beta * s[j];
      B[j] =
        -V[j] / k -
        (a / 2) * (V[j + 1] - 2 * V[j] + V[j - 1]) -
        (b / 4) * (V[j + 1] - V[j - 1]) +
        (p.r / 2) * V[j];
    }
    const left = 0; // V(0, τ) = 0
    const right = upperBoundary(p, tauNext);
    B[1] -= A[1] * left;
    B[N - 1] -= C[N - 1] * right;

    // Thomas algorithm over the interior nodes 1…N−1
    cp[1] = C[1] / D[1];
    dp[1] = B[1] / D[1];
    for (let j = 2; j < N; j++) {
      const m = D[j] - A[j] * cp[j - 1];
      cp[j] = C[j] / m;
      dp[j] = (B[j] - A[j] * dp[j - 1]) / m;
    }
    V[N - 1] = dp[N - 1];
    for (let j = N - 2; j >= 1; j--) V[j] = dp[j] - cp[j] * V[j + 1];
    V[0] = left;
    V[N] = right;

    if (keep.has(i + 1)) {
      taus.push(tauNext);
      snaps.push(V.slice());
    }
  }
  return { s, h, k, taus, snapshots: snaps };
}

export function solve(scheme: Scheme, p: Params, snapshots = 120): Solution {
  return scheme === "explicit" ? solveExplicit(p, snapshots) : solveImplicit(p, snapshots);
}
