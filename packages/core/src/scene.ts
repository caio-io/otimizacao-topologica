import type { Problem } from "./types";

/**
 * Cena editável pelo usuário, em unidades físicas (m, kN). Origem no canto inferior esquerdo,
 * y para cima. É a fonte de verdade do projeto (JSON serializável → permalink) e é
 * rasterizada para uma `Problem` (malha regular) por `buildProblem`.
 */
export interface Shape {
  id: string;
  /** "add" soma ao domínio; "cut" subtrai (aberturas, chanfros). Aplicados na ordem da lista. */
  mode: "add" | "cut";
  /** polígono (retângulo = 4 vértices) */
  pts: [number, number][];
}

export interface LoadSpec {
  id: string;
  /** ponto de aplicação [m] */
  x: number;
  y: number;
  /** componentes da força [kN]; fy<0 = para baixo. Se houver (x1,y1), é a RESULTANTE da carga distribuída */
  fx: number;
  fy: number;
  /** fim do trecho carregado: presente ⇒ carga distribuída uniforme entre (x,y) e (x1,y1) sobre um lado */
  x1?: number;
  y1?: number;
  /** força pontual verdadeira: aplicada em UM nó (sem espalhar pela placa de aplicação) */
  point?: boolean;
}

/** carga distribuída? (trecho com comprimento > 0) */
export const isLineLoad = (l: LoadSpec): l is LoadSpec & { x1: number; y1: number } =>
  l.x1 !== undefined && l.y1 !== undefined && Math.hypot(l.x1 - l.x, l.y1 - l.y) > 1e-9;
/** intensidade média [kN/m] (resultante / comprimento) */
export const lineLoadIntensity = (l: LoadSpec) => (isLineLoad(l) ? Math.hypot(l.fx, l.fy) / Math.hypot(l.x1 - l.x, l.y1 - l.y) : 0);

export interface SupportSpec {
  id: string;
  /** segmento onde o apoio atua [m] (x0=x1,y0=y1 → pontual) */
  x0: number; y0: number; x1: number; y1: number;
  ux: boolean;
  uy: boolean;
}

export interface Scene {
  /** tamanho do elemento finito [m] — resolução da malha */
  h: number;
  /** largura FIXA da placa de aplicação, igual para todas as forças [m] */
  bearing: number;
  /** espessura [m] */
  t: number;
  E: number;
  nu: number;
  /** resistência característica do concreto [MPa], ≥ 25 (γc = 1,4 fixo) */
  fck?: number;
  shapes: Shape[];
  loads: LoadSpec[];
  supports: SupportSpec[];
}

export type SupportKind = "fixo" | "movel-x" | "movel-y";
/** fixo: ux,uy · móvel horizontal (desliza em x): só uy · móvel vertical (desliza em y): só ux */
export const supportFlags = (k: SupportKind) => ({ ux: k !== "movel-x", uy: k !== "movel-y" });
export const supportKind = (s: { ux: boolean; uy: boolean }): SupportKind =>
  s.ux && s.uy ? "fixo" : s.uy ? "movel-x" : "movel-y";

/** vértices únicos (todas as formas) — os apoios e as forças só podem ficar sobre eles */
export function sceneVertices(s: Scene): [number, number][] {
  const out: [number, number][] = [];
  for (const sh of s.shapes) for (const [x, y] of sh.pts)
    if (!out.some(([a, b]) => Math.abs(a - x) < 1e-6 && Math.abs(b - y) < 1e-6)) out.push([x, y]);
  return out;
}
export const isVertex = (s: Scene, x: number, y: number) =>
  sceneVertices(s).some(([a, b]) => Math.abs(a - x) < 1e-6 && Math.abs(b - y) < 1e-6);

/** lados (segmentos) de todas as formas */
export function sceneEdges(s: Scene): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  for (const sh of s.shapes) for (let i = 0; i < sh.pts.length; i++) {
    const a = sh.pts[i], b = sh.pts[(i + 1) % sh.pts.length];
    out.push([a[0], a[1], b[0], b[1]]);
  }
  return out;
}

/** ponto mais próximo de (x,y) sobre algum lado; `t` ∈ [0,1] é a posição no lado `edge` */
export function nearestEdgePoint(s: Scene, x: number, y: number, only?: number): { x: number; y: number; dist: number; edge: number; t: number } | null {
  let best: { x: number; y: number; dist: number; edge: number; t: number } | null = null;
  sceneEdges(s).forEach(([x0, y0, x1, y1], i) => {
    if (only !== undefined && i !== only) return;
    const dx = x1 - x0, dy = y1 - y0, L2 = dx * dx + dy * dy;
    const t = L2 ? Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / L2)) : 0;
    const qx = x0 + t * dx, qy = y0 + t * dy, d = Math.hypot(x - qx, y - qy);
    if (!best || d < best.dist) best = { x: qx, y: qy, dist: d, edge: i, t };
  });
  return best;
}
/** (x,y) está sobre um lado da geometria? (tolerância 2 mm) */
export const isOnEdge = (s: Scene, x: number, y: number, tol = 2e-3) => (nearestEdgePoint(s, x, y)?.dist ?? Infinity) <= tol;

