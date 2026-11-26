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

import { buildProblem, deepBeamScene, supportReactions, beso } from "../src";
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

import { solveBanded, connectivityError, MAX_ELEMENTS } from "../src";
describe("Solver em banda (usado em produção)", () => {
  const cantilever = (nu: number, nelx = 40, nely = 8, h = 0.1) => {
    const p: Problem = {
      nelx, nely, h, t: 1, E: 1, nu, mask: new Uint8Array(nelx * nely).fill(1),
      fixed: [], loads: [{ node: nelx * (nely + 1) + nely / 2, fx: 0, fy: -1 }],
    };
    for (let j = 0; j <= nely; j++) p.fixed.push(2 * j, 2 * j + 1);
    return p;
  };
  it("coincide com o PCG (ν=0,3, módulos heterogêneos)", () => {
    const p = cantilever(0.3);
    const m = buildModel(p);
    const Ee = new Float64Array(p.nelx * p.nely).map((_, e) => (e % 7 === 0 ? 1e-3 : 1));
    const a = new Float64Array(m.ndof), b = new Float64Array(m.ndof);
    solveBanded(m, p.nely, Ee, a);
    solvePCG(m, Ee, b, 1e-13, 50000);
    let err = 0, nrm = 0;
    for (let d = 0; d < m.ndof; d++) { err = Math.max(err, Math.abs(a[d] - b[d])); nrm = Math.max(nrm, Math.abs(a[d])); }
    expect(err / nrm).toBeLessThan(1e-6);
  });
  it("flecha da viga em balanço ≈ Timoshenko (ν=0,3)", () => {
    const p = cantilever(0.3, 60, 10);
    const m = buildModel(p), u = new Float64Array(m.ndof);
    solveBanded(m, p.nely, new Float64Array(p.nelx * p.nely).fill(1), u);
    const tip = Math.abs(u[2 * (p.nelx * (p.nely + 1) + p.nely / 2) + 1]);
    const L = p.nelx * p.h, H = p.nely * p.h, I = H ** 3 / 12, G = 1 / (2 * 1.3);
    const analytic = L ** 3 / (3 * I) + L / (G * (5 / 6) * H);
    expect(tip / analytic).toBeGreaterThan(0.85);
    expect(tip / analytic).toBeLessThan(1.15);
  });
});

describe("Conectividade da cena", () => {
  it("presets são conectados", () => {
    for (const s of [deepBeamScene(), deepBeamScene(true)])
      expect(buildProblem(s).errors).toEqual([]);
  });
  it("ilha flutuante de material é rejeitada", () => {
    const s = deepBeamScene();
    s.shapes.push({ id: "S2", mode: "add", pts: [[3.3, 0.5], [3.6, 0.5], [3.6, 0.8], [3.3, 0.8]] });
    // a ilha estende a caixa; a carga e os apoios continuam na peça principal
    expect(buildProblem(s).errors.join()).toMatch(/desconectado|sem caminho/);
  });
  it("abertura que corta a peça ao meio deixa a carga sem caminho", () => {
    const s = deepBeamScene();
    s.shapes.push({ id: "A9", mode: "cut", pts: [[1.2, -0.1], [1.3, -0.1], [1.3, 1.6], [1.2, 1.6]] });
    s.shapes.push({ id: "A8", mode: "cut", pts: [[1.7, -0.1], [1.8, -0.1], [1.8, 1.6], [1.7, 1.6]] });
    expect(buildProblem(s).errors.join()).toMatch(/desconectad|sem caminho/);
  });
  it("connectivityError direto: tudo ligado ⇒ null", () => {
    expect(connectivityError(new Uint8Array(16).fill(1), 4, 4, [0, 1], [{ node: 24 }])).toBeNull();
  });
  it("limite de malha vigente", () => {
    const s = deepBeamScene(); s.h = 0.005;
    expect(buildProblem(s).errors.join()).toContain(String(MAX_ELEMENTS));
  });
});

