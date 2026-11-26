/// <reference types="vite/client" />
import { tensionZones, CSFM_DEFAULTS, FCK_MIN, GAMMA_C, K_STRUT, SCENE_PRESETS, clampFck, filterRadiusForWidth, sigmaRdMax, strutWidth, isLineLoad, lineLoadIntensity, nearestEdgePoint, pointInPolygon, rectPts, sceneEdges, sceneVertices, supportFlags, supportKind } from "@stm/core";
import type { LoadSpec, NlBarResult, PrincipalField, Scene, Shape, SupportKind, SupportSpec } from "@stm/core";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const cv = $<HTMLCanvasElement>("cv");
const ctx = cv.getContext("2d")!;
const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });

/* ───────────────────────── estado ───────────────────────── */
const DEFAULT_PRESET = "Viga-parede";
/** modelos só de desenvolvimento interno: vêm de presets.local.ts (ignorado pelo git); ausente ⇒ lista pública */
const localMods = import.meta.glob("../../../packages/core/src/presets.local.ts", { eager: true }) as Record<string, { LOCAL_SCENE_PRESETS?: Record<string, () => Scene> }>;
const ALL_PRESETS: Record<string, () => Scene> = { ...SCENE_PRESETS, ...Object.assign({}, ...Object.values(localMods).map((mod) => mod.LOCAL_SCENE_PRESETS ?? {})) };
/** cena salva na sessão anterior (validação mínima de forma; qualquer problema ⇒ cai no preset) */
function loadSaved(): Scene | null {
  try {
    const o = JSON.parse(localStorage.getItem("stm-scene") ?? "null");
    const num = (v: unknown) => typeof v === "number" && Number.isFinite(v);
    const okPt = (p: unknown) => Array.isArray(p) && p.length === 2 && p.every(num);
    if (!o || !num(o.h) || o.h <= 0 || !num(o.bearing) || !num(o.t) || !num(o.E) || !num(o.nu)) return null;
    if (!Array.isArray(o.shapes) || !o.shapes.every((q: any) => typeof q.id === "string" && (q.mode === "add" || q.mode === "cut") && Array.isArray(q.pts) && q.pts.every(okPt))) return null;
    if (!Array.isArray(o.loads) || !o.loads.every((l: any) => typeof l.id === "string" && [l.x, l.y, l.fx, l.fy].every(num))) return null;
    if (!Array.isArray(o.supports) || !o.supports.every((s: any) => typeof s.id === "string" && [s.x0, s.y0, s.x1, s.y1].every(num) && typeof s.ux === "boolean" && typeof s.uy === "boolean")) return null;
    const okBar = (b: any) => b && typeof b.id === "string" && typeof b.label === "string" && Array.isArray(b.path) && b.path.every(okPt) && [b.areaCm2, b.fy, b.ft, b.Es, b.epsU].every(num);
    if (o.bars !== undefined && !(Array.isArray(o.bars) && o.bars.every(okBar))) delete o.bars;
    if (o.nl !== undefined && !(o.nl && (o.nl.values === "mean" || o.nl.values === "design") && num(o.nl.epsCu) && num(o.nl.crushLength))) delete o.nl;
    return o as Scene;
  } catch { return null; }
}
const saved = loadSaved();
let scene: Scene = saved ?? ALL_PRESETS[DEFAULT_PRESET]();
type Sel = { kind: "shape" | "load" | "support"; id: string } | null;
let sel: Sel = null;
type Tool = "select" | "rect+" | "rect-" | "poly+" | "poly-" | "load" | "qload" | "support";
let tool: Tool = "select";
let geomLocked = localStorage.getItem("stm-lock") === "1";
let nextId = 100;
if (saved) for (const q of [...saved.shapes, ...saved.loads, ...saved.supports]) nextId = Math.max(nextId, (parseInt(q.id.replace(/\D/g, ""), 10) || 0) + 1);
const newId = (p: string) => `${p}${nextId++}`;

/** execução vigente; mensagens de outras execuções (cena editada, nova rodada) são descartadas */
let curToken = 0;
interface Reaction { id: string; rx: number; ry: number; x: number; y: number }
interface Msg {
  kind: "frame"; token: number;
  dims: { nelx: number; nely: number; h: number; ox: number; oy: number };
  mask: Uint8Array; iter: number; compliance: number; volume: number; change: number;
  rho: Float64Array; u: Float64Array; field: PrincipalField; done: boolean; warnings: string[]; elastic?: boolean;
  reactions: Reaction[]; residual: { x: number; y: number };
  /** carga de referência total [kN] (módulo da soma das forças) e resultado da análise não linear */
  P0?: number; nl?: NlInfo;
}
interface NlInfo {
  lambda: number; mode: "CC" | "FR" | "divergencia" | "lambdaMax" | "interrompida" | null;
  epsComp: Float64Array; epsTens: Float64Array; barSamples: { x: number; y: number; N: number }[][]; bars: NlBarResult[];
  maxEpsC: number; crushStrain: number; epsCu: number; fc: number; crushLength: number; equilibrium: { x: number; y: number };
}
const frames: Msg[] = [];
type CsfmData = ReturnType<typeof tensionZones>;
const csfmData = new WeakMap<Msg, CsfmData>();
let pendingCsfm = false;
const NL_LABEL = "Rodar análise não linear";
const slider = $<HTMLInputElement>("frame");

const view = { s: 100, ox: 0, oy: 0 };
const wx = (x: number) => view.ox + x * view.s;
const wy = (y: number) => view.oy - y * view.s;
const toWorld = (px: number, py: number): [number, number] => [(px - view.ox) / view.s, (view.oy - py) / view.s];

function fitView() {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x: number, y: number) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  for (const s of scene.shapes) s.pts.forEach(([x, y]) => add(x, y));
  for (const l of scene.loads) add(l.x, l.y);
  for (const p of scene.supports) { add(p.x0, p.y0); add(p.x1, p.y1); }
  if (x0 === Infinity) { x0 = 0; y0 = 0; x1 = 1; y1 = 1; }
  const m = 90, w = cv.clientWidth, h = cv.clientHeight;
  view.s = Math.max(1, Math.min((w - 2 * m) / Math.max(x1 - x0, 1e-6), (h - 2 * m) / Math.max(y1 - y0, 1e-6)));
  view.ox = (w - (x1 - x0) * view.s) / 2 - x0 * view.s;
  view.oy = (h + (y1 - y0) * view.s) / 2 + y0 * view.s;
}

let fitted = false;
new ResizeObserver(() => {
  cv.width = cv.clientWidth; cv.height = cv.clientHeight;
  if (!fitted && cv.clientWidth > 50) { fitted = true; fitView(); }
  draw();
}).observe($("wrap"));

/* ───────────────────────── desenho ───────────────────────── */
const diverge = (v: number) => {
  const t = Math.max(-1, Math.min(1, v)), a = Math.abs(t);
  return `rgb(${t > 0 ? 255 : Math.round(255 * (1 - a))},${Math.round(255 * (1 - a * 0.85))},${t < 0 ? 255 : Math.round(255 * (1 - a))})`;
};
/** percentis custam uma ordenação: guarda por quadro, pois o desenho roda a cada movimento do mouse */
const pctCache = new WeakMap<object, Map<string, number>>();
const cachedPct = (m: Msg, key: string, f: () => number) => {
  let c = pctCache.get(m); if (!c) pctCache.set(m, (c = new Map()));
  let v = c.get(key); if (v === undefined) c.set(key, (v = f()));
  return v;
};
const pct = (a: Float64Array, idx: number[], q: number) => {
  const v = idx.map((i) => a[i]).sort((x, y) => x - y);
  return v.length ? v[Math.min(v.length - 1, Math.floor(q * v.length))] : 0;
};

function polyPath(pts: [number, number][]) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(wx(x), wy(y)) : ctx.moveTo(wx(x), wy(y))));
  ctx.closePath();
}

function drawGeometry() {
  for (const s of scene.shapes) { polyPath(s.pts); ctx.fillStyle = s.mode === "add" ? "#dfe5ee" : "#ffffff"; ctx.fill(); }
  for (const s of scene.shapes) {
    polyPath(s.pts);
    ctx.setLineDash(s.mode === "cut" ? [5, 4] : []);
    ctx.strokeStyle = sel?.id === s.id ? "#1f5fbf" : "#6b7686";
    ctx.lineWidth = sel?.id === s.id ? 2.5 : 1.2;
    ctx.stroke(); ctx.setLineDash([]);
  }
}

