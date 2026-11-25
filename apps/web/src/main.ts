import { SCENE_PRESETS, nearestEdgePoint, pointInPolygon, rectPts, sceneEdges, sceneVertices, supportFlags, supportKind } from "@stm/core";
import type { LoadSpec, PrincipalField, Scene, Shape, SupportKind, SupportSpec } from "@stm/core";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const cv = $<HTMLCanvasElement>("cv");
const ctx = cv.getContext("2d")!;
const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });

/* ───────────────────────── estado ───────────────────────── */
const DEFAULT_PRESET = "Viga-parede";
let scene: Scene = SCENE_PRESETS[DEFAULT_PRESET]();
type Sel = { kind: "shape" | "load" | "support"; id: string } | null;
let sel: Sel = null;
type Tool = "select" | "rect+" | "rect-" | "poly+" | "poly-" | "load" | "support";
let tool: Tool = "select";
let geomLocked = localStorage.getItem("stm-lock") === "1";
let nextId = 100;
const newId = (p: string) => `${p}${nextId++}`;

interface Reaction { id: string; rx: number; ry: number; x: number; y: number }
interface Msg {
  kind: "frame";
  dims: { nelx: number; nely: number; h: number; ox: number; oy: number };
  mask: Uint8Array; iter: number; compliance: number; volume: number; change: number;
  rho: Float64Array; u: Float64Array; field: PrincipalField; done: boolean; warnings: string[]; elastic?: boolean;
  reactions: Reaction[]; residual: { x: number; y: number };
}
const frames: Msg[] = [];
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

const solidAt = (m: Msg, e: number) => m.mask[e] !== 0 && m.rho[e] > 0.5;

