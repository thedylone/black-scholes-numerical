import "katex/dist/katex.min.css";
import "./style.css";

import katex from "katex";
import { bsCall } from "./analytic";
import { render } from "./plot";
import { maxStableK, Params, Scheme, solve, Solution, stabilityRatio } from "./solver";

// Chart colours come from the kit tokens: --series-1 (analytic), --series-2 (numerical).
const token = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const NAVY = token("--series-1") || "#1e2f4d";
const GOLD = token("--series-2") || "#b8860b";
const FAINT = token("--color-text-faint") || "rgba(15, 23, 42, 0.42)";
const SNAPSHOTS = 120;

// ---------- KaTeX ----------
document.querySelectorAll<HTMLElement>(".tex").forEach((el) => {
  katex.render(el.textContent ?? "", el, {
    displayMode: el.classList.contains("display"),
    throwOnError: false,
  });
});

// ---------- number formatting ----------
function sci(v: number, digits = 2): string {
  if (!Number.isFinite(v)) return Number.isNaN(v) ? "NaN" : "∞";
  if (v === 0) return "0";
  const a = Math.abs(v);
  if (a >= 1e-3 && a < 1e4) return String(parseFloat(v.toPrecision(digits + 1)));
  const [m, e] = v.toExponential(digits).split("e");
  return `${parseFloat(m)} × 10<sup>${e.replace("+", "").replace("-", "−")}</sup>`;
}

// ---------- controls ----------
interface SliderDef {
  label: string;
  min: number;
  max: number;
  step: number;
  fmt: (v: number) => string;
  log?: boolean;
  int?: boolean;
}

const DEFS: Record<keyof Params, SliderDef> = {
  sigma: { label: "Volatility <i>σ</i>", min: 0.05, max: 1, step: 0.01, fmt: (v) => v.toFixed(2) },
  r: { label: "Risk-free rate <i>r</i>", min: 0, max: 0.15, step: 0.005, fmt: (v) => v.toFixed(3) },
  K: { label: "Strike <i>K</i>", min: 0.5, max: 5, step: 0.1, fmt: (v) => v.toFixed(1) },
  T: { label: "Maturity <i>T</i>", min: 0.1, max: 10, step: 0.1, fmt: (v) => v.toFixed(1) },
  sMax: { label: "Price cap <i>S</i><sub>max</sub>", min: 2, max: 20, step: 0.5, fmt: (v) => v.toFixed(1) },
  N: { label: "Price intervals <i>N</i>", min: 10, max: 500, step: 1, fmt: (v) => String(v), int: true },
  M: { label: "Time steps <i>M</i>", min: 10, max: 20000, step: 1, fmt: (v) => String(v), log: true, int: true },
};

interface Preset {
  name: string;
  scheme: Scheme;
  p: Params;
}

const PRESETS: Preset[] = [
  { name: "Default", scheme: "explicit", p: { sigma: 0.4, r: 0.05, K: 2, T: 1, sMax: 6, N: 60, M: 800 } },
  { name: "Notebook grid", scheme: "explicit", p: { sigma: 0.8, r: 0.05, K: 2, T: 10, sMax: 5, N: 10, M: 1000 } },
  { name: "Notebook fine grid", scheme: "explicit", p: { sigma: 0.8, r: 0.05, K: 2, T: 10, sMax: 5, N: 500, M: 1000 } },
  { name: "CN with big steps", scheme: "implicit", p: { sigma: 0.4, r: 0.05, K: 2, T: 1, sMax: 6, N: 300, M: 40 } },
];

const state = {
  scheme: PRESETS[0].scheme,
  p: { ...PRESETS[0].p },
  snap: SNAPSHOTS,
  hover: null as number | null,
  sol: null as Solution | null,
  ms: 0,
};

const LOG_RES = 1000;
const toSlider = (d: SliderDef, v: number) =>
  d.log ? Math.round((Math.log(v / d.min) / Math.log(d.max / d.min)) * LOG_RES) : v;
const fromSlider = (d: SliderDef, x: number) => {
  const v = d.log ? d.min * (d.max / d.min) ** (x / LOG_RES) : x;
  return d.int ? Math.round(v) : v;
};

const inputs = {} as Record<keyof Params, { range: HTMLInputElement; out: HTMLOutputElement }>;