/** armadura da cena; com resultado não linear, cada trecho é colorido por σ/fy (tração: verde→vermelho; compressão: azul) */
function drawBars(m?: Msg) {
  const bars = scene.bars ?? [];
  if (!bars.length) return;
  ctx.save(); ctx.lineCap = "round"; ctx.lineJoin = "round";
  bars.forEach((b, k) => {
    ctx.beginPath(); b.path.forEach(([x, y], i) => (i ? ctx.lineTo(wx(x), wy(y)) : ctx.moveTo(wx(x), wy(y))));
    ctx.strokeStyle = m?.nl ? "rgba(40,40,40,.55)" : "#8a2a1d"; ctx.lineWidth = m?.nl ? 1 : Math.max(1.5, Math.min(4, Math.sqrt(b.areaCm2)));
    ctx.stroke();
    const samples = m?.nl?.barSamples[k];
    if (!samples) return;
    const Afy = b.areaCm2 * 1e-4 * b.fy * 1e3;
    for (const sp of samples) {
      const r = sp.N / Afy, a = Math.min(1, Math.abs(r));
      ctx.fillStyle = r >= 0 ? `hsl(${Math.round(120 - 120 * a)},80%,42%)` : `hsl(215,${Math.round(30 + 50 * a)}%,${Math.round(65 - 25 * a)}%)`;
      ctx.beginPath(); ctx.arc(wx(sp.x), wy(sp.y), Math.max(1.8, Math.min(3.4, Math.sqrt(b.areaCm2))), 0, 7); ctx.fill();
    }
  });
  ctx.restore();
}

const solidAt = (m: Msg, e: number) => m.mask[e] !== 0 && m.rho[e] > 0.5;

function drawResult(m: Msg, mode: string, showMesh: boolean) {
  const { nelx, nely, h, ox, oy } = m.dims;
  const top = oy + nely * h, px = view.s * h;
  const X = (i: number) => wx(ox + i * h), Y = (j: number) => wy(top - j * h);
  const solidIdx: number[] = [];
  for (let e = 0; e < m.mask.length; e++) if (solidAt(m, e)) solidIdx.push(e);

  if (mode === "nlconc" || mode === "nlcrack") {
    const nl = m.nl;
    for (let i = 0; i < nelx; i++) for (let j = 0; j < nely; j++) {
      const e = i * nely + j;
      if (m.mask[e] === 0) continue;
      let col = "#e9edf2";
      if (nl && mode === "nlconc") {
        const r = Math.min(1.2, nl.epsComp[e] / nl.epsCu);
        col = r < 0.02 ? "#e9edf2" : r >= 1 ? "#7b1e12" : `rgb(255,${Math.round(238 - 205 * r)},${Math.round(232 - 215 * r)})`;
      } else if (nl && mode === "nlcrack") {
        col = nl.epsTens[e] > 2e-5 ? "#bcd6f2" : "#e9edf2";
      }
      ctx.fillStyle = col; ctx.fillRect(X(i), Y(j), px + 0.6, px + 0.6);
      if (showMesh) { ctx.strokeStyle = "rgba(0,0,0,.25)"; ctx.lineWidth = 0.5; ctx.strokeRect(X(i), Y(j), px, px); }
    }
    ctx.fillStyle = "#1c2430"; ctx.font = "12px system-ui";
    ctx.fillText(nl ? (mode === "nlconc" ? `Deformação de compressão média / εcu (${(nl.epsCu * 1000).toFixed(1)} ‰): cinza → vermelho; marrom = esmagado` : "Azul: concreto fissurado (tração principal > 0) · barras: verde → vermelho = 0 → 100 % de fy; azul = compressão") : "Rode a análise não linear.", 14, cv.height - 30);
    return;
  }

  if (mode === "csfm") {
    const cz = csfmData.get(m);
    for (let i = 0; i < nelx; i++) for (let j = 0; j < nely; j++) {
      const e = i * nely + j;
      if (m.mask[e] === 0) continue;
      ctx.fillStyle = "#e6eaf0"; ctx.fillRect(X(i), Y(j), px + 0.6, px + 0.6);
    }
    if (!cz) { ctx.fillStyle = "#1c2430"; ctx.font = "13px system-ui"; ctx.fillText("Clique em “CSFM — armadura sugerida” para calcular.", 20, 24); return; }
    for (const z of cz.zones) {
      for (const e of z.elements) {
        const i = Math.floor(e / nely), j = e % nely, a = Math.min(1, m.field.s1[e] / (cz.smax || 1));
        ctx.fillStyle = `rgba(192,57,43,${0.25 + 0.6 * a})`; ctx.fillRect(X(i), Y(j), px + 0.6, px + 0.6);
      }
    }
    ctx.font = "bold 12px system-ui";
    for (const z of cz.zones) {
      const x = wx(z.cx), y = wy(z.cy), tx = Math.cos(z.theta) * 40, ty = -Math.sin(z.theta) * 40;
      ctx.strokeStyle = "#7b1e12"; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(x - tx, y - ty); ctx.lineTo(x + tx, y + ty); ctx.stroke();
      ctx.fillStyle = "#1c2430";
      ctx.fillText(`Z${z.id + 1}: T≈${z.T.toFixed(0)} kN · As≈${z.As.toFixed(1)} cm²`, x - 60, y - 10);
    }
    return;
  }

  if (mode === "topo") {
    for (let i = 0; i < nelx; i++) for (let j = 0; j < nely; j++) {
      const e = i * nely + j;
      if (m.mask[e] === 0) continue;
      const g = Math.round(255 - 70 * m.rho[e]);
      ctx.fillStyle = `rgb(${g},${g},${g})`;
      ctx.fillRect(X(i), Y(j), px + 0.6, px + 0.6);
    }
    drawTrajectories(m, X, Y, px, solidIdx);
    return;
  }
  let umax = 0;
  for (let d = 0; d < m.u.length; d++) umax = Math.max(umax, Math.abs(m.u[d]));
  const amp = umax > 0 ? (0.06 * Math.max(nelx, nely) * h) / umax : 0;
  const def = mode === "def";
  const sv = mode === "s1" ? m.field.s1 : m.field.s2;
  // escala robusta: percentil 97 (um pico no apoio não pode apagar o resto)
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
      ctx.fillStyle = `hsl(${240 - 240 * (Math.hypot(m.u[2 * n], m.u[2 * n + 1]) / (umax || 1))},70%,60%)`;
    } else ctx.fillStyle = diverge(sv[e] / smax);
    ctx.fill();
    if (showMesh) { ctx.strokeStyle = "rgba(0,0,0,.25)"; ctx.lineWidth = 0.5; ctx.stroke(); }
  }
}

