/** Minimal SVG line charts: linear x, linear or log10 y. */

export interface Series {
  ys: ArrayLike<number>;
  color: string;
  width?: number;
  dash?: string;
  markers?: boolean;
}

export interface PlotOptions {
  xs: ArrayLike<number>;
  series: Series[];
  xMax: number;
  yMin: number;
  yMax: number;
  log?: boolean;
  height: number;
  xLabel?: string;
  yLabel?: string;
  /** x position of a dashed vertical reference line (the strike). */
  xRef?: { at: number; label: string };
  /** Grid-node index to highlight with the crosshair. */
  hover?: number | null;
}

export const PAD = { l: 52, r: 14, t: 10, b: 34 };

// Kit tokens, read at render time so the chart follows project-kit.css.
function token(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function niceStep(range: number, target: number): number {
  const raw = range / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const f = raw / mag;
  return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag;
}

function fmtTick(v: number, step: number): string {
  const dp = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  return v.toFixed(Math.min(dp, 4));
}

function fmtPow(e: number): string {
  const sup: Record<string, string> = { "-": "⁻", "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹" };
  return "10" + String(e).split("").map((c) => sup[c]).join("");
}

export function render(el: HTMLElement, o: PlotOptions): (S: number) => number {
  const INK = token("--color-text", "#0f172a");
  const MUTED = token("--color-hairline-strong", "rgba(15, 23, 42, 0.2)");
  const HAIR = token("--color-hairline", "rgba(15, 23, 42, 0.12)");
  const BG = token("--color-bg", "#f9f9f6");
  const W = Math.max(280, el.clientWidth);
  const H = o.height;
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const tf = o.log ? (v: number) => Math.log10(v) : (v: number) => v;
  const y0 = tf(o.yMin);
  const y1 = tf(o.yMax);
  const X = (x: number) => PAD.l + (x / o.xMax) * iw;
  const Y = (y: number) => PAD.t + (1 - (tf(y) - y0) / (y1 - y0)) * ih;
  const id = el.id + "-clip";

  const parts: string[] = [];
  parts.push(`<defs><clipPath id="${id}"><rect x="${PAD.l}" y="${PAD.t - 1}" width="${iw}" height="${ih + 2}"/></clipPath></defs>`);

  // y grid + ticks
  if (o.log) {
    const span = y1 - y0;
    const every = Math.max(1, Math.ceil(span / 5));
    for (let e = Math.ceil(y0); e <= y1; e += every) {
      const y = PAD.t + (1 - (e - y0) / span) * ih;
      parts.push(`<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${y}" y2="${y}" stroke="${HAIR}"/>`);
      parts.push(`<text x="${PAD.l - 8}" y="${y + 4}" text-anchor="end" class="bs-tick">${fmtPow(e)}</text>`);
    }
  } else {
    const step = niceStep(o.yMax - o.yMin, ih < 200 ? 3 : 5);
    for (let v = Math.ceil(o.yMin / step) * step; v <= o.yMax + 1e-9; v += step) {
      const y = Y(v);
      parts.push(`<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${y}" y2="${y}" stroke="${HAIR}"/>`);
      parts.push(`<text x="${PAD.l - 8}" y="${y + 4}" text-anchor="end" class="bs-tick">${fmtTick(v, step)}</text>`);
    }
  }
  // x ticks
  const xs = niceStep(o.xMax, iw < 420 ? 4 : 8);
  for (let v = 0; v <= o.xMax + 1e-9; v += xs) {
    const x = X(v);
    parts.push(`<line x1="${x}" x2="${x}" y1="${PAD.t + ih}" y2="${PAD.t + ih + 5}" stroke="${MUTED}"/>`);
    parts.push(`<text x="${x}" y="${PAD.t + ih + 18}" text-anchor="middle" class="bs-tick">${fmtTick(v, xs)}</text>`);
  }
  parts.push(`<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${PAD.t + ih}" y2="${PAD.t + ih}" stroke="${MUTED}"/>`);
  if (o.xLabel) parts.push(`<text x="${W - PAD.r}" y="${H - 2}" text-anchor="end" class="bs-axis">${o.xLabel}</text>`);

  if (o.xRef) {
    const x = X(o.xRef.at);
    parts.push(`<line x1="${x}" x2="${x}" y1="${PAD.t}" y2="${PAD.t + ih}" stroke="${HAIR}" stroke-dasharray="3 4"/>`);
    parts.push(`<text x="${x + 5}" y="${PAD.t + 12}" class="bs-axis">${o.xRef.label}</text>`);
  }

  // Series, split into runs of finite values so blow-ups and gaps don't draw spurious lines.
  const yClamp = (v: number) => {
    const lim = 1e6 * (o.yMax - o.yMin + 1);
    if (o.log) return Math.min(Math.max(v, o.yMin), o.yMax * 10);
    return Math.max(-lim, Math.min(lim, v));
  };
  parts.push(`<g clip-path="url(#${id})">`);
  for (const s of o.series) {
    let d = "";
    let pen = false;
    for (let j = 0; j < o.xs.length; j++) {
      const v = s.ys[j];
      if (!Number.isFinite(v)) {
        pen = false;
        continue;
      }
      d += `${pen ? "L" : "M"}${X(o.xs[j]).toFixed(1)},${Y(yClamp(v)).toFixed(1)}`;
      pen = true;
    }
    parts.push(
      `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.width ?? 2}" stroke-linejoin="round" stroke-linecap="round"${s.dash ? ` stroke-dasharray="${s.dash}"` : ""}/>`,
    );
    if (s.markers) {
      for (let j = 0; j < o.xs.length; j++) {
        const v = s.ys[j];
        if (!Number.isFinite(v)) continue;
        parts.push(`<circle cx="${X(o.xs[j]).toFixed(1)}" cy="${Y(yClamp(v)).toFixed(1)}" r="3.5" fill="${s.color}" stroke="${BG}" stroke-width="1.5"/>`);
      }
    }
  }
  parts.push(`</g>`);

  if (o.hover != null && o.hover >= 0 && o.hover < o.xs.length) {
    const j = o.hover;
    const x = X(o.xs[j]);
    parts.push(`<line x1="${x}" x2="${x}" y1="${PAD.t}" y2="${PAD.t + ih}" stroke="${INK}" stroke-opacity="0.35"/>`);
    for (const s of o.series) {
      const v = s.ys[j];
      if (!Number.isFinite(v) || tf(v) < y0 || tf(v) > y1) continue;
      parts.push(`<circle cx="${x}" cy="${Y(v)}" r="4.5" fill="${s.color}" stroke="${BG}" stroke-width="2"/>`);
    }
  }

  if (o.yLabel) parts.push(`<text x="${PAD.l - 44}" y="${PAD.t + 10}" class="bs-axis">${o.yLabel}</text>`);

  el.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img">${parts.join("")}</svg>`;
  // Return the inverse x-map so callers can turn pointer positions into S.
  return (px: number) => ((px - PAD.l) / iw) * o.xMax;
}