export const rectPts = (x: number, y: number, w: number, h: number): [number, number][] => [
  [x, y], [x + w, y], [x + w, y + h], [x, y + h],
];

export function pointInPolygon(px: number, py: number, pts: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function sceneBounds(s: Scene): { x0: number; y0: number; x1: number; y1: number } | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const sh of s.shapes) {
    if (sh.mode !== "add") continue;
    for (const [x, y] of sh.pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  }
  return x0 === Infinity ? null : { x0, y0, x1, y1 };
}

/** limite prático do solver em banda (custo ≈ N·bw² por iteração, memória ≈ N·bw) */
export const MAX_ELEMENTS = 20000;

export interface BuildResult {
  problem: Problem | null;
  /** nós restringidos por apoio (para reações) e posição física do apoio */
  supportGroups: { id: string; nodes: number[]; x: number; y: number }[];
  /** nós carregados por força */
  loadGroups: { id: string; nodes: number[] }[];
  /** origem da malha em coordenadas da cena (canto inferior esquerdo) */
  origin: { x: number; y: number };
  warnings: string[];
  errors: string[];
}

const distToSegment = (px: number, py: number, x0: number, y0: number, x1: number, y1: number) => {
  const dx = x1 - x0, dy = y1 - y0;
  const L2 = dx * dx + dy * dy;
  const t = L2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / L2));
  return Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy));
};

