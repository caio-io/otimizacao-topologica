import type { IterInfo, Problem, SimpOptions } from "./types";
import { buildModel, solveBanded } from "./fe";

const EMIN = 1e-6;

/**
 * SIMP (Bendsøe 1989) com filtro de sensibilidade (Sigmund) e critério de optimalidade (OC).
 * Minimiza a flexibilidade sob restrição de volume. Gerador: cede a cada iteração
 * (permite progresso em Web Worker e cancelamento pelo consumidor).
 */
export function* simp(p: Problem, opt: SimpOptions): Generator<IterInfo, IterInfo> {
  const { nelx, nely } = p;
  const nel = nelx * nely;
  const m = buildModel(p);
  const { edof, KE } = m;
  const move = opt.move ?? 0.2;

  const active: number[] = [];
  const rho = new Float64Array(nel);
  for (let e = 0; e < nel; e++) {
    if (p.mask[e] === 1) { active.push(e); rho[e] = opt.volfrac; }
    else rho[e] = p.mask[e] === 2 ? 1 : 0;
  }
  const nAct = active.length;

  // vizinhança do filtro
  const R = Math.ceil(opt.rmin) - 1;
  const offs: { di: number; dj: number; w: number }[] = [];
  for (let di = -R; di <= R; di++)
    for (let dj = -R; dj <= R; dj++) {
      const w = opt.rmin - Math.hypot(di, dj);
      if (w > 0) offs.push({ di, dj, w });
    }

  const Ee = new Float64Array(nel);
  const u = new Float64Array(m.ndof);
  const dc = new Float64Array(nel), dcf = new Float64Array(nel);
  const ue = new Float64Array(8);
  let last: IterInfo = { iter: 0, compliance: 0, volume: opt.volfrac, change: 1, rho };

  for (let iter = 1; iter <= opt.maxIter; iter++) {
    for (let e = 0; e < nel; e++) Ee[e] = EMIN + (1 - EMIN) * Math.pow(rho[e], opt.penal);
    solveBanded(m, p.nely, Ee, u);

    let c = 0;
    for (let e = 0; e < nel; e++) {
      for (let a = 0; a < 8; a++) ue[a] = u[edof[e * 8 + a]];
      let s = 0;
      for (let a = 0; a < 8; a++) {
        let t = 0;
        for (let b = 0; b < 8; b++) t += KE[a * 8 + b] * ue[b];
        s += ue[a] * t;
      }
      c += Ee[e] * s;
      dc[e] = -opt.penal * (1 - EMIN) * Math.pow(rho[e], opt.penal - 1) * s;
    }

    // filtro de sensibilidade
    for (const e of active) {
      const i = Math.floor(e / nely), j = e % nely;
      let sum = 0, acc = 0;
      for (const o of offs) {
        const ii = i + o.di, jj = j + o.dj;
        if (ii < 0 || jj < 0 || ii >= nelx || jj >= nely) continue;
        const k = ii * nely + jj;
        if (p.mask[k] !== 1) continue;
        sum += o.w;
        acc += o.w * rho[k] * dc[k];
      }
      dcf[e] = acc / (sum * Math.max(rho[e], 1e-3));
    }

    // OC com bisseção no multiplicador de Lagrange
    let l1 = 0, l2 = 1e9;
    const rhoNew = new Float64Array(rho);
    while ((l2 - l1) / (l1 + l2) > 1e-4) {
      const mid = 0.5 * (l1 + l2);
      let vol = 0;
      for (const e of active) {
        const be = Math.sqrt(Math.max(-dcf[e], 1e-30) / mid);
        const x = rho[e] * be;
        rhoNew[e] = Math.max(1e-3, Math.max(rho[e] - move, Math.min(1, Math.min(rho[e] + move, x))));
        vol += rhoNew[e];
      }
      if (vol / nAct > opt.volfrac) l1 = mid; else l2 = mid;
    }
    let change = 0;
    for (const e of active) change = Math.max(change, Math.abs(rhoNew[e] - rho[e]));
    rho.set(rhoNew);

    let v = 0;
    for (const e of active) v += rho[e];
    last = { iter, compliance: c, volume: v / nAct, change, rho, u, Ee };
    if (change < opt.tol && iter > 5) return last;
    yield last;
  }
  return last;
}

export function runSimp(p: Problem, opt: SimpOptions): IterInfo {
  const g = simp(p, opt);
  for (;;) {
    const r = g.next();
    if (r.done) return r.value;
  }
}

/** Resolve o campo de deslocamentos para uma densidade dada (para pós-processamento). */
export function solveDisplacements(p: Problem, rho: Float64Array, penal: number): Float64Array {
  const m = buildModel(p);
  const Ee = new Float64Array(rho.length);
  for (let e = 0; e < rho.length; e++) Ee[e] = EMIN + (1 - EMIN) * Math.pow(rho[e], penal);
  const u = new Float64Array(m.ndof);
  solveBanded(m, p.nely, Ee, u);
  return u;
}
