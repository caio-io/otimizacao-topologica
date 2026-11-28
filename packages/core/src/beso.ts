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
  let er = opt.er, ar = opt.arMax;
  let okStreak = 0, rollbacks = 0;
  let repairs = 0; void repairs;
  /**
   * toda carga tem caminho de elementos sólidos (ou passivos) até algum nó apoiado? Elementos só se ligam por
   * ARESTA compartilhada: contato por um único nó (diagonal) é rótula e não transmite flexão — era o que gerava
   * picos de flexibilidade mesmo com a "conectividade" intacta.
   */
  const parent = new Int32Array(nelx * nely);
  const find = (q: number) => { while (parent[q] !== q) { parent[q] = parent[parent[q]]; q = parent[q]; } return q; };
  const fixedNodes = [...new Set(p.fixed.map((d) => d >> 1))];
  const loadNodes = [...new Set(p.loads.map((l) => l.node))];
  const adjElems = (n: number): number[] => {
    const i = Math.floor(n / (nely + 1)), j = n % (nely + 1), out: number[] = [];
    for (const [di, dj] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) {
      const ei = i + di, ej = j + dj;
      if (ei >= 0 && ej >= 0 && ei < nelx && ej < nely) out.push(ei * nely + ej);
    }
    return out;
  };
  /** marca em `out` os elementos ligados (por aresta) a algum apoio; devolve o rótulo de componente para consulta */
  const reachable = (sol: Float64Array, out: Uint8Array) => {
    const on = (e: number) => p.mask[e] === 2 || (p.mask[e] === 1 && sol[e] >= 1);
    for (let q = 0; q < parent.length; q++) parent[q] = q;
    for (let i = 0; i < nelx; i++) for (let j = 0; j < nely; j++) {
      const e = i * nely + j;
      if (!on(e)) continue;
      if (i + 1 < nelx && on(e + nely)) parent[find(e)] = find(e + nely);
      if (j + 1 < nely && on(e + 1)) parent[find(e)] = find(e + 1);
    }
    const sup = new Set<number>();
    for (const n of fixedNodes) for (const e of adjElems(n)) if (on(e)) sup.add(find(e));
    for (let e = 0; e < nel; e++) out[e] = on(e) && sup.has(find(e)) ? 1 : 0;
    return { on, sup };
  };
  const reach = new Uint8Array(nel);
  const loadsConnected = (sol: Float64Array): boolean => {
    const { on, sup } = reachable(sol, reach);
    return loadNodes.every((n) => adjElems(n).some((e) => on(e) && sup.has(find(e))));
  };

  // último estado que gerou flexibilidade 'boa' (para voltar se a topologia desconectar)
  let xGood = x.slice(), volGood = 1, cGood = 0;
  // melhor projeto já com o volume-alvo atingido (se a topologia piorar depois, devolvemos este)
  let best: IterInfo | null = null;
  const finalize = (r: IterInfo): IterInfo => {
    if (!best || best.compliance >= r.compliance) return r;
    return { ...best, iter: r.iter };
  };
  let last: IterInfo = { iter: 0, compliance: 0, volume: 1, change: 1, rho: x, u, Ee };

  // reversões por desconexão não gastam o orçamento de iterações (limitadas a 100 para garantir término)
  for (let iter = 1; iter - Math.min(rollbacks, 100) <= opt.maxIter; iter++) {
    // material sem ligação (por aresta) com os apoios é 'flutuante': rigidez singular gera deslocamentos de corpo
    // rígido numéricos e picos espúrios de flexibilidade. Trata-o como vazio na análise (e ele sai na seleção).
    reachable(x, reach);
    for (let e = 0; e < nel; e++) Ee[e] = p.mask[e] === 0 || !reach[e] ? 1e-9 : Math.pow(Math.max(x[e], XMIN), opt.penal);
    if (!solveBanded(m, p.nely, Ee, u)) {
      throw new Error("BESO: matriz de rigidez singular ou mal condicionada (verifique apoios e conectividade).");
    }

    let c = 0;
    for (let e = 0; e < nel; e++) {
      for (let a = 0; a < 8; a++) ue[a] = u[edof[e * 8 + a]];
      let s = 0;
      for (let a = 0; a < 8; a++) {
        let t = 0;
        for (let b = 0; b < 8; b++) t += KE[a * 8 + b] * ue[b];
        s += ue[a] * t;
      }
      alpha[e] = reach[e] || p.mask[e] === 0 ? 0.5 * Math.pow(Math.max(x[e], XMIN), opt.penal - 1) * s : 0;
    }
    // flexibilidade = ½·fᵀu (imune a corpos rígidos flutuantes, ao contrário da soma por elemento)
    c = 0;
    for (let d = 0; d < m.ndof; d++) c += 0.5 * m.f[d] * u[d];
    // desconexão (carga sem caminho até o apoio) ⇒ flexibilidade explode: volta e reduz a taxa de remoção
    if (cGood > 0 && c > 1.5 * cGood && (er > 0.002 || ar > 0.002)) {
      x.set(xGood); volCur = volGood; er = Math.max(0.002, er / 2); ar = Math.max(0.002, ar / 2);
      alphaPrev.fill(0);
      okStreak = 0; rollbacks++;
      continue;
    }
    xGood.set(x); volGood = volCur; cGood = c;
    // passos aceitos em sequência: a taxa de evolução volta a subir aos poucos (antes ficava reduzida para sempre
    // depois da 1ª reversão e, com filtro grande, o volume não chegava ao alvo em 150 iterações)
    if (++okStreak >= 6) { er = Math.min(opt.er, er * 1.5); ar = Math.min(opt.arMax, ar * 1.5); okStreak = 0; }
    if (volCur <= opt.volfrac + 1e-9 && (!best || c < best.compliance)) {
      let vv = 0; for (const e of active) if (x[e] === 1) vv++;
      best = { iter, compliance: c, volume: vv / nAct, change: 0, rho: x.slice(), u: u.slice(), Ee: Ee.slice() };
    }
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
    const maxAdd = Math.max(1, Math.round(ar * nAct));
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

    // proteção de conectividade: a remoção não pode isolar nenhuma carga dos apoios; se isolar, devolve o menor
    // número de elementos removidos (os de maior α) que restabelece o caminho de carga
    if (!loadsConnected(next)) {
      const removed = active.filter((e) => x[e] >= 1 && next[e] !== 1).sort((p1, p2) => alphaF[p2] - alphaF[p1]);
      let lo = 0, hi = removed.length; // lo: não conecta · hi: conecta (x anterior conectava)
      const trial = (k: number) => { const t = next.slice(); for (let q = 0; q < k; q++) t[removed[q]] = 1; return t; };
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (loadsConnected(trial(mid))) hi = mid; else lo = mid; }
      for (let q = 0; q < hi; q++) next[removed[q]] = 1;
      repairs++;
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
      const relDiff = a <= 1e-30 ? Math.abs(a - b) : Math.abs(a - b) / a;
      if (relDiff < opt.tol) return finalize(last);
    }
    yield last;
  }
  return finalize(last);
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
