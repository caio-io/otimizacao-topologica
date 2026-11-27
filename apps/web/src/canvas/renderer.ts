import {
  STEEL_CLASSES,
  arcFrom3Points,
  barAreaCm2,
  discretizeBarPath,
  isLineLoad,
  lineLoadIntensity,
  sceneBounds,
  sceneEdges,
  sceneVertices,
  supportKind,
} from "@stm/core";
import type { LoadSpec, Scene, StmModel, SupportSpec } from "@stm/core";
import type { CsfmSummary, FrameMsg, RebarToolConfig, Selection, StmDisplayMode, Tool, ViewMode } from "../types/app";

export interface ViewportTransform {
  s: number;  // px / m
  ox: number; // px
  oy: number; // px
}

export const worldToScreenX = (v: ViewportTransform, x: number) => v.ox + x * v.s;
export const worldToScreenY = (v: ViewportTransform, y: number) => v.oy - y * v.s;
export const screenToWorld = (v: ViewportTransform, px: number, py: number): [number, number] => [
  (px - v.ox) / v.s,
  (v.oy - py) / v.s,
];

export function computeFitTransform(scene: Scene, w: number, h: number, margin = 56): ViewportTransform {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x: number, y: number) => {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y);
    x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  };
  for (const sh of scene.shapes) sh.pts.forEach(([x, y]) => add(x, y));
  for (const l of scene.loads) {
    add(l.x, l.y);
    if (l.x1 !== undefined && l.y1 !== undefined) add(l.x1, l.y1);
  }
  for (const sp of scene.supports) { add(sp.x0, sp.y0); add(sp.x1, sp.y1); }
  if (x0 === Infinity) { x0 = 0; y0 = 0; x1 = 1; y1 = 1; }
  const s = Math.max(1, Math.min((w - 2 * margin) / Math.max(x1 - x0, 1e-6), (h - 2 * margin) / Math.max(y1 - y0, 1e-6)));
  return {
    s,
    ox: (w - (x1 - x0) * s) / 2 - x0 * s,
    oy: (h + (y1 - y0) * s) / 2 + y0 * s,
  };
}

export function princFromStress(stress: Float64Array, e: number) {
  const sx = stress[3 * e], sy = stress[3 * e + 1], t = stress[3 * e + 2];
  const avg = (sx + sy) / 2, rad = Math.hypot((sx - sy) / 2, t);
  return { sx, sy, t, s1: avg + rad, s3: avg - rad, tmax: rad };
}

const diverge = (v: number) => {
  const t = Math.max(-1, Math.min(1, v)), a = Math.abs(t);
  return `rgb(${t > 0 ? 235 : Math.round(245 * (1 - a))},${Math.round(245 * (1 - a * 0.82))},${t < 0 ? 235 : Math.round(245 * (1 - a))})`;
};

/** escala de utilização 0 → 100 %: cinza suave → âmbar → vermelho escuro */
const utilColor = (r: number) => {
  if (r < 0.02) return "#edf1f6";
  if (r >= 1.0) return "#7f1d1d";
  if (r < 0.5) {
    const k = r / 0.5;
    return `rgb(${Math.round(237 + 16 * k)},${Math.round(241 - 31 * k)},${Math.round(246 - 116 * k)})`;
  }
  const k = (r - 0.5) / 0.5;
  return `rgb(${Math.round(253 - 45 * k)},${Math.round(210 - 165 * k)},${Math.round(130 - 95 * k)})`;
};

const pctCache = new WeakMap<object, Map<string, number>>();
function cachedPct(m: FrameMsg, key: string, fn: () => number): number {
  let c = pctCache.get(m);
  if (!c) pctCache.set(m, (c = new Map()));
  let v = c.get(key);
  if (v === undefined) c.set(key, (v = fn()));
  return v;
}
function pct(a: Float64Array, idx: number[], q: number): number {
  const v = idx.map((i) => a[i]).sort((x, y) => x - y);
  return v.length ? v[Math.min(v.length - 1, Math.floor(q * v.length))] : 0;
}

const solidAt = (m: FrameMsg, e: number) => m.mask[e] !== 0 && m.rho[e] > 0.5;

function drawGrid(ctx: CanvasRenderingContext2D, v: ViewportTransform, w: number, h: number) {
  const targetPx = 48;
  const rawStep = targetPx / v.s;
  const pow = Math.pow(10, Math.floor(Math.log10(Math.max(rawStep, 1e-6))));
  const norm = rawStep / pow;
  const step = (norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10) * pow;
  const [xMin, yMax] = screenToWorld(v, 0, 0);
  const [xMax, yMin] = screenToWorld(v, w, h);
  ctx.save();
  ctx.strokeStyle = "#eef2f6";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = Math.floor(xMin / step) * step; x <= xMax; x += step) {
    const px = Math.round(worldToScreenX(v, x)) + 0.5;
    ctx.moveTo(px, 0); ctx.lineTo(px, h);
  }
  for (let y = Math.floor(yMin / step) * step; y <= yMax; y += step) {
    const py = Math.round(worldToScreenY(v, y)) + 0.5;
    ctx.moveTo(0, py); ctx.lineTo(w, py);
  }
  ctx.stroke();
  // eixos x=0, y=0 sutis
  ctx.strokeStyle = "#dce3ec";
  ctx.beginPath();
  const ox = Math.round(worldToScreenX(v, 0)) + 0.5;
  const oy = Math.round(worldToScreenY(v, 0)) + 0.5;
  ctx.moveTo(ox, 0); ctx.lineTo(ox, h);
  ctx.moveTo(0, oy); ctx.lineTo(w, oy);
  ctx.stroke();
  ctx.restore();
}

function polyPath(ctx: CanvasRenderingContext2D, v: ViewportTransform, pts: [number, number][]) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(worldToScreenX(v, x), worldToScreenY(v, y)) : ctx.moveTo(worldToScreenX(v, x), worldToScreenY(v, y))));
  ctx.closePath();
}

function arrowHead(ctx: CanvasRenderingContext2D, x: number, y: number, ang: number, sz = 11) {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x - sz * Math.cos(ang - 0.38), y - sz * Math.sin(ang - 0.38));
  ctx.lineTo(x - sz * Math.cos(ang + 0.38), y - sz * Math.sin(ang + 0.38));
  ctx.closePath();
  ctx.fill();
}