function drawTrajectories(m: Msg, X: (i: number) => number, Y: (j: number) => number, px: number, solidIdx: number[]) {
  const { nelx, nely } = m.dims;
  const { s1, s2, theta } = m.field;
  // tração e compressão com escalas SEPARADAS e robustas (percentil 95) — antes, o pico de compressão
  // sob a carga/apoio zerava visualmente a tração.
  const tmax = Math.max(1e-12, cachedPct(m, "t", () => pct(s1, solidIdx, 0.95))), cmax = Math.max(1e-12, cachedPct(m, "c", () => -pct(s2, solidIdx, 0.05)));
  const step = Math.max(1, Math.round(9 / px));
  const half = Math.max(4, px * step * 0.8);
  ctx.lineWidth = 1.4;
  const seg = (cx: number, cy: number, ang: number, s: number) => {
    const ref = s > 0 ? tmax : cmax;
    if (Math.abs(s) < 0.08 * ref) return;
    const k = Math.min(1, Math.abs(s) / ref * 0.7 + 0.3);
    const dx = Math.cos(ang) * half * k, dy = -Math.sin(ang) * half * k;
    ctx.strokeStyle = s > 0 ? "#c0392b" : "#1f5fbf";
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

function arrowHead(x: number, y: number, ang: number, sz = 12) {
  ctx.beginPath(); ctx.moveTo(x, y);
  ctx.lineTo(x - sz * Math.cos(ang - 0.4), y - sz * Math.sin(ang - 0.4));
  ctx.lineTo(x - sz * Math.cos(ang + 0.4), y - sz * Math.sin(ang + 0.4));
  ctx.closePath(); ctx.fill();
}

function drawLineLoad(l: LoadSpec & { x1: number; y1: number }) {
  const F = Math.hypot(l.fx, l.fy) || 1, ux = l.fx / F, uy = l.fy / F;
  const x0 = wx(l.x), y0 = wy(l.y), x1 = wx(l.x1), y1 = wy(l.y1), len = Math.hypot(x1 - x0, y1 - y0), A = 38;
  const selected = sel?.id === l.id;
  ctx.strokeStyle = selected ? "#1f5fbf" : "#d35400"; ctx.fillStyle = ctx.strokeStyle;
  ctx.lineWidth = selected ? 3 : 2;
  const n = Math.max(2, Math.round(len / 26));
  const ox = -ux * A, oy = uy * A; // origem das setas: contra o sentido da força
  ctx.beginPath(); ctx.moveTo(x0 + ox, y0 + oy); ctx.lineTo(x1 + ox, y1 + oy); ctx.stroke();
  for (let k = 0; k <= n; k++) {
    const bx = x0 + ((x1 - x0) * k) / n, by = y0 + ((y1 - y0) * k) / n;
    ctx.beginPath(); ctx.moveTo(bx + ox, by + oy); ctx.lineTo(bx, by); ctx.stroke();
    arrowHead(bx, by, Math.atan2(-oy, -ox), 9);
  }
  ctx.font = "12px system-ui"; ctx.fillStyle = "#1c2430";
  ctx.fillText(`${l.id}: ${lineLoadIntensity(l).toFixed(1)} kN/m (Σ ${l.fx ? `Fx=${l.fx} ` : ""}${l.fy ? `Fy=${l.fy} ` : ""}kN)`, (x0 + x1) / 2 - 60, (y0 + y1) / 2 + oy - 8);
}

function drawLoad(l: LoadSpec) {
  if (isLineLoad(l)) { drawLineLoad(l); return; }
  const F = Math.hypot(l.fx, l.fy);
  const ux = F ? l.fx / F : 0, uy = F ? l.fy / F : -1;
  const x = wx(l.x), y = wy(l.y), L = 56;
  const tx = x - ux * L, ty = y + uy * L;
  const selected = sel?.id === l.id;
  ctx.strokeStyle = selected ? "#1f5fbf" : "#d35400"; ctx.fillStyle = ctx.strokeStyle;
  ctx.lineWidth = selected ? 3.5 : 2.5;
  if (scene.bearing > 0) { // placa de largura fixa, perpendicular à força
    const hw = (scene.bearing * view.s) / 2;
    ctx.beginPath(); ctx.moveTo(x + uy * hw, y + ux * hw); ctx.lineTo(x - uy * hw, y - ux * hw); ctx.stroke();
  }
  ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(x, y); ctx.stroke();
  arrowHead(x, y, Math.atan2(y - ty, x - tx));
  ctx.font = "12px system-ui"; ctx.fillStyle = "#1c2430";
  ctx.fillText(`${l.id}: ${l.fx ? `Fx=${l.fx} ` : ""}${l.fy ? `Fy=${l.fy} ` : ""}kN`, tx + 6, ty - 6);
}

function drawSupport(s: SupportSpec) {
  const x0 = wx(s.x0), y0 = wy(s.y0), x1 = wx(s.x1), y1 = wy(s.y1);
  const selected = sel?.id === s.id;
  const kind = supportKind(s);
  const col = selected ? "#1f5fbf" : kind === "fixo" ? "#1e8449" : "#6c3483";
  ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = selected ? 4 : 3;
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  const sh = scene.shapes.filter((q) => q.mode === "add").flatMap((q) => q.pts);
  const cx = sh.reduce((a, p) => a + wx(p[0]), 0) / (sh.length || 1), cy = sh.reduce((a, p) => a + wy(p[1]), 0) / (sh.length || 1);
  const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy);
  let nx = len ? -dy / len : 0, ny = len ? dx / len : 1;
  if (len === 0 || (((x0 + x1) / 2 - cx) * nx + ((y0 + y1) / 2 - cy) * ny < 0)) { nx = -nx; ny = -ny; }
  if (len === 0) { nx = 0; ny = 1; }
  const n = Math.max(1, Math.round(len / 22));
  for (let k = 0; k <= (len === 0 ? 0 : n); k++) {
    const t = len === 0 ? 0 : k / n, bx = x0 + dx * t, by = y0 + dy * t, w = 7;
    const tipx = bx + nx * 14, tipy = by + ny * 14;
    ctx.beginPath(); ctx.moveTo(bx, by);
    ctx.lineTo(tipx - ny * w, tipy + nx * w); ctx.lineTo(tipx + ny * w, tipy - nx * w); ctx.closePath();
    if (kind === "fixo") ctx.fill(); else { ctx.lineWidth = 1.5; ctx.stroke(); ctx.beginPath(); ctx.arc(bx + nx * 18, by + ny * 18, 3, 0, 7); ctx.stroke(); }
  }
  ctx.font = "11px system-ui"; ctx.fillStyle = "#1c2430";
  ctx.fillText(`${s.id} (${kind === "fixo" ? "fixo" : kind === "movel-x" ? "móvel ↔" : "móvel ↕"})`, (x0 + x1) / 2 + nx * 34 - 20, (y0 + y1) / 2 + ny * 34 + (ny > 0 ? 8 : -2));
}

function drawReactions(m: Msg) {
  ctx.font = "bold 12px system-ui";
  for (const r of m.reactions) {
    if (Math.hypot(r.rx, r.ry) < 1e-6) continue;
    const x = wx(r.x), y = wy(r.y), mag = Math.hypot(r.rx, r.ry), L = 50;
    const ux = r.rx / mag, uy = r.ry / mag;
    const x0 = x - ux * L, y0 = y + uy * L;
    ctx.strokeStyle = "#0e7c66"; ctx.fillStyle = "#0e7c66"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x, y); ctx.stroke();
    arrowHead(x, y, Math.atan2(y - y0, x - x0));
    ctx.fillText(`R(${r.id}): ${Math.abs(r.rx) > 0.05 ? `Rx=${r.rx.toFixed(1)} ` : ""}Ry=${r.ry.toFixed(1)} kN`, x0 - 20, y0 + (uy > 0 ? 14 : -6));
  }
}

let drag: null | { type: string; start: [number, number]; cur: [number, number]; orig?: any; carried?: { kind: "load" | "support"; id: string; key: string; o: any }[] } = null;
let polyDraft: [number, number][] = [];
let hover: [number, number] = [0, 0];
let hoverGrip: [number, number] | null = null;

function draw() {
  ctx.clearRect(0, 0, cv.width, cv.height);
  const frame = frames[+slider.value];
  if (frame) {
    drawResult(frame, $<HTMLSelectElement>("view").value, $<HTMLInputElement>("showMesh").checked);
    for (const s of scene.shapes) { polyPath(s.pts); ctx.strokeStyle = "#6b7686"; ctx.lineWidth = 1; ctx.setLineDash(s.mode === "cut" ? [5, 4] : []); ctx.stroke(); ctx.setLineDash([]); }
  } else drawGeometry();
  drawBars(frame);
  for (const s of scene.supports) drawSupport(s);
  for (const l of scene.loads) drawLoad(l);
  if (frame) drawReactions(frame);

  // grips nos LADOS (contorno): realça os lados e marca o ponto de encaixe sob o cursor
  if (tool === "load" || tool === "qload" || tool === "support" || drag?.type === "moveLoad") {
    ctx.strokeStyle = "rgba(31,95,191,.55)"; ctx.lineWidth = 3; ctx.setLineDash([2, 4]);
    for (const [x0, y0, x1, y1] of sceneEdges(scene)) { ctx.beginPath(); ctx.moveTo(wx(x0), wy(y0)); ctx.lineTo(wx(x1), wy(y1)); ctx.stroke(); }
    ctx.setLineDash([]);
    for (const [x, y] of sceneVertices(scene)) { ctx.fillStyle = "#fff"; ctx.strokeStyle = "#1f5fbf"; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.rect(wx(x) - 3, wy(y) - 3, 6, 6); ctx.fill(); ctx.stroke(); }
    if (hoverGrip) { ctx.fillStyle = "#1f5fbf"; ctx.beginPath(); ctx.arc(wx(hoverGrip[0]), wy(hoverGrip[1]), 6, 0, 7); ctx.fill(); }
  }
  ctx.strokeStyle = "#1f5fbf"; ctx.lineWidth = 1.5; ctx.setLineDash([6, 3]);
  if (drag && (tool === "rect+" || tool === "rect-")) {
    const [a, b] = [drag.start, drag.cur];
    ctx.strokeRect(wx(Math.min(a[0], b[0])), wy(Math.max(a[1], b[1])), Math.abs(b[0] - a[0]) * view.s, Math.abs(b[1] - a[1]) * view.s);
  }
  if (drag && (tool === "support" || tool === "qload")) { ctx.beginPath(); ctx.moveTo(wx(drag.start[0]), wy(drag.start[1])); ctx.lineTo(wx(drag.cur[0]), wy(drag.cur[1])); ctx.stroke(); }
  if (polyDraft.length) {
    ctx.beginPath(); polyDraft.forEach(([x, y], i) => (i ? ctx.lineTo(wx(x), wy(y)) : ctx.moveTo(wx(x), wy(y)))); ctx.lineTo(wx(hover[0]), wy(hover[1])); ctx.stroke();
  }
  ctx.setLineDash([]);
}

