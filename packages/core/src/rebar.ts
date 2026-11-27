/**
 * Armadura "inteligente": a barra acompanha o contorno da peça a uma distância fixa da face (cobrimento + Ø/2).
 * O usuário informa o cobrimento; ao passar o mouse sobre uma face, o caminho da barra é calculado e mostrado, e o clique o cria.
 * Formas: reta (a face inteira), L (a face e uma perna ao longo da face vizinha, num dos dois cantos) e U (pernas nos dois cantos).
 *
 * Limites conhecidos: usa as arestas dos polígonos da cena (shapes `add` e `cut`); não trata arestas internas entre polígonos
 * sobrepostos nem o cobrimento ao estribo (a distância é da face à SUPERFÍCIE da barra).
 */
import { pointInPolygon, type BarCurveSpec, type Scene } from "./scene";

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

/** Verifica se o ponto (x, y) está dentro do concreto sólido considerando shapes `add` e `cut` em ordem. */
export function isPointInSolid(s: Scene, x: number, y: number): boolean {
  let solid = false;
  for (const sh of s.shapes) {
    if (pointInPolygon(x, y, sh.pts)) solid = sh.mode === "add";
  }
  return solid;
}

/** Recorta uma polilinha nos vazios/aberturas (`cut`) e bordas externas da cena, retornando apenas os trechos sólidos. */
export function clipPolylineToSolid(s: Scene, pts: readonly Pt[], minLen = 0.02): Pt[][] {
  if (pts.length < 2 || s.shapes.length === 0) return pts.length >= 2 ? [pts.map((p) => [p[0], p[1]] as Pt)] : [];

  const out: Pt[][] = [];
  let cur: Pt[] = [];

  const pushPt = (p: Pt) => {
    const q: Pt = [r4(p[0]), r4(p[1])];
    const last = cur[cur.length - 1];
    if (!last || Math.hypot(q[0] - last[0], q[1] - last[1]) > 1e-6) cur.push(q);
  };
  const flush = () => {
    if (cur.length >= 2) {
      let len = 0;
      for (let i = 1; i < cur.length; i++) len += Math.hypot(cur[i][0] - cur[i - 1][0], cur[i][1] - cur[i - 1][1]);
      if (len >= minLen) out.push(cur);
    }
    cur = [];
  };

  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const rx = b[0] - a[0], ry = b[1] - a[1];
    const segLen = Math.hypot(rx, ry);
    if (segLen < 1e-9) continue;

    const ts: number[] = [0, 1];
    for (const sh of s.shapes) {
      const poly = sh.pts;
      for (let j = 0; j < poly.length; j++) {
        const p = poly[j], q = poly[(j + 1) % poly.length];
        const sx = q[0] - p[0], sy = q[1] - p[1];
        const denom = rx * sy - ry * sx;
        if (Math.abs(denom) < 1e-12) continue;
        const qpx = p[0] - a[0], qpy = p[1] - a[1];
        const t = (qpx * sy - qpy * sx) / denom;
        const u = (qpx * ry - qpy * rx) / denom;
        if (t > 1e-7 && t < 1 - 1e-7 && u >= -1e-6 && u <= 1 + 1e-6) ts.push(t);
      }
    }
    ts.sort((x, y) => x - y);
    const uniq: number[] = [];
    for (const t of ts) {
      if (uniq.length === 0 || t - uniq[uniq.length - 1] > 1e-6) uniq.push(t);
    }

    for (let k = 0; k < uniq.length - 1; k++) {
      const t0 = uniq[k], t1 = uniq[k + 1];
      if (t1 - t0 < 1e-6) continue;
      const tm = 0.5 * (t0 + t1);
      const mx = a[0] + rx * tm, my = a[1] + ry * tm;
      if (isPointInSolid(s, mx, my)) {
        pushPt([a[0] + rx * t0, a[1] + ry * t0]);
        pushPt([a[0] + rx * t1, a[1] + ry * t1]);
      } else {
        flush();
      }
    }
  }
  flush();
  return out;
}

/** Versão de `smartBarPath` já recortada contra aberturas (`cut`) da cena. */
export function smartBarPaths(s: Scene, ref: { shape: number; i: number }, o: RebarOptions): Pt[][] {
  const raw = smartBarPath(s, ref, o);
  if (!raw) return [];
  return clipPolylineToSolid(s, raw);
}

/** Espaçamento livre mínimo provisório entre camadas paralelas [m]: max(Ø, 20 mm) (PROVISÓRIO — sem norma local). */
export const PROVISIONAL_LAYER_CLEAR_M = 0.02;

export interface ParallelLayerResult {
  layerIndex: number;
  effectiveCover: number;
  existingCount: number;
  provisional: true;
}

