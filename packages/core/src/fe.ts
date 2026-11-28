import type { Problem } from "./types";

/** Matriz de rigidez do Q4 quadrado, E=1, t=1 (independe do lado h em estado plano). Ordem: BL, BR, TR, TL. */
export type ElementKind = "q4" | "qm6";

/**
 * Rigidez do elemento quadrado (E=1, t=1; em estado plano não depende do lado).
 * `qm6` (padrão): Q4 com 2 modos incompatíveis por direção (Wilson–Taylor), condensados estaticamente.
 * Elimina o travamento por cisalhamento do Q4 puro na flexão; continua uma matriz 8×8 constante.
 */
export function elementStiffness(nu: number, kind: ElementKind = "qm6"): Float64Array {
  return kind === "q4" ? elementStiffnessQ4(nu) : elementStiffnessQM6(nu);
}

function elementStiffnessQM6(nu: number): Float64Array {
  // quadrado [-1,1]² (J = 1 em coordenadas físicas x=ξ, y=η); nós: BL, BR, TR, TL
  const xs = [-1, 1, 1, -1], ys = [-1, -1, 1, 1];
  const cf = 1 / (1 - nu * nu);
  const D = [cf, cf * nu, 0, cf * nu, cf, 0, 0, 0, cf * (1 - nu) / 2];
  const g = 1 / Math.sqrt(3);
  const Kuu = new Float64Array(64), Kua = new Float64Array(32), Kaa = new Float64Array(16);
  const B = new Float64Array(24), Ba = new Float64Array(12); // 3×8 e 3×4
  for (const xi of [-g, g]) for (const eta of [-g, g]) {
    B.fill(0); Ba.fill(0);
    for (let a = 0; a < 4; a++) {
      const dNx = xs[a] * (1 + ys[a] * eta) / 4, dNy = ys[a] * (1 + xs[a] * xi) / 4;
      B[2 * a] = dNx; B[8 + 2 * a + 1] = dNy; B[16 + 2 * a] = dNy; B[16 + 2 * a + 1] = dNx;
    }
    // modos: u = φ1·a1 + φ2·a2, v = φ1·a3 + φ2·a4, com φ1 = ξ²−1, φ2 = η²−1
    Ba[0] = 2 * xi;                 // εx  ← a1
    Ba[4 + 3] = 2 * eta;            // εy  ← a4
    Ba[8 + 1] = 2 * eta;            // γxy ← a2 (u,y)
    Ba[8 + 2] = 2 * xi;             // γxy ← a3 (v,x)
    const DB = new Float64Array(24), DBa = new Float64Array(12);
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 8; c++) DB[r * 8 + c] = D[r * 3] * B[c] + D[r * 3 + 1] * B[8 + c] + D[r * 3 + 2] * B[16 + c];
      for (let c = 0; c < 4; c++) DBa[r * 4 + c] = D[r * 3] * Ba[c] + D[r * 3 + 1] * Ba[4 + c] + D[r * 3 + 2] * Ba[8 + c];
    }
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) { let s = 0; for (let k = 0; k < 3; k++) s += B[k * 8 + r] * DB[k * 8 + c]; Kuu[r * 8 + c] += s; }
      for (let c = 0; c < 4; c++) { let s = 0; for (let k = 0; k < 3; k++) s += B[k * 8 + r] * DBa[k * 4 + c]; Kua[r * 4 + c] += s; }
    }
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) { let s = 0; for (let k = 0; k < 3; k++) s += Ba[k * 4 + r] * DBa[k * 4 + c]; Kaa[r * 4 + c] += s; }
  }
  // X = Kaa⁻¹ · Kauᵀ (4×8) por eliminação de Gauss; K = Kuu − Kua · X
  const A = Float64Array.from(Kaa), X = new Float64Array(32);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 8; c++) X[r * 8 + c] = Kua[c * 4 + r];
  for (let k = 0; k < 4; k++) {
    let piv = k;
    for (let r = k + 1; r < 4; r++) if (Math.abs(A[r * 4 + k]) > Math.abs(A[piv * 4 + k])) piv = r;
    if (piv !== k) {
      for (let c = 0; c < 4; c++) { const t = A[k * 4 + c]; A[k * 4 + c] = A[piv * 4 + c]; A[piv * 4 + c] = t; }
      for (let c = 0; c < 8; c++) { const t = X[k * 8 + c]; X[k * 8 + c] = X[piv * 8 + c]; X[piv * 8 + c] = t; }
    }
    for (let r = k + 1; r < 4; r++) {
      const f = A[r * 4 + k] / A[k * 4 + k];
      for (let c = k; c < 4; c++) A[r * 4 + c] -= f * A[k * 4 + c];
      for (let c = 0; c < 8; c++) X[r * 8 + c] -= f * X[k * 8 + c];
    }
  }
  for (let k = 3; k >= 0; k--) {
    for (let c = 0; c < 8; c++) {
      let s = X[k * 8 + c];
      for (let j = k + 1; j < 4; j++) s -= A[k * 4 + j] * X[j * 8 + c];
      X[k * 8 + c] = s / A[k * 4 + k];
    }
  }
  const KE = new Float64Array(64);
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    let s = Kuu[r * 8 + c];
    for (let k = 0; k < 4; k++) s -= Kua[r * 4 + k] * X[k * 8 + c];
    KE[r * 8 + c] = s;
  }
  // simetriza (remove ruído numérico)
  for (let r = 0; r < 8; r++) for (let c = r + 1; c < 8; c++) { const m = 0.5 * (KE[r * 8 + c] + KE[c * 8 + r]); KE[r * 8 + c] = m; KE[c * 8 + r] = m; }
  return KE;
}

