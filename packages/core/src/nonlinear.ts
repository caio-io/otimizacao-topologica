import type { Problem } from "./types";
import { buildModel, solveBandedAssembled } from "./fe";
import type { Scene } from "./scene";

/**
 * Nível 2 do roteiro CSFM: análise não linear de peças planas de concreto com armadura 1D.
 *
 * Hipóteses (livro do CSFM, cap. 3.2–3.3 e eq. 3.12):
 *  - concreto sem resistência à tração (σ1 = 0 se ε1 > 0); rigidez residual numérica só na matriz, nunca na tensão;
 *  - direções principais de tensão e de deformação coincidem (fissuras girantes);
 *  - em cada direção principal vale a lei uniaxial parábola-retângulo (ν = 0 nas direções principais), SEM
 *    amolecimento por tração transversal (kc2 = 1) — isso é o Nível 3;
 *  - armadura = barras de treliça sobre arestas da malha, ADERÊNCIA PERFEITA (só para teste de equilíbrio
 *    e capacidade; não é modelo de projeto);
 *  - solução por rigidez secante com correção pelo resíduo e controle de carga com bissecção.
 * Unidades: kN e m (tensões em kN/m²).
 */

export interface ConcreteLaw {
  /** resistência de projeto à compressão no patamar [kN/m²] */
  fc: number;
  /** deformação ao início do patamar (0,002) */
  eps0: number;
  /** deformação última na compressão (0,0035) — usada como limite de verificação */
  epsu: number;
}

/** Parábola-retângulo da NBR 6118/EC2: fc = 0,85·fck/γc (fck ≤ 50 MPa), εc2 = 2 ‰, εcu = 3,5 ‰. */
export const nbrConcrete = (fckMPa: number, gammaC = 1.4): ConcreteLaw => ({
  fc: (0.85 * fckMPa * 1000) / gammaC, eps0: 0.002, epsu: 0.0035,
});

export interface SteelLaw {
  fy: number; ft: number; Es: number;
  /** deformação na ruptura (limite de verificação) */
  epsU: number;
}

/** Aço CA-50 com valores de projeto: fyd = 500/1,15, ft = 1,08·fy, Es = 210 GPa, εu = 5 %. */
export const ca50: SteelLaw = { fy: 500e3 / 1.15, ft: 1.08 * (500e3 / 1.15), Es: 210e6, epsU: 0.05 };

export interface Bar {
  /** extremidades em coordenadas da cena; a barra precisa ser horizontal ou vertical e estar sobre linhas da malha */
  x0: number; y0: number; x1: number; y1: number;
  /** área total da armadura [m²] */
  area: number;
  steel: SteelLaw;
  label?: string;
  /**
   * Poligonal da barra em coordenadas da cena. Se existir, a barra é EMBUTIDA (aderência perfeita, qualquer direção,
   * sem GDLs próprios): a deformação axial da barra é a do concreto na sua direção, avaliada em trechos de h/4.
   * Sem `path`, a barra tem de ser horizontal/vertical sobre linhas da malha (elementos de treliça).
   */
  path?: [number, number][];
}

export interface NlOptions {
  concrete: ConcreteLaw;
  bars?: Bar[];
  /** origem da malha na cena (BuildResult.origin); padrão (0,0) */
  origin?: { x: number; y: number };
  /** verifica |ε3| ≥ epsu no concreto como critério de ruptura (padrão: sim) */
  checkCrushing?: boolean;
  /**
   * comprimento de esmagamento [m]: se informado, o critério |ε3| ≥ epsu usa a deformação de compressão MÉDIA numa janela
   * desse comprimento (como recomenda o livro do CSFM), em vez do valor em cada ponto — evita parada precoce por picos
   * locais sob placas (dependência de malha).
   */
  crushLength?: number;
  /** passo inicial de carga, em múltiplos da carga de referência (padrão 0,1) */
  dLambda?: number;
  /** carga máxima, em múltiplos da carga de referência (padrão 1e4) */
  lambdaMax?: number;
  /** tolerância do resíduo relativo (padrão 1e-4) */
  tol?: number;
  /** emite um `NlStep` a cada passo convergido (uso em `solveNonlinearSteps`, p. ex. para mostrar o progresso) */
  stepwise?: boolean;
  /** usa a rigidez tangente (com piso) no lugar da secante; converge bem mais perto do patamar (padrão: sim) */
  tangent?: boolean;
  maxIt?: number;
}