import { isLineLoad, lineLoadIntensity } from "../src";
describe("Carga distribuída", () => {
  const withQ = (x0: number, x1: number, F = -1000) => {
    const s = deepBeamScene();
    s.loads = [{ id: "Q1", x: x0, y: 1.5, x1, y1: 1.5, fx: 0, fy: F }];
    return s;
  };
  it("a resultante é preservada e se espalha por vários nós", () => {
    const r = buildProblem(withQ(1.0, 2.0));
    expect(r.errors).toEqual([]);
    const ls = r.problem!.loads;
    expect(ls.reduce((a, l) => a + l.fy, 0)).toBeCloseTo(-1000, 6);
    expect(ls.length).toBeGreaterThan(30);
    expect(Math.max(...ls.map((l) => l.fy)) / Math.min(...ls.map((l) => l.fy))).toBeLessThan(1.01); // uniforme
  });
  it("intensidade kN/m = resultante / comprimento", () => {
    const l = withQ(1.0, 2.0).loads[0];
    expect(isLineLoad(l)).toBe(true);
    expect(lineLoadIntensity(l)).toBeCloseTo(1000, 6);
  });
  it("extremidade fora do lado é rejeitada; reações equilibram", () => {
    const bad = withQ(1.0, 2.0); bad.loads[0].y1 = 1.0;
    expect(buildProblem(bad).errors.join()).toMatch(/lado/);
    const sc = withQ(0.5, 2.5), r = buildProblem(sc), p = r.problem!;
    const rho = new Float64Array(p.mask.length).map((_, e) => (p.mask[e] ? 1 : 0));
    const u = solveDisplacements(p, rho, 1);
    const Ee = rho.map((v) => 1e-6 + (1 - 1e-6) * v);
    const { reactions, residual } = supportReactions(p, Ee, u, r.supportGroups);
    expect(Math.abs(residual.y)).toBeLessThan(1e-3);
    expect(reactions[0].ry + reactions[1].ry).toBeCloseTo(1000, 1);
  }, 60_000);
});

import { sigmaRdMax, strutWidth, clampFck, GAMMA_C } from "../src";
describe("Largura de biela (Borges 2022)", () => {
  it("reproduz o exemplo do Borges: C35, γc 1,5 ⇒ 17,1 MPa e a = 323,6 mm", () => {
    expect(sigmaRdMax(35, 1.0, 1.5)).toBeCloseTo(17.1, 1);
    expect(strutWidth(2484, 0.45, 35, 1.0, 1.5) * 1000).toBeCloseTo(323.6, -0.5);
    expect(sigmaRdMax(35, 0.6, 1.5)).toBeCloseTo(10.23, 2);
  });
  it("γc fixo em 1,4 e fck mínimo de 25 MPa", () => {
    expect(GAMMA_C).toBe(1.4);
    expect(clampFck(20)).toBe(25);
    expect(clampFck(NaN)).toBe(25);
    expect(sigmaRdMax(20)).toBeCloseTo(sigmaRdMax(25), 9);
  });
});

describe("Força pontual vs distribuída", () => {
  it("point=true usa um único nó; sem flag espalha pela placa; resultante igual", () => {
    const a = deepBeamScene(); a.loads = [{ id: "P", x: 1.5, y: 1.5, fx: 0, fy: -1000, point: true }];
    const b = deepBeamScene(); b.loads = [{ id: "P", x: 1.5, y: 1.5, fx: 0, fy: -1000 }];
    const la = buildProblem(a).problem!.loads, lb = buildProblem(b).problem!.loads;
    expect(la.length).toBe(1);
    expect(lb.length).toBeGreaterThan(5);
    expect(la.reduce((s, l) => s + l.fy, 0)).toBeCloseTo(-1000, 6);
  });
});

describe("BESO: proteção de conectividade", () => {
  it("carga distribuída longa + filtro grande: atinge o volume e a flexibilidade não explode", () => {
    const sc = deepBeamScene(false);
    sc.loads = [{ id: "Q1", x: 0.15, y: 1.5, x1: 2.85, y1: 1.5, fx: 0, fy: -1000 }];
    const p = buildProblem(sc).problem!;
    const cs: number[] = []; let n = 0, last: any;
    for (const r of beso(p, { ...BESO_DEFAULTS, volfrac: 0.35, rmin: 7.5 })) { cs.push(r.compliance); last = r; n++; }
    expect(last.volume).toBeLessThan(0.375);
    // picos isolados (trecho esbelto de 1 elemento) são aceitáveis; antes eram dezenas de iterações perdidas
    expect(cs.filter((c) => c > 5 * last.compliance).length).toBeLessThanOrEqual(3);
    expect(n).toBeLessThanOrEqual(BESO_DEFAULTS.maxIter);
  }, 300_000);
});