/* ───────────────────────── edição ───────────────────────── */
const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
const snap = (v: number) => r4(Math.round(v / scene.h) * scene.h);

function changed(clearResults = true) {
  if (clearResults) { curToken++; worker.postMessage({ stop: true }); $("run").textContent = "Otimizar"; $("nl").textContent = NL_LABEL; $("nlOut").innerHTML = ""; frames.length = 0; slider.max = "0"; $("stats").textContent = ""; $("csfmOut").innerHTML = ""; renderReactions(); }
  $("msg").innerHTML = "";
  localStorage.setItem("stm-scene", JSON.stringify(scene));
  renderList(); draw();
}
const evPos = (ev: MouseEvent): [number, number] => { const r = cv.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; };

function distSeg(px: number, py: number, x0: number, y0: number, x1: number, y1: number) {
  const dx = x1 - x0, dy = y1 - y0, L2 = dx * dx + dy * dy;
  const t = L2 ? Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / L2)) : 0;
  return Math.hypot(px - x0 - t * dx, py - y0 - t * dy);
}

/**
 * Ponto de encaixe (grip) sobre os LADOS da geometria mais próximo do cursor. Ao longo do lado, o ponto é
 * quantizado ao tamanho do elemento (e vai às pontas quando perto delas). `only` restringe a um lado.
 */
function edgeGrip(px: number, py: number, maxPx = 20, only?: number): { x: number; y: number; edge: number } | null {
  const [wxm, wym] = toWorld(px, py);
  const q = nearestEdgePoint(scene, wxm, wym, only);
  if (!q || q.dist * view.s > maxPx) return null;
  const e = sceneEdges(scene)[q.edge], L = Math.hypot(e[2] - e[0], e[3] - e[1]);
  let d = q.t * L;
  if (d < 0.5 * scene.h) d = 0; else if (L - d < 0.5 * scene.h) d = L; else d = Math.round(d / scene.h) * scene.h;
  const t = L ? Math.min(1, d / L) : 0;
  return { x: r4(e[0] + t * (e[2] - e[0])), y: r4(e[1] + t * (e[3] - e[1])), edge: q.edge };
}
/**
 * Trecho de carga (placa de largura `bearing`) centrado em (cx,cy) sobre o lado `edge`, cortado nas pontas do lado.
 * Devolve null se `bearing` = 0 (carga pontual).
 */
function plateOnEdge(edge: number, cx: number, cy: number): { x: number; y: number; x1: number; y1: number } | null {
  const e = sceneEdges(scene)[edge];
  if (!e || !(scene.bearing > 0)) return null;
  const L = Math.hypot(e[2] - e[0], e[3] - e[1]); if (!L) return null;
  const ux = (e[2] - e[0]) / L, uy = (e[3] - e[1]) / L, d = (cx - e[0]) * ux + (cy - e[1]) * uy, hw = scene.bearing / 2;
  const lo = Math.max(0, d - hw), hi = Math.min(L, d + hw);
  if (hi - lo < 1e-6) return null;
  return { x: r4(e[0] + lo * ux), y: r4(e[1] + lo * uy), x1: r4(e[0] + hi * ux), y1: r4(e[1] + hi * uy) };
}
/** projeta (x,y) sobre o lado mais próximo (para valores digitados) */
function projectToEdge(x: number, y: number): [number, number] {
  const q = nearestEdgePoint(scene, x, y);
  return q ? [r4(q.x), r4(q.y)] : [x, y];
}
function onPoly(pts: [number, number][], x: number, y: number) {
  for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; if (distSeg(x, y, a[0], a[1], b[0], b[1]) < 2e-3) return true; }
  return false;
}

function hit(px: number, py: number): Sel {
  for (const l of scene.loads) {
    if (isLineLoad(l)) { if (distSeg(px, py, wx(l.x), wy(l.y), wx(l.x1), wy(l.y1)) < 40) return { kind: "load", id: l.id }; continue; }
    const F = Math.hypot(l.fx, l.fy) || 1, ux = l.fx / F, uy = l.fy / F, x = wx(l.x), y = wy(l.y);
    if (distSeg(px, py, x, y, x - ux * 56, y + uy * 56) < 10) return { kind: "load", id: l.id };
  }
  for (const s of scene.supports) if (distSeg(px, py, wx(s.x0), wy(s.y0), wx(s.x1), wy(s.y1)) < 12) return { kind: "support", id: s.id };
  const [x, y] = toWorld(px, py);
  for (let i = scene.shapes.length - 1; i >= 0; i--) if (pointInPolygon(x, y, scene.shapes[i].pts)) return { kind: "shape", id: scene.shapes[i].id };
  return null;
}

/** só o material (modo "add") é travado; aberturas, forças e apoios continuam editáveis */
const shapeLocked = (id: string) => geomLocked && scene.shapes.find((q) => q.id === id)?.mode === "add";
const same = (a: [number, number], b: [number, number]) => Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(b[1] - a[1]) < 1e-6;
/** depois de alterar a geometria, recoloca forças/apoios no lado mais próximo */
function reproject() {
  for (const l of scene.loads) {
    const p = projectToEdge(l.x, l.y); l.x = p[0]; l.y = p[1];
    if (l.x1 !== undefined && l.y1 !== undefined) { const q = projectToEdge(l.x1, l.y1); l.x1 = q[0]; l.y1 = q[1]; }
  }
  for (const s2 of scene.supports) { const a = projectToEdge(s2.x0, s2.y0), b = projectToEdge(s2.x1, s2.y1); s2.x0 = a[0]; s2.y0 = a[1]; s2.x1 = b[0]; s2.y1 = b[1]; }
}
const esc = (t: string) => t.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const toast = (msg: string) => { $("msg").innerHTML = `<div class="warn">${msg}</div>`; setTimeout(() => { if ($("msg").textContent === msg) $("msg").innerHTML = ""; }, 3500); };
const clearFrames = () => { curToken++; worker.postMessage({ stop: true }); $("run").textContent = "Otimizar"; $("nl").textContent = NL_LABEL; $("nlOut").innerHTML = ""; $("csfmOut").innerHTML = ""; if (frames.length) { frames.length = 0; slider.max = "0"; renderReactions(); } };