export type NlMode = "CC" | "FR" | "divergencia" | "lambdaMax";

export interface NlBarResult { label: string; axialMax: number; strainMax: number; yielded: boolean }

export interface NlResult {
  /** fator de carga último (múltiplo da carga de referência do Problem) */
  lambda: number;
  mode: NlMode;
  u: Float64Array;
  bars: NlBarResult[];
  /** maior encurtamento principal no concreto [‰ como fração] */
  maxCompStrain: number;
  /** equilíbrio global: |ΣR + ΣF| / |ΣF| em x e y */
  equilibrium: { x: number; y: number };
  steps: { lambda: number; its: number; rel: number }[];
  /** reação por GDL [kN] (R = fint − λ·fRaw nos GDLs restringidos; zero nos demais) */
  reaction: Float64Array;
  /** forças axiais [kN] por elemento de barra no estado último, na ordem das barras */
  barForces: Float64Array[];
  /** encurtamento principal médio por elemento (compressão, valor positivo) */
  epsComp: Float64Array;
  /** deformação principal de tração média por elemento (> 0 ⇒ concreto fissurado) */
  epsTens: Float64Array;
  /** pontos de amostra das barras com a força axial [kN] (para desenho) */
  barSamples: { x: number; y: number; N: number }[][];
  /** deformação de compressão usada no critério de esmagamento (média na janela, se `crushLength`) */
  crushStrain: number;
  /** avisos (p. ex. trechos de barra ligados ao elemento vizinho numa malha grossa) */
  notes: string[];
}

/** estado de um passo de carga convergido (só emitido com `stepwise: true`) */
export interface NlStep {
  lambda: number; its: number;
  u: Float64Array; epsComp: Float64Array; epsTens: Float64Array;
  barSamples: { x: number; y: number; N: number }[][];
  maxEpsC: number; crushStrain: number; notes: string[];
}

interface BarEl { a: number; b: number; cx: number; cy: number; bar: number }

const GP = 1 / Math.sqrt(3);
const XI = [-1, 1, 1, -1], ETA = [-1, -1, 1, 1];

function concreteSigma(c: ConcreteLaw, e: number) {
  if (e <= c.eps0) { const r = 1 - e / c.eps0; return c.fc * (1 - r * r); }
  return c.fc;
}

function steelSigma(s: SteelLaw, eps: number) {
  const a = Math.abs(eps), ey = s.fy / s.Es, sg = Math.sign(eps);
  if (a <= ey) return s.Es * eps;
  const Esh = (s.ft - s.fy) / (s.epsU - ey);
  return sg * (s.fy + Esh * (Math.min(a, s.epsU) - ey));
}


/** maior média de `v` (campo por elemento nelx×nely, índice i*nely+j) numa janela quadrada de raio R elementos */
function windowMax(v: Float64Array, nelx: number, nely: number, R: number): number {
  if (R <= 0) return v.reduce((m, x) => Math.max(m, x), 0);
  const W = nelx + 1, H = nely + 1, S = new Float64Array(W * H); // soma acumulada
  for (let i = 0; i < nelx; i++) for (let j = 0; j < nely; j++) S[(i + 1) * H + (j + 1)] = v[i * nely + j] + S[i * H + (j + 1)] + S[(i + 1) * H + j] - S[i * H + j];
  let best = 0;
  for (let i = 0; i < nelx; i++) for (let j = 0; j < nely; j++) {
    if (v[i * nely + j] === 0) continue;
    // janela fixa (2R+1)² deslocada para caber na malha, dividida pela área inteira (elementos vazios contam zero)
    const i0 = Math.max(0, Math.min(nelx - (2 * R + 1), i - R)), j0 = Math.max(0, Math.min(nely - (2 * R + 1), j - R));
    const i1 = Math.min(nelx, i0 + 2 * R + 1), j1 = Math.min(nely, j0 + 2 * R + 1);
    const sum = S[i1 * H + j1] - S[i0 * H + j1] - S[i1 * H + j0] + S[i0 * H + j0];
    best = Math.max(best, sum / ((2 * R + 1) * (2 * R + 1)));
  }
  return best;
}

