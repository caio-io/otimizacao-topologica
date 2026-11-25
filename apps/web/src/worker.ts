import { BESO_DEFAULTS, beso, buildProblem, principalStresses, simp, solveDisplacements, supportReactions } from "@stm/core";
import type { Scene } from "@stm/core";

export type WorkerIn =
  | { mode: "opt"; scene: Scene; method: "beso" | "simp"; volfrac: number; rmin: number }
  | { mode: "elastic"; scene: Scene }
  | { stop: true };

let stopFlag = false;
const post = (m: unknown) => (self as unknown as Worker).postMessage(m);

self.onmessage = (ev: MessageEvent<WorkerIn>) => {
  const d = ev.data;
  if ("stop" in d) { stopFlag = true; return; }
  stopFlag = false;
  const r = buildProblem(d.scene);
  if (!r.problem) { post({ kind: "error", errors: r.errors, warnings: r.warnings }); return; }
  const problem = r.problem;
  const dims = { nelx: problem.nelx, nely: problem.nely, h: problem.h, ox: r.origin.x, oy: r.origin.y };

  if (d.mode === "elastic") {
    const rho = new Float64Array(problem.mask.length);
    for (let e = 0; e < rho.length; e++) rho[e] = problem.mask[e] ? 1 : 0;
    const u = solveDisplacements(problem, rho, 1);
    const Ee = new Float64Array(rho.length);
    for (let e = 0; e < rho.length; e++) Ee[e] = 1e-6 + (1 - 1e-6) * rho[e];
    const rr = supportReactions(problem, Ee, u, r.supportGroups.map((g) => ({ ...g, nodes: g.nodes })));
    post({ kind: "frame", dims, mask: problem.mask, iter: 0, compliance: 0, volume: 1, change: 0, rho, u,
      field: principalStresses(problem, u), done: true, warnings: r.warnings, elastic: true,
      reactions: rr.reactions, residual: rr.residual });
    return;
  }

  const gen =
    d.method === "beso"
      ? beso(problem, { ...BESO_DEFAULTS, volfrac: d.volfrac, rmin: d.rmin })
      : simp(problem, { volfrac: d.volfrac, penal: 3, rmin: d.rmin, maxIter: 120, tol: 0.01 });
  let first = true;
  const step = () => {
    const g = gen.next();
    const info = g.value;
    const done = !!g.done || stopFlag;
    const u = info.u!;
    const rr = supportReactions(problem, info.Ee!, u, r.supportGroups);
    post({
      kind: "frame", dims, mask: problem.mask, reactions: rr.reactions, residual: rr.residual,
      iter: info.iter, compliance: info.compliance, volume: info.volume, change: info.change,
      rho: info.rho.slice(), u: u.slice(), field: principalStresses(problem, u), done,
      warnings: first ? r.warnings : [],
    });
    first = false;
    if (!done) setTimeout(step, 0);
  };
  step();
};
