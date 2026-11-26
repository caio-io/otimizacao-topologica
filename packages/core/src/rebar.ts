/**
 * Armadura "inteligente": a barra acompanha o contorno da peça a uma distância fixa da face (cobrimento + Ø/2).
 * O usuário informa o cobrimento; ao passar o mouse sobre uma face, o caminho da barra é calculado e mostrado, e o clique o cria.
 * Formas: reta (a face inteira), L (a face e uma perna ao longo da face vizinha, num dos dois cantos) e U (pernas nos dois cantos).
 *
 * Limites conhecidos: usa as arestas dos polígonos da cena (shapes `add` e `cut`); não trata arestas internas entre polígonos
 * sobrepostos nem o cobrimento ao estribo (a distância é da face à SUPERFÍCIE da barra).
 */
import type { Scene } from "./scene";

export type Pt = [number, number];
export type RebarForm = "reta" | "L" | "U";

export interface FaceEdge {
  shape: number; i: number;
  a: Pt; b: Pt;
  /** normal unitária apontando para dentro do CONCRETO */
  n: Pt;
  len: number;
}

const signedArea = (pts: Pt[]) => {
  let s = 0;
  for (let i = 0; i < pts.length; i++) { const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length]; s += x0 * y1 - x1 * y0; }
  return s / 2;
};

/**
 * "Faces" de cada polígono: trechos retos maximais (vértices colineares, p. ex. os que marcam apoios ao longo de um lado,
 * são fundidos), com a normal voltada para o concreto (para fora, no caso das aberturas)
 */
export function faceEdges(s: Scene): FaceEdge[][] {
  return s.shapes.map((sh, si) => {
    const raw = sh.pts.filter((p, k, arr) => Math.hypot(p[0] - arr[(k + 1) % arr.length][0], p[1] - arr[(k + 1) % arr.length][1]) > 1e-9);
    const n0 = raw.length;
    if (n0 < 3) return [];
    const ccw = signedArea(raw) > 0;
    const dir = (k: number): Pt => { const a = raw[k % n0], b = raw[(k + 1) % n0], L = Math.hypot(b[0] - a[0], b[1] - a[1]); return [(b[0] - a[0]) / L, (b[1] - a[1]) / L]; };
    const colin = (k: number) => { const u = dir(k - 1 + n0), v = dir(k); return Math.abs(u[0] * v[1] - u[1] * v[0]) < 1e-9 && u[0] * v[0] + u[1] * v[1] > 0; };
    // começa num vértice que seja canto de verdade, para não partir uma face no fechamento do polígono
    let start = 0;
    for (let k = 0; k < n0; k++) if (!colin(k)) { start = k; break; }
    const out: FaceEdge[] = [];
    let k = 0;
    while (k < n0) {
      const i0 = (start + k) % n0;
      let j = k + 1;
      while (j < n0 && colin((start + j) % n0)) j++;
      const a = raw[i0], b = raw[(start + j) % n0], dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
      let nx = -dy / len, ny = dx / len; // normal à esquerda: para dentro quando o polígono é anti-horário
      if (!ccw) { nx = -nx; ny = -ny; }
      if (sh.mode === "cut") { nx = -nx; ny = -ny; }
      out.push({ shape: si, i: out.length, a, b, n: [nx, ny], len });
      k = j;
    }
    return out;
  });
}

const distSeg = (px: number, py: number, a: Pt, b: Pt) => {
  const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
  const t = L2 ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / L2)) : 0;
  return { d: Math.hypot(px - a[0] - t * dx, py - a[1] - t * dy), t };
};

/** face mais próxima do ponto (x, y) [m] dentro de `maxDist`; `t` é a posição ao longo da aresta (0 = início, 1 = fim) */
export function nearestFace(s: Scene, x: number, y: number, maxDist: number): { shape: number; i: number; t: number; dist: number; a: Pt; b: Pt } | null {
  let best: { shape: number; i: number; t: number; dist: number; a: Pt; b: Pt } | null = null;
  for (const list of faceEdges(s)) for (const e of list) {
    if (e.len === 0) continue;
    const q = distSeg(x, y, e.a, e.b);
    if (q.d <= maxDist && (!best || q.d < best.dist)) best = { shape: e.shape, i: e.i, t: q.t, dist: q.d, a: e.a, b: e.b };
  }
  return best;
}

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