function drawTrajectories(ctx: CanvasRenderingContext2D, m: FrameMsg, X: (i: number) => number, Y: (j: number) => number, px: number, solidIdx: number[]) {
  const { nelx, nely } = m.dims;
  const { s1, s2, theta } = m.field;
  const tmax = Math.max(1e-12, cachedPct(m, "t", () => pct(s1, solidIdx, 0.95)));
  const cmax = Math.max(1e-12, cachedPct(m, "c", () => -pct(s2, solidIdx, 0.05)));
  const step = Math.max(1, Math.round(10 / px));
  const half = Math.max(4, px * step * 0.78);
  ctx.lineWidth = 1.45;
  const seg = (cx: number, cy: number, ang: number, s: number) => {
    const ref = s > 0 ? tmax : cmax;
    if (Math.abs(s) < 0.08 * ref) return;
    const k = Math.min(1, (Math.abs(s) / ref) * 0.7 + 0.3);
    const dx = Math.cos(ang) * half * k, dy = -Math.sin(ang) * half * k;
    ctx.strokeStyle = s > 0 ? "#dc2626" : "#1d4ed8";
    ctx.beginPath(); ctx.moveTo(cx - dx, cy - dy); ctx.lineTo(cx + dx, cy + dy); ctx.stroke();
  };
  for (let i = 0; i < nelx; i += step) for (let j = 0; j < nely; j += step) {
    const e = i * nely + j;
    if (!solidAt(m, e)) continue;
    const cx = X(i) + px / 2, cy = Y(j) + px / 2;
    seg(cx, cy, theta[e], s1[e]);
    seg(cx, cy, theta[e] + Math.PI / 2, s2[e]);
  }
}

function drawResult(
  ctx: CanvasRenderingContext2D,
  v: ViewportTransform,
  m: FrameMsg,
  mode: ViewMode,
  showMesh: boolean,
  csfm: CsfmSummary | null,
) {
  const { nelx, nely, h, ox, oy } = m.dims;
  const top = oy + nely * h, px = v.s * h;
  const X = (i: number) => worldToScreenX(v, ox + i * h);
  const Y = (j: number) => worldToScreenY(v, top - j * h);
  const solidIdx: number[] = [];
  for (let e = 0; e < m.mask.length; e++) if (solidAt(m, e)) solidIdx.push(e);

  if (mode === "nlconc" || mode === "nlcrack" || mode === "nlstress" || mode === "nlutil") {
    const nl = m.nl;
    for (let i = 0; i < nelx; i++) for (let j = 0; j < nely; j++) {
      const e = i * nely + j;
      if (m.mask[e] === 0) continue;
      let col = "#e9edf2";
      if (nl && mode === "nlconc") {
        const r = Math.min(1.2, nl.epsComp[e] / nl.epsCu);
        col = r < 0.02 ? "#edf1f6" : r >= 1 ? "#7f1d1d" : `rgb(255,${Math.round(238 - 205 * r)},${Math.round(232 - 215 * r)})`;
      } else if (nl && mode === "nlcrack") {
        col = nl.epsTens[e] > 2e-5 ? "#dbeafe" : "#eef2f6";
      } else if (nl && mode === "nlstress") {
        const { s3 } = princFromStress(nl.stress, e), r = Math.min(1.2, Math.max(0, -s3) / nl.fc);
        col = r < 0.02 ? "#edf1f6" : r >= 1 ? "#7f1d1d" : `rgb(255,${Math.round(238 - 205 * r)},${Math.round(232 - 215 * r)})`;
      } else if (nl && mode === "nlutil") {
        const { s3 } = princFromStress(nl.stress, e);
        const r = Math.max(Math.max(0, -s3) / nl.fc, nl.epsComp[e] / nl.epsCu);
        col = utilColor(r);
      }
      ctx.fillStyle = col;
      ctx.fillRect(X(i), Y(j), px + 0.6, px + 0.6);
      if (showMesh) {
        ctx.strokeStyle = "rgba(15,23,42,.18)";
        ctx.lineWidth = 0.5;
        ctx.strokeRect(X(i), Y(j), px, px);
      }
    }

    // traços orientados de fissuração perpendiculares à tração principal (ε1)
    if (nl && mode === "nlcrack" && nl.crackTheta?.length === m.mask.length) {
      const step = Math.max(1, Math.round(9 / px));
      const maxEt = cachedPct(m, "nl-et95", () => {
        const arr: number[] = [];
        for (let e = 0; e < m.mask.length; e++) if (m.mask[e] && nl.epsTens[e] > 2e-5) arr.push(nl.epsTens[e]);
        arr.sort((a, b) => a - b);
        return arr.length ? arr[Math.min(arr.length - 1, Math.floor(0.95 * arr.length))] : 1e-3;
      });
      ctx.save();
      ctx.lineCap = "round";
      for (let i = 0; i < nelx; i += step) for (let j = 0; j < nely; j += step) {
        const e = i * nely + j;
        if (m.mask[e] === 0 || nl.epsTens[e] <= 2e-5) continue;
        const k = Math.min(1, Math.sqrt(nl.epsTens[e] / Math.max(maxEt, 1e-5)));
        const half = Math.max(3, px * step * (0.28 + 0.42 * k));
        const ang = nl.crackTheta[e];
        const cx = X(i) + px / 2, cy = Y(j) + px / 2;
        const dx = Math.cos(ang) * half, dy = -Math.sin(ang) * half;
        ctx.strokeStyle = k > 0.65 ? "#1e3a8a" : "#2563eb";
        ctx.lineWidth = 0.9 + 1.1 * k;
        ctx.beginPath(); ctx.moveTo(cx - dx, cy - dy); ctx.lineTo(cx + dx, cy + dy); ctx.stroke();
      }
      ctx.restore();
    }

    // janela crítica de esmagamento
    if (nl?.crush && (nl.crush.ratio >= 0.5 || nl.failure?.crush)) {
      const cr = nl.failure?.crush ?? nl.crush, w = cr.window, failed = !!nl.failure?.crush;
      ctx.save();
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = failed ? 2.5 : 1.6;
      ctx.strokeStyle = failed ? "#7f1d1d" : "#dc2626";
      ctx.strokeRect(
        worldToScreenX(v, w.x0),
        worldToScreenY(v, w.y1),
        worldToScreenX(v, w.x1) - worldToScreenX(v, w.x0),
        worldToScreenY(v, w.y0) - worldToScreenY(v, w.y1),
      );
      ctx.setLineDash([]);
      ctx.fillStyle = failed ? "#7f1d1d" : "#dc2626";
      ctx.font = "bold 11.5px Inter, system-ui, sans-serif";
      ctx.fillText(
        failed ? `CC · esmagamento (${(cr.strain * 1000).toFixed(2)} ‰)` : `compressão ${(100 * cr.ratio).toFixed(0)} % de εcu`,
        worldToScreenX(v, w.x0),
        worldToScreenY(v, w.y1) - 6,
      );
      ctx.restore();
    }
    return;
  }

  if (mode === "csfm") {
    for (let i = 0; i < nelx; i++) for (let j = 0; j < nely; j++) {
      const e = i * nely + j;
      if (m.mask[e] === 0) continue;
      ctx.fillStyle = "#e6ebf2"; ctx.fillRect(X(i), Y(j), px + 0.6, px + 0.6);
    }
    if (!csfm) return;
    for (const z of csfm.zones) {
      for (const e of z.elements) {
        const i = Math.floor(e / nely), j = e % nely, a = Math.min(1, m.field.s1[e] / (csfm.smax || 1));
        ctx.fillStyle = `rgba(220,38,38,${0.22 + 0.58 * a})`;
        ctx.fillRect(X(i), Y(j), px + 0.6, px + 0.6);
      }
    }
    ctx.font = "bold 12px Inter, system-ui, sans-serif";
    for (const z of csfm.zones) {
      const x = worldToScreenX(v, z.cx), y = worldToScreenY(v, z.cy);
      const tx = Math.cos(z.theta) * 40, ty = -Math.sin(z.theta) * 40;
      ctx.strokeStyle = "#7f1d1d"; ctx.lineWidth = 2.6;
      ctx.beginPath(); ctx.moveTo(x - tx, y - ty); ctx.lineTo(x + tx, y + ty); ctx.stroke();
      const lbl = `Z${z.id + 1}: T ≈ ${z.T.toFixed(0)} kN · As ≈ ${z.As.toFixed(1)} cm²`;
      const tw = ctx.measureText(lbl).width;
      ctx.fillStyle = "rgba(255,255,255,.9)"; ctx.fillRect(x - tw / 2 - 4, y - 24, tw + 8, 17);
      ctx.fillStyle = "#1e293b"; ctx.fillText(lbl, x - tw / 2, y - 11);
    }
    return;
  }

  if (mode === "stm") {
    for (let i = 0; i < nelx; i++) for (let j = 0; j < nely; j++) {
      const e = i * nely + j;
      if (m.mask[e] === 0) continue;
      const g = m.elastic ? 242 : Math.round(248 - 32 * m.rho[e]);
      ctx.fillStyle = `rgb(${g},${g + 2},${Math.min(255, g + 5)})`;
      ctx.fillRect(X(i), Y(j), px + 0.6, px + 0.6);
    }
    return;
  }

  if (mode === "topo") {
    for (let i = 0; i < nelx; i++) for (let j = 0; j < nely; j++) {
      const e = i * nely + j;
      if (m.mask[e] === 0) continue;
      const g = Math.round(252 - 72 * m.rho[e]);
      ctx.fillStyle = `rgb(${g},${g + 2},${Math.min(255, g + 5)})`;
      ctx.fillRect(X(i), Y(j), px + 0.6, px + 0.6);
    }
    drawTrajectories(ctx, m, X, Y, px, solidIdx);
    return;
  }

  let umax = 0;
  for (let d = 0; d < m.u.length; d++) umax = Math.max(umax, Math.abs(m.u[d]));
  const amp = umax > 0 ? (0.06 * Math.max(nelx, nely) * h) / umax : 0;
  const def = mode === "def";
  const sv = mode === "s1" ? m.field.s1 : m.field.s2;
  const smax = Math.max(1e-12, cachedPct(m, `abs-${mode}`, () => Math.abs(pct(Float64Array.from(sv, Math.abs), solidIdx, 0.97))));
  const P = (i: number, j: number): [number, number] => {
    const n = i * (nely + 1) + j;
    const dx = def ? (m.u[2 * n] * amp) / h : 0, dy = def ? (m.u[2 * n + 1] * amp) / h : 0;
    return [X(i) + dx * px, Y(j) - dy * px];
  };
  for (let i = 0; i < nelx; i++) for (let j = 0; j < nely; j++) {
    const e = i * nely + j;
    if (!solidAt(m, e)) continue;
    const a = P(i, j), b = P(i + 1, j), c = P(i + 1, j + 1), d = P(i, j + 1);
    ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.lineTo(...c); ctx.lineTo(...d); ctx.closePath();
    if (def) {
      const n = i * (nely + 1) + j;
      ctx.fillStyle = `hsl(${230 - 230 * (Math.hypot(m.u[2 * n], m.u[2 * n + 1]) / (umax || 1))},72%,56%)`;
    } else ctx.fillStyle = diverge(sv[e] / smax);
    ctx.fill();
    if (showMesh) { ctx.strokeStyle = "rgba(15,23,42,.2)"; ctx.lineWidth = 0.5; ctx.stroke(); }
  }
}

