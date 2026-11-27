import type { RawBar, RawNode } from "./types";
import { compactTruss } from "./groundStructure";

/** Dense linear solver with partial pivoting for small truss/beam systems. Returns null if singular. */
export function solveLinearDense(A: Float64Array, b: Float64Array, n: number): Float64Array | null {
  const M = A.slice();
  const rhs = b.slice();
  for (let k = 0; k < n; k++) {
    let piv = k;
    let best = Math.abs(M[k * n + k]);
    for (let r = k + 1; r < n; r++) {
      const v = Math.abs(M[r * n + k]);
      if (v > best) { best = v; piv = r; }
    }
    if (!(best > 1e-18)) return null;
    if (piv !== k) {
      for (let c = k; c < n; c++) {
        const tmp = M[k * n + c]; M[k * n + c] = M[piv * n + c]; M[piv * n + c] = tmp;
      }
      const tr = rhs[k]; rhs[k] = rhs[piv]; rhs[piv] = tr;
    }
    const diag = M[k * n + k];
    for (let r = k + 1; r < n; r++) {
      const f = M[r * n + k] / diag;
      if (f === 0) continue;
      for (let c = k; c < n; c++) M[r * n + c] -= f * M[k * n + c];
      rhs[r] -= f * rhs[k];
    }
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let sum = rhs[i];
    for (let j = i + 1; j < n; j++) sum -= M[i * n + j] * x[j];
    x[i] = sum / M[i * n + i];
  }
  return x;
}

/** Solve 2D truss K*u = F, returning displacements and bar axial forces, or null if singular. */
export function solveTruss(
  nNodes: number,
  bars: readonly RawBar[],
  nodes: readonly RawNode[],
  E: number,
  reg = 0,
): { u: Float64Array; forces: Float64Array } | null {
  const ndof = 2 * nNodes;
  const K = new Float64Array(ndof * ndof);
  const F = new Float64Array(ndof);
  const fixed = new Uint8Array(ndof);

  for (let i = 0; i < nNodes; i++) {
    F[2 * i] = nodes[i].fx;
    F[2 * i + 1] = nodes[i].fy;
    if (nodes[i].uxFixed) fixed[2 * i] = 1;
    if (nodes[i].uyFixed) fixed[2 * i + 1] = 1;
  }

  let kSum = 0, kCount = 0;
  for (const b of bars) {
    if (b.area <= 0) continue;
    const ke = (E * b.area) / b.L;
    kSum += ke; kCount++;
    const cc = b.c * b.c * ke, ss = b.s * b.s * ke, cs = b.c * b.s * ke;
    const d1x = 2 * b.n1, d1y = 2 * b.n1 + 1, d2x = 2 * b.n2, d2y = 2 * b.n2 + 1;

    K[d1x * ndof + d1x] += cc; K[d1x * ndof + d1y] += cs; K[d1y * ndof + d1x] += cs; K[d1y * ndof + d1y] += ss;
    K[d2x * ndof + d2x] += cc; K[d2x * ndof + d2y] += cs; K[d2y * ndof + d2x] += cs; K[d2y * ndof + d2y] += ss;
    K[d1x * ndof + d2x] -= cc; K[d1x * ndof + d2y] -= cs; K[d1y * ndof + d2x] -= cs; K[d1y * ndof + d2y] -= ss;
    K[d2x * ndof + d1x] -= cc; K[d2x * ndof + d1y] -= cs; K[d2y * ndof + d1x] -= cs; K[d2y * ndof + d1y] -= ss;
  }

  const kReg = reg > 0 && kCount > 0 ? reg * (kSum / kCount) : 0;
  for (let d = 0; d < ndof; d++) {
    if (fixed[d]) {
      for (let j = 0; j < ndof; j++) { K[d * ndof + j] = 0; K[j * ndof + d] = 0; }
      K[d * ndof + d] = 1;
      F[d] = 0;
    } else if (kReg > 0) {
      K[d * ndof + d] += kReg;
    }
  }

  const u = solveLinearDense(K, F, ndof);
  if (!u) return null;

  const forces = new Float64Array(bars.length);
  for (let e = 0; e < bars.length; e++) {
    const b = bars[e];
    if (b.area <= 0) continue;
    const du = u[2 * b.n2] - u[2 * b.n1];
    const dv = u[2 * b.n2 + 1] - u[2 * b.n1 + 1];
    forces[e] = ((E * b.area) / b.L) * (b.c * du + b.s * dv);
  }
  return { u, forces };
}