/**
 * Detecta barras existentes paralelas à face selecionada e calcula o cobrimento efetivo
 * para lançar uma nova camada acima (`layerDir = 1`, para dentro do concreto) ou abaixo (`layerDir = -1`).
 */
export function parallelLayerOffset(
  s: Scene,
  ref: { shape: number; i: number },
  o: RebarOptions,
  layerDir: 1 | -1 = 1,
): ParallelLayerResult {
  const E = faceEdges(s)[ref.shape];
  if (!E || !E[ref.i] || E[ref.i].len === 0) {
    return { layerIndex: 0, effectiveCover: o.cover, existingCount: 0, provisional: true };
  }
  const e = E[ref.i];
  const ux = (e.b[0] - e.a[0]) / e.len, uy = (e.b[1] - e.a[1]) / e.len;
  const nx = e.n[0], ny = e.n[1];
  const baseD = o.cover + o.dia / 2000;
  const stepD = Math.max(o.dia / 1000, PROVISIONAL_LAYER_CLEAR_M) + o.dia / 1000;
  const offsets: number[] = [];

  for (const b of s.bars ?? []) {
    const polys = [b.path, ...(b.extra ?? [])];
    for (const poly of polys) {
      for (let i = 0; i < poly.length - 1; i++) {
        const p = poly[i], q = poly[i + 1];
        const dx = q[0] - p[0], dy = q[1] - p[1];
        const L = Math.hypot(dx, dy);
        if (L < 0.02) continue;
        const dotU = Math.abs((dx * ux + dy * uy) / L);
        if (dotU < 0.996) continue; // ~5° de tolerância
        const s0 = (p[0] - e.a[0]) * ux + (p[1] - e.a[1]) * uy;
        const s1 = (q[0] - e.a[0]) * ux + (q[1] - e.a[1]) * uy;
        const overlap = Math.min(Math.max(s0, s1), e.len) - Math.max(Math.min(s0, s1), 0);
        if (overlap < 0.02) continue;
        const dn = (0.5 * (p[0] + q[0]) - e.a[0]) * nx + (0.5 * (p[1] + q[1]) - e.a[1]) * ny;
        if (dn >= -0.005 && dn <= 0.5) offsets.push(dn);
      }
    }
  }

  if (offsets.length === 0) {
    return { layerIndex: 0, effectiveCover: o.cover, existingCount: 0, provisional: true };
  }

  // Agrupa offsets em camadas distintas (tolerância 5 mm)
  offsets.sort((a, b) => a - b);
  const layers: number[] = [];
  for (const d of offsets) {
    if (layers.length === 0 || Math.abs(d - layers[layers.length - 1]) > 0.005) layers.push(d);
  }

  const nearBase = layers.some((d) => Math.abs(d - baseD) < 0.008);
  if (!nearBase) {
    return { layerIndex: 0, effectiveCover: o.cover, existingCount: layers.length, provisional: true };
  }

  if (layerDir === 1) {
    const targetD = layers[layers.length - 1] + stepD;
    return {
      layerIndex: layers.length,
      effectiveCover: r4(targetD - o.dia / 2000),
      existingCount: layers.length,
      provisional: true,
    };
  }

  const minCover = 0.01;
  const targetD = Math.max(minCover + o.dia / 2000, layers[0] - stepD);
  return {
    layerIndex: layers.length,
    effectiveCover: r4(targetD - o.dia / 2000),
    existingCount: layers.length,
    provisional: true,
  };
}

/** Raio mínimo de dobramento provisório [m] (PROVISÓRIO: 2,5Ø para Ø <= 20 mm, 3,5Ø acima). */
export function minBendRadiusM(diaMm: number): { radiusM: number; provisional: true } {
  const factor = diaMm <= 20 ? 2.5 : 3.5;
  return { radiusM: r4((factor * diaMm) / 1000), provisional: true };
}

