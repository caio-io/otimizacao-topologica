import type { BesoOptions, IterInfo, Problem } from "./types";
import { buildModel, solveBanded } from "./fe";

const XMIN = 1e-3;

/**
 * BESO "soft-kill" (Huang & Xie 2009; aplicação a STM: Liang, Xie & Steven 2000; Borges 2022).
 * Minimiza flexibilidade sob volume alvo. Elementos são sólidos (1) ou "moles" (XMIN).
 * Sensibilidade: α_e = ½ x_e^(p-1) u_eᵀ K_e u_e, filtrada espacialmente e
 * promediada com a iteração anterior (estabiliza o histórico).
 */
export function* beso(p: Problem, opt: BesoOptions): Generator<IterInfo, IterInfo> {
  const { nelx, nely } = p;
  const nel = nelx * nely;
  const m = buildModel(p);
  const { edof, KE } = m;

  const active: number[] = [];
  const x = new Float64Array(nel);
  for (let e = 0; e < nel; e++) {
    if (p.mask[e] === 1) { active.push(e); x[e] = 1; }
    else x[e] = p.mask[e] === 2 ? 1 : 0;
  }
  const nAct = active.length;

  const R = Math.ceil(opt.rmin) - 1;
  const offs: { di: number; dj: number; w: number }[] = [];
  for (let di = -R; di <= R; di++)
    for (let dj = -R; dj <= R; dj++) {
      const w = opt.rmin - Math.hypot(di, dj);
      if (w > 0) offs.push({ di, dj, w });
    }

  const Ee = new Float64Array(nel);
  const u = new Float64Array(m.ndof);
  const alpha = new Float64Array(nel), alphaF = new Float64Array(nel), alphaPrev = new Float64Array(nel);
  const ue = new Float64Array(8);
  const hist: number[] = [];
  let volCur = 1;
  let er = opt.er;
  // último estado que gerou flexibilidade 'boa' (para voltar se a topologia desconectar)
  let xGood = x.slice(), volGood = 1, cGood = 0;
  let last: IterInfo = { iter: 0, compliance: 0, volume: 1, change: 1, rho: x, u, Ee };

  for (let iter = 1; iter <= opt.maxIter; iter++) {
    for (let e = 0; e < nel; e++) Ee[e] = p.mask[e] === 0 ? 1e-9 : Math.pow(Math.max(x[e], XMIN), opt.penal);
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
      c += 0.5 * Ee[e] * s;
      alpha[e] = 0.5 * Math.pow(Math.max(x[e], XMIN), opt.penal - 1) * s;
    }
    // desconexão (carga sem caminho até o apoio) ⇒ flexibilidade explode: volta e reduz a taxa de remoção
    if (cGood > 0 && c > 3 * cGood && er > 0.002) {
      x.set(xGood); volCur = volGood; er = Math.max(0.002, er / 2);
      alphaPrev.fill(0);
      continue;
    }
    xGood.set(x); volGood = volCur; cGood = c;
    hist.push(c);

    // filtro espacial (média ponderada por distância)
    for (const e of active) {
      const i = Math.floor(e / nely), j = e % nely;
      let sum = 0, acc = 0;
      for (const o of offs) {
        const ii = i + o.di, jj = j + o.dj;
        if (ii < 0 || jj < 0 || ii >= nelx || jj >= nely) continue;
        const k = ii * nely + jj;
        if (p.mask[k] !== 1) continue;
        sum += o.w; acc += o.w * alpha[k];
      }
      alphaF[e] = acc / sum;
    }
    // média com histórico
    if (iter > 1 && hist.length > 1) for (const e of active) alphaF[e] = 0.5 * (alphaF[e] + alphaPrev[e]);
    for (const e of active) alphaPrev[e] = alphaF[e];

    // volume alvo desta iteração
    volCur = Math.max(opt.volfrac, volCur * (1 - er));
    const nTarget = Math.round(volCur * nAct);

    // seleciona: top-nTarget por α, limitando reinserções a arMax·nAct
    const order = active.slice().sort((a, b) => alphaF[b] - alphaF[a]);
    const maxAdd = Math.max(1, Math.round(opt.arMax * nAct));
    const keepSolid: number[] = [], addVoid: number[] = [];
    for (let k = 0; k < order.length && k < nTarget; k++) {
      (x[order[k]] >= 1 ? keepSolid : addVoid).push(order[k]);
    }
    const added = addVoid.slice(0, maxAdd);
    const nSolidNeeded = nTarget - added.length;
    const solids = order.filter((e) => x[e] >= 1);
    const next = new Float64Array(x);
    for (const e of active) next[e] = XMIN;
    for (const e of added) next[e] = 1;
    for (let k = 0; k < solids.length && k < nSolidNeeded; k++) next[solids[k]] = 1;
    // (se faltaram sólidos, complementa com os melhores restantes)
    let have = 0;
    for (const e of active) if (next[e] === 1) have++;
    for (let k = 0; have < nTarget && k < order.length; k++) {
      if (next[order[k]] !== 1) { next[order[k]] = 1; have++; }
    }

    let changed = 0;
    for (const e of active) if (next[e] !== x[e]) changed++;
    x.set(next);
    let v = 0;
    for (const e of active) if (x[e] === 1) v++;

    last = { iter, compliance: c, volume: v / nAct, change: changed / nAct, rho: x, u, Ee };

    // convergência: volume atingido e flexibilidade estabilizada
    if (volCur <= opt.volfrac + 1e-9 && hist.length >= 10 + 1) {
      const n = hist.length;
      const a = hist.slice(n - 5).reduce((s, t) => s + t, 0) / 5;
      const b = hist.slice(n - 10, n - 5).reduce((s, t) => s + t, 0) / 5;
      if (Math.abs(a - b) / a < opt.tol) return last;
    }
    yield last;
  }
  return last;
}

export function runBeso(p: Problem, opt: BesoOptions): IterInfo {
  const g = beso(p, opt);
  for (;;) {
    const r = g.next();
    if (r.done) return r.value;
  }
}

export const BESO_DEFAULTS: Omit<BesoOptions, "volfrac" | "rmin"> = {
  penal: 3, er: 0.02, arMax: 0.03, maxIter: 150, tol: 1e-3,
};