function drawResult(m: Msg, mode: string, showMesh: boolean) {
  const { nelx, nely, h, ox, oy } = m.dims;
  const top = oy + nely * h, px = view.s * h;
  const X = (i: number) => wx(ox + i * h), Y = (j: number) => wy(top - j * h);
  const solidIdx: number[] = [];
  for (let e = 0; e < m.mask.length; e++) if (solidAt(m, e)) solidIdx.push(e);

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
  const smax = Math.max(1e-12, Math.abs(pct(Float64Array.from(sv, Math.abs), solidIdx, 0.97)));
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
  const tmax = Math.max(1e-12, pct(s1, solidIdx, 0.95)), cmax = Math.max(1e-12, -pct(s2, solidIdx, 0.05));
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

function drawLoad(l: LoadSpec) {
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
  for (const s of scene.supports) drawSupport(s);
  for (const l of scene.loads) drawLoad(l);
  if (frame) drawReactions(frame);

  // grips nos LADOS (contorno): realça os lados e marca o ponto de encaixe sob o cursor
  if (tool === "load" || tool === "support" || drag?.type === "moveLoad") {
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
  if (drag && tool === "support") { ctx.beginPath(); ctx.moveTo(wx(drag.start[0]), wy(drag.start[1])); ctx.lineTo(wx(drag.cur[0]), wy(drag.cur[1])); ctx.stroke(); }
  if (polyDraft.length) {
    ctx.beginPath(); polyDraft.forEach(([x, y], i) => (i ? ctx.lineTo(wx(x), wy(y)) : ctx.moveTo(wx(x), wy(y)))); ctx.lineTo(wx(hover[0]), wy(hover[1])); ctx.stroke();
  }
  ctx.setLineDash([]);
}

/* ───────────────────────── edição ───────────────────────── */
const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
const snap = (v: number) => r4(Math.round(v / scene.h) * scene.h);

function changed(clearResults = true) {
  if (clearResults) { frames.length = 0; slider.max = "0"; $("stats").textContent = ""; renderReactions(); }
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
  for (const l of scene.loads) { const p = projectToEdge(l.x, l.y); l.x = p[0]; l.y = p[1]; }
  for (const s2 of scene.supports) { const a = projectToEdge(s2.x0, s2.y0), b = projectToEdge(s2.x1, s2.y1); s2.x0 = a[0]; s2.y0 = a[1]; s2.x1 = b[0]; s2.y1 = b[1]; }
}
const toast = (msg: string) => { $("msg").innerHTML = `<div class="warn">${msg}</div>`; setTimeout(() => { if ($("msg").textContent === msg) $("msg").innerHTML = ""; }, 3500); };
const clearFrames = () => { if (frames.length) { frames.length = 0; slider.max = "0"; renderReactions(); } };

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
  } else if (tool === "load" || tool === "support") {
    const g = edgeGrip(px, py, 28);
    if (!g) { toast("Clique sobre um lado (contorno) da geometria — as linhas pontilhadas azuis."); return; }
    if (tool === "support") drag = { type: "support", start: [g.x, g.y], cur: [g.x, g.y] };
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
  const gr = tool === "load" || tool === "support" || drag?.type === "moveLoad" ? edgeGrip(px, py, 40) : null;
  hoverGrip = gr ? [gr.x, gr.y] : null;
  if (drag) {
    if (drag.type === "moveLoad" && sel) {
      const v = edgeGrip(px, py, 60);
      if (v) { const l = scene.loads.find((q) => q.id === sel!.id)!; l.x = v.x; l.y = v.y; clearFrames(); }
    } else if (drag.type === "moveShape" && sel) {
      clearFrames();
      const dx = snap(wxm - drag.start[0]), dy = snap(wym - drag.start[1]);
      const o = drag.orig;
      const sh = scene.shapes.find((q) => q.id === sel!.id)!;
      sh.pts = o.pts.map((q: number[]) => [r4(q[0] + dx), r4(q[1] + dy)]);
      // forças/apoios que estão sobre os lados desta forma acompanham
      scene.loads.forEach((l, i) => { if (onPoly(o.pts, o.loads[i].x, o.loads[i].y)) { l.x = r4(o.loads[i].x + dx); l.y = r4(o.loads[i].y + dy); } });
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
    const l: LoadSpec = { id: newId("P"), x: v.x, y: v.y, fx: 0, fy: -100 };
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
  ["poly+", "⬠ Polígono", true], ["poly-", "⬠ Abertura poligonal", false], ["load", "↓ Força", false], ["support", "△ Apoio", false],
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
  load: "Clique sobre um LADO da geometria (linha pontilhada azul) para aplicar a força.", support: "Arraste ao longo de um lado para definir o apoio (ou clique num ponto do lado p/ apoio pontual).",
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
  for (const s of scene.shapes) row("shape", s.id, `<b>${s.id}</b> ${s.mode === "add" ? "material" : "abertura"} <small>${s.pts.length} vértices</small>`);
  for (const s of scene.supports) { const k = supportKind(s); row("support", s.id, `<b>${s.id}</b> apoio <small>${k === "fixo" ? "fixo" : k === "movel-x" ? "móvel (desliza em x)" : "móvel (desliza em y)"}</small>`); }
  for (const l of scene.loads) row("load", l.id, `<b>${l.id}</b> força <small>Fx=${l.fx} Fy=${l.fy} kN</small>`);
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
    g.append(...pointFields("Posição", () => [l.x, l.y], (x, y) => { l.x = x; l.y = y; }), num("Fx — horizontal (kN), + para a direita", l.fx, (v2) => (l.fx = v2), 10, false, "fx"), num("Fy — vertical (kN), − para baixo", l.fy, (v2) => (l.fy = v2), 10, false, "fy"));
    const info = document.createElement("small"); info.className = "note"; info.style.gridColumn = "1 / 3";
    info.textContent = `Digite x,y: o ponto é projetado no lado mais próximo. Placa de aplicação fixa: ${scene.bearing} m.`; g.append(info);
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
    m.reactions.map((r) => `<div class="item"><b>${r.id}</b> <small>Rx=${r.rx.toFixed(1)} · Ry=${r.ry.toFixed(1)} kN</small></div>`).join("") +
    `<div class="item"><small>ΣR = (${sum.x.toFixed(1)}; ${sum.y.toFixed(1)}) · resíduo de equilíbrio (${m.residual.x.toFixed(3)}; ${m.residual.y.toFixed(3)}) kN</small></div>`;
}
/* ───────────────────────── execução ───────────────────────── */
const showMsg = (errors: string[], warnings: string[]) => {
  $("msg").innerHTML = errors.map((e) => `<div class="err">${e}</div>`).join("") + warnings.map((e) => `<div class="warn">${e}</div>`).join("");
};
worker.onmessage = (ev: MessageEvent<Msg | { kind: "error"; errors: string[]; warnings: string[] }>) => {
  const m = ev.data;
  if (m.kind === "error") { showMsg(m.errors, m.warnings); $("run").textContent = "Otimizar"; return; }
  if (m.warnings?.length) showMsg([], m.warnings);
  frames.push(m);
  slider.max = String(frames.length - 1);
  if (!m.done || frames.length === 1 || +slider.value >= frames.length - 2) slider.value = String(frames.length - 1);
  renderStats(); renderReactions(); draw();
  $("run").textContent = m.done ? "Otimizar" : "Parar";
};
function renderStats() {
  const m = frames[+slider.value]; if (!m) return;
  $("stats").textContent = m.elastic
    ? "Campo elástico do domínio cheio\n(pré-análise, sem otimização)"
    : `iter ${m.iter}\nflexibilidade ${m.compliance.toExponential(3)}\nvolume ${(m.volume * 100).toFixed(1)}%\nmudança ${(m.change * 100).toFixed(2)}%` + (m.done ? "\nconcluído" : "");
}
const runPayload = () => ({ scene, method: $<HTMLSelectElement>("method").value, volfrac: +$<HTMLInputElement>("vf").value, rmin: +$<HTMLInputElement>("rmin").value });
$("run").onclick = () => {
  if ($("run").textContent === "Parar") { worker.postMessage({ stop: true }); return; }
  frames.length = 0; slider.max = "0"; $("msg").innerHTML = "";
  $("run").textContent = "Parar";
  worker.postMessage({ mode: "opt", ...runPayload() });
};
$("elastic").onclick = () => { frames.length = 0; slider.max = "0"; $("msg").innerHTML = ""; worker.postMessage({ mode: "elastic", scene }); };
$("clearRes").onclick = () => { clearFrames(); $("stats").textContent = ""; $("msg").innerHTML = ""; draw(); };
$("clearAll").onclick = () => {
  if (!confirm(geomLocked ? "Limpar aberturas, apoios, forças e resultados (a geometria principal travada é mantida)?" : "Limpar tudo (geometria, apoios, forças e resultados)?")) return;
  scene = { ...scene, shapes: geomLocked ? scene.shapes.filter((s) => s.mode === "add") : [], loads: [], supports: [] }; sel = null; if (!geomLocked) presetSel.value = "custom";
  changed(); renderProps();
};
$<HTMLInputElement>("vf").oninput = (e) => ($("vfv").textContent = (e.target as HTMLInputElement).value);
$<HTMLInputElement>("rmin").oninput = (e) => ($("rv").textContent = (e.target as HTMLInputElement).value);
slider.oninput = () => { renderStats(); renderReactions(); draw(); };
$("view").onchange = draw;
$("showMesh").onchange = draw;
$<HTMLInputElement>("elemSize").onchange = (e) => { const v = +(e.target as HTMLInputElement).value; if (v > 0) { scene.h = v; changed(); } };
$<HTMLInputElement>("bearing").onchange = (e) => { const v = +(e.target as HTMLInputElement).value; if (v >= 0) { scene.bearing = v; changed(); renderProps(); } };

const presetSel = $<HTMLSelectElement>("preset");
for (const k of Object.keys(SCENE_PRESETS)) presetSel.add(new Option(k, k));
presetSel.add(new Option("— minha geometria —", "custom"));
presetSel.value = DEFAULT_PRESET;
presetSel.onchange = () => {
  if (presetSel.value === "custom") return;
  if (geomLocked && !confirm("A geometria está travada. Carregar o exemplo substitui tudo. Continuar?")) { presetSel.value = "custom"; return; }
  scene = SCENE_PRESETS[presetSel.value](); sel = null;
  syncFields(); changed(); renderProps(); fitView(); draw();
};
function syncFields() {
  $<HTMLInputElement>("elemSize").value = String(scene.h);
  $<HTMLInputElement>("bearing").value = String(scene.bearing);
}

updateLock(); setTool("select"); renderList(); syncFields();
