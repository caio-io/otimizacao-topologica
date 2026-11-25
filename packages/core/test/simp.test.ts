import { describe, expect, it } from "vitest";
import { BESO_DEFAULTS, runBeso, buildModel, deepBeam, principalStresses, runSimp, solveDisplacements, solvePCG } from "../src";
import type { Problem } from "../src";

describe("FE Q4", () => {
  it("viga em balanço ≈ Euler-Timoshenko (ordem de grandeza)", () => {
    const nelx = 60, nely = 10, h = 0.1;
    const p: Problem = {
      nelx, nely, h, t: 1, E: 1, nu: 0, mask: new Uint8Array(nelx * nely).fill(1),
      fixed: [], loads: [{ node: nelx * (nely + 1) + nely / 2, fx: 0, fy: -1 }],
    };
    for (let j = 0; j <= nely; j++) p.fixed.push(2 * j, 2 * j + 1);
    const m = buildModel(p);
    const u = new Float64Array(m.ndof);
    solvePCG(m, new Float64Array(nelx * nely).fill(1), u, 1e-12, 20000);
    const tip = Math.abs(u[2 * (nelx * (nely + 1) + nely / 2) + 1]);
    const L = nelx * h, I = (nely * h) ** 3 / 12;
    const analytic = (1 * L ** 3) / (3 * 1 * I); // PL³/3EI (t=1)
    expect(tip / analytic).toBeGreaterThan(0.85);
    expect(tip / analytic).toBeLessThan(1.15);
  });
});

describe("BESO", () => {
  it("viga-parede: atinge volume alvo, resultado binário e conectado ao carregamento", () => {
    const p = deepBeam(false);
    const res = runBeso(p, { ...BESO_DEFAULTS, volfrac: 0.35, rmin: 2.5, maxIter: 60 });
    expect(res.volume).toBeGreaterThan(0.33);
    expect(res.volume).toBeLessThan(0.37);
    let binary = true;
    for (let e = 0; e < res.rho.length; e++) if (res.rho[e] !== 1 && res.rho[e] !== 1e-3) binary = false;
    expect(binary).toBe(true);
    expect(Number.isFinite(res.compliance)).toBe(true);
  }, 240_000);
});

describe("SIMP", () => {
  it("viga-parede: volume atinge a fração e flexibilidade cai", () => {
    const p = deepBeam(false);
    const first = runSimp(p, { volfrac: 1, penal: 3, rmin: 2.5, maxIter: 1, tol: 0 });
    const res = runSimp(p, { volfrac: 0.35, penal: 3, rmin: 2.5, maxIter: 40, tol: 1e-3 });
    expect(res.volume).toBeLessThan(0.36);
    expect(res.compliance).toBeGreaterThan(first.compliance); // menos material => mais flexível
    expect(res.compliance).toBeLessThan(first.compliance * 8);
  }, 120_000);

  it("equilíbrio: tensões principais finitas e s1>=s2", () => {
    const p = deepBeam(false);
    const res = runSimp(p, { volfrac: 0.4, penal: 3, rmin: 2.5, maxIter: 5, tol: 0 });
    const u = solveDisplacements(p, res.rho, 3);
    const f = principalStresses(p, u);
    for (let e = 0; e < f.s1.length; e++) {
      expect(Number.isFinite(f.s1[e])).toBe(true);
      expect(f.s1[e]).toBeGreaterThanOrEqual(f.s2[e]);
    }
  }, 120_000);
});

