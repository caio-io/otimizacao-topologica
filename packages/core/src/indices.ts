import type { Problem } from "./types";
import { buildModel, solveBanded } from "./fe";
import { principalStresses } from "./stress";

/**
 * Índices de avaliação de Xia, Langelaar & Hendriks (2020), "A critical evaluation of topology
 * optimization results for strut-and-tie modeling of reinforced concrete":
 *  - TRS (Tensile Region Similarity): quão bem a topologia reproduz a região tracionada da peça cheia;
 *  - SR  (Steel Reinforcement ratio): volume de aço (σ1/fy nas regiões tracionadas) sobre o volume da peça.
 * O índice STS (equilíbrio axial da treliça extraída) NÃO é implementado: depende da extração do modelo.
 */

/** esqueletonização de Zhang–Suen em imagem (i = coluna, j = linha), armazenada como i*H + j */
export function thinning(img: Uint8Array, W: number, H: number): Uint8Array {
  const a = Uint8Array.from(img);
  const at = (i: number, j: number) => (i < 0 || j < 0 || i >= W || j >= H ? 0 : a[i * H + j]);
  for (let changed = true; changed; ) {
    changed = false;
    for (let step = 0; step < 2; step++) {
      const del: number[] = [];
      for (let i = 0; i < W; i++) for (let j = 0; j < H; j++) {
        if (!a[i * H + j]) continue;
        const p2 = at(i, j - 1), p3 = at(i + 1, j - 1), p4 = at(i + 1, j), p5 = at(i + 1, j + 1);
        const p6 = at(i, j + 1), p7 = at(i - 1, j + 1), p8 = at(i - 1, j), p9 = at(i - 1, j - 1);
        const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
        if (B < 2 || B > 6) continue;
        const seq = [p2, p3, p4, p5, p6, p7, p8, p9, p2];
        let A = 0;
        for (let k = 0; k < 8; k++) if (seq[k] === 0 && seq[k + 1] === 1) A++;
        if (A !== 1) continue;
        if (step === 0) { if (p2 * p4 * p6 !== 0 || p4 * p6 * p8 !== 0) continue; }
        else if (p2 * p4 * p8 !== 0 || p2 * p6 * p8 !== 0) continue;
        del.push(i * H + j);
      }
      for (const d of del) a[d] = 0;
      if (del.length) changed = true;
    }
  }
  return a;
}

/** comprimento total [m] do esqueleto (elos ortogonais = h; diagonais = √2·h quando não há caminho ortogonal) */
export function skeletonLength(sk: Uint8Array, W: number, H: number, h: number): number {
  const at = (i: number, j: number) => (i < 0 || j < 0 || i >= W || j >= H ? 0 : sk[i * H + j]);
  let L = 0;
  for (let i = 0; i < W; i++) for (let j = 0; j < H; j++) {
    if (!sk[i * H + j]) continue;
    if (at(i + 1, j)) L += h;
    if (at(i, j + 1)) L += h;
    if (at(i + 1, j + 1) && !at(i + 1, j) && !at(i, j + 1)) L += Math.SQRT2 * h;
    if (at(i - 1, j + 1) && !at(i - 1, j) && !at(i, j + 1)) L += Math.SQRT2 * h;
  }
  return L;
}

const EVOID = 1e-6;

/** tensões (σx, σy, τxy, σ1, σ2) por elemento, para um campo de módulos relativos Ee (1 = sólido) */
function stressesFor(p: Problem, Ee: Float64Array) {
  const m = buildModel(p), u = new Float64Array(m.ndof);
  solveBanded(m, p.nely, Ee, u);
  const f = principalStresses(p, u);
  const nel = p.nelx * p.nely;
  const sx = new Float64Array(nel), sy = new Float64Array(nel), txy = new Float64Array(nel);
  for (let e = 0; e < nel; e++) {
    const avg = 0.5 * (f.s1[e] + f.s2[e]), rad = 0.5 * (f.s1[e] - f.s2[e]);
    sx[e] = avg + rad * Math.cos(2 * f.theta[e]);
    sy[e] = avg - rad * Math.cos(2 * f.theta[e]);
    txy[e] = rad * Math.sin(2 * f.theta[e]);
  }
  return { s1: f.s1, s2: f.s2, sx, sy, txy };
}

export interface XiaIndices {
  /** índice TRS, 0–100 % */
  trs: number;
  /** relação de aço SR, % do volume da peça (fy = 450 MPa por padrão, como no artigo) */
  sr: number;
  /** comprimento total do esqueleto [m] e raio de média não local r0 [m] */
  skeletonLength: number;
  r0: number;
}

/**
 * Avalia uma topologia binária `solid` (1 = material, por elemento) contra a peça cheia.
 * Tensões em kN/m²; `fy` em kN/m² (450 MPa ⇒ 450e3).
 */