/** Discretiza um arco circular passando por 3 pontos (`p1 -> p2 -> p3`) com flecha <= `maxSagitta`. */
export function arcFrom3Points(p1: Pt, p2: Pt, p3: Pt, maxSagitta = 0.01): Pt[] {
  const [x1, y1] = p1, [x2, y2] = p2, [x3, y3] = p3;
  const d = 2 * (x1 * (y2 - y3) + x2 * (y3 - y1) + x3 * (y1 - y2));
  if (Math.abs(d) < 1e-9) return [[r4(x1), r4(y1)], [r4(x3), r4(y3)]];
  const n1 = x1 * x1 + y1 * y1, n2 = x2 * x2 + y2 * y2, n3 = x3 * x3 + y3 * y3;
  const cx = (n1 * (y2 - y3) + n2 * (y3 - y1) + n3 * (y1 - y2)) / d;
  const cy = (n1 * (x3 - x2) + n2 * (x1 - x3) + n3 * (x2 - x1)) / d;
  const R = Math.hypot(x1 - cx, y1 - cy);
  if (!Number.isFinite(R) || R > 500 || R < 1e-4) return [[r4(x1), r4(y1)], [r4(x3), r4(y3)]];

  const a1 = Math.atan2(y1 - cy, x1 - cx);
  let a2 = Math.atan2(y2 - cy, x2 - cx);
  let a3 = Math.atan2(y3 - cy, x3 - cx);
  const normAngle = (a: number, ref: number) => {
    let v = a;
    while (v - ref <= -Math.PI) v += 2 * Math.PI;
    while (v - ref > Math.PI) v -= 2 * Math.PI;
    return v;
  };
  a2 = normAngle(a2, a1);
  a3 = normAngle(a3, a1);
  // Garante que o arco passe por a2 entre a1 e a3
  if ((a2 > a1 && a3 < a2) || (a2 < a1 && a3 > a2)) {
    a3 = a3 > a1 ? a3 - 2 * Math.PI : a3 + 2 * Math.PI;
  }
  const dTheta = Math.abs(a3 - a1);
  const cosTerm = Math.max(-1, Math.min(1, 1 - Math.min(maxSagitta, R * 0.5) / R));
  const stepAng = 2 * Math.acos(cosTerm);
  const nSeg = Math.max(4, Math.min(64, Math.ceil(dTheta / Math.max(1e-3, stepAng))));

  const out: Pt[] = [];
  for (let i = 0; i <= nSeg; i++) {
    const a = a1 + ((a3 - a1) * i) / nSeg;
    out.push([r4(cx + R * Math.cos(a)), r4(cy + R * Math.sin(a))]);
  }
  return out;
}

/** Aplica concordância circular (`fillet`) nos vértices internos de uma polilinha. */
export function filletPolyline(pts: readonly Pt[], radius: number, maxSagitta = 0.01): Pt[] {
  if (pts.length < 3 || radius <= 1e-4) return pts.map((p) => [p[0], p[1]] as Pt);
  const out: Pt[] = [[r4(pts[0][0]), r4(pts[0][1])]];
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1], cur = pts[i], next = pts[i + 1];
    const v1x = prev[0] - cur[0], v1y = prev[1] - cur[1], L1 = Math.hypot(v1x, v1y);
    const v2x = next[0] - cur[0], v2y = next[1] - cur[1], L2 = Math.hypot(v2x, v2y);
    if (L1 < 1e-6 || L2 < 1e-6) { out.push([r4(cur[0]), r4(cur[1])]); continue; }
    const u1x = v1x / L1, u1y = v1y / L1, u2x = v2x / L2, u2y = v2y / L2;
    const dot = Math.max(-0.9999, Math.min(0.9999, u1x * u2x + u1y * u2y));
    const theta = Math.acos(dot);
    if (theta < 0.05 || Math.PI - theta < 0.05) { out.push([r4(cur[0]), r4(cur[1])]); continue; }
    const tanHalf = Math.tan(theta / 2);
    const tMax = Math.min(0.45 * L1, 0.45 * L2);
    const rEff = Math.min(radius, tMax * tanHalf);
    const t = rEff / tanHalf;
    const pStart: Pt = [cur[0] + u1x * t, cur[1] + u1y * t];
    const pEnd: Pt = [cur[0] + u2x * t, cur[1] + u2y * t];
    const bisX = u1x + u2x, bisY = u1y + u2y, bisL = Math.hypot(bisX, bisY);
    if (bisL < 1e-9 || rEff < 1e-4) { out.push([r4(cur[0]), r4(cur[1])]); continue; }
    const distC = rEff / Math.sin(theta / 2);
    const cx = cur[0] + (bisX / bisL) * distC, cy = cur[1] + (bisY / bisL) * distC;
    const pMid: Pt = [cx - (bisX / bisL) * rEff, cy - (bisY / bisL) * rEff];
    const arc = arcFrom3Points(pStart, pMid, pEnd, maxSagitta);
    for (const q of arc) out.push(q);
  }
  const last = pts[pts.length - 1];
  out.push([r4(last[0]), r4(last[1])]);
  return out;
}

/** Discretiza uma barra curva (`arc` ou `fillet`) em polilinha com flecha `<= hRef / 8`. */
export function discretizeBarPath(
  bar: { path: readonly Pt[]; curve?: BarCurveSpec },
  hRef = 0.1,
): Pt[] {
  const maxSagitta = Math.max(0.002, hRef / 8);
  if (bar.curve?.type === "arc") {
    return arcFrom3Points(bar.curve.p1, bar.curve.p2, bar.curve.p3, maxSagitta);
  }
  if (bar.curve?.type === "fillet") {
    return filletPolyline(bar.path, bar.curve.radius, maxSagitta);
  }
  return bar.path.map((p) => [p[0], p[1]] as Pt);
}