function drawBars(ctx: CanvasRenderingContext2D, v: ViewportTransform, scene: Scene, frame: FrameMsg | null, hoverBarId: string | null) {
  const bars = scene.bars ?? [];
  const tendons = scene.tendons ?? [];
  if (!bars.length && !tendons.length) return;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  bars.forEach((b, k) => {
    const hl = hoverBarId === b.id;
    const mainPath = discretizeBarPath(b, scene.h);
    const allPaths = [mainPath, ...(b.extra ?? [])];
    ctx.strokeStyle = hl ? "#2563eb" : frame?.nl ? "rgba(30,41,59,.45)" : "#991b1b";
    ctx.lineWidth = hl ? 3.5 : frame?.nl ? 1.1 : Math.max(1.5, Math.min(3.8, Math.sqrt(b.areaCm2)));
    for (const path of allPaths) {
      ctx.beginPath();
      path.forEach(([x, y], i) => (i ? ctx.lineTo(worldToScreenX(v, x), worldToScreenY(v, y)) : ctx.moveTo(worldToScreenX(v, x), worldToScreenY(v, y))));
      ctx.stroke();
    }
    // rótulo no maior segmento da primeira polilinha
    let bi = 0, bl = 0;
    for (let q = 0; q + 1 < b.path.length; q++) {
      const l = Math.hypot(b.path[q + 1][0] - b.path[q][0], b.path[q + 1][1] - b.path[q][1]);
      if (l > bl) { bl = l; bi = q; }
    }
    if (b.path.length > 1) {
      const lx = worldToScreenX(v, (b.path[bi][0] + b.path[bi + 1][0]) / 2);
      const ly = worldToScreenY(v, (b.path[bi][1] + b.path[bi + 1][1]) / 2);
      ctx.font = `${hl ? "700 " : "600 "}10px Inter, system-ui, sans-serif`;
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(255,255,255,.92)";
      ctx.strokeText(b.label, lx + 4, ly - 4);
      ctx.fillStyle = hl ? "#1d4ed8" : "#7f1d1d";
      ctx.fillText(b.label, lx + 4, ly - 4);
    }
    const samples = frame?.nl?.barSamples[k];
    if (!samples) return;
    const Afy = b.areaCm2 * 1e-4 * b.fy * 1e3;
    const rad = Math.max(1.8, Math.min(3.4, Math.sqrt(b.areaCm2)));
    for (const sp of samples) {
      const r = sp.N / (Afy || 1), a = Math.min(1, Math.abs(r));
      ctx.fillStyle = r >= 0
        ? `hsl(${Math.round(125 - 125 * a)},82%,40%)`
        : `hsl(215,${Math.round(35 + 48 * a)}%,${Math.round(62 - 24 * a)}%)`;
      ctx.beginPath();
      ctx.arc(worldToScreenX(v, sp.x), worldToScreenY(v, sp.y), rad, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  // Cabos de protensão não aderentes (Fase B1 PROVISÓRIO)
  for (const td of tendons) {
    const pts = discretizeBarPath({ path: td.path, curve: td.curve }, scene.h);
    if (pts.length < 2) continue;
    ctx.setLineDash([10, 4, 2, 4]);
    ctx.strokeStyle = "#7c3aed";
    ctx.lineWidth = Math.max(2.2, Math.min(4.2, Math.sqrt(td.areaCm2) * 1.4));
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(worldToScreenX(v, x), worldToScreenY(v, y)) : ctx.moveTo(worldToScreenX(v, x), worldToScreenY(v, y))));
    ctx.stroke();
    ctx.setLineDash([]);
    // Ancoragens nas extremidades
    ctx.fillStyle = "#5b21b6";
    for (const endPt of [pts[0], pts[pts.length - 1]]) {
      ctx.fillRect(worldToScreenX(v, endPt[0]) - 4, worldToScreenY(v, endPt[1]) - 4, 8, 8);
    }
    const mid = pts[Math.floor(pts.length / 2)];
    const lx = worldToScreenX(v, mid[0]), ly = worldToScreenY(v, mid[1]);
    const lbl = `${td.label} (P0=${td.P0.toFixed(0)} kN · PROVISÓRIO)`;
    ctx.font = "700 10px Inter, system-ui, sans-serif";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(255,255,255,.92)";
    ctx.strokeText(lbl, lx + 6, ly - 6);
    ctx.fillStyle = "#6d28d9";
    ctx.fillText(lbl, lx + 6, ly - 6);
  }
  ctx.restore();
}

function drawLoad(ctx: CanvasRenderingContext2D, v: ViewportTransform, scene: Scene, l: LoadSpec, selected: boolean) {
  ctx.save();
  ctx.strokeStyle = selected ? "#2563eb" : "#ea580c";
  ctx.fillStyle = ctx.strokeStyle;
  if (isLineLoad(l)) {
    const F = Math.hypot(l.fx, l.fy) || 1, ux = l.fx / F, uy = l.fy / F;
    const x0 = worldToScreenX(v, l.x), y0 = worldToScreenY(v, l.y);
    const x1 = worldToScreenX(v, l.x1), y1 = worldToScreenY(v, l.y1);
    const len = Math.hypot(x1 - x0, y1 - y0), A = 36;
    ctx.lineWidth = selected ? 2.8 : 2;
    const n = Math.max(2, Math.round(len / 24));
    const ox = -ux * A, oy = uy * A;
    ctx.beginPath(); ctx.moveTo(x0 + ox, y0 + oy); ctx.lineTo(x1 + ox, y1 + oy); ctx.stroke();
    for (let k = 0; k <= n; k++) {
      const bx = x0 + ((x1 - x0) * k) / n, by = y0 + ((y1 - y0) * k) / n;
      ctx.beginPath(); ctx.moveTo(bx + ox, by + oy); ctx.lineTo(bx, by); ctx.stroke();
      arrowHead(ctx, bx, by, Math.atan2(-oy, -ox), 8);
    }
    ctx.font = "600 11px Inter, system-ui, sans-serif";
    ctx.fillStyle = "#1e293b";
    ctx.fillText(
      `${l.id}: ${lineLoadIntensity(l).toFixed(1)} kN/m (Σ ${l.fx ? `Fx=${l.fx} ` : ""}${l.fy ? `Fy=${l.fy} ` : ""}kN)`,
      (x0 + x1) / 2 - 58,
      (y0 + y1) / 2 + oy - 7,
    );
    ctx.restore();
    return;
  }
  const F = Math.hypot(l.fx, l.fy);
  const ux = F ? l.fx / F : 0, uy = F ? l.fy / F : -1;
  const x = worldToScreenX(v, l.x), y = worldToScreenY(v, l.y), L = 52;
  const tx = x - ux * L, ty = y + uy * L;
  ctx.lineWidth = selected ? 3.2 : 2.4;
  if (scene.bearing > 0 && !l.point) {
    const hw = (scene.bearing * v.s) / 2;
    ctx.beginPath(); ctx.moveTo(x + uy * hw, y + ux * hw); ctx.lineTo(x - uy * hw, y - ux * hw); ctx.stroke();
  }
  ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(x, y); ctx.stroke();
  arrowHead(ctx, x, y, Math.atan2(y - ty, x - tx));
  ctx.font = "600 11px Inter, system-ui, sans-serif";
  ctx.fillStyle = "#1e293b";
  ctx.fillText(`${l.id}: ${l.fx ? `Fx=${l.fx} ` : ""}${l.fy ? `Fy=${l.fy} ` : ""}kN`, tx + 6, ty - 5);
  ctx.restore();
}

function drawSupport(ctx: CanvasRenderingContext2D, v: ViewportTransform, scene: Scene, s: SupportSpec, selected: boolean) {
  ctx.save();
  const x0 = worldToScreenX(v, s.x0), y0 = worldToScreenY(v, s.y0);
  const x1 = worldToScreenX(v, s.x1), y1 = worldToScreenY(v, s.y1);
  const kind = supportKind(s);
  const col = selected ? "#2563eb" : kind === "fixo" ? "#15803d" : "#7e22ce";
  ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = selected ? 3.8 : 2.8;
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  const pts = scene.shapes.filter((q) => q.mode === "add").flatMap((q) => q.pts);
  const cx = pts.reduce((a, p) => a + worldToScreenX(v, p[0]), 0) / (pts.length || 1);
  const cy = pts.reduce((a, p) => a + worldToScreenY(v, p[1]), 0) / (pts.length || 1);
  const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy);
  let nx = len ? -dy / len : 0, ny = len ? dx / len : 1;
  if (len === 0 || ((x0 + x1) / 2 - cx) * nx + ((y0 + y1) / 2 - cy) * ny < 0) { nx = -nx; ny = -ny; }
  if (len === 0) { nx = 0; ny = 1; }
  const n = Math.max(1, Math.round(len / 22));
  for (let k = 0; k <= (len === 0 ? 0 : n); k++) {
    const t = len === 0 ? 0 : k / n, bx = x0 + dx * t, by = y0 + dy * t, w = 6.5;
    const tipx = bx + nx * 13, tipy = by + ny * 13;
    ctx.beginPath(); ctx.moveTo(bx, by);
    ctx.lineTo(tipx - ny * w, tipy + nx * w); ctx.lineTo(tipx + ny * w, tipy - nx * w); ctx.closePath();
    if (kind === "fixo") ctx.fill();
    else { ctx.lineWidth = 1.5; ctx.stroke(); ctx.beginPath(); ctx.arc(bx + nx * 17, by + ny * 17, 2.8, 0, Math.PI * 2); ctx.stroke(); }
  }
  ctx.font = "600 10.5px Inter, system-ui, sans-serif";
  ctx.fillStyle = "#334155";
  ctx.fillText(
    `${s.id} (${kind === "fixo" ? "fixo" : kind === "movel-x" ? "móvel ↔" : "móvel ↕"})`,
    (x0 + x1) / 2 + nx * 30 - 20,
    (y0 + y1) / 2 + ny * 30 + (ny > 0 ? 8 : -2),
  );
  ctx.restore();
}

function drawReactions(ctx: CanvasRenderingContext2D, v: ViewportTransform, m: FrameMsg) {
  ctx.save();
  ctx.font = "700 11px Inter, system-ui, sans-serif";
  for (const r of m.reactions) {
    const mag = Math.hypot(r.rx, r.ry);
    if (mag < 1e-6) continue;
    const x = worldToScreenX(v, r.x), y = worldToScreenY(v, r.y), L = 46;
    const ux = r.rx / mag, uy = r.ry / mag;
    const x0 = x - ux * L, y0 = y + uy * L;
    ctx.strokeStyle = "#0f766e"; ctx.fillStyle = "#0f766e"; ctx.lineWidth = 2.6;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x, y); ctx.stroke();
    arrowHead(ctx, x, y, Math.atan2(y - y0, x - x0), 10);
    ctx.fillText(
      `R(${r.id}): ${Math.abs(r.rx) > 0.05 ? `Rx=${r.rx.toFixed(1)} ` : ""}Ry=${r.ry.toFixed(1)} kN`,
      x0 - 20,
      y0 + (uy > 0 ? 13 : -6),
    );
  }
  ctx.restore();
}