let panning: null | { x: number; y: number } = null;
cv.addEventListener("contextmenu", (e) => e.preventDefault());
cv.addEventListener("mousedown", (ev) => {
  const [px, py] = evPos(ev);
  if (ev.button === 2 || ev.button === 1) { panning = { x: px, y: py }; return; }
  const [wxm, wym] = toWorld(px, py);
  const p: [number, number] = [snap(wxm), snap(wym)];
  if (tool === "select") {
    sel = hit(px, py);
    renderList(); renderProps();
    if (sel && sel.kind === "load") drag = { type: "moveLoad", start: [wxm, wym], cur: [wxm, wym] };
    else if (sel && sel.kind === "shape" && !shapeLocked(sel.id)) {
      const sh = scene.shapes.find((s) => s.id === sel!.id)!;
      const o = sh.pts.map((q) => [...q] as [number, number]);
      drag = { type: "moveShape", start: [wxm, wym], cur: [wxm, wym], orig: { pts: o, loads: scene.loads.map((l) => ({ ...l })), sups: scene.supports.map((s) => ({ ...s })) } };
    } else if (sel && sel.kind === "shape") toast("Geometria principal travada — só aberturas, forças e apoios podem ser movidos.");
  } else if (tool === "load" || tool === "qload" || tool === "support") {
    const g = edgeGrip(px, py, 28);
    if (!g) { toast("Clique sobre um lado (contorno) da geometria — as linhas pontilhadas azuis."); return; }
    if (tool === "support" || tool === "qload") drag = { type: "support", start: [g.x, g.y], cur: [g.x, g.y] };
  } else if (geomLocked && (tool === "rect+" || tool === "poly+")) toast("Geometria principal travada.");
  else if (tool === "poly+" || tool === "poly-") polyDraft.push(p);
  else drag = { type: tool, start: p, cur: p };
  draw();
});
cv.addEventListener("mousemove", (ev) => {
  const [px, py] = evPos(ev);
  if (panning) { view.ox += px - panning.x; view.oy += py - panning.y; panning = { x: px, y: py }; draw(); return; }
  const [wxm, wym] = toWorld(px, py);
  hover = [snap(wxm), snap(wym)];
  const gr = tool === "load" || tool === "qload" || tool === "support" || drag?.type === "moveLoad" ? edgeGrip(px, py, 40) : null;
  hoverGrip = gr ? [gr.x, gr.y] : null;
  if (drag) {
    if (drag.type === "moveLoad" && sel) {
      const v = edgeGrip(px, py, 60);
      if (v) {
        const l = scene.loads.find((q) => q.id === sel!.id)!, pl = isLineLoad(l) ? plateOnEdge(v.edge, v.x, v.y) : null;
        if (pl) Object.assign(l, pl); else { l.x = v.x; l.y = v.y; delete l.x1; delete l.y1; }
        clearFrames();
      }
    } else if (drag.type === "moveShape" && sel) {
      clearFrames();
      const dx = snap(wxm - drag.start[0]), dy = snap(wym - drag.start[1]);
      const o = drag.orig;
      const sh = scene.shapes.find((q) => q.id === sel!.id)!;
      sh.pts = o.pts.map((q: number[]) => [r4(q[0] + dx), r4(q[1] + dy)]);
      // forças/apoios que estão sobre os lados desta forma acompanham
      scene.loads.forEach((l, i) => {
        const O = o.loads[i];
        if (onPoly(o.pts, O.x, O.y)) { l.x = r4(O.x + dx); l.y = r4(O.y + dy); }
        if (O.x1 !== undefined && onPoly(o.pts, O.x1, O.y1)) { l.x1 = r4(O.x1 + dx); l.y1 = r4(O.y1 + dy); }
      });
      scene.supports.forEach((s, i) => {
        const O = o.sups[i];
        if (onPoly(o.pts, O.x0, O.y0)) { s.x0 = r4(O.x0 + dx); s.y0 = r4(O.y0 + dy); }
        if (onPoly(o.pts, O.x1, O.y1)) { s.x1 = r4(O.x1 + dx); s.y1 = r4(O.y1 + dy); }
      });
    } else if (drag.type === "support") {
      // o apoio fica sobre UM lado: entre os lados que contêm o ponto inicial, usa o mais próximo do cursor
      const edges = sceneEdges(scene);
      let best: { x: number; y: number } | null = null, bd = Infinity;
      edges.forEach((e, i) => {
        if (distSeg(drag!.start[0], drag!.start[1], e[0], e[1], e[2], e[3]) > 2e-3) return;
        const g = edgeGrip(px, py, 1e9, i);
        if (g) { const d = Math.hypot(wx(g.x) - px, wy(g.y) - py); if (d < bd) { bd = d; best = g; } }
      });
      if (best) drag.cur = [(best as any).x, (best as any).y];
    }
    else drag.cur = hover;
  }
  draw();
});
window.addEventListener("mouseup", () => {
  panning = null;
  if (!drag) return;
  const d = drag; drag = null;
  if (d.type === "moveLoad" || d.type === "moveShape") { changed(); renderProps(); return; }
  const [a, b] = [d.start, d.cur];
  if (tool === "rect+" || tool === "rect-") {
    const w = Math.abs(b[0] - a[0]), h = Math.abs(b[1] - a[1]);
    if (w >= scene.h && h >= scene.h) {
      const s: Shape = { id: newId(tool === "rect+" ? "S" : "A"), mode: tool === "rect+" ? "add" : "cut", pts: rectPts(Math.min(a[0], b[0]), Math.min(a[1], b[1]), w, h) };
      scene.shapes.push(s); sel = { kind: "shape", id: s.id }; setTool("select");
    }
  } else if (tool === "qload") {
    let seg: { x: number; y: number; x1: number; y1: number } | null = { x: a[0], y: a[1], x1: b[0], y1: b[1] };
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < scene.h) { // clique simples: placa da largura configurada
      const q = nearestEdgePoint(scene, a[0], a[1]);
      seg = q ? plateOnEdge(q.edge, a[0], a[1]) : null;
    }
    if (!seg) { toast("Arraste ao longo de um lado (ou clique, com largura de placa > 0) para criar a carga distribuída."); drag = null; return; }
    const l: LoadSpec = { id: newId("Q"), ...seg, fx: 0, fy: -100 };
    scene.loads.push(l); sel = { kind: "load", id: l.id }; setTool("select"); changed(); renderProps(); focusForceField(); return;
  } else if (tool === "support") {
    const kind = $<HTMLSelectElement>("supKind").value as SupportKind;
    const s: SupportSpec = { id: newId("Ap"), x0: a[0], y0: a[1], x1: b[0], y1: b[1], ...supportFlags(kind) };
    scene.supports.push(s); sel = { kind: "support", id: s.id }; setTool("select");
  }
  changed(); renderProps();
});
cv.addEventListener("click", (ev) => {
  if (tool === "load" && ev.button === 0) {
    const [px, py] = evPos(ev), v = edgeGrip(px, py, 28);
    if (!v) return;
    const pl = plateOnEdge(v.edge, v.x, v.y);
    void pl; // a ferramenta "Força pontual" sempre cria uma força concentrada em um nó
    const l: LoadSpec = { id: newId("P"), x: v.x, y: v.y, fx: 0, fy: -100, point: true };
    scene.loads.push(l); sel = { kind: "load", id: l.id }; setTool("select"); changed(); renderProps(); focusForceField();
  }
});
function finishPoly() {
  if (polyDraft.length >= 3) {
    const add = tool === "poly+";
    const s: Shape = { id: newId(add ? "S" : "A"), mode: add ? "add" : "cut", pts: polyDraft.map((p) => [...p] as [number, number]) };
    scene.shapes.push(s); sel = { kind: "shape", id: s.id }; setTool("select"); changed(); renderProps();
  }
  polyDraft = []; draw();
}
cv.addEventListener("dblclick", (ev) => {
  if (tool.startsWith("poly")) { polyDraft.pop(); finishPoly(); return; }
  if (tool === "select") { const [px, py] = evPos(ev); const h2 = hit(px, py); if (h2?.kind === "load") { sel = h2; renderList(); renderProps(); focusForceField(); } }
});
window.addEventListener("keydown", (ev) => {
  const tag = (ev.target as HTMLElement).tagName;
  if (tag === "INPUT" || tag === "SELECT") return;
  if (ev.key === "Enter" && tool.startsWith("poly")) finishPoly();
  if (ev.key === "Escape") { polyDraft = []; drag = null; setTool("select"); draw(); }
  if ((ev.key === "Delete" || ev.key === "Backspace") && sel) {
    if (sel.kind === "shape" && shapeLocked(sel.id)) { toast("Geometria principal travada — destrave para excluir."); return; }
    scene.shapes = scene.shapes.filter((s) => s.id !== sel!.id);
    scene.loads = scene.loads.filter((s) => s.id !== sel!.id);
    scene.supports = scene.supports.filter((s) => s.id !== sel!.id);
    sel = null; changed(); renderProps();
  }
});
cv.addEventListener("wheel", (ev) => {
  ev.preventDefault();
  const [px, py] = evPos(ev), [x, y] = toWorld(px, py);
  view.s *= ev.deltaY < 0 ? 1.12 : 1 / 1.12;
  view.ox = px - x * view.s; view.oy = py + y * view.s;
  draw();
}, { passive: false });

