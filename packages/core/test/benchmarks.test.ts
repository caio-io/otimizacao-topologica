import { describe, expect, it } from "vitest";
import {
  BENCHMARKS,
  benchmarkById,
  buildProblem,
  ca50,
  cappedAutoFilterRadius,
  deepBeamScene,
  generateStirrupGroup,
  nbrConcrete,
  solveNonlinear,
  templateCorbel,
  templateDeepBeam,
  templateFrameCorner,
} from "../src";
import type { Problem } from "../src";

describe("Catálogo de benchmarks dos artigos", () => {
  it("todos os benchmarks constroem Scene e Problem válidos sem erros", () => {
    expect(BENCHMARKS.length).toBeGreaterThanOrEqual(7);
    for (const bm of BENCHMARKS) {
      const sc = bm.createScene();
      const b = buildProblem(sc);
      expect(b.errors, `erros em ${bm.id}`).toEqual([]);
      expect(b.problem, `problem nulo em ${bm.id}`).not.toBeNull();
      expect(benchmarkById(bm.id)?.id).toBe(bm.id);
    }
  });
});

describe("Pós-processamento estendido do Nível 2 (crackTheta, curva P–δ e utilização)", () => {
  it("tirante horizontal em tração uniaxial: fissura vertical (|crackTheta| ≈ π/2), curva P–δ monotônica e utilização do aço ≈ ft/fy", () => {
    const nelx = 8, nely = 2, h = 0.05;
    const p: Problem = {
      nelx, nely, h, t: 0.3, E: 30e6, nu: 0.2, mask: new Uint8Array(nelx * nely).fill(1),
      fixed: [], loads: [{ node: nelx * (nely + 1) + 1, fx: 1, fy: 0 }],
    };
    for (let j = 0; j <= nely; j++) p.fixed.push(2 * j, 2 * j + 1);
    const r = solveNonlinear(p, {
      concrete: nbrConcrete(30),
      bars: [{ x0: 0, y0: 0.05, x1: 0.4, y1: 0.05, area: 1e-3, steel: ca50, label: "T" }],
      dLambda: 80,
    });
    expect(r.curve.length).toBeGreaterThan(4);
    expect(r.curve[0]).toEqual({ lambda: 0, load: 0, disp: 0, maxDisp: 0 });
    for (let i = 1; i < r.curve.length; i++) {
      expect(r.curve[i].load).toBeGreaterThan(r.curve[i - 1].load);
      expect(r.curve[i].disp).toBeGreaterThanOrEqual(r.curve[i - 1].disp - 1e-9);
    }
    expect(r.utilization.steelStress).toBeGreaterThan(1.0);
    expect(r.utilization.steelStrain).toBeGreaterThan(0.8);
    let cracked = 0, vertical = 0;
    for (let e = 0; e < r.epsTens.length; e++) {
      if (r.epsTens[e] > 1e-4) {
        cracked++;
        if (Math.abs(Math.sin(r.crackTheta[e])) > 0.85) vertical++;
      }
    }
    expect(cracked).toBeGreaterThan(0);
    expect(vertical / cracked).toBeGreaterThan(0.7);
  });
});

describe("Templates paramétricos, gerador de estribos e filtro automático", () => {
  it("templates de viga-parede, consolo e nó de pórtico produzem problemas válidos", () => {
    const scenes = [
      templateDeepBeam({ L: 3, H: 1.5, t: 0.25, h: 0.05, bearing: 0.3, loadKN: 800, fck: 30, opening: { x: 0.6, y: 0.5, w: 0.5, h: 0.4 } }),
      templateCorbel({ colW: 0.5, colH: 2.0, corbA: 0.5, corbH: 0.6, corbY: 0.8, t: 0.3, h: 0.05, bearing: 0.2, fvKN: 400, fhKN: 40, fck: 30 }),
      templateFrameCorner({ colW: 0.4, colH: 2.4, beamL: 2.4, beamH: 0.5, t: 0.3, h: 0.05, qKNm: 150, fck: 30 }),
    ];
    for (const sc of scenes) expect(buildProblem(sc).errors).toEqual([]);
  });

  it("generateStirrupGroup cria grupo vertical com espaçamento e área corretos", () => {
    const g = generateStirrupGroup({
      id: "B10", x0: 0, y0: 0, x1: 1.0, y1: 0.5, orientation: "vertical",
      cover: 0.05, spacing: 0.15, legs: 2, diaMm: 6.3, steelClass: "CA60",
    });
    expect(g).not.toBeNull();
    expect(1 + (g!.extra?.length ?? 0)).toBe(7);
    expect(g!.areaCm2).toBeCloseTo(2 * Math.PI * 0.315 ** 2, 6);
  });

  it("cappedAutoFilterRadius preserva viga-parede e limita fuste estreito de consolo", () => {
    const db = buildProblem(deepBeamScene(false)).problem!;
    expect(cappedAutoFilterRadius(0.156, db.h, db.mask, db.nelx, db.nely)).toBe(6.5);

    const corb = buildProblem(templateCorbel({
      colW: 0.28, colH: 0.9, corbA: 0.42, corbH: 0.32, corbY: 0.54,
      t: 0.2, h: 0.01, bearing: 0.12, fvKN: 400, fhKN: 0, fck: 30,
    })).problem!;
    expect(cappedAutoFilterRadius(0.375, corb.h, corb.mask, corb.nelx, corb.nely)).toBeLessThanOrEqual(4.5);
  });
});
