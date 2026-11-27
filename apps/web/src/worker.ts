import {
  BESO_DEFAULTS,
  barsFromScene,
  beso,
  buildModel,
  buildProblem,
  concreteFromScene,
  principalStresses,
  simp,
  solveDisplacements,
  solveNonlinearSteps,
  steelVolume,
  supportReactions,
  xiaIndices,
} from "@stm/core";
import type { NlCurvePoint, NlStep, Scene } from "@stm/core";

export type WorkerIn =
  | { token: number; mode: "opt"; scene: Scene; method: "beso" | "simp"; volfrac: number; rmin: number }
  | { token: number; mode: "elastic"; scene: Scene }
  | { token: number; mode: "nl"; scene: Scene }
  | { token: number; mode: "metrics"; scene: Scene; rho: Float64Array }
  | { stop: true };

let stopFlag = false;
let runToken = 0;
const post = (m: unknown) => (self as unknown as Worker).postMessage(m);

self.onmessage = (ev: MessageEvent<WorkerIn>) => {
  const d = ev.data;
  if ("stop" in d) { stopFlag = true; return; }
  const token = (runToken = d.token);
  stopFlag = false;
  const r = buildProblem(d.scene);
  if (!r.problem) { post({ kind: "error", token, errors: r.errors, warnings: r.warnings }); return; }
  const problem = r.problem;
  const model = buildModel(problem);
  const dims = { nelx: problem.nelx, nely: problem.nely, h: problem.h, ox: r.origin.x, oy: r.origin.y };

  if (d.mode === "metrics") {
    try {
      const solid = Uint8Array.from(d.rho, (v, e) => (v > 0.5 || problem.mask[e] === 2 ? 1 : 0));
      const sv = steelVolume(problem, solid);
      const xia = xiaIndices(problem, solid);
      post({ kind: "metrics", token, steelVolCm3: sv, xia });
    } catch (err) {
      post({ kind: "error", token, errors: [String((err as Error).message ?? err)], warnings: [] });
    }
    return;
  }

  if (d.mode === "elastic") {
    const rho = new Float64Array(problem.mask.length);
    for (let e = 0; e < rho.length; e++) rho[e] = problem.mask[e] ? 1 : 0;
    const u = solveDisplacements(problem, rho, 1);
    const Ee = new Float64Array(rho.length);
    for (let e = 0; e < rho.length; e++) Ee[e] = 1e-6 + (1 - 1e-6) * rho[e];
    const rr = supportReactions(problem, Ee, u, r.supportGroups, model);
    post({
      kind: "frame", token, dims, mask: problem.mask, iter: 0, compliance: 0, volume: 1, change: 0, rho, u,
      field: principalStresses(problem, u), done: true, warnings: r.warnings, elastic: true,
      reactions: rr.reactions, residual: rr.residual,
    });
    return;
  }

  if (d.mode === "nl") {
    const nel = problem.mask.length;
    const rho = new Float64Array(nel);
    for (let e = 0; e < nel; e++) rho[e] = problem.mask[e] ? 1 : 0;
    const zeros = new Float64Array(nel);
    const field = { s1: zeros, s2: zeros, theta: zeros };
    const par0 = d.scene.nl ?? { values: "design" as const, epsCu: 0.0035, crushLength: 0 };
    const par = { ...par0, crushLength: par0.crushAuto !== false ? d.scene.t : par0.crushLength };
    const concrete = concreteFromScene(d.scene);
    let P0x = 0, P0y = 0;
    for (let n = 0; n < model.fRaw.length; n += 2) { P0x += model.fRaw[n]; P0y += model.fRaw[n + 1]; }
    const P0 = Math.hypot(P0x, P0y);
    let gen: ReturnType<typeof solveNonlinearSteps>;
    try {
      gen = solveNonlinearSteps(problem, {
        concrete,
        bars: barsFromScene(d.scene),
        origin: r.origin,
        checkCrushing: true,
        crushLength: par.crushLength || undefined,
        dLambda: 0.1,
        maxIt: 200,
        stepwise: true,
      });
    } catch (err) {
      post({ kind: "error", token, errors: [String((err as Error).message ?? err)], warnings: r.warnings });
      return;
    }

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
    const nlResidualKn = (reaction: Float64Array, lam: number) => {
      let sx = 0, sy = 0;
      for (let idx = 0; idx < model.ndof; idx += 2) {
        sx += lam * model.fRaw[idx] + reaction[idx];
        sy += lam * model.fRaw[idx + 1] + reaction[idx + 1];
      }
      return { x: sx, y: sy };
    };

    const base = { kind: "frame", token, dims, mask: problem.mask, compliance: 0, volume: 1, change: 0, rho, field, P0 };
    const curveAcc: NlCurvePoint[] = [{ lambda: 0, load: 0, disp: 0, maxDisp: 0 }];
    const emptyUtil = { concreteStress: 0, concreteCrush: 0, steelStress: 0, steelStrain: 0, maxCompStress: 0 };
    let first = true, count = 0, last: NlStep | null = null;
    const step = () => {
      if (token !== runToken) return;
      try {
        if (stopFlag) {
          post({
            ...base, iter: count, u: last?.u ?? new Float64Array(model.ndof), reactions: [], residual: { x: 0, y: 0 }, done: true, warnings: [],
            nl: {
              lambda: last?.lambda ?? 0, mode: "interrompida", epsComp: last?.epsComp ?? zeros, epsTens: last?.epsTens ?? zeros,
              crackTheta: last?.crackTheta ?? zeros, stress: last?.stress ?? new Float64Array(3 * nel),
              barSamples: last?.barSamples ?? [], bars: [], maxEpsC: last?.maxEpsC ?? 0, crushStrain: last?.crushStrain ?? 0,
              epsCu: concrete.epsu, fc: concrete.fc, crushLength: par.crushLength, equilibrium: { x: 0, y: 0 },
              curve: curveAcc.slice(), utilization: last?.utilization ?? emptyUtil,
            },
          });
          return;
        }
        const g = gen.next();
        if (!g.done) {
          const st = g.value; last = st; count++;
          curveAcc.push(st.curvePoint);
          post({
            ...base, iter: count, u: st.u, reactions: [], residual: { x: 0, y: 0 }, done: false, warnings: first ? [...r.warnings, ...st.notes] : [],
            nl: {
              lambda: st.lambda, mode: null, epsComp: st.epsComp, epsTens: st.epsTens, crackTheta: st.crackTheta,
              stress: st.stress, barSamples: st.barSamples, bars: [], maxEpsC: st.maxEpsC, crushStrain: st.crushStrain,
              crush: st.crush, epsCu: concrete.epsu, fc: concrete.fc, crushLength: par.crushLength,
              equilibrium: { x: 0, y: 0 }, curve: curveAcc.slice(), utilization: st.utilization,
            },
          });
          first = false;
          setTimeout(step, 0);
        } else {
          const res = g.value;
          post({
            ...base, iter: count + 1, u: res.u, reactions: groupReactions(res.reaction), residual: nlResidualKn(res.reaction, res.lambda), done: true,
            warnings: first ? [...r.warnings, ...res.notes] : res.notes,
            nl: {
              lambda: res.lambda, mode: res.mode, epsComp: res.epsComp, epsTens: res.epsTens, crackTheta: res.crackTheta,
              stress: res.stress, barSamples: res.barSamples, bars: res.bars, maxEpsC: res.maxCompStrain, crushStrain: res.crushStrain,
              crush: res.crush, failure: res.failure, firstPlateau: res.firstPlateau,
              epsCu: concrete.epsu, fc: concrete.fc, crushLength: par.crushLength, equilibrium: res.equilibrium,
              curve: res.curve, utilization: res.utilization,
            },
          });
        }
      } catch (err) {
        post({ kind: "error", token, errors: [String((err as Error).message ?? err)], warnings: [] });
      }
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
    let steelVolCm3: number | undefined;
    if (done) {
      const solid = Uint8Array.from(info.rho, (v, e) => (v > 0.5 || problem.mask[e] === 2 ? 1 : 0));
      steelVolCm3 = steelVolume(problem, solid);
    }
    post({
      kind: "frame", token, dims, mask: problem.mask, reactions: rr.reactions, residual: rr.residual,
      iter: info.iter, compliance: info.compliance, volume: info.volume, change: info.change,
      rho: info.rho.slice(), u: u.slice(), field: principalStresses(problem, u), done,
      warnings: first ? r.warnings : [], steelVolCm3,
    });
    first = false;
    if (!done) setTimeout(step, 0);
  };
  step();
};
