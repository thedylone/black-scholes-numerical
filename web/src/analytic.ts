/**
 * Closed-form Black–Scholes price of a European call.
 */

/**
 * Standard normal CDF, Hart (1968) algorithm 5666 as given by
 * G. West, "Better approximations to cumulative normal functions" (2005).
 * Accurate to roughly double precision.
 */
export function normCdf(x: number): number {
  const z = Math.abs(x);
  let c: number;
  if (z > 37) {
    c = 0;
  } else {
    const e = Math.exp((-z * z) / 2);
    if (z < 7.07106781186547) {
      let n = 3.52624965998911e-2 * z + 0.700383064443688;
      n = n * z + 6.37396220353165;
      n = n * z + 33.912866078383;
      n = n * z + 112.079291497871;
      n = n * z + 221.213596169931;
      n = n * z + 220.206867912376;
      let d = 8.83883476483184e-2 * z + 1.75566716318264;
      d = d * z + 16.064177579207;
      d = d * z + 86.7807322029461;
      d = d * z + 296.564248779674;
      d = d * z + 637.333633378831;
      d = d * z + 793.826512519948;
      d = d * z + 440.413735824752;
      c = (e * n) / d;
    } else {
      let b = z + 0.65;
      b = z + 4 / b;
      b = z + 3 / b;
      b = z + 2 / b;
      b = z + 1 / b;
      c = e / b / 2.506628274631;
    }
  }
  return x > 0 ? 1 - c : c;
}

/**
 * Call value V(S, τ) with τ = T − t the time to expiry.
 */
export function bsCall(S: number, K: number, r: number, sigma: number, tau: number): number {
  if (S <= 0) return 0;
  if (tau <= 0) return Math.max(S - K, 0);
  const sq = sigma * Math.sqrt(tau);
  const d1 = (Math.log(S / K) + (r + (sigma * sigma) / 2) * tau) / sq;
  const d2 = d1 - sq;
  return S * normCdf(d1) - K * Math.exp(-r * tau) * normCdf(d2);
}