export function computeMaxNodalResidual(ns: readonly RawNode[], bs: readonly RawBar[], forces: Float64Array): number {
  const sfx = new Float64Array(ns.length);
  const sfy = new Float64Array(ns.length);
  for (let e = 0; e < bs.length; e++) {
    const b = bs[e], N = forces[e];
    sfx[b.n1] -= N * b.c; sfy[b.n1] -= N * b.s;
    sfx[b.n2] += N * b.c; sfy[b.n2] += N * b.s;
  }
  let res = 0;
  for (let i = 0; i < ns.length; i++) {
    if (!ns[i].uxFixed) res = Math.max(res, Math.abs(ns[i].fx - sfx[i]));
    if (!ns[i].uyFixed) res = Math.max(res, Math.abs(ns[i].fy - sfy[i]));
  }
  return res;
}

/** Iterative Fully Stressed Design + safe pruning preserving nodal equilibrium residual < 1e-6. */
export function optimizeGroundStructure(
  rawNodes: readonly RawNode[],
  bars: RawBar[],
  E: number,
  maxIter: number,
): { finalRawNodes: RawNode[]; finalRawBars: RawBar[]; forces: Float64Array } {
  const nAll = rawNodes.length;
  let lastForces: Float64Array = new Float64Array(bars.length);
  const sigmaRef = 1000.0;

  for (let it = 0; it < maxIter; it++) {
    const res = solveTruss(nAll, bars, rawNodes, E, 1e-9);
    if (!res) break;
    lastForces = res.forces;
    let maxA = 0;
    for (let e = 0; e < bars.length; e++) {
      const targetA = Math.abs(res.forces[e]) / sigmaRef;
      bars[e].area = 0.3 * bars[e].area + 0.7 * targetA;
      if (bars[e].area > maxA) maxA = bars[e].area;
    }
    const floorA = maxA * 1e-8;
    for (let e = 0; e < bars.length; e++) if (bars[e].area < floorA) bars[e].area = floorA;
  }

  let maxForce = 0;
  for (let e = 0; e < bars.length; e++) maxForce = Math.max(maxForce, Math.abs(lastForces[e]));

  for (const ratio of [1e-2, 5e-3, 1e-3, 1e-4, 1e-6, 0]) {
    const cutoff = ratio * maxForce;
    const candBars = bars.filter((_, e) => Math.abs(lastForces[e]) >= cutoff && Math.abs(lastForces[e]) > 1e-12);
    if (candBars.length === 0) continue;
    const compacted = compactTruss(rawNodes, candBars);
    const sol = solveTruss(compacted.finalRawNodes.length, compacted.finalRawBars, compacted.finalRawNodes, E, 0);
    if (sol && computeMaxNodalResidual(compacted.finalRawNodes, compacted.finalRawBars, sol.forces) < 1e-6) {
      return { finalRawNodes: compacted.finalRawNodes, finalRawBars: compacted.finalRawBars, forces: sol.forces };
    }
  }

  const compacted = compactTruss(rawNodes, bars);
  const fallbackSol =
    solveTruss(compacted.finalRawNodes.length, compacted.finalRawBars, compacted.finalRawNodes, E, 0) ??
    solveTruss(compacted.finalRawNodes.length, compacted.finalRawBars, compacted.finalRawNodes, E, 1e-11);
  if (!fallbackSol) throw new Error("Não foi possível resolver o equilíbrio axial da treliça STM extraída.");
  return { finalRawNodes: compacted.finalRawNodes, finalRawBars: compacted.finalRawBars, forces: fallbackSol.forces };
}

/**
 * Computes the Suitable Truss Structure (STS) index of Xia, Langelaar & Hendriks (2020), Eq. (1):
 *   STS = (1 / n) * Σ |N_e| / (|N_e| + |V_e|)
 * using a 2D slender Euler-Bernoulli beam model (width = t, height = 0.01 * t).
 */