document.querySelectorAll<HTMLElement>(".pk-control[data-key]").forEach((el) => {
  const key = el.dataset.key as keyof Params;
  const d = DEFS[key];
  const id = `in-${key}`;
  el.innerHTML = `
    <div class="bs-control-head"><label for="${id}">${d.label}</label><output for="${id}"></output></div>
    <input type="range" id="${id}" min="${d.log ? 0 : d.min}" max="${d.log ? LOG_RES : d.max}" step="${d.log ? 1 : d.step}" />`;
  const range = el.querySelector("input")!;
  const out = el.querySelector("output")!;
  inputs[key] = { range, out };
  range.addEventListener("input", () => {
    state.p[key] = fromSlider(d, Number(range.value));
    if (key === "K" || key === "sMax") {
      // Keep the strike well inside the domain.
      if (state.p.sMax < state.p.K * 1.5) {
        if (key === "K") state.p.sMax = Math.min(DEFS.sMax.max, Math.ceil(state.p.K * 3 * 2) / 2);
        else state.p.K = Math.max(DEFS.K.min, Math.floor((state.p.sMax / 1.5) * 10) / 10);
      }
    }
    syncInputs();
    schedule();
  });
});

function syncInputs() {
  (Object.keys(inputs) as (keyof Params)[]).forEach((key) => {
    const d = DEFS[key];
    inputs[key].range.value = String(toSlider(d, state.p[key]));
    inputs[key].out.textContent = d.fmt(state.p[key]);
  });
  document.querySelectorAll<HTMLButtonElement>("[data-scheme]").forEach((b) => {
    b.setAttribute("aria-pressed", String(b.dataset.scheme === state.scheme));
  });
  const h = state.p.sMax / state.p.N;
  const k = state.p.T / state.p.M;
  document.getElementById("gridinfo")!.innerHTML =
    `<i>h</i> = ${sci(h, 3)} · <i>k</i> = ${sci(k, 3)} · ${(state.p.N + 1).toLocaleString("en-GB")} × ${(state.p.M + 1).toLocaleString("en-GB")} nodes`;
}

document.querySelectorAll<HTMLButtonElement>("[data-scheme]").forEach((b) => {
  b.addEventListener("click", () => {
    state.scheme = b.dataset.scheme as Scheme;
    syncInputs();
    schedule();
  });
});

const presetBox = document.getElementById("presets")!;
PRESETS.forEach((pr) => {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "pk-btn pk-btn-secondary bs-btn-sm";
  b.textContent = pr.name;
  b.addEventListener("click", () => {
    state.scheme = pr.scheme;
    state.p = { ...pr.p };
    syncInputs();
    schedule();
  });
  presetBox.appendChild(b);
});

// ---------- solve + draw ----------
let pending = false;
function schedule() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    const t0 = performance.now();
    state.sol = solve(state.scheme, state.p, SNAPSHOTS);
    state.ms = performance.now() - t0;
    state.snap = state.sol.snapshots.length - 1;
    tauInput.max = String(state.snap);
    tauInput.value = String(state.snap);
    draw();
  });
}

const plotV = document.getElementById("plot-v")!;
const plotE = document.getElementById("plot-e")!;
const tooltip = document.getElementById("tooltip")!;
const tauInput = document.getElementById("tau") as HTMLInputElement;
const tauLabel = document.getElementById("tau-label")!;
let invX: (px: number) => number = () => 0;

function current() {
  const sol = state.sol!;
  const { p } = state;
  const tau = sol.taus[state.snap];
  const V = sol.snapshots[state.snap];
  const n = sol.s.length;
  const exact = new Float64Array(n);
  const payoff = new Float64Array(n);
  const err = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    exact[j] = bsCall(sol.s[j], p.K, p.r, p.sigma, tau);
    payoff[j] = Math.max(sol.s[j] - p.K, 0);
    const e = Math.abs(V[j] - exact[j]);
    err[j] = Number.isNaN(e) ? NaN : Math.max(e, 1e-12);
  }
  return { sol, tau, V, exact, payoff, err };
}

