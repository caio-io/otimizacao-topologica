import { describe, expect, it } from "vitest";
import {
  computeStmSts,
  deepBeamScene,
  extractStm,
  stmTiesToBarSpecs,
  templateCorbel,
  templateDeepBeam,
} from "../src";

describe("STM — Extração Ground Structure e Verificação Normativa", () => {
  it("viga-parede biapoiada: equilíbrio nodal, biela inclinada + tirante inferior, nós CCC/CCT e STS ≈ 1", () => {
    const scene = deepBeamScene(false);
    const stm = extractStm(scene);

    expect(stm.residual).toBeLessThan(1e-6);
    expect(stm.sts).toBeGreaterThan(0.95);
    expect(stm.sts).toBeLessThanOrEqual(1.0 + 1e-9);

    // Equilíbrio global de forças
    const sumFx = stm.nodes.reduce((s, n) => s + n.fx + n.rx, 0);
    const sumFy = stm.nodes.reduce((s, n) => s + n.fy + n.ry, 0);
    expect(Math.abs(sumFx)).toBeLessThan(1e-6);
    expect(Math.abs(sumFy)).toBeLessThan(1e-6);

    const struts = stm.members.filter((m) => m.kind === "strut");
    const ties = stm.members.filter((m) => m.kind === "tie");
    expect(struts.length).toBeGreaterThanOrEqual(2);
    expect(ties.length).toBeGreaterThanOrEqual(1);

    // Tirante inferior: T ≈ M / z; M = P*L/4 = 1000*2.85/4 = 712.5 kNm, z ≈ 1.44 m → T ≈ 495 kN
    const maxTieForce = Math.max(...ties.map((t) => t.N));
    expect(maxTieForce).toBeGreaterThan(350);
    expect(maxTieForce).toBeLessThan(650);
    expect(stm.totalAsReqCm2).toBeGreaterThan(0);

    // Nó de carga no topo = CCC; nós de apoio na base = CCT
    const loadNode = stm.nodes.find((n) => n.role === "load");
    const supportNodes = stm.nodes.filter((n) => n.role === "support");
    expect(loadNode?.kind).toBe("CCC");
    expect(supportNodes.length).toBe(2);
    for (const sp of supportNodes) {
      expect(sp.kind).toBe("CCT");
    }

    // Conversão para BarSpec do Nível 2
    const bars = stmTiesToBarSpecs(stm);
    expect(bars.length).toBe(ties.length);
    expect(bars[0].areaCm2).toBeGreaterThan(0);
    expect(bars[0].path.length).toBe(2);
  });

  it("viga-parede com abertura: contorna o vazio mantendo equilíbrio nodal", () => {
    const scene = deepBeamScene(true);
    const stm = extractStm(scene);

    expect(stm.residual).toBeLessThan(1e-6);
    expect(stm.sts).toBeGreaterThan(0.9);

    // Nenhuma barra pode passar pelo centro da abertura [0.7, 0.6] x [1.3, 1.1] (x∈(0.7,1.3), y∈(0.6,1.1))
    const nodeMap = new Map(stm.nodes.map((n) => [n.id, n]));
    for (const m of stm.members) {
      const a = nodeMap.get(m.n1)!;
      const b = nodeMap.get(m.n2)!;
      for (let k = 1; k < 10; k++) {
        const t = k / 10;
        const px = a.x + t * (b.x - a.x);
        const py = a.y + t * (b.y - a.y);
        const insideOpening = px > 0.72 && px < 1.28 && py > 0.62 && py < 1.08;
        expect(insideOpening).toBe(false);
      }
    }
  });

  it("consolo curto: equilíbrio nodal, tirante no topo, biela inclinada e verificação de ângulo", () => {
    const scene = templateCorbel({
      colW: 0.4,
      colH: 1.6,
      corbA: 0.5,
      corbH: 0.45,
      corbY: 0.8,
      t: 0.25,
      h: 0.04,
      bearing: 0.16,
      fvKN: 350,
      fhKN: 50,
      fck: 30,
    });
    const stm = extractStm(scene);

    expect(stm.residual).toBeLessThan(1e-6);
    expect(stm.sts).toBeGreaterThan(0.95);

    const ties = stm.members.filter((m) => m.kind === "tie");
    const struts = stm.members.filter((m) => m.kind === "strut");
    expect(ties.length).toBeGreaterThanOrEqual(1);
    expect(struts.length).toBeGreaterThanOrEqual(1);

    // Deve haver tirante na região superior do consolo (y >= corbY + 0.5 * corbH)
    const nodeMap = new Map(stm.nodes.map((n) => [n.id, n]));
    const hasTopTie = ties.some((t) => {
      const y1 = nodeMap.get(t.n1)!.y;
      const y2 = nodeMap.get(t.n2)!.y;
      return y1 >= 1.0 && y2 >= 1.0;
    });
    expect(hasTopTie).toBe(true);

    // Pelo menos um nó com verificação de ângulo biela-tirante
    const nodesWithAngle = stm.nodes.filter((n) => n.minAngleDeg !== null);
    expect(nodesWithAngle.length).toBeGreaterThanOrEqual(1);
  });

  it("verificação normativa fcd1/fcd2/fcd3 e reprovação quando carga excede limite", () => {
    const passingScene = templateDeepBeam({
      L: 3.0,
      H: 1.5,
      t: 0.25,
      h: 0.05,
      bearing: 0.35,
      loadKN: 500,
      fck: 30,
    });
    const stmPass = extractStm(passingScene, { codeId: "NBR6118" });

    // Conferência exata das relações de Borges (2022) / NBR 6118 item 22.3.2
    expect(stmPass.fcd1MPa).toBeCloseTo(0.85 * (1 - 30 / 250) * stmPass.fcdMPa, 6);
    expect(stmPass.fcd3MPa).toBeCloseTo(0.72 * (1 - 30 / 250) * stmPass.fcdMPa, 6);
    expect(stmPass.fcd2MPa).toBeCloseTo(0.60 * (1 - 30 / 250) * stmPass.fcdMPa, 6);
    expect(stmPass.nodeLimitsVerified).toBe("sec");
    expect(stmPass.ok).toBe(true);
    expect(stmPass.maxNodeUtil).toBeLessThanOrEqual(1.0);

    const failingScene = templateDeepBeam({
      L: 3.0,
      H: 1.5,
      t: 0.25,
      h: 0.05,
      bearing: 0.35,
      loadKN: 4000,
      fck: 30,
    });
    const stmFail = extractStm(failingScene, { codeId: "NBR6118" });
    expect(stmFail.ok).toBe(false);
    expect(Math.max(stmFail.maxNodeUtil, stmFail.maxStrutUtil)).toBeGreaterThan(1.0);
  });

  it("detecta violação de ângulo mínimo biela-tirante (< 29,7° na NBR 6118)", () => {
    // Viga muito esbelta (L=4.0, H=0.6) força biela com ângulo ~17°
    const shallow = templateDeepBeam({
      L: 4.0,
      H: 0.6,
      t: 0.25,
      h: 0.05,
      bearing: 0.3,
      loadKN: 200,
      fck: 30,
    });
    const stm = extractStm(shallow, { codeId: "NBR6118", gridCols: 3, gridRows: 2 });
    const angleNodes = stm.nodes.filter((n) => n.minAngleDeg !== null);
    expect(angleNodes.some((n) => !n.angleOk)).toBe(true);
    expect(stm.ok).toBe(false);
    expect(stm.warnings.some((w) => w.includes("ângulo mínimo"))).toBe(true);
  });

  it("computeStmSts retorna ≈ 1.0 para treliça isostática simples em equilíbrio axial", () => {
    const nodes = [
      { x: 0, y: 0, uxFixed: true, uyFixed: true },
      { x: 2, y: 0, uxFixed: false, uyFixed: true },
      { x: 1, y: 1, uxFixed: false, uyFixed: false },
    ];
    const members = [
      { n1: 0, n2: 1 },
      { n1: 0, n2: 2 },
      { n1: 1, n2: 2 },
    ];
    const sts = computeStmSts(nodes, members, [{ node: 2, fx: 0, fy: -100 }], 0.2, 30e6);
    expect(sts).toBeGreaterThan(0.99);
    expect(sts).toBeLessThanOrEqual(1.0 + 1e-9);
  });
});