export function computeStmSts(
  nodes: readonly { x: number; y: number; uxFixed: boolean; uyFixed: boolean }[],
  members: readonly { n1: number; n2: number }[],
  loads: readonly { node: number; fx: number; fy: number }[],
  t: number,
  E: number,
): number {
  const nNodes = nodes.length;
  const nElem = members.length;
  if (nNodes === 0 || nElem === 0) return 0;

  const hBeam = 0.01 * t;
  const A = t * hBeam;
  const I = (t * hBeam * hBeam * hBeam) / 12;
  const ndof = 3 * nNodes;
  const K = new Float64Array(ndof * ndof);
  const F = new Float64Array(ndof);
  const fixed = new Uint8Array(ndof);

  for (let i = 0; i < nNodes; i++) {
    if (nodes[i].uxFixed) fixed[3 * i] = 1;
    if (nodes[i].uyFixed) fixed[3 * i + 1] = 1;
  }
  for (const l of loads) { F[3 * l.node] += l.fx; F[3 * l.node + 1] += l.fy; }

  const elemData: { n1: number; n2: number; L: number; c: number; s: number }[] = [];
  for (const m of members) {
    const p1 = nodes[m.n1], p2 = nodes[m.n2];
    const dx = p2.x - p1.x, dy = p2.y - p1.y, L = Math.hypot(dx, dy);
    if (L < 1e-9) continue;
    const c = dx / L, s = dy / L;
    elemData.push({ n1: m.n1, n2: m.n2, L, c, s });

    const ea = (E * A) / L, ei12 = (12 * E * I) / (L * L * L), ei6 = (6 * E * I) / (L * L), ei4 = (4 * E * I) / L, ei2 = (2 * E * I) / L;
    const kl = [
      [ea, 0, 0, -ea, 0, 0],
      [0, ei12, ei6, 0, -ei12, ei6],
      [0, ei6, ei4, 0, -ei6, ei2],
      [-ea, 0, 0, ea, 0, 0],
      [0, -ei12, -ei6, 0, ei12, -ei6],
      [0, ei6, ei2, 0, -ei6, ei4],
    ];
    const T = [
      [c, s, 0, 0, 0, 0], [-s, c, 0, 0, 0, 0], [0, 0, 1, 0, 0, 0],
      [0, 0, 0, c, s, 0], [0, 0, 0, -s, c, 0], [0, 0, 0, 0, 0, 1],
    ];
    const tmp = Array.from({ length: 6 }, () => new Float64Array(6));
    for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) {
      let sum = 0; for (let k = 0; k < 6; k++) sum += kl[i][k] * T[k][j]; tmp[i][j] = sum;
    }
    const dofs = [3 * m.n1, 3 * m.n1 + 1, 3 * m.n1 + 2, 3 * m.n2, 3 * m.n2 + 1, 3 * m.n2 + 2];
    for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) {
      let kg = 0; for (let k = 0; k < 6; k++) kg += T[k][i] * tmp[k][j]; K[dofs[i] * ndof + dofs[j]] += kg;
    }
  }

  const kRotReg = 1e-12 * ((E * I) / 1.0);
  for (let i = 0; i < nNodes; i++) K[(3 * i + 2) * ndof + (3 * i + 2)] += kRotReg;
  for (let d = 0; d < ndof; d++) {
    if (fixed[d]) {
      for (let j = 0; j < ndof; j++) { K[d * ndof + j] = 0; K[j * ndof + d] = 0; }
      K[d * ndof + d] = 1; F[d] = 0;
    }
  }

  const u = solveLinearDense(K, F, ndof);
  if (!u) return 0;

  let stsSum = 0, validCount = 0;
  for (const el of elemData) {
    const duLocal = el.c * (u[3 * el.n2] - u[3 * el.n1]) + el.s * (u[3 * el.n2 + 1] - u[3 * el.n1 + 1]);
    const dvLocal = -el.s * (u[3 * el.n2] - u[3 * el.n1]) + el.c * (u[3 * el.n2 + 1] - u[3 * el.n1 + 1]);
    const Ne = ((E * A) / el.L) * duLocal;
    const Ve = ((12 * E * I) / (el.L * el.L * el.L)) * dvLocal - ((6 * E * I) / (el.L * el.L)) * (u[3 * el.n1 + 2] + u[3 * el.n2 + 2]);
    const denom = Math.abs(Ne) + Math.abs(Ve);
    if (denom > 1e-12) { stsSum += Math.abs(Ne) / denom; validCount++; }
  }
  return validCount > 0 ? stsSum / validCount : 0;
}