/* ───────────────────────── barra de ferramentas ───────────────────────── */
const TOOLS: [Tool, string, boolean][] = [
  ["select", "Selecionar/mover", false], ["rect+", "▭ Retângulo", true], ["rect-", "▭ Abertura", false],
  ["poly+", "⬠ Polígono", true], ["poly-", "⬠ Abertura poligonal", false], ["load", "↓ Força pontual", false], ["qload", "⇊ Carga distribuída", false], ["support", "△ Apoio", false],
];
const tb = $("toolbar");
for (const [t, label, geo] of TOOLS) {
  const b = document.createElement("button"); b.textContent = label; b.dataset.tool = t; if (geo) b.dataset.geo = "1";
  b.onclick = () => { if (geo && geomLocked) { toast("Geometria principal travada — destrave para adicionar/alterar material (aberturas, forças e apoios continuam livres)."); return; } setTool(t); };
  tb.appendChild(b);
}
const lockBtn = document.createElement("button");
lockBtn.onclick = () => { geomLocked = !geomLocked; localStorage.setItem("stm-lock", geomLocked ? "1" : "0"); if (geomLocked && (tool === "rect+" || tool === "poly+")) setTool("select"); updateLock(); renderProps(); draw(); };
tb.appendChild(lockBtn);
function updateLock() {
  lockBtn.textContent = geomLocked ? "🔒 Geometria principal travada" : "🔓 Travar geometria principal";
  lockBtn.classList.toggle("on", geomLocked);
  tb.querySelectorAll<HTMLButtonElement>("button[data-geo]").forEach((b) => (b.disabled = geomLocked));
}
const fitBtn = document.createElement("button"); fitBtn.textContent = "Ajustar vista"; fitBtn.onclick = () => { fitView(); draw(); }; tb.appendChild(fitBtn);
const hintEl = document.createElement("small"); hintEl.style.color = "#6b7686"; tb.appendChild(hintEl);
const HINTS: Record<Tool, string> = {
  select: "Clique para selecionar; arraste para mover; duplo clique numa força para editar o valor. Botão direito: panorâmica. Roda: zoom.",
  "rect+": "Arraste para desenhar um retângulo de material.", "rect-": "Arraste para desenhar uma abertura.",
  "poly+": "Clique os vértices; duplo clique ou Enter fecha.", "poly-": "Clique os vértices da abertura; duplo clique ou Enter fecha.",
  qload: "Clique num LADO (placa da largura configurada) ou arraste ao longo dele (trecho livre); depois digite a resultante (kN) — a intensidade em kN/m aparece na tela.",
  load: "Clique sobre um LADO da geometria (linha pontilhada azul) para aplicar uma força concentrada em um ponto. Arraste para mover.", support: "Arraste ao longo de um lado para definir o apoio (ou clique num ponto do lado p/ apoio pontual).",
};
function setTool(t: Tool) {
  tool = t; polyDraft = []; hoverGrip = null;
  tb.querySelectorAll("button[data-tool]").forEach((b) => b.classList.toggle("on", (b as HTMLElement).dataset.tool === t));
  hintEl.textContent = HINTS[t];
  cv.style.cursor = t === "select" ? "default" : "crosshair";
  draw();
}

/* ───────────────────────── listas e propriedades ───────────────────────── */
function renderList() {
  const el = $("list"); el.innerHTML = "";
  const row = (kind: "shape" | "load" | "support", id: string, text: string) => {
    const d = document.createElement("div"); d.className = "item" + (sel?.id === id ? " sel" : ""); d.innerHTML = text;
    d.onclick = () => { sel = { kind, id }; renderList(); renderProps(); draw(); }; el.appendChild(d);
  };
  for (const s of scene.shapes) row("shape", s.id, `<b>${esc(s.id)}</b> ${s.mode === "add" ? "material" : "abertura"} <small>${s.pts.length} vértices</small>`);
  for (const s of scene.supports) { const k = supportKind(s); row("support", s.id, `<b>${esc(s.id)}</b> apoio <small>${k === "fixo" ? "fixo" : k === "movel-x" ? "móvel (desliza em x)" : "móvel (desliza em y)"}</small>`); }
  for (const l of scene.loads) row("load", l.id, isLineLoad(l)
    ? `<b>${esc(l.id)}</b> carga distribuída <small>${lineLoadIntensity(l).toFixed(1)} kN/m · Σ Fx=${l.fx} Fy=${l.fy} kN</small>`
    : `<b>${esc(l.id)}</b> força <small>Fx=${l.fx} Fy=${l.fy} kN</small>`);
}

function num(label: string, val: number, on: (v: number) => void, step = 0.01, disabled = false, key = "") {
  const l = document.createElement("label"); l.textContent = label;
  const i = document.createElement("input"); i.type = "number"; i.step = String(step); i.value = String(val); i.disabled = disabled; if (key) i.dataset.key = key;
  i.oninput = () => { if (i.value !== "") { on(+i.value); changed(); } };
  l.appendChild(i); return l;
}
function chk(label: string, val: boolean, on: (v: boolean) => void, disabled = false) {
  const l = document.createElement("label"); l.className = "chk";
  const i = document.createElement("input"); i.type = "checkbox"; i.checked = val; i.disabled = disabled;
  i.onchange = () => { on(i.checked); changed(); renderProps(); };
  l.append(i, label); return l;
}
/** campos x,y de um ponto que precisa ficar sobre um lado: o valor digitado é projetado no lado mais próximo */
function pointFields(label: string, get: () => [number, number], set: (x: number, y: number) => void): HTMLElement[] {
  const mk = (axis: 0 | 1) => {
    const l = document.createElement("label"); l.textContent = `${label} ${axis ? "y" : "x"} (m)`;
    const i = document.createElement("input"); i.type = "number"; i.step = "0.01"; i.value = String(get()[axis]);
    i.onchange = () => {
      const c = get(); c[axis] = +i.value;
      const p = projectToEdge(c[0], c[1]); set(p[0], p[1]); changed(); renderProps();
    };
    l.appendChild(i); return l;
  };
  return [mk(0), mk(1)];
}

/** leva o usuário ao campo do valor da força (Fy) */
function focusForceField() {
  const el = document.querySelector<HTMLInputElement>('#props input[data-key="fy"]');
  if (el) { el.scrollIntoView({ block: "center", behavior: "smooth" }); el.focus(); el.select(); }
}

function renderProps() {
  const el = $("props"); el.innerHTML = "";
  if (!sel) return;
  const head = document.createElement("h2");
  head.textContent = `Item selecionado: ${sel.id} (${sel.kind === "load" ? "força — digite o valor abaixo" : sel.kind === "support" ? "apoio" : "forma"})`;
  head.style.color = "#1f5fbf";
  el.appendChild(head);
  const g = document.createElement("div"); g.className = "grid2";
  if (sel.kind === "load") {
    const l = scene.loads.find((q) => q.id === sel!.id); if (!l) return;
    const line = isLineLoad(l);
    const tl = document.createElement("label"); tl.textContent = "Tipo de carga"; tl.style.gridColumn = "1 / 3";
    const ts = document.createElement("select");
    ts.add(new Option("Pontual (concentrada em um nó)", "point")); ts.add(new Option("Uniformemente distribuída (kN/m)", "line"));
    ts.value = line ? "line" : "point";
    ts.onchange = () => {
      if (ts.value === "line" && !line) {
        const q = nearestEdgePoint(scene, l.x, l.y), pl = q ? plateOnEdge(q.edge, l.x, l.y) : null;
        if (!pl) { toast("Defina a largura da placa (> 0) para distribuir a carga."); ts.value = "point"; return; }
        Object.assign(l, pl); delete l.point;
      } else if (ts.value === "point" && line) {
        const mx = r4((l.x + l.x1!) / 2), my = r4((l.y + l.y1!) / 2);
        const ll: LoadSpec = l; ll.x = mx; ll.y = my; delete ll.x1; delete ll.y1; ll.point = true;
      }
      changed(); renderProps();
    };
    tl.appendChild(ts); g.append(tl);
    const pf = line
      ? [...pointFields("Início", () => [l.x, l.y], (x, y) => { l.x = x; l.y = y; }), ...pointFields("Fim", () => [l.x1!, l.y1!], (x, y) => { l.x1 = x; l.y1 = y; })]
      : pointFields("Posição", () => [l.x, l.y], (x, y) => { l.x = x; l.y = y; });
    const tot = line ? " — RESULTANTE" : "";
    g.append(...pf, num(`Fx — horizontal (kN)${tot}, + para a direita`, l.fx, (v2) => (l.fx = v2), 10, false, "fx"), num(`Fy — vertical (kN)${tot}, − para baixo`, l.fy, (v2) => (l.fy = v2), 10, false, "fy"));
    const info = document.createElement("small"); info.className = "note"; info.style.gridColumn = "1 / 3";
    info.textContent = line
      ? `Carga distribuída uniforme: ${lineLoadIntensity(l).toFixed(1)} kN/m sobre ${Math.hypot(l.x1! - l.x, l.y1! - l.y).toFixed(3)} m (a resultante é o que você digita).`
      : `Força concentrada em um nó. Digite x,y: o ponto é projetado no lado mais próximo. (Atenção: força pontual gera pico de tensão no nó; use carga distribuída para representar uma placa.)`;
    g.append(info);
  } else if (sel.kind === "support") {
    const s = scene.supports.find((q) => q.id === sel!.id); if (!s) return;
    const tl = document.createElement("label"); tl.textContent = "Tipo de apoio"; tl.style.gridColumn = "1 / 3";
    const ts = document.createElement("select");
    ts.add(new Option("Fixo (restringe ux e uy)", "fixo")); ts.add(new Option("Móvel — desliza em x (restringe só uy)", "movel-x")); ts.add(new Option("Móvel — desliza em y (restringe só ux)", "movel-y"));
    ts.value = supportKind(s);
    ts.onchange = () => { Object.assign(s, supportFlags(ts.value as SupportKind)); changed(); };
    tl.appendChild(ts);
    g.append(tl, ...pointFields("Início", () => [s.x0, s.y0], (x, y) => { s.x0 = x; s.y0 = y; }), ...pointFields("Fim", () => [s.x1, s.y1], (x, y) => { s.x1 = x; s.y1 = y; }));
  } else {
    const s = scene.shapes.find((q) => q.id === sel!.id); if (!s) return;
    const lab = document.createElement("label"); lab.style.gridColumn = "1 / 3"; const lk = shapeLocked(s.id);
    lab.textContent = "Vértices (x,y; x,y; …) em m" + (lk ? " — travado" : "");
    const inp = document.createElement("input"); inp.type = "text"; inp.value = s.pts.map((p) => `${p[0]},${p[1]}`).join("; "); inp.disabled = lk;
    inp.onchange = () => {
      const pts = inp.value.split(";").map((t) => t.split(",").map(Number)).filter((p) => p.length === 2 && p.every(Number.isFinite)) as [number, number][];
      if (pts.length >= 3) {
        s.pts = pts; reproject(); changed();
      }
    };
    lab.appendChild(inp); g.append(lab);
    g.append(chk("é abertura (subtrai)", s.mode === "cut", (v) => (s.mode = v ? "cut" : "add"), lk));
  }
  el.appendChild(g);
}