function steelTangent(s: SteelLaw, eps: number) {
  const ey = s.fy / s.Es;
  if (Math.abs(eps) <= ey) return s.Es;
  return Math.max((s.ft - s.fy) / (s.epsU - ey), 1e-3 * s.Es);
}

export function* solveNonlinearSteps(p: Problem, opt: NlOptions): Generator<NlStep, NlResult> {
  const { nelx, nely, h, t } = p;
  const m = buildModel(p);
  const { ndof, edof } = m;
  const c = opt.concrete, bars = opt.bars ?? [];
  const origin = opt.origin ?? { x: 0, y: 0 };
  const tol = opt.tol ?? 1e-4, maxIt = opt.maxIt ?? 150;
  const check = opt.checkCrushing ?? true;
  const E0 = (2 * c.fc) / c.eps0, Ecr = 1e-4 * E0;
  const useTan = opt.tangent ?? true;
  const Efloor = 1e-3 * E0;

  // ---- barras → elementos de treliça sobre arestas da malha
  const nodeId = (i: number, j: number) => i * (nely + 1) + j;
  const barEls: BarEl[] = [];
  bars.forEach((bar, k) => {
    if (bar.path) return;
    const ci = (x: number) => Math.round((x - origin.x) / h), cj = (y: number) => nely - Math.round((y - origin.y) / h);
    const i0 = ci(bar.x0), i1 = ci(bar.x1), j0 = cj(bar.y0), j1 = cj(bar.y1);
    const onGrid = Math.abs(origin.x + i0 * h - bar.x0) < 1e-6 && Math.abs(origin.x + i1 * h - bar.x1) < 1e-6
      && Math.abs(origin.y + (nely - j0) * h - bar.y0) < 1e-6 && Math.abs(origin.y + (nely - j1) * h - bar.y1) < 1e-6;
    if (!onGrid || (i0 !== i1 && j0 !== j1)) throw new Error(`barra ${bar.label ?? k}: precisa ser horizontal ou vertical e estar sobre linhas da malha`);
    if (i0 !== i1) {
      const [a, b] = i0 < i1 ? [i0, i1] : [i1, i0];
      for (let i = a; i < b; i++) barEls.push({ a: nodeId(i, j0), b: nodeId(i + 1, j0), cx: 1, cy: 0, bar: k });
    } else {
      const [a, b] = j0 > j1 ? [j0, j1] : [j1, j0]; // j cresce para baixo: de baixo (j grande) para cima
      for (let j = a; j > b; j--) barEls.push({ a: nodeId(i0, j), b: nodeId(i0, j - 1), cx: 0, cy: 1, bar: k });
    }
  });

  // ---- barras embutidas: trechos de ~h/4 com o vetor g (ε_axial = g·u_e) do elemento que contém o ponto médio
  interface Piece { e: number; g: Float64Array; len: number; bar: number; xm: number; ym: number }
  const pieces: Piece[] = [];
  let projected = 0; // trechos cujo elemento natural é vazio (malha grossa) e foram ligados ao elemento de concreto vizinho
  bars.forEach((bar, k) => {
    if (!bar.path) return;
    for (let q = 0; q + 1 < bar.path.length; q++) {
      const [xa, ya] = bar.path[q], [xb, yb] = bar.path[q + 1];
      const L = Math.hypot(xb - xa, yb - ya);
      if (L < 1e-9) continue;
      const n = Math.max(1, Math.ceil(L / (h / 4))), len = L / n, cs = (xb - xa) / L, sn = (yb - ya) / L;
      const m0 = cs * cs, m1 = sn * sn, m2 = cs * sn;
      for (let r = 0; r < n; r++) {
        const x = xa + ((r + 0.5) / n) * (xb - xa) - origin.x, y = ya + ((r + 0.5) / n) * (yb - ya) - origin.y;
        const ie = Math.min(nelx - 1, Math.max(0, Math.floor(x / h))), jy = Math.min(nely - 1, Math.max(0, Math.floor(y / h)));
        let iu = ie, ju = jy; // coluna e linha (de baixo para cima) do elemento hospedeiro
        if (p.mask[ie * nely + (nely - 1 - jy)] === 0) {
          // o contorno inclinado vira "escada" na malha: o elemento que contém o ponto pode ser vazio mesmo com a barra dentro
          // da peça. Usa o elemento de concreto mais próximo (até 3 elementos) e prende as coordenadas locais ao elemento.
          let best = Infinity;
          for (let di = -3; di <= 3; di++) for (let dj = -3; dj <= 3; dj++) {
            const ci = ie + di, cj = jy + dj;
            if (ci < 0 || cj < 0 || ci >= nelx || cj >= nely || p.mask[ci * nely + (nely - 1 - cj)] === 0) continue;
            const dx = Math.max(ci * h - x, 0, x - (ci + 1) * h), dy = Math.max(cj * h - y, 0, y - (cj + 1) * h), d = dx * dx + dy * dy;
            if (d < best) { best = d; iu = ci; ju = cj; }
          }
          if (best === Infinity) throw new Error(`barra ${bar.label ?? k}: trecho fora da geometria em (${(x + origin.x).toFixed(3)}, ${(y + origin.y).toFixed(3)}); refine a malha (elemento menor)`);
          projected++;
        }
        const e = iu * nely + (nely - 1 - ju);
        const clamp = (v: number) => Math.max(-1, Math.min(1, v));
        const xi = clamp(2 * (x - iu * h) / h - 1), eta = clamp(2 * (y - ju * h) / h - 1);
        const g = new Float64Array(8);
        for (let a = 0; a < 4; a++) {
          const dnx = (XI[a] * (1 + ETA[a] * eta)) / (2 * h), dny = (ETA[a] * (1 + XI[a] * xi)) / (2 * h);
          g[2 * a] = m0 * dnx + m2 * dny;
          g[2 * a + 1] = m1 * dny + m2 * dnx;
        }
        pieces.push({ e, g, len, bar: k, xm: x + origin.x, ym: y + origin.y });
      }
    }
  });

  const notes: string[] = projected ? [`${projected} trechos de barra caíram em elementos vazios (malha grossa) e foram ligados ao elemento de concreto vizinho; refine a malha para mais precisão.`] : [];

  // posição de cada amostra de força, na mesma ordem em que `assemble` empilha as forças de cada barra
  const nodeXY = (n: number): [number, number] => [origin.x + Math.floor(n / (nely + 1)) * h, origin.y + (nely - (n % (nely + 1))) * h];
  const samplePos: [number, number][][] = bars.map(() => []);
  for (const be of barEls) { const a = nodeXY(be.a), b = nodeXY(be.b); samplePos[be.bar].push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]); }
  for (const pc of pieces) samplePos[pc.bar].push([pc.xm, pc.ym]);
  const samplesOf = (a: { barForces: Float64Array[] }) => bars.map((_, k) => Array.from(a.barForces[k], (N, q) => ({ x: samplePos[k][q][0], y: samplePos[k][q][1], N })));
  const crushOf = (a: { epsEl: Float64Array; maxEpsC: number }) => (opt.crushLength ? windowMax(a.epsEl, nelx, nely, Math.max(0, Math.round(opt.crushLength / (2 * h)))) : a.maxEpsC);

  // GDLs sem rigidez (só tocam vazios) viram restrições
  const used = new Uint8Array(ndof);
  for (let e = 0; e < nelx * nely; e++) if (p.mask[e] !== 0) for (let a = 0; a < 8; a++) used[edof[e * 8 + a]] = 1;
  for (const be of barEls) for (const n of [be.a, be.b]) { used[2 * n] = 1; used[2 * n + 1] = 1; }
  const fixedEff = new Uint8Array(ndof);
  for (let d = 0; d < ndof; d++) fixedEff[d] = m.isFixed[d] || !used[d] ? 1 : 0;

  const bw = 2 * nely + 5, w = bw + 1;
  const dV = (h / 2) * (h / 2) * t;
  const fRef = m.f;

  // pré-cálculo das derivadas das funções de forma nos 4 pontos de Gauss
  const dNx = new Float64Array(16), dNy = new Float64Array(16);
  for (let g = 0; g < 4; g++) {
    const xi = (g & 1 ? 1 : -1) * GP, eta = (g & 2 ? 1 : -1) * GP;
    for (let a = 0; a < 4; a++) {
      dNx[g * 4 + a] = (XI[a] * (1 + ETA[a] * eta)) / (2 * h);
      dNy[g * 4 + a] = (ETA[a] * (1 + XI[a] * xi)) / (2 * h);
    }
  }

  interface Asm { L: Float64Array; fint: Float64Array; maxEpsC: number; epsEl: Float64Array; epsT: Float64Array; barForces: Float64Array[]; barEps: number[]; yielded: boolean[] }

  const assemble = (u: Float64Array): Asm => {
    const L = new Float64Array(ndof * w);
    const fint = new Float64Array(ndof);
    let maxEpsC = 0;
    const epsEl = new Float64Array(nelx * nely), epsT = new Float64Array(nelx * nely);
    const ue = new Float64Array(8), Ke = new Float64Array(64), B = new Float64Array(24), DB = new Float64Array(24), fe = new Float64Array(8);
    for (let e = 0; e < nelx * nely; e++) {
      if (p.mask[e] === 0) continue;
      const b0 = e * 8;
      for (let a = 0; a < 8; a++) ue[a] = u[edof[b0 + a]];
      Ke.fill(0); fe.fill(0);
      for (let g = 0; g < 4; g++) {
        // deformações no ponto de Gauss
        let ex = 0, ey = 0, gm = 0;
        for (let a = 0; a < 4; a++) {
          const nx = dNx[g * 4 + a], ny = dNy[g * 4 + a], ux = ue[2 * a], uy = ue[2 * a + 1];
          ex += nx * ux; ey += ny * uy; gm += ny * ux + nx * uy;
        }
        const avg = 0.5 * (ex + ey), rad = Math.hypot(0.5 * (ex - ey), 0.5 * gm);
        const e1 = avg + rad, e3 = avg - rad;
        if (e1 > 0) epsT[e] += e1 / 4;
        const th = 0.5 * Math.atan2(gm, ex - ey), cs = Math.cos(th), sn = Math.sin(th);
        // leis uniaxiais nas direções principais
        const fresh = rad < 1e-14 && Math.abs(avg) < 1e-14;
        let s1 = 0, s3 = 0, E1 = Ecr, E3 = Ecr;
        if (fresh) { E1 = E3 = E0; }
        else {
          if (e1 < 0) { s1 = -concreteSigma(c, -e1); E1 = s1 / e1; }
          if (e3 < 0) { s3 = -concreteSigma(c, -e3); E3 = s3 / e3; }
          if (e3 < 0) { maxEpsC = Math.max(maxEpsC, -e3); epsEl[e] += -e3 / 4; }
        }
        const G = rad > 1e-12 ? (s1 - s3) / (2 * (e1 - e3)) : 0.25 * (E1 + E3);
        if (useTan && !fresh) {
          // módulos tangentes nas direções principais (piso para manter a matriz definida positiva)
          if (e1 < 0) E1 = Math.max(Efloor, -e1 < c.eps0 ? E0 * (1 + e1 / c.eps0) : 0);
          if (e3 < 0) E3 = Math.max(Efloor, -e3 < c.eps0 ? E0 * (1 + e3 / c.eps0) : 0);
        }
        const Gs = Math.max(G, 1e-6 * E0);
        // σ global (coaxial) e D secante = Tεᵀ·diag(E1,E3,G)·Tε
        const sx = s1 * cs * cs + s3 * sn * sn, sy = s1 * sn * sn + s3 * cs * cs, tx = (s1 - s3) * sn * cs;
        const sc = sn * cs, c2 = cs * cs, s2 = sn * sn;
        const r1 = [c2, s2, sc], r3 = [s2, c2, -sc], rg = [-2 * sc, 2 * sc, c2 - s2];
        const D = new Float64Array(9);
        for (let r = 0; r < 3; r++) for (let q = 0; q < 3; q++) D[r * 3 + q] = E1 * r1[r] * r1[q] + E3 * r3[r] * r3[q] + Gs * rg[r] * rg[q];
        // B (3×8)
        B.fill(0);
        for (let a = 0; a < 4; a++) {
          const nx = dNx[g * 4 + a], ny = dNy[g * 4 + a];
          B[2 * a] = nx; B[8 + 2 * a + 1] = ny; B[16 + 2 * a] = ny; B[16 + 2 * a + 1] = nx;
        }
        for (let r = 0; r < 3; r++) for (let q = 0; q < 8; q++) DB[r * 8 + q] = D[r * 3] * B[q] + D[r * 3 + 1] * B[8 + q] + D[r * 3 + 2] * B[16 + q];
        for (let r = 0; r < 8; r++) {
          fe[r] += (B[r] * sx + B[8 + r] * sy + B[16 + r] * tx) * dV;
          for (let q = 0; q < 8; q++) Ke[r * 8 + q] += (B[r] * DB[q] + B[8 + r] * DB[8 + q] + B[16 + r] * DB[16 + q]) * dV;
        }
      }
      for (let a = 0; a < 8; a++) {
        const i = edof[b0 + a];
        fint[i] += fe[a];
        if (fixedEff[i]) continue;
        for (let q = 0; q < 8; q++) {
          const j = edof[b0 + q];
          if (j > i || fixedEff[j]) continue;
          L[i * w + (bw - (i - j))] += Ke[a * 8 + q];
        }
      }
    }
    // barras
    const barForces = bars.map(() => new Float64Array(0));
    const perBar: number[][] = bars.map(() => []);
    const barEps = bars.map(() => 0), yielded = bars.map(() => false);
    for (const be of barEls) {
      const bar = bars[be.bar], s = bar.steel;
      const da = [2 * be.a, 2 * be.a + 1, 2 * be.b, 2 * be.b + 1];
      const eps = ((u[da[2]] - u[da[0]]) * be.cx + (u[da[3]] - u[da[1]]) * be.cy) / h;
      const sg = steelSigma(s, eps);
      const Esec = useTan ? steelTangent(s, eps) : Math.abs(eps) > 1e-12 ? Math.max(sg / eps, 1e-3 * s.Es) : s.Es;
      const k = (bar.area * Esec) / h, N = bar.area * sg;
      perBar[be.bar].push(N);
      barEps[be.bar] = Math.max(barEps[be.bar], Math.abs(eps));
      if (Math.abs(eps) > s.fy / s.Es) yielded[be.bar] = true;
      const dir = [-be.cx, -be.cy, be.cx, be.cy];
      for (let a = 0; a < 4; a++) {
        fint[da[a]] += N * dir[a];
        if (fixedEff[da[a]]) continue;
        for (let q = 0; q < 4; q++) {
          if (da[q] > da[a] || fixedEff[da[q]]) continue;
          L[da[a] * w + (bw - (da[a] - da[q]))] += k * dir[a] * dir[q];
        }
      }
    }
    for (const pc of pieces) {
      const bar = bars[pc.bar], st = bar.steel, b0 = pc.e * 8;
      let eps = 0;
      for (let a = 0; a < 8; a++) eps += pc.g[a] * u[edof[b0 + a]];
      const sg = steelSigma(st, eps);
      const Esec = useTan ? steelTangent(st, eps) : Math.abs(eps) > 1e-12 ? Math.max(sg / eps, 1e-3 * st.Es) : st.Es;
      const N = bar.area * sg, kk = bar.area * Esec * pc.len;
      perBar[pc.bar].push(N);
      barEps[pc.bar] = Math.max(barEps[pc.bar], Math.abs(eps));
      if (Math.abs(eps) > st.fy / st.Es) yielded[pc.bar] = true;
      for (let a = 0; a < 8; a++) {
        const i = edof[b0 + a];
        fint[i] += N * pc.len * pc.g[a];
        if (fixedEff[i]) continue;
        for (let q = 0; q < 8; q++) {
          const j = edof[b0 + q];
          if (j > i || fixedEff[j]) continue;
          L[i * w + (bw - (i - j))] += kk * pc.g[a] * pc.g[q];
        }
      }
    }
    perBar.forEach((arr, k) => { barForces[k] = Float64Array.from(arr); });
    return { L, fint, maxEpsC, epsEl, epsT, barForces, barEps, yielded };
  };

  // ---- equilíbrio em um nível de carga: correção pelo resíduo com rigidez secante
  const rhsLam = new Float64Array(ndof), du = new Float64Array(ndof), R = new Float64Array(ndof);
  const equilibrate = (lam: number, u0: Float64Array) => {
    const u = u0.slice();
    let nf = 0;
    for (let d = 0; d < ndof; d++) { rhsLam[d] = fixedEff[d] ? 0 : lam * fRef[d]; nf += rhsLam[d] * rhsLam[d]; }
    nf = Math.sqrt(nf) || 1;
    let asm = assemble(u), rel = Infinity, its = 0;
    for (; its < maxIt; its++) {
      let nr = 0;
      for (let d = 0; d < ndof; d++) { R[d] = fixedEff[d] ? 0 : rhsLam[d] - asm.fint[d]; nr += R[d] * R[d]; }
      rel = Math.sqrt(nr) / nf;
      if (rel < tol) return { ok: true, u, asm, rel, its };
      solveBandedAssembled(asm.L, ndof, bw, fixedEff, R, du);
      let bad = false;
      for (let d = 0; d < ndof; d++) { u[d] += du[d]; if (!Number.isFinite(u[d])) bad = true; }
      if (bad) return { ok: false, u, asm, rel, its };
      asm = assemble(u);
    }
    return { ok: false, u, asm, rel, its };
  };

  // ---- passo de carga com bissecção até o limite
  const steps: NlResult["steps"] = [];
  let lamGood = 0, uGood = new Float64Array(ndof), asmGood = assemble(uGood);
  let dl = opt.dLambda ?? 0.1;
  const lamMax = opt.lambdaMax ?? 1e4;
  let mode: NlMode = "lambdaMax";
  const dlMin = 1e-6;
  let everFailed = false;
  for (let guard = 0; guard < 2000; guard++) {
    const lamTry = Math.min(lamGood + dl, lamMax);
    const eq = equilibrate(lamTry, uGood);
    let failMode: NlMode | null = null;
    // classifica pelo estado (convergido ou última iteração): ruptura do aço, esmagamento ou divergência pura
    const epsCheck = opt.crushLength ? windowMax(eq.asm.epsEl, nelx, nely, Math.max(0, Math.round(opt.crushLength / (2 * h)))) : eq.asm.maxEpsC;
    if (check && epsCheck >= c.epsu) failMode = "CC";
    for (let k = 0; k < bars.length; k++) if (eq.asm.barEps[k] >= bars[k].steel.epsU) failMode = "FR";
    // sem convergência: se o concreto chegou ao patamar (≥ 0,95·ε0) é esgotamento da resistência do concreto (CC),
    // como no livro (Tab. 4.5: "divergência por resistência do concreto atingida"); caso contrário, divergência pura
    if (!failMode && !eq.ok) failMode = eq.asm.maxEpsC >= 0.95 * c.eps0 ? "CC" : "divergencia";
    if (failMode) {
      mode = failMode; everFailed = true;
      if (dl <= dlMin || dl <= 1e-3 * Math.max(lamGood, 1e-3)) break;
      dl /= 2;
      continue;
    }
    lamGood = lamTry; uGood = eq.u; asmGood = eq.asm;
    steps.push({ lambda: lamGood, its: eq.its, rel: eq.rel });
    if (opt.stepwise) yield { lambda: lamGood, its: eq.its, u: uGood.slice(), epsComp: asmGood.epsEl.slice(), epsTens: asmGood.epsT.slice(), barSamples: samplesOf(asmGood), maxEpsC: asmGood.maxEpsC, crushStrain: crushOf(asmGood), notes };
    if (lamGood >= lamMax) { mode = "lambdaMax"; break; }
    if (!everFailed && eq.its <= 6) dl *= 1.5;
  }

  // reações nos GDLs restringidos: R = fint − λ·fRaw; equilíbrio global: ΣR + λ·ΣF = 0
  let fx = 0, fy = 0, rx = 0, ry = 0;
  for (let d = 0; d < ndof; d += 2) {
    fx += lamGood * m.fRaw[d]; fy += lamGood * m.fRaw[d + 1];
    if (m.isFixed[d]) rx += asmGood.fint[d] - lamGood * m.fRaw[d];
    if (m.isFixed[d + 1]) ry += asmGood.fint[d + 1] - lamGood * m.fRaw[d + 1];
  }
  const reaction = new Float64Array(ndof);
  for (let d = 0; d < ndof; d++) if (m.isFixed[d]) reaction[d] = asmGood.fint[d] - lamGood * m.fRaw[d];
  const eqx = Math.abs(fx) > 1e-9 ? Math.abs(rx + fx) / Math.abs(fx) : Math.abs(rx);
  const eqy = Math.abs(fy) > 1e-9 ? Math.abs(ry + fy) / Math.abs(fy) : Math.abs(ry);

  return {
    lambda: lamGood, mode, u: uGood,
    bars: bars.map((b, k) => ({
      label: b.label ?? `B${k + 1}`,
      axialMax: asmGood.barForces[k].reduce((s, v) => Math.max(s, Math.abs(v)), 0),
      strainMax: asmGood.barEps[k], yielded: asmGood.yielded[k],
    })),
    maxCompStrain: asmGood.maxEpsC,
    equilibrium: { x: eqx, y: eqy },
    steps, barForces: asmGood.barForces, reaction,
    epsComp: asmGood.epsEl, epsTens: asmGood.epsT, barSamples: samplesOf(asmGood), crushStrain: crushOf(asmGood), notes,
  };
}