export function elementStiffnessQ4(nu: number): Float64Array {
  const A11 = [12, 3, -6, -3, 3, 12, 3, 0, -6, 3, 12, -3, -3, 0, -3, 12];
  const A12 = [-6, -3, 0, 3, -3, -6, -3, -6, 0, -3, -6, 3, 3, -6, 3, -6];
  const B11 = [-4, 3, -2, 9, 3, -4, -9, 4, -2, -9, -4, -3, 9, 4, -3, -4];
  const B12 = [2, -3, 4, -9, -3, 2, 9, -2, 4, 9, 2, 3, -9, -2, 3, 2];
  const KE = new Float64Array(64);
  const c = 1 / (1 - nu * nu) / 24;
  for (let r = 0; r < 4; r++) {
    for (let s = 0; s < 4; s++) {
      const a11 = A11[r * 4 + s], a12 = A12[r * 4 + s];
      const a12t = A12[s * 4 + r];
      const b11 = B11[r * 4 + s], b12 = B12[r * 4 + s];
      const b12t = B12[s * 4 + r];
      KE[r * 8 + s] = c * (a11 + nu * b11);
      KE[r * 8 + (s + 4)] = c * (a12 + nu * b12);
      KE[(r + 4) * 8 + s] = c * (a12t + nu * b12t);
      KE[(r + 4) * 8 + (s + 4)] = c * (a11 + nu * b11);
    }
  }
  return KE;
}

export const nodeId = (p: { nely: number }, i: number, j: number) => i * (p.nely + 1) + j;

/** GDLs do elemento (i,j): BL, BR, TR, TL */
export function elementDofs(nely: number, i: number, j: number, out: Int32Array | number[]) {
  const n1 = i * (nely + 1) + j; // top-left
  const n2 = (i + 1) * (nely + 1) + j; // top-right
  out[0] = 2 * (n1 + 1); out[1] = 2 * (n1 + 1) + 1;
  out[2] = 2 * (n2 + 1); out[3] = 2 * (n2 + 1) + 1;
  out[4] = 2 * n2; out[5] = 2 * n2 + 1;
  out[6] = 2 * n1; out[7] = 2 * n1 + 1;
}

export interface FEModel {
  ndof: number;
  nel: number;
  edof: Int32Array; // nel*8
  KE: Float64Array;
  isFixed: Uint8Array;
  f: Float64Array;
  /** cargas originais (inclui as aplicadas em nós restringidos) */
  fRaw: Float64Array;
}

export function buildModel(p: Problem): FEModel {
  const nel = p.nelx * p.nely;
  const ndof = 2 * (p.nelx + 1) * (p.nely + 1);
  const edof = new Int32Array(nel * 8);
  const tmp = new Int32Array(8);
  for (let i = 0; i < p.nelx; i++) {
    for (let j = 0; j < p.nely; j++) {
      elementDofs(p.nely, i, j, tmp);
      edof.set(tmp, (i * p.nely + j) * 8);
    }
  }
  const isFixed = new Uint8Array(ndof);
  for (const d of p.fixed) isFixed[d] = 1;
  const f = new Float64Array(ndof);
  for (const l of p.loads) {
    f[2 * l.node] += l.fx;
    f[2 * l.node + 1] += l.fy;
  }
  const fRaw = f.slice();
  for (let d = 0; d < ndof; d++) if (isFixed[d]) f[d] = 0;
  return { ndof, nel, edof, KE: elementStiffness(p.nu, p.element ?? "qm6"), isFixed, f, fRaw };
}