/* ───────────────────────── reações / STM ───────────────────────── */
function renderReactions() {
  const el = $("reactions"); const m = frames[+slider.value];
  if (!m) { el.innerHTML = ""; return; }
  const sum = m.reactions.reduce((a, r) => ({ x: a.x + r.rx, y: a.y + r.ry }), { x: 0, y: 0 });
  el.innerHTML = `<h2>Reações de apoio</h2>` +
    m.reactions.map((r) => `<div class="item"><b>${esc(r.id)}</b> <small>Rx=${r.rx.toFixed(1)} · Ry=${r.ry.toFixed(1)} kN</small></div>`).join("") +
    `<div class="item"><small>ΣR = (${sum.x.toFixed(1)}; ${sum.y.toFixed(1)}) · resíduo de equilíbrio (${m.residual.x.toFixed(3)}; ${m.residual.y.toFixed(3)}) kN</small></div>`;
}
function renderCsfm(m: Msg) {
  const cz = csfmData.get(m), el = $("csfmOut");
  if (!cz) { el.innerHTML = ""; return; }
  const tot = cz.zones.reduce((a, z) => a + z.As, 0);
  el.innerHTML = cz.zones.length
    ? `<b>Zonas tracionadas</b> (σ1 &gt; ${CSFM_DEFAULTS.threshold * 100}% da tração máx. ≈ ${(cz.smax / 1000).toFixed(2)} MPa) · fyd = ${(cz.fyd / 1000).toFixed(0)} MPa<br>` +
      cz.zones.map((z) => `Z${z.id + 1}: T ≈ ${z.T.toFixed(0)} kN, As ≈ ${z.As.toFixed(1)} cm², direção ${((z.theta * 180) / Math.PI).toFixed(0)}°`).join("<br>") +
      `<br>ΣAs ≈ ${tot.toFixed(1)} cm² · <i>estimativa linear — não é a verificação CSFM completa (sem não linearidade/ELS)</i>`
    : "Nenhuma zona tracionada relevante.";
}
$("csfm").onclick = () => { pendingCsfm = true; frames.length = 0; slider.max = "0"; $("msg").innerHTML = ""; send({ mode: "elastic", scene }); };