/** versão síncrona: roda todos os passos e devolve o resultado final */
export function solveNonlinear(p: Problem, opt: NlOptions): NlResult {
  const g = solveNonlinearSteps(p, { ...opt, stepwise: false });
  let r = g.next();
  while (!r.done) r = g.next();
  return r.value;
}

/** barras da cena (cm², MPa, GPa) → barras do solver (m², kN/m²) */
export function barsFromScene(s: Scene): Bar[] {
  return (s.bars ?? []).map((b) => ({
    x0: 0, y0: 0, x1: 0, y1: 0, path: b.path, area: b.areaCm2 * 1e-4, label: b.label,
    steel: { fy: b.fy * 1e3, ft: b.ft * 1e3, Es: b.Es * 1e6, epsU: b.epsU },
  }));
}

/** concreto da cena: valores médios (fc = fck) ou de projeto (0,85·fck/γc, γc = 1,4) */
export function concreteFromScene(s: Scene): ConcreteLaw {
  const fck = s.fck ?? 30, nl = s.nl ?? { values: "design", epsCu: 0.0035, crushLength: 0 };
  const c = nl.values === "mean" ? { fc: fck * 1000, eps0: 0.002, epsu: nl.epsCu } : { ...nbrConcrete(fck), epsu: nl.epsCu };
  return c;
}