function draw() {
  if (!state.sol) return;
  const { p } = state;
  const { sol, tau, V, exact, payoff, err } = current();
  const narrow = plotV.clientWidth < 520;

  const yTop = Math.max(p.sMax - p.K, bsCall(p.sMax, p.K, p.r, p.sigma, p.T)) * 1.08;
  const showMarkers = p.N <= 40;
  invX = render(plotV, {
    xs: sol.s,
    xMax: p.sMax,
    yMin: -0.05 * yTop,
    yMax: yTop,
    height: narrow ? 240 : 300,
    xLabel: "stock price S",
    xRef: { at: p.K, label: "K" },
    hover: state.hover,
    series: [
      { ys: payoff, color: FAINT, width: 1.25, dash: "2 4" },
      { ys: exact, color: NAVY, width: 2 },
      { ys: V, color: GOLD, width: 2, dash: showMarkers ? undefined : "6 4", markers: showMarkers },
    ],
  });

  let maxErr = 0;
  let maxAbsV = 0;
  let blown = false;
  for (let j = 0; j < V.length; j++) {
    if (!Number.isFinite(V[j])) blown = true;
    else maxAbsV = Math.max(maxAbsV, Math.abs(V[j]));
    if (Number.isFinite(err[j])) maxErr = Math.max(maxErr, err[j]);
  }
  if (blown) maxErr = Infinity;

  const eTop = Math.min(1e300, 10 ** Math.ceil(Math.log10(Math.max(maxErr === Infinity ? 1e300 : maxErr, 1e-2) * 1.01)));
  render(plotE, {
    xs: sol.s,
    xMax: p.sMax,
    yMin: 1e-7,
    yMax: eTop,
    log: true,
    height: narrow ? 150 : 170,
    xLabel: "stock price S",
    xRef: { at: p.K, label: "K" },
    hover: state.hover,
    series: [{ ys: err, color: GOLD, width: 2 }],
  });

  document.getElementById("legend-v")!.innerHTML = `
    <span class="bs-key"><svg width="22" height="8"><line x1="1" x2="21" y1="4" y2="4" stroke="${GOLD}" stroke-width="2" ${showMarkers ? "" : 'stroke-dasharray="6 4"'}/>${showMarkers ? `<circle cx="11" cy="4" r="3.5" fill="${GOLD}"/>` : ""}</svg>${state.scheme === "explicit" ? "Explicit" : "Crank–Nicolson"}</span>
    <span class="bs-key"><svg width="22" height="8"><line x1="1" x2="21" y1="4" y2="4" stroke="${NAVY}" stroke-width="2"/></svg>Analytic</span>
    <span class="bs-key"><svg width="22" height="8"><line x1="1" x2="21" y1="4" y2="4" stroke="${FAINT}" stroke-width="1.25" stroke-dasharray="2 4"/></svg>Payoff</span>`;

  // Stats
  const jK = Math.round(p.K / sol.h);
  const errK = Math.abs(V[jK] - exact[jK]);
  const offScale = blown || maxAbsV > yTop * 1.5;
  document.getElementById("stats")!.innerHTML = `
    <div class="pk-stat"><span class="pk-label">Max error</span><div class="pk-stat-value">${sci(maxErr)}</div></div>
    <div class="pk-stat"><span class="pk-label">Error at S = K</span><div class="pk-stat-value">${sci(errK)}</div></div>
    <div class="pk-stat"><span class="pk-label">V(K) numerical</span><div class="pk-stat-value">${sci(V[jK], 4)}</div></div>
    <div class="pk-stat"><span class="pk-label">Solve time</span><div class="pk-stat-value">${state.ms < 1 ? "&lt; 1" : state.ms.toFixed(0)} ms</div></div>
    ${offScale ? `<p class="bs-offscale" role="status"><span aria-hidden="true">⚠</span> Off the chart: max |V| = ${blown ? "overflow (∞ / NaN)" : sci(maxAbsV)}</p>` : ""}`;

  // Stability
  const lam = stabilityRatio(p);
  const kStar = maxStableK(p);
  const stable = lam < 1;
  const pos = Math.min(100, Math.max(0, ((Math.log10(lam) + 2) / 5) * 100)); // 1e-2 … 1e3
  const isExp = state.scheme === "explicit";
  const verdict = isExp
    ? stable
      ? `<span class="bs-badge ok"><span aria-hidden="true">✓</span> Stable</span>`
      : `<span class="bs-badge bad"><span aria-hidden="true">⚠</span> Unstable</span>`
    : `<span class="bs-badge neutral"><span aria-hidden="true">✓</span> Unconditionally stable</span>`;
  const note = isExp
    ? stable
      ? `Within the limit <i>k</i> &lt; <i>k</i>* = ${sci(kStar, 3)}. Raise <i>N</i> or cut <i>M</i> to break it.`
      : `<i>k</i> is ${sci(lam, 2)}× the limit <i>k</i>* = ${sci(kStar, 3)}. Errors flip sign every step and grow.`
    : `For comparison, the explicit scheme on this grid ${stable ? "would also be stable" : `would be ${sci(lam, 2)}× over its limit`}.`;
  document.getElementById("stability")!.innerHTML = `
    <div class="bs-stab-head">
      <span class="pk-label">Explicit stability</span><span class="bs-lam">λ = k(σ²N² + r) = ${sci(lam, 2)}</span>
      ${verdict}
    </div>
    <div class="bs-meter${isExp ? "" : " dim"}" aria-hidden="true">
      <div class="bs-meter-fill${stable ? "" : " over"}" style="width:${pos}%"></div>
      <div class="bs-meter-one" style="left:${(2 / 5) * 100}%"><span>λ = 1</span></div>
    </div>
    <div class="bs-stab-foot">
      <p>${note}</p>
      <div class="bs-buttons">
        <button type="button" class="pk-btn pk-btn-secondary bs-btn-sm" data-k="limit">Set k just below k*</button>
        <button type="button" class="pk-btn pk-btn-secondary bs-btn-sm" data-k="break">Set k = 1.1 k*</button>
      </div>
    </div>`;

  tauLabel.innerHTML = `Time to expiry <i>τ</i> = ${tau.toFixed(2)}${state.snap === sol.snapshots.length - 1 ? " (today)" : tau === 0 ? " (expiry)" : ""}`;
  updateTooltip(sol, V, exact);
}