/** Rasteriza a cena. Nunca lança: problemas vêm em `errors` (impedem rodar) e `warnings`. */
export function buildProblem(s: Scene): BuildResult {
  const errors: string[] = [], warnings: string[] = [];
  const b = sceneBounds(s);
  const empty = { problem: null, supportGroups: [], loadGroups: [], origin: { x: 0, y: 0 }, warnings, errors };
  if (!b) { errors.push("Defina ao menos uma forma de geometria."); return empty; }
  const nelx = Math.round((b.x1 - b.x0) / s.h), nely = Math.round((b.y1 - b.y0) / s.h);
  if (nelx < 4 || nely < 4) { errors.push("Geometria pequena demais para a resolução escolhida."); return empty; }
  if (nelx * nely > MAX_ELEMENTS) { errors.push(`Malha com ${nelx * nely} elementos; aumente o tamanho do elemento (limite ${MAX_ELEMENTS}).`); return empty; }

  for (const l of s.loads) {
    if (!isOnEdge(s, l.x, l.y) || (isLineLoad(l) && !isOnEdge(s, l.x1, l.y1)))
      errors.push(`A força ${l.id} precisa estar sobre um lado (contorno) da geometria.`);
  }
  for (const sp of s.supports)
    if (!isOnEdge(s, sp.x0, sp.y0) || !isOnEdge(s, sp.x1, sp.y1)) errors.push(`O apoio ${sp.id} precisa ter início e fim sobre um lado (contorno) da geometria.`);
  if (errors.length) return { ...empty, errors, warnings };

  // máscara
  const mask = new Uint8Array(nelx * nely);
  for (let i = 0; i < nelx; i++) {
    for (let j = 0; j < nely; j++) {
      const cx = b.x0 + (i + 0.5) * s.h;
      const cy = b.y1 - (j + 0.5) * s.h; // linha j cresce para baixo
      let v = 0;
      for (const sh of s.shapes) if (pointInPolygon(cx, cy, sh.pts)) v = sh.mode === "add" ? 1 : 0;
      mask[i * nely + j] = v;
    }
  }
  let nSolid = 0;
  for (let e = 0; e < mask.length; e++) nSolid += mask[e];
  if (nSolid === 0) { errors.push("A geometria não contém nenhum elemento."); return empty; }

  const nodePos = (n: number) => {
    const i = Math.floor(n / (nely + 1)), j = n % (nely + 1);
    return { i, j, x: b.x0 + i * s.h, y: b.y1 - j * s.h };
  };
  // nó toca sólido? / está no contorno?
  const touch = new Uint8Array((nelx + 1) * (nely + 1)); // bit0: toca sólido, bit1: toca vazio/fora
  for (let i = 0; i <= nelx; i++) for (let j = 0; j <= nely; j++) {
    let sol = 0, voidOrOut = 0;
    for (const [di, dj] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) {
      const ei = i + di, ej = j + dj;
      if (ei < 0 || ej < 0 || ei >= nelx || ej >= nely) voidOrOut = 1;
      else if (mask[ei * nely + ej] !== 0) sol = 1; else voidOrOut = 1;
    }
    touch[i * (nely + 1) + j] = sol | (voidOrOut << 1);
  }
  const solidNodes: number[] = [];
  for (let n = 0; n < touch.length; n++) if (touch[n] & 1) solidNodes.push(n);
  const nearest = (x: number, y: number, boundaryOnly: boolean) => {
    let best = -1, bd = Infinity;
    for (const n of solidNodes) {
      if (boundaryOnly && !(touch[n] & 2)) continue;
      const q = nodePos(n);
      const d = Math.hypot(q.x - x, q.y - y);
      if (d < bd) { bd = d; best = n; }
    }
    return { n: best, d: bd };
  };

  // apoios
  const fixedSet = new Set<number>();
  const supportGroups: BuildResult["supportGroups"] = [];
  for (const sp of s.supports) {
    const gnodes: number[] = [];
    for (const n of solidNodes) {
      if (!(touch[n] & 2)) continue;
      const q = nodePos(n);
      if (distToSegment(q.x, q.y, sp.x0, sp.y0, sp.x1, sp.y1) <= 0.71 * s.h) gnodes.push(n);
    }
    if (gnodes.length === 0) {
      const near = nearest((sp.x0 + sp.x1) / 2, (sp.y0 + sp.y1) / 2, true);
      if (near.n >= 0 && near.d < 3 * s.h) gnodes.push(near.n);
      else { warnings.push(`Apoio ${sp.id} está longe do material e foi ignorado.`); continue; }
    }
    for (const n of gnodes) {
      if (sp.ux) fixedSet.add(2 * n);
      if (sp.uy) fixedSet.add(2 * n + 1);
    }
    supportGroups.push({ id: sp.id, nodes: gnodes, x: (sp.x0 + sp.x1) / 2, y: (sp.y0 + sp.y1) / 2 });
  }

  // cargas (placa de largura fixa s.bearing centrada no vértice)
  const loadGroups: BuildResult["loadGroups"] = [];
  const loads: Problem["loads"] = [];
  for (const ld of s.loads) {
    if (isLineLoad(ld)) {
      // distribuída: nós de contorno sobre o trecho; peso por trecho tributário (pontas com metade), soma = resultante
      const L = Math.hypot(ld.x1 - ld.x, ld.y1 - ld.y), ux = (ld.x1 - ld.x) / L, uy = (ld.y1 - ld.y) / L;
      const on: { n: number; s: number }[] = [];
      for (const n of solidNodes) {
        if (!(touch[n] & 2)) continue;
        const q = nodePos(n);
        if (distToSegment(q.x, q.y, ld.x, ld.y, ld.x1, ld.y1) > 0.51 * s.h) continue;
        const along = (q.x - ld.x) * ux + (q.y - ld.y) * uy;
        if (along < -0.51 * s.h || along > L + 0.51 * s.h) continue;
        on.push({ n, s: Math.min(L, Math.max(0, along)) });
      }
      if (on.length === 0) { warnings.push(`Carga distribuída ${ld.id} está fora do material e foi ignorada.`); continue; }
      on.sort((a, b) => a.s - b.s);
      const w = on.map((o, k) => {
        const lo = k === 0 ? 0 : (on[k - 1].s + o.s) / 2, hi = k === on.length - 1 ? L : (o.s + on[k + 1].s) / 2;
        return Math.max(hi - lo, 1e-9);
      });
      const tot = w.reduce((a, b) => a + b, 0);
      on.forEach((o, k) => loads.push({ node: o.n, fx: (ld.fx * w[k]) / tot, fy: (ld.fy * w[k]) / tot }));
      loadGroups.push({ id: ld.id, nodes: on.map((o) => o.n) });
      continue;
    }
    let nodes: number[] = [];
    const r = s.bearing / 2 + 1e-9;
    if (ld.point) { const near = nearest(ld.x, ld.y, true); if (near.n >= 0 && near.d < 3 * s.h) nodes = [near.n]; }
    else for (const n of solidNodes) {
      if (!(touch[n] & 2)) continue;
      const q = nodePos(n);
      if (Math.hypot(q.x - ld.x, q.y - ld.y) <= r) nodes.push(n);
    }
    if (nodes.length === 0) {
      const near = nearest(ld.x, ld.y, true);
      if (near.n < 0 || near.d > 3 * s.h + s.bearing) { warnings.push(`Carga ${ld.id} está fora do material e foi ignorada.`); continue; }
      nodes = [near.n];
    }
    for (const n of nodes) loads.push({ node: n, fx: ld.fx / nodes.length, fy: ld.fy / nodes.length });
    loadGroups.push({ id: ld.id, nodes });
  }

  // placas de apoio/aplicação: elementos que tocam nós carregados ou apoiados ficam sólidos (passivos)
  const markPassive = (n: number) => {
    const i = Math.floor(n / (nely + 1)), j = n % (nely + 1);
    for (const [di, dj] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) {
      const ei = i + di, ej = j + dj;
      if (ei >= 0 && ej >= 0 && ei < nelx && ej < nely && mask[ei * nely + ej] === 1) mask[ei * nely + ej] = 2;
    }
  };
  for (const g of loadGroups) g.nodes.forEach(markPassive);
  for (const g of supportGroups) g.nodes.forEach(markPassive);

  // validações de estabilidade global
  if (loads.length === 0) errors.push("Adicione ao menos uma carga.");
  const fixed = [...fixedSet];
  if (fixed.length < 3) errors.push("Apoios insuficientes: a estrutura precisa de pelo menos 3 vínculos.");
  else if (!restrainsRigidBody(fixed, nodePos, b)) errors.push("Apoios não impedem o movimento de corpo rígido (precisa travar x, y e rotação).");

  // equilíbrio: sem apoios na direção da carga resultante
  const sumFx = loads.reduce((a, l) => a + l.fx, 0), sumFy = loads.reduce((a, l) => a + l.fy, 0);
  if (Math.abs(sumFx) > 1e-9 && !fixed.some((d) => d % 2 === 0)) errors.push("Há força horizontal resultante, mas nenhum apoio restringe ux.");
  if (Math.abs(sumFy) > 1e-9 && !fixed.some((d) => d % 2 === 1)) errors.push("Há força vertical resultante, mas nenhum apoio restringe uy.");

  if (!errors.length) {
    const msg = connectivityError(mask, nelx, nely, fixed, loads);
    if (msg) errors.push(msg);
  }

  if (errors.length) return { ...empty, errors, warnings };
  return {
    problem: { nelx, nely, h: s.h, t: s.t, E: s.E, nu: s.nu, mask, fixed, loads },
    supportGroups, loadGroups,
    origin: { x: b.x0, y: b.y0 },
    warnings, errors,
  };
}