/** interseção das retas deslocadas de d das arestas e1 (que termina no vértice) e e2 (que começa nele) */
function miter(e1: FaceEdge, e2: FaceEdge, d: number): Pt {
  const u1: Pt = [(e1.b[0] - e1.a[0]) / e1.len, (e1.b[1] - e1.a[1]) / e1.len];
  const u2: Pt = [(e2.b[0] - e2.a[0]) / e2.len, (e2.b[1] - e2.a[1]) / e2.len];
  const p1: Pt = [e1.a[0] + e1.n[0] * d, e1.a[1] + e1.n[1] * d], p2: Pt = [e2.a[0] + e2.n[0] * d, e2.a[1] + e2.n[1] * d];
  const cr = u1[0] * u2[1] - u1[1] * u2[0];
  if (Math.abs(cr) < 1e-9) return [e1.b[0] + e1.n[0] * d, e1.b[1] + e1.n[1] * d]; // arestas colineares
  const t = ((p2[0] - p1[0]) * u2[1] - (p2[1] - p1[1]) * u2[0]) / cr;
  return [p1[0] + u1[0] * t, p1[1] + u1[1] * t];
}

export interface RebarOptions {
  form: RebarForm;
  /** cobrimento [m] da face à superfície da barra */
  cover: number;
  /** diâmetro [mm] */
  dia: number;
  /** para a forma L: 0 = perna no canto do início da aresta, 1 = no canto do fim */
  end: 0 | 1;
  /** comprimento da perna de ancoragem [m] (limitado ao comprimento da face vizinha) */
  legLen: number;
}

/** caminho da barra (centro da barra, coordenadas da cena) para a aresta `i` do polígono `shape`; null se a aresta for degenerada */
export function smartBarPath(s: Scene, ref: { shape: number; i: number }, o: RebarOptions): Pt[] | null {
  const E = faceEdges(s)[ref.shape];
  if (!E || !E[ref.i] || E[ref.i].len === 0) return null;
  const n = E.length, d = o.cover + o.dia / 2000;
  const at = (k: number) => E[((k % n) + n) % n];
  const e = at(ref.i), prev = at(ref.i - 1), next = at(ref.i + 1);
  if (prev.len === 0 || next.len === 0) return null;
  const S = miter(prev, e, d), T = miter(e, next, d);
  const leg = (from: Pt, along: FaceEdge, sign: 1 | -1, limitTo: Pt): Pt | null => {
    const u: Pt = [sign * (along.b[0] - along.a[0]) / along.len, sign * (along.b[1] - along.a[1]) / along.len];
    const avail = Math.hypot(limitTo[0] - from[0], limitTo[1] - from[1]);
    const L = Math.min(o.legLen, avail);
    return L > 1e-6 ? [from[0] + u[0] * L, from[1] + u[1] * L] : null;
  };
  const endOfNext = miter(next, at(ref.i + 2), d), startOfPrev = miter(at(ref.i - 2), prev, d);
  const path: Pt[] = [];
  if (o.form === "reta") path.push(S, T);
  else {
    const useStart = o.form === "U" || o.end === 0, useEnd = o.form === "U" || o.end === 1;
    if (useStart) { const q = leg(S, prev, -1, startOfPrev); if (q) path.push(q); }
    path.push(S, T);
    if (useEnd) { const q = leg(T, next, 1, endOfNext); if (q) path.push(q); }
  }
  return path.map(([x, y]) => [r4(x), r4(y)] as Pt);
}

/** área total [cm²] de n barras de diâmetro dia [mm] */
export const barAreaCm2 = (n: number, diaMm: number) => (n * Math.PI * (diaMm / 10) ** 2) / 4;

/** diâmetros comerciais usuais [mm] */
export const BAR_DIAMETERS = [5, 6.3, 8, 10, 12.5, 16, 20, 25, 32, 40] as const;