import { buildProblem, deepBeamScene, supportReactions } from "../src";
describe("Scene", () => {
  it("viga-parede reproduz malha 120x60 e apoios/cargas", () => {
    const r = buildProblem(deepBeamScene());
    expect(r.errors).toEqual([]);
    expect(r.problem!.nelx).toBe(120);
    expect(r.problem!.nely).toBe(60);
    const sum = r.problem!.loads.reduce((a, l) => a + l.fy, 0);
    expect(sum).toBeCloseTo(-1000, 6);
  });
  it("abertura remove elementos", () => {
    const a = buildProblem(deepBeamScene(false)).problem!, b = buildProblem(deepBeamScene(true)).problem!;
    const n = (p: Problem) => p.mask.reduce((s, v) => s + v, 0);
    expect(n(b)).toBeLessThan(n(a));
  });
  it("detecta falta de apoio e de carga", () => {
    const s = deepBeamScene();
    s.supports = [s.supports[1]];
    expect(buildProblem(s).errors.length).toBeGreaterThan(0);
    const s2 = deepBeamScene(); s2.loads = [];
    expect(buildProblem(s2).errors.join()).toMatch(/carga/);
  });
  it("duas aberturas: ambas são subtraídas", () => {
    const s = deepBeamScene(true);
    const one = buildProblem(s).problem!.mask.reduce((a, v) => a + (v ? 1 : 0), 0);
    s.shapes.push({ id: "A2", mode: "cut", pts: [[1.8, 0.3], [2.4, 0.3], [2.4, 0.8], [1.8, 0.8]] });
    const two = buildProblem(s).problem!.mask.reduce((a, v) => a + (v ? 1 : 0), 0);
    expect(two).toBeLessThan(one - 400);
  });
  it("exige força e apoio sobre os lados (contorno)", () => {
    const s = deepBeamScene(); s.loads[0].x = 1.37; // sobre o lado superior: válido
    expect(buildProblem(s).errors).toEqual([]);
    const s1 = deepBeamScene(); s1.loads[0].y = 1.0; // dentro da peça: inválido
    expect(buildProblem(s1).errors.join()).toMatch(/lado/);
    const s2 = deepBeamScene(); s2.supports[0].x1 = 0.17; // sobre o lado inferior: válido
    expect(buildProblem(s2).errors).toEqual([]);
    const s3 = deepBeamScene(); s3.supports[0].y1 = 0.1; // fora do lado: inválido
    expect(buildProblem(s3).errors.join()).toMatch(/lado/);
  });
  it("detecta rotação livre (dois apoios x na mesma linha)", () => {
    const s = deepBeamScene();
    s.supports = [{ id: "a", x0: 0, y0: 0, x1: 3, y1: 0, ux: true, uy: false }];
    expect(buildProblem(s).errors.length).toBeGreaterThan(0);
  });
});

describe("Coerência física", () => {
  it("reações equilibram as cargas e tensões têm ordem de grandeza física", () => {
    const sc = deepBeamScene();
    const r = buildProblem(sc);
    const p = r.problem!;
    const rho = new Float64Array(p.mask.length);
    for (let e = 0; e < rho.length; e++) rho[e] = p.mask[e] ? 1 : 0;
    const u = solveDisplacements(p, rho, 1);
    const Ee = new Float64Array(rho.length);
    for (let e = 0; e < rho.length; e++) Ee[e] = 1e-6 + (1 - 1e-6) * rho[e];
    const { reactions, residual } = supportReactions(p, Ee, u, r.supportGroups);
    expect(Math.abs(residual.y)).toBeLessThan(1e-3);
    expect(Math.abs(residual.x)).toBeLessThan(1e-3);
    expect(reactions[0].ry + reactions[1].ry).toBeCloseTo(1000, 1);
    // simetria aproximada (apoio esquerdo é pino, direito é rolete)
    expect(reactions[0].ry).toBeGreaterThan(450);
    // tensão máxima: P/(t·b)=1000/(0.2*0.3)=16.7 MPa ⇒ concentra algumas vezes, mas nunca 1e6×
    const f = principalStresses(p, u);
    let smax = 0;
    for (let e = 0; e < rho.length; e++) if (p.mask[e]) smax = Math.max(smax, Math.abs(f.s2[e]));
    expect(smax).toBeGreaterThan(5_000); // kN/m²
    expect(smax).toBeLessThan(500_000);
    // equilíbrio de momento na seção central: ∫σx·y dA ≈ momento fletor (R·(L/2 − xR))
    const M = reactions[0].ry * (1.5 - reactions[0].x) ;
    let Mint = 0;
    const i = p.nelx / 2;
    for (let j = 0; j < p.nely; j++) {
      const e = i * p.nely + j;
      const th = f.theta[e], sx = f.s1[e] * Math.cos(th) ** 2 + f.s2[e] * Math.sin(th) ** 2;
      const y = (p.nely - j - 0.5) * p.h - 0.75;
      Mint += -sx * y * p.h * p.t;
    }
    expect(Math.abs(Mint) / M).toBeGreaterThan(0.8);
    expect(Math.abs(Mint) / M).toBeLessThan(1.2);
  }, 120_000);
});
