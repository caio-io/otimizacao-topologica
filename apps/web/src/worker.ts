import { BESO_DEFAULTS, barsFromScene, beso, buildModel, buildProblem, concreteFromScene, principalStresses, simp, solveDisplacements, solveNonlinearSteps, supportReactions } from "@stm/core";
import type { NlStep } from "@stm/core";
import type { Scene } from "@stm/core";

export type WorkerIn =
  | { token: number; mode: "opt"; scene: Scene; method: "beso" | "simp"; volfrac: number; rmin: number }
  | { token: number; mode: "elastic"; scene: Scene }
  | { token: number; mode: "nl"; scene: Scene }
  | { stop: true };

let stopFlag = false;
/** identifica a execução corrente; passos agendados de execuções antigas se descartam sozinhos */
let runToken = 0;
const post = (m: unknown) => (self as unknown as Worker).postMessage(m);

self.onmessage = (ev: MessageEvent<WorkerIn>) => {
  const d = ev.data;
  if ("stop" in d) { stopFlag = true; return; }
  const token = (runToken = d.token); // invalida qualquer otimização anterior ainda agendada
  stopFlag = false;
  const r = buildProblem(d.scene);
  if (!r.problem) { post({ kind: "error", token, errors: r.errors, warnings: r.warnings }); return; }
  const problem = r.problem;
  const model = buildModel(problem); // montado uma vez; reutilizado nas reações de cada iteração
  const dims = { nelx: problem.nelx, nely: problem.nely, h: problem.h, ox: r.origin.x, oy: r.origin.y };

  if (d.mode === "elastic") {
    const rho = new Float64Array(problem.mask.length);
    for (let e = 0; e < rho.length; e++) rho[e] = problem.mask[e] ? 1 : 0;
    const u = solveDisplacements(problem, rho, 1);
    const Ee = new Float64Array(rho.length);
    for (let e = 0; e < rho.length; e++) Ee[e] = 1e-6 + (1 - 1e-6) * rho[e];
    const rr = supportReactions(problem, Ee, u, r.supportGroups, model);
    post({ kind: "frame", token, dims, mask: problem.mask, iter: 0, compliance: 0, volume: 1, change: 0, rho, u,
      field: principalStresses(problem, u), done: true, warnings: r.warnings, elastic: true,
      reactions: rr.reactions, residual: rr.residual });
    return;
  }


  if (d.mode === "nl") {
    const nel = problem.mask.length;
    const rho = new Float64Array(nel);
    for (let e = 0; e < nel; e++) rho[e] = problem.mask[e] ? 1 : 0;
    const zeros = new Float64Array(nel);
    const field = { s1: zeros, s2: zeros, theta: zeros };
    const par0 = d.scene.nl ?? { values: "design" as const, epsCu: 0.0035, crushLength: 0 };
    // comprimento de esmagamento: automático = espessura da peça (livro do CSFM, p. 18/104/137)
    const par = { ...par0, crushLength: par0.crushAuto !== false ? d.scene.t : par0.crushLength };
    const concrete = concreteFromScene(d.scene);
    let P0x = 0, P0y = 0;
    for (let n = 0; n < model.fRaw.length; n += 2) { P0x += model.fRaw[n]; P0y += model.fRaw[n + 1]; }
    const P0 = Math.hypot(P0x, P0y);
    let gen: ReturnType<typeof solveNonlinearSteps>;
    try {
      gen = solveNonlinearSteps(problem, { concrete, bars: barsFromScene(d.scene), origin: r.origin, checkCrushing: true, crushLength: par.crushLength || undefined, dLambda: 0.1, maxIt: 200, stepwise: true });
    } catch (err) { post({ kind: "error", token, errors: [String((err as Error).message ?? err)], warnings: r.warnings }); return; }
    const groupReactions = (reaction: Float64Array) => {
      const used = new Set<number>();
      return r.supportGroups.map((g) => {
        let rx = 0, ry = 0;
        for (const n of g.nodes) {
          if (model.isFixed[2 * n] && !used.has(2 * n)) { rx += reaction[2 * n]; used.add(2 * n); }
          if (model.isFixed[2 * n + 1] && !used.has(2 * n + 1)) { ry += reaction[2 * n + 1]; used.add(2 * n + 1); }
        }
        return { id: g.id, x: g.x, y: g.y, rx, ry };
      });
    };
    /** resíduo absoluto de equilíbrio global em kN (ΣR + λ·ΣF), coerente com `supportReactions` */
    const nlResidualKn = (reaction: Float64Array, lam: number) => {
      let sx = 0, sy = 0;
      for (let d = 0; d < model.ndof; d += 2) {
        sx += lam * model.fRaw[d] + reaction[d];
        sy += lam * model.fRaw[d + 1] + reaction[d + 1];
      }
      return { x: sx, y: sy };
    };
    const base = { kind: "frame", token, dims, mask: problem.mask, compliance: 0, volume: 1, change: 0, rho, field, P0 };
    let first = true, count = 0, last: NlStep | null = null;
    const step = () => {
      if (token !== runToken) return;
      try {
        if (stopFlag) {
          post({ ...base, iter: count, u: last?.u ?? new Float64Array(model.ndof), reactions: [], residual: { x: 0, y: 0 }, done: true, warnings: [],
            nl: { lambda: last?.lambda ?? 0, mode: "interrompida", epsComp: last?.epsComp ?? zeros, epsTens: last?.epsTens ?? zeros, stress: last?.stress ?? new Float64Array(3 * nel), barSamples: last?.barSamples ?? [], bars: [],
              maxEpsC: last?.maxEpsC ?? 0, crushStrain: last?.crushStrain ?? 0, epsCu: concrete.epsu, fc: concrete.fc, crushLength: par.crushLength, equilibrium: { x: 0, y: 0 } } });
          return;
        }
        const g = gen.next();
        if (!g.done) {
          const st = g.value; last = st; count++;
          post({ ...base, iter: count, u: st.u, reactions: [], residual: { x: 0, y: 0 }, done: false, warnings: first ? [...r.warnings, ...st.notes] : [],
            nl: { lambda: st.lambda, mode: null, epsComp: st.epsComp, epsTens: st.epsTens, stress: st.stress, barSamples: st.barSamples, bars: [], maxEpsC: st.maxEpsC, crushStrain: st.crushStrain,
              crush: st.crush,
              epsCu: concrete.epsu, fc: concrete.fc, crushLength: par.crushLength, equilibrium: { x: 0, y: 0 } } });
          first = false;
          setTimeout(step, 0);
        } else {
          const res = g.value;
          post({ ...base, iter: count + 1, u: res.u, reactions: groupReactions(res.reaction), residual: nlResidualKn(res.reaction, res.lambda), done: true, warnings: first ? r.warnings : [],
            nl: { lambda: res.lambda, mode: res.mode, epsComp: res.epsComp, epsTens: res.epsTens, stress: res.stress, barSamples: res.barSamples, bars: res.bars, maxEpsC: res.maxCompStrain, crushStrain: res.crushStrain,
              crush: res.crush, failure: res.failure, firstPlateau: res.firstPlateau,
              epsCu: concrete.epsu, fc: concrete.fc, crushLength: par.crushLength, equilibrium: res.equilibrium } });
        }
      } catch (err) { post({ kind: "error", token, errors: [String((err as Error).message ?? err)], warnings: [] }); }
    };
    step();
    return;
  }

  const gen =
    d.method === "beso"
      ? beso(problem, { ...BESO_DEFAULTS, volfrac: d.volfrac, rmin: d.rmin })
      : simp(problem, { volfrac: d.volfrac, penal: 3, rmin: d.rmin, maxIter: 120, tol: 0.01 });
  let first = true;
  const step = () => {
    if (token !== runToken) return;
    const g = gen.next();
    const info = g.value;
    const done = !!g.done || stopFlag;
    const u = info.u!;
    const rr = supportReactions(problem, info.Ee!, u, r.supportGroups, model);
    post({
      kind: "frame", token, dims, mask: problem.mask, reactions: rr.reactions, residual: rr.residual,
      iter: info.iter, compliance: info.compliance, volume: info.volume, change: info.change,
      rho: info.rho.slice(), u: u.slice(), field: principalStresses(problem, u), done,
      warnings: first ? r.warnings : [],
    });
    first = false;
    if (!done) setTimeout(step, 0);
  };
  step();
};