/**
 * Resolve K(E_e) u = f por gradientes conjugados com pré-condicionador de Jacobi,
 * sem montar K (matrix-free). `Ee` é o módulo (relativo) de cada elemento.
 * `u` entra como chute inicial (warm start) e sai com a solução.
 */
export function solvePCG(
  m: FEModel,
  Ee: Float64Array,
  u: Float64Array,
  tol = 1e-9,
  maxIt = 4000,
): number {
  const { ndof, nel, edof, KE, isFixed, f } = m;
  const diag = new Float64Array(ndof);
  for (let e = 0; e < nel; e++) {
    const E = Ee[e];
    for (let a = 0; a < 8; a++) diag[edof[e * 8 + a]] += E * KE[a * 9];
  }
  for (let d = 0; d < ndof; d++) if (isFixed[d] || diag[d] === 0) diag[d] = 1;

  const matvec = (x: Float64Array, y: Float64Array) => {
    y.fill(0);
    for (let e = 0; e < nel; e++) {
      const E = Ee[e];
      const b = e * 8;
      for (let a = 0; a < 8; a++) {
        let s = 0;
        for (let c = 0; c < 8; c++) s += KE[a * 8 + c] * x[edof[b + c]];
        y[edof[b + a]] += E * s;
      }
    }
    for (let d = 0; d < ndof; d++) if (isFixed[d]) y[d] = x[d];
  };

  for (let d = 0; d < ndof; d++) if (isFixed[d]) u[d] = 0;
  const r = new Float64Array(ndof), z = new Float64Array(ndof);
  const pv = new Float64Array(ndof), Ap = new Float64Array(ndof);
  matvec(u, Ap);
  let bnorm = 0;
  for (let d = 0; d < ndof; d++) { r[d] = f[d] - Ap[d]; bnorm += f[d] * f[d]; }
  bnorm = Math.sqrt(bnorm) || 1;
  let rz = 0;
  for (let d = 0; d < ndof; d++) { z[d] = r[d] / diag[d]; pv[d] = z[d]; rz += r[d] * z[d]; }
  let it = 0;
  for (; it < maxIt; it++) {
    let rn = 0;
    for (let d = 0; d < ndof; d++) rn += r[d] * r[d];
    if (Math.sqrt(rn) / bnorm < tol) break;
    matvec(pv, Ap);
    let pAp = 0;
    for (let d = 0; d < ndof; d++) pAp += pv[d] * Ap[d];
    if (!(pAp > 1e-30) || !(Math.abs(rz) > 1e-30)) break;
    const alpha = rz / pAp;
    let rzNew = 0;
    for (let d = 0; d < ndof; d++) {
      u[d] += alpha * pv[d];
      r[d] -= alpha * Ap[d];
      z[d] = r[d] / diag[d];
      rzNew += r[d] * z[d];
    }
    const beta = rzNew / rz;
    rz = rzNew;
    for (let d = 0; d < ndof; d++) pv[d] = z[d] + beta * pv[d];
  }
  return it;
}

/**
 * Solver direto: Cholesky em banda. Numeração coluna a coluna ⇒ largura de banda
 * bw = 2·nely+5, independente do nº de colunas. Custo ≈ N·bw² por fatoração, mas é
 * robusto ao contraste 1e-9 entre sólido e vazio (onde o PCG-Jacobi precisa de milhares
 * de iterações).
 */
export interface BandedWorkspace {
  L?: Float64Array;
  y?: Float64Array;
}

export function solveBanded(m: FEModel, nely: number, Ee: Float64Array, u: Float64Array, work?: BandedWorkspace): boolean {
  const { ndof, nel, edof, KE, isFixed, f } = m;
  const bw = 2 * nely + 5;
  const w = bw + 1;
  const needed = ndof * w;
  let L = work?.L;
  if (!L || L.length < needed) {
    L = new Float64Array(needed);
    if (work) work.L = L;
  } else {
    L.fill(0, 0, needed);
  }
  for (let e = 0; e < nel; e++) {
    const E = Ee[e], b = e * 8;
    for (let a = 0; a < 8; a++) {
      const i = edof[b + a];
      if (isFixed[i]) continue;
      for (let c = 0; c < 8; c++) {
        const j = edof[b + c];
        if (j > i || isFixed[j]) continue;
        L[i * w + (bw - (i - j))] += E * KE[a * 8 + c];
      }
    }
  }
  return solveBandedAssembled(L, ndof, bw, isFixed, f, u, work);
}