function drawStm(ctx: CanvasRenderingContext2D, v: ViewportTransform, stm: StmModel, displayMode: StmDisplayMode = "both") {
  if (!stm.nodes.length || !stm.members.length) return;
  const nodeMap = new Map(stm.nodes.map((n) => [n.id, n]));
  const maxN = Math.max(1e-6, ...stm.members.map((m) => Math.abs(m.N)));
  ctx.save();
  ctx.lineCap = "round";

  // Contornos estilo CAST (bielas prismáticas/garrafa e zonas nodais)
  if (displayMode !== "axes" && stm.geometry) {
    for (const sc of stm.geometry.struts) {
      if (sc.pts.length < 3) continue;
      ctx.beginPath();
      sc.pts.forEach(([x, y], i) => (i ? ctx.lineTo(worldToScreenX(v, x), worldToScreenY(v, y)) : ctx.moveTo(worldToScreenX(v, x), worldToScreenY(v, y))));
      ctx.closePath();
      ctx.fillStyle = sc.ok ? "rgba(37, 99, 235, 0.16)" : "rgba(220, 38, 38, 0.20)";
      ctx.fill();
      ctx.setLineDash(sc.provisional ? [5, 3] : []);
      ctx.strokeStyle = sc.ok ? "rgba(29, 78, 216, 0.65)" : "rgba(185, 28, 28, 0.85)";
      ctx.lineWidth = 1.25;
      ctx.stroke();
      ctx.setLineDash([]);
    }
    for (const nc of stm.geometry.nodes) {
      if (nc.pts.length < 3) continue;
      ctx.beginPath();
      nc.pts.forEach(([x, y], i) => (i ? ctx.lineTo(worldToScreenX(v, x), worldToScreenY(v, y)) : ctx.moveTo(worldToScreenX(v, x), worldToScreenY(v, y))));
      ctx.closePath();
      ctx.fillStyle = nc.ok ? "rgba(22, 163, 74, 0.26)" : "rgba(220, 38, 38, 0.28)";
      ctx.fill();
      ctx.strokeStyle = nc.ok ? "#15803d" : "#b91c1c";
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }
  }

  if (displayMode !== "contours") {
    for (const m of stm.members) {
      const a = nodeMap.get(m.n1);
      const b = nodeMap.get(m.n2);
      if (!a || !b) continue;
      const x0 = worldToScreenX(v, a.x), y0 = worldToScreenY(v, a.y);
      const x1 = worldToScreenX(v, b.x), y1 = worldToScreenY(v, b.y);
      const lw = 2 + 5.5 * (Math.abs(m.N) / maxN);

      if (m.kind === "strut") {
        ctx.setLineDash([7, 4]);
        ctx.strokeStyle = m.ok ? "#1d4ed8" : "#b91c1c";
        ctx.lineWidth = lw;
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
        ctx.setLineDash([]);
      } else {
        ctx.setLineDash([]);
        ctx.strokeStyle = "#dc2626";
        ctx.lineWidth = lw;
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();

        const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
        const lbl = `T = ${m.N.toFixed(0)} kN · As = ${m.AsReqCm2.toFixed(1)} cm²`;
        ctx.font = "700 11px Inter, system-ui, sans-serif";
        const tw = ctx.measureText(lbl).width;
        ctx.fillStyle = "rgba(255,255,255,.92)";
        ctx.fillRect(mx - tw / 2 - 4, my - 19, tw + 8, 16);
        ctx.fillStyle = "#991b1b";
        ctx.fillText(lbl, mx - tw / 2, my - 7);
      }
    }
  } else {
    // No modo apenas Contornos, ainda desenha os tirantes em vermelho para fechar o equilíbrio visual
    for (const m of stm.members) {
      if (m.kind !== "tie") continue;
      const a = nodeMap.get(m.n1), b = nodeMap.get(m.n2);
      if (!a || !b) continue;
      ctx.strokeStyle = "#dc2626";
      ctx.lineWidth = 2 + 4 * (Math.abs(m.N) / maxN);
      ctx.beginPath();
      ctx.moveTo(worldToScreenX(v, a.x), worldToScreenY(v, a.y));
      ctx.lineTo(worldToScreenX(v, b.x), worldToScreenY(v, b.y));
      ctx.stroke();
    }
  }

  ctx.setLineDash([]);
  for (const n of stm.nodes) {
    const nx = worldToScreenX(v, n.x), ny = worldToScreenY(v, n.y);
    const ok = n.ok && n.angleOk;
    ctx.fillStyle = ok ? "#16a34a" : "#dc2626";
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(nx, ny, 6.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    const badge = `${n.kind} ${(n.utilization * 100).toFixed(0)}%`;
    ctx.font = "700 10px Inter, system-ui, sans-serif";
    const bw = ctx.measureText(badge).width;
    const bx = nx + 9, by = ny - 9;
    ctx.fillStyle = ok ? "rgba(220,252,231,.94)" : "rgba(254,226,226,.95)";
    ctx.strokeStyle = ok ? "#86efac" : "#fca5a5";
    ctx.lineWidth = 1;
    ctx.fillRect(bx - 3, by - 10, bw + 6, 14);
    ctx.strokeRect(bx - 3, by - 10, bw + 6, 14);
    ctx.fillStyle = ok ? "#166534" : "#991b1b";
    ctx.fillText(badge, bx, by);
  }
  ctx.restore();
}

export interface RenderCanvasArgs {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  view: ViewportTransform;
  scene: Scene;
  frame: FrameMsg | null;
  viewMode: ViewMode;
  showMesh: boolean;
  csfm: CsfmSummary | null;
  stm: StmModel | null;
  stmDisplayMode?: StmDisplayMode;
  sel: Selection;
  hoverBarId: string | null;
  tool: Tool;
  hoverGrip: [number, number] | null;
  rebarPreview: { path: [number, number][]; a: [number, number]; b: [number, number] } | null;
  rebarCfg: RebarToolConfig;
  dragOverlay: { type: string; start: [number, number]; cur: [number, number] } | null;
  polyDraft: [number, number][];
  arcDraft?: [number, number][];
  hoverWorld: [number, number];
}

export function renderViewport(args: RenderCanvasArgs) {
  const { ctx, width, height, view, scene, frame, viewMode, showMesh, csfm, stm, stmDisplayMode = "both", sel, hoverBarId, tool, hoverGrip, rebarPreview, rebarCfg, dragOverlay, polyDraft, arcDraft, hoverWorld } = args;
  ctx.clearRect(0, 0, width, height);
  drawGrid(ctx, view, width, height);

  if (frame) {
    drawResult(ctx, view, frame, viewMode, showMesh, csfm);
    for (const s of scene.shapes) {
      polyPath(ctx, view, s.pts);
      ctx.strokeStyle = sel?.id === s.id ? "#2563eb" : "#64748b";
      ctx.lineWidth = sel?.id === s.id ? 2.2 : 1.1;
      ctx.setLineDash(s.mode === "cut" ? [5, 4] : []);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  } else {
    for (const s of scene.shapes) {
      polyPath(ctx, view, s.pts);
      ctx.fillStyle = s.mode === "add" ? "#e2e8f0" : "#ffffff";
      ctx.fill();
    }
    for (const s of scene.shapes) {
      polyPath(ctx, view, s.pts);
      ctx.setLineDash(s.mode === "cut" ? [5, 4] : []);
      ctx.strokeStyle = sel?.id === s.id ? "#2563eb" : "#475569";
      ctx.lineWidth = sel?.id === s.id ? 2.4 : 1.3;
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  if (viewMode === "stm" && stm) drawStm(ctx, view, stm, stmDisplayMode);
  drawBars(ctx, view, scene, frame, hoverBarId);
  for (const sp of scene.supports) drawSupport(ctx, view, scene, sp, sel?.kind === "support" && sel.id === sp.id);
  for (const ld of scene.loads) drawLoad(ctx, view, scene, ld, sel?.kind === "load" && sel.id === ld.id);
  if (frame) drawReactions(ctx, view, frame);

  // grips nos lados do contorno
  if (tool === "load" || tool === "qload" || tool === "support" || dragOverlay?.type === "moveLoad") {
    ctx.save();
    ctx.strokeStyle = "rgba(37,99,235,.55)"; ctx.lineWidth = 2.8; ctx.setLineDash([2, 4]);
    for (const [x0, y0, x1, y1] of sceneEdges(scene)) {
      ctx.beginPath(); ctx.moveTo(worldToScreenX(view, x0), worldToScreenY(view, y0)); ctx.lineTo(worldToScreenX(view, x1), worldToScreenY(view, y1)); ctx.stroke();
    }
    ctx.setLineDash([]);
    for (const [x, y] of sceneVertices(scene)) {
      ctx.fillStyle = "#fff"; ctx.strokeStyle = "#2563eb"; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.rect(worldToScreenX(view, x) - 3, worldToScreenY(view, y) - 3, 6, 6); ctx.fill(); ctx.stroke();
    }
    if (hoverGrip) {
      ctx.fillStyle = "#2563eb";
      ctx.beginPath(); ctx.arc(worldToScreenX(view, hoverGrip[0]), worldToScreenY(view, hoverGrip[1]), 5.5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  // pré-visualização da armadura inteligente
  if (tool === "rebar" && rebarPreview) {
    ctx.save();
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(21,128,61,.26)"; ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.moveTo(worldToScreenX(view, rebarPreview.a[0]), worldToScreenY(view, rebarPreview.a[1]));
    ctx.lineTo(worldToScreenX(view, rebarPreview.b[0]), worldToScreenY(view, rebarPreview.b[1]));
    ctx.stroke();
    ctx.strokeStyle = "#15803d";
    ctx.lineWidth = Math.max(2.5, (rebarCfg.dia / 1000) * view.s);
    ctx.beginPath();
    rebarPreview.path.forEach(([x, y], i) => (i ? ctx.lineTo(worldToScreenX(view, x), worldToScreenY(view, y)) : ctx.moveTo(worldToScreenX(view, x), worldToScreenY(view, y))));
    ctx.stroke();
    ctx.fillStyle = "#15803d";
    for (const [x, y] of rebarPreview.path) {
      ctx.beginPath(); ctx.arc(worldToScreenX(view, x), worldToScreenY(view, y), 3.5, 0, Math.PI * 2); ctx.fill();
    }
    const mid = rebarPreview.path[Math.floor(rebarPreview.path.length / 2)] ?? rebarPreview.path[0];
    const txt = `${rebarCfg.n}Ø${String(rebarCfg.dia).replace(".", ",")} · c = ${(rebarCfg.cover * 100).toFixed(1).replace(".", ",")} cm · As = ${barAreaCm2(rebarCfg.n, rebarCfg.dia).toFixed(2).replace(".", ",")} cm²`;
    ctx.font = "700 11.5px Inter, system-ui, sans-serif";
    const tw = ctx.measureText(txt).width;
    const tx = Math.max(8, Math.min(width - tw - 8, worldToScreenX(view, mid[0]) - tw / 2));
    const ty = Math.max(18, Math.min(height - 8, worldToScreenY(view, mid[1]) - 14));
    ctx.fillStyle = "rgba(255,255,255,.94)"; ctx.fillRect(tx - 5, ty - 13, tw + 10, 18);
    ctx.fillStyle = "#14532d"; ctx.fillText(txt, tx, ty);
    ctx.restore();
  }

  // pré-visualização da barra em arco (3 pontos)
  if (tool === "arcbar" && arcDraft && arcDraft.length > 0) {
    ctx.save();
    const pts = arcDraft.length === 2
      ? arcFrom3Points(arcDraft[0], arcDraft[1], hoverWorld, Math.max(0.002, scene.h / 8))
      : [arcDraft[0], hoverWorld];
    ctx.strokeStyle = "#0f766e";
    ctx.lineWidth = Math.max(2.2, (rebarCfg.dia / 1000) * view.s);
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(worldToScreenX(view, x), worldToScreenY(view, y)) : ctx.moveTo(worldToScreenX(view, x), worldToScreenY(view, y))));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#0f766e";
    for (const [x, y] of arcDraft) {
      ctx.beginPath(); ctx.arc(worldToScreenX(view, x), worldToScreenY(view, y), 4, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  // rascunhos de arrasto / polígono
  ctx.save();
  ctx.strokeStyle = "#2563eb"; ctx.lineWidth = 1.6; ctx.setLineDash([6, 3]);
  if (dragOverlay && (tool === "rect+" || tool === "rect-")) {
    const [a, b] = [dragOverlay.start, dragOverlay.cur];
    ctx.strokeRect(
      worldToScreenX(view, Math.min(a[0], b[0])),
      worldToScreenY(view, Math.max(a[1], b[1])),
      Math.abs(b[0] - a[0]) * view.s,
      Math.abs(b[1] - a[1]) * view.s,
    );
  }
  if (dragOverlay && (tool === "support" || tool === "qload")) {
    ctx.beginPath();
    ctx.moveTo(worldToScreenX(view, dragOverlay.start[0]), worldToScreenY(view, dragOverlay.start[1]));
    ctx.lineTo(worldToScreenX(view, dragOverlay.cur[0]), worldToScreenY(view, dragOverlay.cur[1]));
    ctx.stroke();
  }
  if (polyDraft.length) {
    ctx.beginPath();
    polyDraft.forEach(([x, y], i) => (i ? ctx.lineTo(worldToScreenX(view, x), worldToScreenY(view, y)) : ctx.moveTo(worldToScreenX(view, x), worldToScreenY(view, y))));
    ctx.lineTo(worldToScreenX(view, hoverWorld[0]), worldToScreenY(view, hoverWorld[1]));
    ctx.stroke();
  }
  ctx.restore();
}

export function distSeg(px: number, py: number, x0: number, y0: number, x1: number, y1: number) {
  const dx = x1 - x0, dy = y1 - y0, L2 = dx * dx + dy * dy;
  const t = L2 ? Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / L2)) : 0;
  return Math.hypot(px - x0 - t * dx, py - y0 - t * dy);
}

const MPa = (v: number) => (v / 1000).toFixed(2);

export function inspectHoverPoint(
  px: number,
  py: number,
  view: ViewportTransform,
  scene: Scene,
  frame: FrameMsg | null,
  viewMode: ViewMode,
  stm: StmModel | null = null,
): { barId: string | null; lines: string[]; title?: string } | null {
  if (viewMode === "stm" && stm) {
    for (const n of stm.nodes) {
      const d = Math.hypot(worldToScreenX(view, n.x) - px, worldToScreenY(view, n.y) - py);
      if (d <= 11) {
        return {
          barId: null,
          title: `Nó ${n.id} (${n.kind} · ${n.role})`,
          lines: [
            `σ = ${n.sigmaMPa.toFixed(2)} / ${n.sigmaLimitMPa.toFixed(2)} MPa · util. ${(n.utilization * 100).toFixed(0)} % (${n.ok ? "OK" : "REPROVADO"})`,
            `Ângulo mín.: ${n.minAngleDeg != null ? `${n.minAngleDeg.toFixed(1)}°` : "—"} (${n.angleOk ? "OK" : "abaixo do mínimo"})`,
          ],
        };
      }
    }
    const nodeMap = new Map(stm.nodes.map((n) => [n.id, n]));
    for (const m of stm.members) {
      const a = nodeMap.get(m.n1);
      const b = nodeMap.get(m.n2);
      if (!a || !b) continue;
      const d = distSeg(
        px, py,
        worldToScreenX(view, a.x), worldToScreenY(view, a.y),
        worldToScreenX(view, b.x), worldToScreenY(view, b.y),
      );
      if (d <= 9) {
        return {
          barId: null,
          title: `${m.kind === "strut" ? "Biela" : "Tirante"} M${m.id} (Nó ${m.n1}–Nó ${m.n2})`,
          lines: [
            `N = ${m.N.toFixed(1)} kN · L = ${m.length.toFixed(2)} m · θ = ${m.angleDeg.toFixed(1)}°`,
            m.kind === "tie"
              ? `As,req = ${m.AsReqCm2.toFixed(2)} cm² · util. ${(m.utilization * 100).toFixed(0)} %`
              : `σ = ${m.sigmaMPa.toFixed(2)} / ${m.sigmaLimitMPa.toFixed(2)} MPa · w = ${(m.wReqM * 100).toFixed(1)} cm · util. ${(m.utilization * 100).toFixed(0)} %`,
          ],
        };
      }
    }
  }

  const bars = scene.bars ?? [];
  let best: { k: number; q: number; d: number } | null = null;
  bars.forEach((b, k) => {
    const samples = frame?.nl?.barSamples[k];
    if (samples) {
      samples.forEach((sp, q) => {
        const d = Math.hypot(worldToScreenX(view, sp.x) - px, worldToScreenY(view, sp.y) - py);
        if (!best || d < best.d) best = { k, q, d };
      });
    } else {
      for (const path of [b.path, ...(b.extra ?? [])]) {
        for (let q = 0; q + 1 < path.length; q++) {
          const d = distSeg(
            px, py,
            worldToScreenX(view, path[q][0]), worldToScreenY(view, path[q][1]),
            worldToScreenX(view, path[q + 1][0]), worldToScreenY(view, path[q + 1][1]),
          );
          if (!best || d < best.d) best = { k, q, d };
        }
      }
    }
  });
  const hit = best as { k: number; q: number; d: number } | null;
  if (hit && hit.d <= 8) {
    const b = bars[hit.k];
    const cls = b.steelClass && b.steelClass !== "custom" ? STEEL_CLASSES[b.steelClass].label : "ensaio";
    const lines = [`Aço ${cls} · As = ${b.areaCm2.toFixed(2)} cm² · fy = ${b.fy.toFixed(0)} MPa`];
    const sp = frame?.nl?.barSamples[hit.k]?.[hit.q];
    if (sp) {
      const sig = sp.N / (b.areaCm2 * 1e-4) / 1000;
      lines.push(`N = ${sp.N.toFixed(1)} kN (${sp.N >= 0 ? "tração" : "compressão"}) · σ = ${sig.toFixed(0)} MPa (${((Math.abs(sig) / b.fy) * 100).toFixed(0)} % fy${Math.abs(sig) >= b.fy * 0.999 ? " — escoou" : ""})`);
    }
    return { barId: b.id, title: `${b.label} (${b.id})`, lines };
  }

  if (!frame) return null;
  const { nelx, nely, h, ox, oy } = frame.dims;
  const [x, y] = screenToWorld(view, px, py);
  const i = Math.floor((x - ox) / h), jy = Math.floor((y - oy) / h), j = nely - 1 - jy;
  if (i < 0 || i >= nelx || jy < 0 || jy >= nely) return null;
  const e = i * nely + j;
  if (frame.mask[e] === 0) return null;
  const title = `Elem. (${i}, ${jy}) · x = ${(ox + (i + 0.5) * h).toFixed(3)} m, y = ${(oy + (jy + 0.5) * h).toFixed(3)} m`;
  if (viewMode.startsWith("nl")) {
    const nl = frame.nl;
    if (!nl) return { barId: null, title, lines: ["Rode a análise não linear (Nível 2) para ver resultados."] };
    const s = princFromStress(nl.stress, e);
    if (viewMode === "nlcrack") {
      const cracked = nl.epsTens[e] > 2e-5;
      const deg = ((nl.crackTheta[e] * 180) / Math.PI).toFixed(0);
      return {
        barId: null,
        title,
        lines: [
          cracked ? `Fissurado · direção da fissura: ${deg}°` : "Não fissurado",
          `ε1 = ${(nl.epsTens[e] * 1000).toFixed(2)} ‰ · ε3 = ${(nl.epsComp[e] * 1000).toFixed(2)} ‰`,
        ],
      };
    }
    if (viewMode === "nlstress" || viewMode === "nlutil") {
      const uStr = (Math.max(0, -s.s3) / nl.fc) * 100;
      const uEps = (nl.epsComp[e] / nl.epsCu) * 100;
      return {
        barId: null,
        title,
        lines: [
          `σ1 = ${MPa(s.s1)} MPa · σ3 = ${MPa(s.s3)} MPa · τmáx = ${MPa(s.tmax)} MPa`,
          `Utilização: tensão ${uStr.toFixed(0)} % fc · deformação ${uEps.toFixed(0)} % εcu`,
        ],
      };
    }
    return {
      barId: null,
      title,
      lines: [
        `Compressão ε3 = ${(nl.epsComp[e] * 1000).toFixed(2)} ‰ (${((nl.epsComp[e] / nl.epsCu) * 100).toFixed(0)} % εcu)`,
        `Tração ε1 = ${(nl.epsTens[e] * 1000).toFixed(2)} ‰${nl.epsTens[e] > 2e-5 ? " (fissurado)" : ""}`,
      ],
    };
  }
  if (viewMode === "def") {
    const n = i * (nely + 1) + j;
    let ux = 0, uy = 0;
    for (const d of [n, n + 1, n + nely + 1, n + nely + 2]) { ux += frame.u[2 * d] / 4; uy += frame.u[2 * d + 1] / 4; }
    return { barId: null, title, lines: [`Deslocamento: ux = ${(ux * 1000).toFixed(2)} mm · uy = ${(uy * 1000).toFixed(2)} mm`] };
  }
  const s1 = frame.field.s1[e], s2 = frame.field.s2[e];
  return {
    barId: null,
    title,
    lines: [
      `σ1 = ${MPa(s1)} MPa · σ2 = ${MPa(s2)} MPa · τmáx = ${MPa((s1 - s2) / 2)} MPa`,
      `Direção σ1 = ${((frame.field.theta[e] * 180) / Math.PI).toFixed(0)}°${frame.elastic ? "" : ` · ρ = ${frame.rho[e].toFixed(2)}`}`,
    ],
  };
}

/** Gera SVG vetorial da geometria, contornos/eixos STM estilo CAST e armaduras/cabos. */
export function exportStmSvg(scene: Scene, stm: StmModel | null, displayMode: StmDisplayMode = "both"): string {
  const b = sceneBounds(scene) ?? { x0: 0, y0: 0, x1: 1, y1: 1 };
  const pad = Math.max(0.15, 0.1 * Math.max(b.x1 - b.x0, b.y1 - b.y0));
  const vx0 = b.x0 - pad, vy0 = b.y0 - pad, vw = (b.x1 - b.x0) + 2 * pad, vh = (b.y1 - b.y0) + 2 * pad;
  const W = 1000, H = Math.max(300, Math.round((W * vh) / vw));
  const sx = (x: number) => (((x - vx0) / vw) * W).toFixed(2);
  const sy = (y: number) => (H - ((y - vy0) / vh) * H).toFixed(2);
  const poly = (pts: readonly [number, number][]) => pts.map(([x, y]) => `${sx(x)},${sy(y)}`).join(" ");
  const lines: string[] = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`,
    `<rect width="${W}" height="${H}" fill="#ffffff"/>`,
  ];
  for (const s of scene.shapes) {
    lines.push(
      `<polygon points="${poly(s.pts)}" fill="${s.mode === "add" ? "#e2e8f0" : "#ffffff"}" stroke="#475569" stroke-width="1.5"${s.mode === "cut" ? ' stroke-dasharray="6,4"' : ""}/>`,
    );
  }
  if (stm) {
    const nm = new Map(stm.nodes.map((n) => [n.id, n]));
    if (displayMode !== "axes" && stm.geometry) {
      for (const sc of stm.geometry.struts) {
        lines.push(
          `<polygon points="${poly(sc.pts)}" fill="${sc.ok ? "rgba(37,99,235,0.16)" : "rgba(220,38,38,0.20)"}" stroke="${sc.ok ? "#1d4ed8" : "#b91c1c"}" stroke-width="1.3"${sc.provisional ? ' stroke-dasharray="5,3"' : ""}/>`,
        );
      }
      for (const nc of stm.geometry.nodes) {
        lines.push(
          `<polygon points="${poly(nc.pts)}" fill="${nc.ok ? "rgba(22,163,74,0.26)" : "rgba(220,38,38,0.28)"}" stroke="${nc.ok ? "#15803d" : "#b91c1c"}" stroke-width="1.5"/>`,
        );
      }
    }
    if (displayMode !== "contours") {
      for (const m of stm.members) {
        const a = nm.get(m.n1), c = nm.get(m.n2);
        if (!a || !c) continue;
        lines.push(
          `<line x1="${sx(a.x)}" y1="${sy(a.y)}" x2="${sx(c.x)}" y2="${sy(c.y)}" stroke="${m.kind === "tie" ? "#dc2626" : m.ok ? "#1d4ed8" : "#b91c1c"}" stroke-width="3"${m.kind === "strut" ? ' stroke-dasharray="7,4"' : ""}/>`,
        );
      }
    }
  }
  for (const br of scene.bars ?? []) {
    const pts = discretizeBarPath(br, scene.h);
    lines.push(`<polyline points="${poly(pts)}" fill="none" stroke="#991b1b" stroke-width="2"/>`);
  }
  for (const td of scene.tendons ?? []) {
    const pts = discretizeBarPath({ path: td.path, curve: td.curve }, scene.h);
    lines.push(`<polyline points="${poly(pts)}" fill="none" stroke="#7c3aed" stroke-width="2.5" stroke-dasharray="10,4,2,4"/>`);
  }
  lines.push(`</svg>`);
  return lines.join("\n");
}
