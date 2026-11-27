import { describe, expect, it } from "vitest";
import {
  DESIGN_CODES,
  barsFromScene,
  ca50,
  nbrConcrete,
  pierCapScene,
  solveBandedAssembled,
  solveNonlinear,
  strutDesignStrength,
  withTensionStiffening,
  xiaIndices,
} from "../src";
import type { Problem } from "../src";

describe("Regressão da auditoria técnica", () => {
  it("solveBandedAssembled: retorna true em matriz SPD e false sem mascarar pivô nulo/negativo/indefinido", () => {
    const bw = 1, w = bw + 1, ndof = 2;
    const isFixed = new Uint8Array(ndof);
    const f = new Float64Array([5, 5]);
    const u = new Float64Array(ndof);

    // SPD: [[4, 1], [1, 3]] → u = [10/11, 15/11]
    const Lspd = new Float64Array(ndof * w);
    Lspd[0 * w + bw] = 4;
    Lspd[1 * w + (bw - 1)] = 1;
    Lspd[1 * w + bw] = 3;
    expect(solveBandedAssembled(Lspd, ndof, bw, isFixed, f, u)).toBe(true);
    expect(u[0]).toBeCloseTo(10 / 11, 9);
    expect(u[1]).toBeCloseTo(15 / 11, 9);

    // Diagonal nula
    const Lzero = new Float64Array(ndof * w);
    Lzero[0 * w + bw] = 4;
    Lzero[1 * w + bw] = 0;
    expect(solveBandedAssembled(Lzero, ndof, bw, isFixed, f, u)).toBe(false);

    // Indefinida: [[1, 2], [2, 1]] (pivô de Schur = 1 - 4 = -3 < 0)
    const Lindef = new Float64Array(ndof * w);
    Lindef[0 * w + bw] = 1;
    Lindef[1 * w + (bw - 1)] = 2;
    Lindef[1 * w + bw] = 1;
    expect(solveBandedAssembled(Lindef, ndof, bw, isFixed, f, u)).toBe(false);

    // NaN na diagonal
    const Lnan = new Float64Array(ndof * w);
    Lnan[0 * w + bw] = NaN;
    Lnan[1 * w + bw] = 1;
    expect(solveBandedAssembled(Lnan, ndof, bw, isFixed, f, u)).toBe(false);
  });

  it("barsFromScene: valida parâmetros positivos, ft >= fy e εy < εu", () => {
    const base = () => {
      const sc = pierCapScene(0.1, 0.12);
      sc.bars = [{ id: "B1", label: "B1", path: [[0.1, 0.1], [1.1, 0.1]], areaCm2: 10, fy: 500, ft: 540, Es: 200, epsU: 0.05 }];
      return sc;
    };
    const ok = barsFromScene(base());
    expect(ok[0].area).toBeCloseTo(1e-3, 12);
    expect(ok[0].steel.fy).toBeCloseTo(500e3, 6);
    expect(ok[0].steel.Es).toBeCloseTo(200e6, 3);

    const negFy = base(); negFy.bars![0].fy = 0;
    expect(() => barsFromScene(negFy)).toThrow(/positivos/);

    const negEs = base(); negEs.bars![0].Es = -200;
    expect(() => barsFromScene(negEs)).toThrow(/positivos/);

    const badFt = base(); badFt.bars![0].ft = 400;
    expect(() => barsFromScene(badFt)).toThrow(/ft/);

    // fy/Es = 12000 MPa / 200000 MPa = 0.06 >= epsU (0.05)
    const badStrain = base(); badStrain.bars![0].fy = 12000; badStrain.bars![0].ft = 13000;
    expect(() => barsFromScene(badStrain)).toThrow(/fy\/Es/);
  });

  it("withTensionStiffening: rejeita rhoEff/fct inválidos e detecta escoamento em epsYm", () => {
    expect(() => withTensionStiffening(ca50, 2900, 0)).toThrow(/rhoEff/);
    expect(() => withTensionStiffening(ca50, 2900, 1)).toThrow(/rhoEff/);
    expect(() => withTensionStiffening(ca50, -1, 0.01)).toThrow(/fct/);

    // Tirante uniaxial com TS: a barra deve escoar antes da ruptura com carga de ruptura = As·ft
    const nelx = 4, nely = 2, h = 0.05;
    const p: Problem = {
      nelx, nely, h, t: 0.3, E: 30e6, nu: 0.2, mask: new Uint8Array(nelx * nely).fill(1),
      fixed: [], loads: [{ node: nelx * (nely + 1) + 1, fx: 1, fy: 0 }],
    };
    for (let j = 0; j <= nely; j++) p.fixed.push(2 * j, 2 * j + 1);
    const area = 1e-3;
    // carga ligeiramente acima de As·fy (434.8 kN) para verificar escoamento detectado com TS
    const r = solveNonlinear(p, {
      concrete: nbrConcrete(30),
      bars: [{ x0: 0, y0: 0.05, x1: 0.2, y1: 0.05, area, steel: ca50, label: "tirante" }],
      tensionStiffening: { fct: 2900, rhoEff: 0.01 },
      dLambda: 50,
      lambdaMax: 445,
    });
    expect(r.bars[0].yielded).toBe(true);
    expect(r.bars[0].yieldLambda).not.toBeNull();
  });

  it("xiaIndices: não trava quando solid está vazio (L = 0)", () => {
    const nelx = 6, nely = 4, h = 0.1;
    const p: Problem = {
      nelx, nely, h, t: 0.2, E: 30e6, nu: 0.2, mask: new Uint8Array(nelx * nely).fill(1),
      fixed: [0, 1, 2 * nely, 2 * nely + 1],
      loads: [{ node: nelx * (nely + 1), fx: 0, fy: -100 }],
    };
    const empty = new Uint8Array(nelx * nely);
    const ix = xiaIndices(p, empty);
    expect(ix.skeletonLength).toBe(0);
    expect(ix.trs).toBe(0);
    expect(ix.sr).toBe(0);
    expect(Number.isFinite(ix.r0)).toBe(true);
  });

  it("codes.ts: rastreabilidade honesta para normas sem fonte primária local (NBR 6118 e ACI 318)", () => {
    const nbr = DESIGN_CODES.NBR6118;
    expect(nbr.fields.gammaC).toBe("sec");
    expect(nbr.fields.gammaS).toBe("sec");
    expect(nbr.fields.strut).toBe("sec");
    expect(nbr.fields.alphaCc).toBe(false);
    expect(nbr.fields.epsUd).toBe(false);
    expect(strutDesignStrength(nbr, 30).verified).toBe("sec");
    expect(DESIGN_CODES.ACI318.fields.epsCu).toBe("sec");
  });
});
