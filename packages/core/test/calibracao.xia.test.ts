import { describe, it } from "vitest";
import { BESO_DEFAULTS, base, beso, buildProblem, plateLoad, rectPts, simp, xiaIndices } from "../src";
import type { Scene } from "../src";

/** Caso I de Xia, Langelaar & Hendriks (2020), Fig. 15a: viga-parede 7,5 × 4,7 m com abertura 1,5 × 1,5 m. */
function xiaCase1(h: number, plate: number): Scene {
  const s = base(h, plate);
  s.t = 0.3; s.E = 20e6; s.nu = 0.2;
  s.shapes.push({ id: "S1", mode: "add", pts: [[0, 0], [plate, 0], [7.5 - plate, 0], [7.5, 0], [7.5, 4.7], [0, 4.7]] });
  s.shapes.push({ id: "A1", mode: "cut", pts: rectPts(0.5, 0.5, 1.5, 1.5) });
  s.supports.push({ id: "Ap1", x0: 0, y0: 0, x1: plate, y1: 0, ux: true, uy: true });
  s.supports.push({ id: "Ap2", x0: 7.5 - plate, y0: 0, x1: 7.5, y1: 0, ux: false, uy: true });
  s.loads.push(plateLoad("P1", 4.7, 4.7, plate, -3000));
  return s;
}

// lento (~4 min): rode com  CALIBRACAO=1 npx vitest run test/calibracao.xia.test.ts
describe.skipIf(!process.env.CALIBRACAO)("Calibração — Xia et al. (2020), Caso I", () => {
  it("índices TRS/SR para SIMP e BESO a 40% (malha 50 mm)", () => {
    const sc = xiaCase1(0.05, 0.15);
    const p = buildProblem(sc).problem!;
    const full = new Uint8Array(p.nelx * p.nely).fill(1);
    const f = xiaIndices(p, full);
    console.log(`peça cheia: TRS=${f.trs.toFixed(1)}% SR=${f.sr.toFixed(3)}%`);
    for (const rmin of [2, 3, 4]) {
      let r: any; const t0 = Date.now();
      for (const q of simp(p, { volfrac: 0.4, penal: 3, rmin, maxIter: 100, tol: 0.01 })) r = q;
      const solid = Uint8Array.from(r.rho, (v: number, e: number) => (v > 0.5 || p.mask[e] === 2 ? 1 : 0));
      const ix = xiaIndices(p, solid);
      console.log(`SIMP 40% rmin=${rmin}: it=${r.iter} C=${r.compliance.toExponential(3)} TRS=${ix.trs.toFixed(1)}% SR=${ix.sr.toFixed(3)}% L=${ix.skeletonLength.toFixed(1)} m r0=${ix.r0.toFixed(2)} m (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    }
    let b: any; const t1 = Date.now();
    for (const q of beso(p, { ...BESO_DEFAULTS, volfrac: 0.4, rmin: 3 })) b = q;
    const solidB = Uint8Array.from(b.rho, (v: number, e: number) => (v > 0.5 || p.mask[e] === 2 ? 1 : 0));
    const ib = xiaIndices(p, solidB);
    console.log(`BESO 40% rmin=3: it=${b.iter} C=${b.compliance.toExponential(3)} TRS=${ib.trs.toFixed(1)}% SR=${ib.sr.toFixed(3)}% L=${ib.skeletonLength.toFixed(1)} m (${((Date.now() - t1) / 1000).toFixed(0)} s)`);
  }, 1_800_000);
});