/**
 * Fatora (Cholesky em banda) e resolve uma matriz já montada: `L[i*(bw+1) + (bw-(i-j))]` guarda A[i][j], j ≤ i.
 * GDLs restringidos (`isFixed`) viram identidade e recebem u = 0. A matriz `L` é sobrescrita.
 * Retorna `true` se todos os pivôs forem positivos e finitos (> 1e-30); caso contrário, retorna `false` sem mascarar
 * singularidade ou perda de positividade definida.
 */
export function solveBandedAssembled(L: Float64Array, ndof: number, bw: number, isFixed: Uint8Array, f: Float64Array, u: Float64Array, work?: BandedWorkspace): boolean {
  const w = bw + 1;
  for (let i = 0; i < ndof; i++) if (isFixed[i]) L[i * w + bw] = 1;
  // fatoração L Lᵀ
  for (let i = 0; i < ndof; i++) {
    const j0 = Math.max(0, i - bw);
    for (let j = j0; j <= i; j++) {
      let s = L[i * w + (bw - (i - j))];
      const k0 = Math.max(j0, j - bw);
      const bi = i * w + bw - i, bj = j * w + bw - j;
      for (let k = k0; k < j; k++) s -= L[bi + k] * L[bj + k];
      if (j === i) {
        if (!(s > 1e-30)) return false;
        L[i * w + bw] = Math.sqrt(s);
      } else L[i * w + (bw - (i - j))] = s / L[j * w + bw];
    }
  }
  // substituições
  let y = work?.y;
  if (!y || y.length < ndof) {
    y = new Float64Array(ndof);
    if (work) work.y = y;
  } else {
    y.fill(0, 0, ndof);
  }
  for (let i = 0; i < ndof; i++) {
    let s = isFixed[i] ? 0 : f[i];
    const bi = i * w + bw - i;
    for (let k = Math.max(0, i - bw); k < i; k++) s -= L[bi + k] * y[k];
    y[i] = s / L[i * w + bw];
  }
  for (let i = ndof - 1; i >= 0; i--) {
    let s = y[i];
    const jEnd = Math.min(ndof - 1, i + bw);
    for (let j = i + 1; j <= jEnd; j++) s -= L[j * w + (bw - (j - i))] * u[j];
    u[i] = s / L[i * w + bw];
  }
  return true;
}

export interface Reaction { id: string; rx: number; ry: number; x: number; y: number }

/**
 * Reações de apoio R = K·u − f nos GDLs restringidos [kN] (positivo: →, ↑). Independe de E e t.
 * `groups` agrupa os nós de cada apoio da cena. Também devolve o resíduo de equilíbrio global
 * (ΣF + ΣR em x e y) — deve ser ≈ 0.
 */
export function supportReactions(
  p: Problem,
  Ee: Float64Array,
  u: Float64Array,
  groups: { id: string; nodes: number[]; x: number; y: number }[],
  model?: FEModel,
): { reactions: Reaction[]; residual: { x: number; y: number } } {
  const m = model ?? buildModel(p);
  const y = new Float64Array(m.ndof);
  for (let e = 0; e < m.nel; e++) {
    const b = e * 8;
    for (let a = 0; a < 8; a++) {
      let s = 0;
      for (let c = 0; c < 8; c++) s += m.KE[a * 8 + c] * u[m.edof[b + c]];
      y[m.edof[b + a]] += Ee[e] * s;
    }
  }
  const used = new Set<number>();
  const reactions: Reaction[] = [];
  let sx = 0, sy = 0;
  for (const g of groups) {
    let rx = 0, ry = 0;
    for (const n of g.nodes) {
      if (m.isFixed[2 * n] && !used.has(2 * n)) { rx += y[2 * n] - m.fRaw[2 * n]; used.add(2 * n); }
      if (m.isFixed[2 * n + 1] && !used.has(2 * n + 1)) { ry += y[2 * n + 1] - m.fRaw[2 * n + 1]; used.add(2 * n + 1); }
    }
    reactions.push({ id: g.id, rx, ry, x: g.x, y: g.y });
    sx += rx; sy += ry;
  }
  for (const l of p.loads) { sx += l.fx; sy += l.fy; }
  return { reactions, residual: { x: sx, y: sy } };
}
