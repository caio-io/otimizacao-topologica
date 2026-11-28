import { describe, expect, it } from "vitest";
import { buildModel, buildProblem, solveBanded, supportReactions, templateWalkingColumn, walkingColumnSummary } from "../src";

describe("Walking Column (3 pavimentos) — autocomplete e equilíbrio", () => {
  it("calcula corretamente o autocomplete do pilar intermediário para e > 0, e < 0 e e = 0", () => {
    // Excentricidade positiva (pilar inferior à direita)
    const sPos = walkingColumnSummary({
      storyH: 3.0, topAxisX: 1.0, eccentricity: 0.8,
      topColW: 0.5, botColW: 0.6, t: 0.4, slabH: 0.2, fck: 35, loadTopKN: 1800,
    });
    expect(sPos.xTopL).toBeCloseTo(0.75, 4);
    expect(sPos.xTopR).toBeCloseTo(1.25, 4);
    expect(sPos.xBotAxis).toBeCloseTo(1.8, 4);
    expect(sPos.xBotL).toBeCloseTo(1.5, 4);
    expect(sPos.xBotR).toBeCloseTo(2.1, 4);
    expect(sPos.xMidL).toBeCloseTo(0.75, 4);
    expect(sPos.xMidR).toBeCloseTo(2.1, 4);
    expect(sPos.midColW).toBeCloseTo(1.35, 4);
    expect(sPos.estimatedThrustKN).toBeCloseTo((1800 * 0.8) / 3.0, 2);

    // Excentricidade negativa (pilar inferior à esquerda)
    const sNeg = walkingColumnSummary({
      storyH: 3.0, topAxisX: 2.0, eccentricity: -0.9,
      topColW: 0.5, botColW: 0.5, t: 0.4, slabH: 0.2, fck: 35, loadTopKN: 1500,
    });
    expect(sNeg.xMidL).toBeCloseTo(0.85, 4);
    expect(sNeg.xMidR).toBeCloseTo(2.25, 4);
    expect(sNeg.midColW).toBeCloseTo(1.4, 4);

    // Excentricidade nula (pilares alinhados)
    const sZero = walkingColumnSummary({
      storyH: 3.0, topAxisX: 1.0, eccentricity: 0,
      topColW: 0.5, botColW: 0.5, t: 0.4, slabH: 0.2, fck: 35, loadTopKN: 1000,
    });
    expect(sZero.midColW).toBeCloseTo(0.5, 4);
    expect(sZero.estimatedThrustKN).toBeCloseTo(0, 6);
  });

  it("gera cena válida (e > 0 e e < 0) que rasteriza sem erros e fecha equilíbrio global com binário nos diafragmas", () => {
    for (const ecc of [0.8, -0.8]) {
      const sc = templateWalkingColumn({
        buildingName: "Torre Teste",
        storyH: 3.0,
        topAxisX: 1.5,
        eccentricity: ecc,
        topColW: 0.5,
        botColW: 0.5,
        t: 0.4,
        slabH: 0.2,
        fck: 35,
        loadTopKN: 1800,
        h: 0.1,
        includeRebar: true,
      });

      const built = buildProblem(sc);
      expect(built.errors).toEqual([]);
      expect(built.problem).not.toBeNull();
      const prob = built.problem!;

      const model = buildModel(prob);
      const Ee = new Float64Array(prob.nelx * prob.nely);
      for (let i = 0; i < Ee.length; i++) Ee[i] = prob.mask[i] ? 1 : 1e-9;
      const u = new Float64Array(model.ndof);
      const ok = solveBanded(model, prob.nely, Ee, u);
      expect(ok).toBe(true);
      const { reactions, residual } = supportReactions(prob, Ee, u, built.supportGroups, model);

      // Equilíbrio global
      expect(Math.abs(residual.x)).toBeLessThan(1e-3);
      expect(Math.abs(residual.y)).toBeLessThan(1e-3);

      const base = reactions.find((g) => g.id === "ApBase")!;
      const d1e = reactions.find((g) => g.id === "Diaf1E")!;
      const d1d = reactions.find((g) => g.id === "Diaf1D")!;
      const d2e = reactions.find((g) => g.id === "Diaf2E")!;
      const d2d = reactions.find((g) => g.id === "Diaf2D")!;

      // Toda a carga vertical sai na base
      expect(base.ry).toBeCloseTo(1800, 1);
      expect(Math.abs(d1e.ry + d1d.ry)).toBeLessThan(1e-3);
      expect(Math.abs(d2e.ry + d2d.ry)).toBeLessThan(1e-3);

      // Resultante horizontal de cada nível de diafragma (Laje 1 vs Laje 2) forma o binário de equilíbrio
      const hDiaf1 = d1e.rx + d1d.rx;
      const hDiaf2 = d2e.rx + d2d.rx;
      expect(hDiaf1 * hDiaf2).toBeLessThan(0);
      expect(Math.abs(hDiaf2)).toBeGreaterThan(350);
      expect(Math.abs(hDiaf2)).toBeLessThan(650);
      expect(hDiaf1 + hDiaf2 + base.rx).toBeCloseTo(0, 1);

      // Armadura inicial gerada
      expect(sc.bars && sc.bars.length).toBeGreaterThanOrEqual(6);
    }
  });
});