/* ───────────────────────── análise não linear (Nível 2) ───────────────────────── */
const MODOS: Record<string, string> = {
  CC: "esmagamento do concreto (ou perda de equilíbrio com o concreto no patamar)", FR: "ruptura da armadura (ε ≥ εu)",
  divergencia: "divergência numérica", lambdaMax: "carga máxima do cálculo", interrompida: "interrompida pelo usuário",
};
function renderNl() {
  const m = frames[+slider.value], el = $("nlOut");
  if (!m?.nl) { el.innerHTML = ""; return; }
  const n = m.nl, P = n.lambda * (m.P0 ?? 0);
  let h = `<b>Carga aplicada: ${P.toFixed(0)} kN</b> (λ = ${n.lambda.toFixed(3)} × ${(m.P0 ?? 0).toFixed(0)} kN de referência)<br>`;
  h += n.mode ? `Modo de ruptura: <b>${MODOS[n.mode] ?? n.mode}</b><br>` : "Em andamento…<br>";
  h += `Deformação de compressão: ${(n.crushStrain * 1000).toFixed(2)} ‰ ${n.crushLength > 0 ? `(média em ${n.crushLength} m)` : "(pontual)"} de ${(n.epsCu * 1000).toFixed(1)} ‰ · máx. pontual ${(n.maxEpsC * 1000).toFixed(1)} ‰<br>`;
  if (n.bars.length) {
    h += "<table><tr><th>barra</th><th>N máx (kN)</th><th>ε (‰)</th><th>escoou</th></tr>" +
      n.bars.map((b) => `<tr><td>${esc(b.label)}</td><td>${b.axialMax.toFixed(0)}</td><td>${(b.strainMax * 1000).toFixed(2)}</td><td>${b.yielded ? "sim" : "não"}</td></tr>`).join("") + "</table>";
  }
  if (n.mode && m.reactions.length) h += `Reações: ${m.reactions.map((r) => `${esc(r.id)} Ry=${r.ry.toFixed(0)} kN`).join(" · ")} · resíduo de equilíbrio ${(Math.max(n.equilibrium.x, n.equilibrium.y) * 100).toExponential(1)} %<br>`;
  h += "<i>Resultado do Nível 2 (sem kc2 nem tension stiffening): serve para equilíbrio e capacidade, não é projeto.</i>";
  el.innerHTML = h;
}
function renderBars() {
  const el = $("barsList"), bars = scene.bars ?? [];
  if (!bars.length) { el.innerHTML = '<small class="note">Este exemplo não tem armadura: a análise considera só o concreto (sem tração).</small>'; return; }
  el.innerHTML = '<h2 style="margin-top:10px">Armadura</h2>';
  const g = document.createElement("div"); g.className = "grid2"; g.style.gridTemplateColumns = "1.4fr 1fr 1fr";
  const head = (t: string) => { const d = document.createElement("small"); d.className = "note"; d.textContent = t; g.appendChild(d); };
  head("barra"); head("As (cm²)"); head("fy (MPa)");
  for (const b of bars) {
    const name = document.createElement("small"); name.textContent = b.label; name.title = `${b.path.length} pontos · aderência perfeita`; g.appendChild(name);
    const mk = (get: () => number, set: (v: number) => void) => {
      const i = document.createElement("input"); i.type = "number"; i.step = "any"; i.min = "0"; i.value = String(Math.round(get() * 1000) / 1000);
      i.onchange = () => { const v = +i.value; if (v > 0) { set(v); changed(); } else i.value = String(get()); };
      g.appendChild(i);
    };
    mk(() => b.areaCm2, (v) => (b.areaCm2 = v)); mk(() => b.fy, (v) => { b.fy = v; b.ft = Math.max(b.ft, v * 1.05); });
  }
  el.appendChild(g);
}
function syncNl() {
  const nl = scene.nl ?? { values: "design" as const, epsCu: 0.0035, crushLength: 0 };
  $<HTMLSelectElement>("nlValues").value = nl.values; $<HTMLInputElement>("nlEpsCu").value = String(Math.round(nl.epsCu * 10000) / 10);
  $<HTMLInputElement>("nlCrush").value = String(nl.crushLength);
  renderBars();
  $("presetNote").textContent = presetSel.value.includes("S1") ? "Ensaio: 556 kN por apoio real (P/4 → 2224 kN no total); CSFM do livro: 568–629 kN. Malha de 40 mm: rápido (≈ 10 s); 20 mm: ≈ 4 min." : "";
}
const readNl = () => { scene.nl = { values: $<HTMLSelectElement>("nlValues").value as "mean" | "design", epsCu: Math.max(0.001, +$<HTMLInputElement>("nlEpsCu").value / 1000), crushLength: Math.max(0, +$<HTMLInputElement>("nlCrush").value) }; };
for (const id of ["nlValues", "nlEpsCu", "nlCrush"]) $(id).onchange = () => { readNl(); changed(); };
$("nl").onclick = () => {
  if ($("nl").textContent === "Parar") { worker.postMessage({ stop: true }); return; }
  readNl(); localStorage.setItem("stm-scene", JSON.stringify(scene));
  frames.length = 0; slider.max = "0"; $("msg").innerHTML = ""; $("nlOut").innerHTML = "";
  if (scene.bars?.length && scene.h > 0.05) showMsg([], [`Malha grossa (elemento de ${scene.h} m): a capacidade costuma ser SUPERESTIMADA (na S1, 0,1 m dá cerca de 50 % a mais que 0,04 m). Use 0,04 m ou menos para um resultado confiável.`]);
  $("nl").textContent = "Parar";
  send({ mode: "nl", scene });
};
/* ───────────────────────── execução ───────────────────────── */
/** nova execução: invalida o que ainda chega da anterior */
const send = (msg: object) => { curToken++; worker.postMessage({ ...msg, token: curToken }); };
const showMsg = (errors: string[], warnings: string[]) => {
  $("msg").innerHTML = errors.map((e) => `<div class="err">${esc(e)}</div>`).join("") + warnings.map((e) => `<div class="warn">${esc(e)}</div>`).join("");
};
worker.onmessage = (ev: MessageEvent<Msg | { kind: "error"; token: number; errors: string[]; warnings: string[] }>) => {
  const m = ev.data;
  if (m.token !== curToken) return;
  if (m.kind === "error") { showMsg(m.errors, m.warnings); $("run").textContent = "Otimizar"; $("nl").textContent = NL_LABEL; return; }
  if (m.warnings?.length) showMsg([], m.warnings);
  frames.push(m);
  if (m.elastic && pendingCsfm) {
    pendingCsfm = false;
    const cz = tensionZones({ ...m.dims, t: scene.t }, m.mask, m.field, { ...CSFM_DEFAULTS });
    csfmData.set(m, cz);
    $<HTMLSelectElement>("view").value = "csfm";
    renderCsfm(m);
  }
  if (m.nl && frames.length === 1 && !$<HTMLSelectElement>("view").value.startsWith("nl")) $<HTMLSelectElement>("view").value = "nlconc";
  slider.max = String(frames.length - 1);
  if (!m.done || frames.length === 1 || +slider.value >= frames.length - 2) slider.value = String(frames.length - 1);
  renderStats(); renderReactions(); renderNl(); draw();
  if (m.nl) $("nl").textContent = m.done ? NL_LABEL : "Parar"; else $("run").textContent = m.done ? "Otimizar" : "Parar";
};
function renderStats() {
  const m = frames[+slider.value]; if (!m) return;
  if (m.nl) { $("stats").textContent = `passo ${m.iter}\nλ = ${m.nl.lambda.toFixed(3)} (P = ${(m.nl.lambda * (m.P0 ?? 0)).toFixed(0)} kN)` + (m.done ? "\nconcluído" : ""); return; }
  $("stats").textContent = m.elastic
    ? "Campo elástico do domínio cheio\n(pré-análise, sem otimização)"
    : `iter ${m.iter}\nflexibilidade ${m.compliance.toExponential(3)}\nvolume ${(m.volume * 100).toFixed(1)}%\nmudança ${(m.change * 100).toFixed(2)}%` + (m.done ? "\nconcluído" : "");
}
const runPayload = () => ({ scene, method: $<HTMLSelectElement>("method").value, volfrac: +$<HTMLInputElement>("vf").value, rmin: +$<HTMLInputElement>("rmin").value });
$("run").onclick = () => {
  if ($("run").textContent === "Parar") { worker.postMessage({ stop: true }); return; }
  frames.length = 0; slider.max = "0"; $("msg").innerHTML = "";
  $("run").textContent = "Parar";
  send({ mode: "opt", ...runPayload() });
};
$("elastic").onclick = () => { frames.length = 0; slider.max = "0"; $("msg").innerHTML = ""; send({ mode: "elastic", scene }); };
$("clearRes").onclick = () => { clearFrames(); $("stats").textContent = ""; $("msg").innerHTML = ""; draw(); };
$("clearAll").onclick = () => {
  if (!confirm(geomLocked ? "Limpar aberturas, apoios, forças e resultados (a geometria principal travada é mantida)?" : "Limpar tudo (geometria, apoios, forças e resultados)?")) return;
  scene = { ...scene, shapes: geomLocked ? scene.shapes.filter((s) => s.mode === "add") : [], loads: [], supports: [] }; sel = null; if (!geomLocked) presetSel.value = "custom";
  changed(); renderProps();
};
$<HTMLInputElement>("vf").oninput = (e) => ($("vfv").textContent = (e.target as HTMLInputElement).value);
$<HTMLInputElement>("rmin").oninput = (e) => ($("rv").textContent = (e.target as HTMLInputElement).value);
slider.oninput = () => { renderStats(); renderReactions(); renderNl(); draw(); };
$("view").onchange = draw;
$("showMesh").onchange = draw;
$<HTMLInputElement>("elemSize").onchange = (e) => { const v = +(e.target as HTMLInputElement).value; if (v > 0) { scene.h = v; changed(); } };
$<HTMLInputElement>("bearing").onchange = (e) => {
  const v = +(e.target as HTMLInputElement).value;
  if (v < 0) return;
  scene.bearing = v;
  // todas as forças de placa passam à nova largura, centradas onde estavam
  for (const l of scene.loads) {
    if (l.point) continue; // força pontual não depende da placa
    const mx = isLineLoad(l) ? (l.x + l.x1) / 2 : l.x, my = isLineLoad(l) ? (l.y + l.y1) / 2 : l.y;
    const q = nearestEdgePoint(scene, mx, my); if (!q) continue;
    const pl = plateOnEdge(q.edge, mx, my);
    if (pl) Object.assign(l, pl); else { l.x = r4(mx); l.y = r4(my); delete l.x1; delete l.y1; }
  }
  changed(); renderProps();
};

$<HTMLInputElement>("fck").onchange = (e) => {
  const el = e.target as HTMLInputElement, v = clampFck(+el.value);
  if (+el.value < FCK_MIN) toast(`fck mínimo: ${FCK_MIN} MPa.`);
  el.value = String(v); scene.fck = v; changed(false);
};
$<HTMLInputElement>("thick").onchange = (e) => { const v = +(e.target as HTMLInputElement).value; if (v > 0) { scene.t = v; changed(); } };
/** largura mínima da biela (Borges 2022) → raio do filtro */
$("biela").onclick = () => {
  const fck = clampFck(scene.fck ?? 30), m = frames[+slider.value];
  let F: number, origem: string;
  if (m && m.reactions.length) { F = Math.max(...m.reactions.map((r) => Math.hypot(r.rx, r.ry))); origem = "maior reação de apoio"; }
  else {
    const tot = scene.loads.reduce((a, l) => a + Math.hypot(l.fx, l.fy), 0);
    F = tot / Math.max(1, scene.supports.length); origem = "carga total ÷ nº de apoios (estimativa; rode o campo elástico para usar a reação)";
  }
  if (!(F > 0)) { toast("Adicione ao menos uma força."); return; }
  const sig = sigmaRdMax(fck, K_STRUT.biela), a = strutWidth(F, scene.t, fck, K_STRUT.biela);
  const r = Math.min(12, Math.max(1.5, Math.ceil(filterRadiusForWidth(a, scene.h) * 2) / 2));
  $<HTMLInputElement>("rmin").value = String(r); $("rv").textContent = String(r);
  $("bielaInfo").textContent = `F = ${F.toFixed(0)} kN (${origem}) · σRd,max = ${sig.toFixed(1)} MPa (fck ${fck}, γc ${GAMMA_C}, k = 1,0) · largura mínima a = ${(a * 100).toFixed(1)} cm → raio do filtro ${r} elem. (${(r * scene.h * 100).toFixed(1)} cm)` + (a / scene.h > 12 ? " — limitado a 12 elementos; refine a malha." : "");
};

const presetSel = $<HTMLSelectElement>("preset");
for (const k of Object.keys(ALL_PRESETS)) presetSel.add(new Option(k, k));
presetSel.add(new Option("— minha geometria —", "custom"));
presetSel.value = saved ? "custom" : DEFAULT_PRESET;
presetSel.onchange = () => {
  if (presetSel.value === "custom") return;
  if (geomLocked && !confirm("A geometria está travada. Carregar o exemplo substitui tudo. Continuar?")) { presetSel.value = "custom"; return; }
  scene = ALL_PRESETS[presetSel.value](); sel = null;
  syncFields(); changed(); renderProps(); fitView(); draw();
};
function syncFields() {
  syncNl();
  $<HTMLInputElement>("fck").value = String(clampFck(scene.fck ?? 30));
  $<HTMLInputElement>("thick").value = String(scene.t);
  $<HTMLInputElement>("elemSize").value = String(scene.h);
  $<HTMLInputElement>("bearing").value = String(scene.bearing);
}

updateLock(); setTool("select"); renderList(); syncFields();