export function xiaIndices(p: Problem, solid: Uint8Array, opts: { fy?: number; r0?: number } = {}): XiaIndices {
  const { nelx, nely, h } = p, nel = nelx * nely, fy = opts.fy ?? 450e3;
  const domain = new Uint8Array(nel);
  for (let e = 0; e < nel; e++) domain[e] = p.mask[e] !== 0 ? 1 : 0;
  const Eori = Float64Array.from(domain, (d) => (d ? 1 : EVOID));
  const Eto = Float64Array.from(solid, (s, e) => (s && domain[e] ? 1 : EVOID));
  const ori = stressesFor(p, Eori), to = stressesFor(p, Eto);
  const nDomain = domain.reduce((s, d) => s + d, 0);

  // raio de média não local: r0 = V / (2·L·t) = A / (2·L)
  const sk = thinning(solid, nelx, nely);
  const L = skeletonLength(sk, nelx, nely, h);
  const r0 = opts.r0 ?? (nDomain * h * h) / (2 * L);

  const tensile = (S: ReturnType<typeof stressesFor>, e: number, active: boolean) =>
    active && S.s1[e] > 0 && S.s1[e] > -5 * S.s2[e];

  const R = Math.ceil(r0 / h);
  const offs: { di: number; dj: number; w: number }[] = [];
  for (let di = -R; di <= R; di++) for (let dj = -R; dj <= R; dj++) {
    const w = Math.max(0, r0 - h * Math.hypot(di, dj));
    if (w > 0) offs.push({ di, dj, w });
  }

  const averaged = (S: ReturnType<typeof stressesFor>, active: (e: number) => boolean) => {
    const out = new Float64Array(nel);
    for (let i = 0; i < nelx; i++) for (let j = 0; j < nely; j++) {
      const e = i * nely + j;
      if (!domain[e]) continue;
      let a = 0, b = 0, c = 0, ws = 0;
      for (const { di, dj, w } of offs) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= nelx || jj >= nely) continue;
        const k = ii * nely + jj;
        ws += w;
        if (!tensile(S, k, active(k))) continue;
        a += w * S.sx[k]; b += w * S.sy[k]; c += w * S.txy[k];
      }
      if (ws === 0) continue;
      a /= ws; b /= ws; c /= ws;
      out[e] = 0.5 * (a + b) + Math.hypot(0.5 * (a - b), c); // σ1 média
    }
    return out;
  };
  const aOri = averaged(ori, (k) => !!domain[k]);
  const aTo = averaged(to, (k) => !!(solid[k] && domain[k]));
  const mo = Math.max(...aOri), mt = Math.max(...aTo);
  const X: number[] = [], Y: number[] = [];
  for (let e = 0; e < nel; e++) if (domain[e]) { X.push(aOri[e] / (mo || 1)); Y.push(aTo[e] / (mt || 1)); }
  const mean = (v: number[]) => v.reduce((s, q) => s + q, 0) / v.length;
  const mx = mean(X), my = mean(Y);
  let vx = 0, vy = 0, cxy = 0;
  for (let k = 0; k < X.length; k++) { vx += (X[k] - mx) ** 2; vy += (Y[k] - my) ** 2; cxy += (X[k] - mx) * (Y[k] - my); }
  vx /= X.length; vy /= X.length; cxy /= X.length;
  const C1 = 1e-6, C2 = 1e-6;
  const trs = (((2 * mx * my + C1) * (2 * cxy + C2)) / ((mx * mx + my * my + C1) * (vx + vy + C2))) * 100;

  // SR: Σ max(σ1,0)/fy nos elementos tracionados da topologia, sobre o nº de elementos da peça
  let sr = 0;
  for (let e = 0; e < nel; e++) if (solid[e] && domain[e] && tensile(to, e, true)) sr += Math.max(to.s1[e], 0) / fy;
  return { trs, sr: (sr / nDomain) * 100, skeletonLength: L, r0 };
}

/**
 * Volume de aço [cm³] estimado a partir do campo de tensões da topologia (Queiroz & Leonel, 2025):
 * cada tirante recebe As = F/fyd com F = σ1 médio × área do tirante, logo V = ∫σ1 dV / fyd nas regiões tracionadas
 * (σ1 > 0 e σ1 > −5·σ2, como em Xia et al.). `fyd` em kN/m² (CA-50: 43,5 kN/cm² = 435 000 kN/m²).
 */
export function steelVolume(p: Problem, solid: Uint8Array, fyd = 435e3, ratio = 5): number {
  const nel = p.nelx * p.nely;
  const E = Float64Array.from({ length: nel }, (_, e) => (solid[e] && p.mask[e] !== 0 ? 1 : EVOID));
  const S = stressesFor(p, E);
  let v = 0;
  for (let e = 0; e < nel; e++) {
    if (!solid[e] || p.mask[e] === 0) continue;
    if (S.s1[e] > 0 && S.s1[e] > -ratio * S.s2[e]) v += S.s1[e] / fyd;
  }
  return v * p.h * p.h * p.t * 1e6; // m³ → cm³
}