import { tensionZones } from "../src";
describe("CSFM linear: zonas tracionadas e armadura", () => {
  it("viga-parede: tirante principal junto à base, T da ordem de M/z, As = T/fyd", () => {
    const sc = deepBeamScene(), r = buildProblem(sc), p = r.problem!;
    const rho = new Float64Array(p.mask.length).map((_, e) => (p.mask[e] ? 1 : 0));
    const f = principalStresses(p, solveDisplacements(p, rho, 1));
    const { zones, fyd } = tensionZones({ nelx: p.nelx, nely: p.nely, h: p.h, ox: r.origin.x, oy: r.origin.y, t: p.t }, p.mask, f);
    expect(zones.length).toBeGreaterThan(0);
    const z = zones[0];
    expect(z.cy).toBeLessThan(0.75); // abaixo da meia altura (H = 1,5 m)
    expect(Math.abs(z.theta)).toBeLessThan(0.5); // tração aproximadamente horizontal
    // M = P·L/4 ≈ 1000·2,85/4 ≈ 712 kN·m; z ≈ 0,6·H ⇒ T ≈ 800 kN (ordem de grandeza)
    expect(z.T).toBeGreaterThan(250);
    expect(z.T).toBeLessThan(1600);
    expect(z.As).toBeCloseTo((z.T / fyd) * 1e4, 9);
  }, 60_000);
});

import { elementStiffness, elementStiffnessQ4 } from "../src";
describe("Elemento QM6 (Q4 com modos incompatíveis)", () => {
  const nu = 0.2;
  it("simétrico, sem energia em movimentos de corpo rígido", () => {
    const K = elementStiffness(nu, "qm6");
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) expect(K[r * 8 + c]).toBeCloseTo(K[c * 8 + r], 12);
    // nós BL, BR, TR, TL de um quadrado de lado 2; translação x, translação y e rotação
    const xs = [-1, 1, 1, -1], ys = [-1, -1, 1, 1];
    const modes = [
      xs.flatMap(() => [1, 0]), xs.flatMap(() => [0, 1]), xs.flatMap((_, a) => [-ys[a], xs[a]]),
    ];
    for (const d of modes) {
      const f = Array.from({ length: 8 }, (_, r) => d.reduce((s, v, c) => s + K[r * 8 + c] * v, 0));
      expect(Math.max(...f.map(Math.abs))).toBeLessThan(1e-12);
    }
  });
  it("não é mais rígido que o Q4 (energia de flexão pura menor)", () => {
    const Kq = elementStiffness(nu, "qm6"), K4 = elementStiffnessQ4(nu);
    // flexão pura: u = x·y, v = −(x²−y²)/2 aproximada pelos valores nodais
    const xs = [-1, 1, 1, -1], ys = [-1, -1, 1, 1];
    const d = xs.flatMap((x, a) => [x * ys[a], -(x * x - ys[a] * ys[a]) / 2]);
    const en = (K: Float64Array) => d.reduce((s, v, r) => s + v * d.reduce((t, w, c) => t + K[r * 8 + c] * w, 0), 0);
    expect(en(Kq)).toBeLessThan(en(K4));
  });
  it("viga esbelta com 2 elementos na altura: QM6 muito mais próximo de Timoshenko que o Q4", () => {
    const nelx = 24, nely = 2, h = 0.5;
    const p: Problem = {
      nelx, nely, h, t: 1, E: 1, nu: 0.3, mask: new Uint8Array(nelx * nely).fill(1),
      fixed: [], loads: [{ node: nelx * (nely + 1) + nely / 2, fx: 0, fy: -1 }],
    };
    for (let j = 0; j <= nely; j++) p.fixed.push(2 * j, 2 * j + 1);
    const L = nelx * h, H = nely * h, I = H ** 3 / 12, G = 1 / (2 * 1.3);
    const analytic = L ** 3 / (3 * I) + L / (G * (5 / 6) * H);
    const tipOf = (kind: "q4" | "qm6") => {
      const m = buildModel(p); m.KE = elementStiffness(p.nu, kind);
      const u = new Float64Array(m.ndof);
      solveBanded(m, p.nely, new Float64Array(nelx * nely).fill(1), u);
      return Math.abs(u[2 * (nelx * (nely + 1) + nely / 2) + 1]) / analytic;
    };
    const q4 = tipOf("q4"), qm6 = tipOf("qm6");
    console.log("flecha/analítica  Q4:", q4.toFixed(3), " QM6:", qm6.toFixed(3));
    expect(Math.abs(qm6 - 1)).toBeLessThan(Math.abs(q4 - 1));
    expect(qm6).toBeGreaterThan(0.9);
    expect(qm6).toBeLessThan(1.1);
  });
});