document.getElementById("stability")!.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-k]");
  if (!b) return;
  const kStar = maxStableK(state.p);
  const k = b.dataset.k === "limit" ? kStar * 0.98 : kStar * 1.1;
  const M = b.dataset.k === "limit" ? Math.ceil(state.p.T / k) : Math.floor(state.p.T / k);
  if (M > DEFS.M.max) {
    // Too many steps needed: coarsen the grid instead.
    state.p.N = Math.max(DEFS.N.min, Math.floor(Math.sqrt((DEFS.M.max / state.p.T) * 0.98 / (state.p.sigma ** 2))));
    state.p.M = Math.ceil(state.p.T / (maxStableK(state.p) * (b.dataset.k === "limit" ? 0.98 : 1.1)));
  } else {
    state.p.M = Math.max(DEFS.M.min, M);
  }
  state.scheme = "explicit";
  syncInputs();
  schedule();
});

// ---------- hover ----------
let lastPointer: { x: number; y: number } | null = null;
function updateTooltip(sol: Solution, V: Float64Array, exact: Float64Array) {
  if (state.hover == null || !lastPointer) {
    tooltip.hidden = true;
    return;
  }
  const j = state.hover;
  tooltip.hidden = false;
  tooltip.innerHTML = `
    <div><span>S</span><b>${sol.s[j].toFixed(3)}</b></div>
    <div><span class="bs-sw" style="background:${GOLD}"></span><span>${state.scheme === "explicit" ? "Explicit" : "CN"}</span><b>${sci(V[j], 4)}</b></div>
    <div><span class="bs-sw" style="background:${NAVY}"></span><span>Analytic</span><b>${sci(exact[j], 4)}</b></div>
    <div><span>|Error|</span><b>${sci(Math.abs(V[j] - exact[j]))}</b></div>`;
  const fig = plotV.parentElement!.getBoundingClientRect();
  const w = tooltip.offsetWidth;
  let left = lastPointer.x - fig.left + 14;
  if (left + w > fig.width - 4) left = lastPointer.x - fig.left - w - 14;
  tooltip.style.left = `${Math.max(4, left)}px`;
  tooltip.style.top = `${44}px`;
}

[plotV, plotE].forEach((el) => {
  el.addEventListener("pointermove", (e) => {
    if (!state.sol) return;
    const rect = el.getBoundingClientRect();
    const S = invX(e.clientX - rect.left);
    if (S < 0 || S > state.p.sMax) {
      state.hover = null;
    } else {
      state.hover = Math.round(S / state.sol.h);
    }
    lastPointer = { x: e.clientX, y: e.clientY };
    draw();
  });
  el.addEventListener("pointerleave", () => {
    state.hover = null;
    draw();
  });
});

// ---------- time slider + playback ----------
tauInput.addEventListener("input", () => {
  state.snap = Number(tauInput.value);
  stopPlay();
  draw();
});

const playBtn = document.getElementById("play") as HTMLButtonElement;
let playing = 0;
function stopPlay() {
  if (playing) cancelAnimationFrame(playing);
  playing = 0;
  playBtn.textContent = "▶";
  playBtn.setAttribute("aria-label", "Play through time to expiry");
}
playBtn.addEventListener("click", () => {
  if (playing) return stopPlay();
  const last = state.sol!.snapshots.length - 1;
  if (state.snap >= last) state.snap = 0;
  playBtn.textContent = "❚❚";
  playBtn.setAttribute("aria-label", "Pause");
  let prev = performance.now();
  const tick = (now: number) => {
    if (now - prev > 33) {
      prev = now;
      state.snap = Math.min(last, state.snap + 1);
      tauInput.value = String(state.snap);
      draw();
      if (state.snap >= last) return stopPlay();
    }
    playing = requestAnimationFrame(tick);
  };
  playing = requestAnimationFrame(tick);
});

new ResizeObserver(() => draw()).observe(plotV);

syncInputs();
schedule();