/**
 * Conectividade (união de nós por elementos não vazios): todo o material precisa estar ligado a algum apoio,
 * senão a rigidez é singular (ilha flutuante) ou a carga não tem caminho até a reação.
 */
export function connectivityError(
  mask: Uint8Array, nelx: number, nely: number, fixed: number[], loads: { node: number }[],
): string | null {
  const nn = (nelx + 1) * (nely + 1), parent = new Int32Array(nn).map((_, i) => i);
  const find = (a: number) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  for (let i = 0; i < nelx; i++) for (let j = 0; j < nely; j++) {
    if (!mask[i * nely + j]) continue;
    const n = i * (nely + 1) + j, ns = [n, n + 1, n + nely + 1, n + nely + 2];
    for (let k = 1; k < 4; k++) parent[find(ns[k])] = find(ns[0]);
  }
  const supported = new Set(fixed.map((d) => find(d >> 1)));
  for (const l of loads) if (!supported.has(find(l.node))) return "Há força sem caminho de material até um apoio (peça desconectada dos apoios).";
  for (let i = 0; i < nelx; i++) for (let j = 0; j < nely; j++) {
    if (!mask[i * nely + j]) continue;
    if (!supported.has(find(i * (nely + 1) + j))) return "Há material desconectado dos apoios (ilha flutuante); remova ou conecte essa região.";
  }
  return null;
}

/** Os vínculos eliminam as 3 translações/rotação de corpo rígido? (posto 3 da matriz de restrições) */
function restrainsRigidBody(
  fixed: number[],
  nodePos: (n: number) => { x: number; y: number },
  b: { x0: number; y0: number; x1: number; y1: number },
): boolean {
  const xc = (b.x0 + b.x1) / 2, yc = (b.y0 + b.y1) / 2, sc = Math.max(b.x1 - b.x0, b.y1 - b.y0);
  const G = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const d of fixed) {
    const q = nodePos(Math.floor(d / 2));
    const row = d % 2 === 0 ? [1, 0, -(q.y - yc) / sc] : [0, 1, (q.x - xc) / sc];
    for (let a = 0; a < 3; a++) for (let c = 0; c < 3; c++) G[a][c] += row[a] * row[c];
  }
  const det =
    G[0][0] * (G[1][1] * G[2][2] - G[1][2] * G[2][1]) -
    G[0][1] * (G[1][0] * G[2][2] - G[1][2] * G[2][0]) +
    G[0][2] * (G[1][0] * G[2][1] - G[1][1] * G[2][0]);
  return det > 1e-9 * Math.pow(fixed.length, 3);
}
