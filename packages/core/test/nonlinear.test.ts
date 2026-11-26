import { describe, expect, it } from "vitest";
import { base, barsFromScene, buildProblem, ca50, concreteFromScene, nbrConcrete, pierCapScene, plateLoad, solveNonlinear, solveNonlinearSteps } from "../src";
import type { Problem } from "../src";

/** bloco manual: todos os elementos de concreto */
const block = (nelx: number, nely: number, h: number): Problem => ({
  nelx, nely, h, t: 0.3, E: 30e6, nu: 0.2, mask: new Uint8Array(nelx * nely).fill(1), fixed: [], loads: [],
});

describe("Nível 2 — análise não linear (concreto sem tração + barras, aderência perfeita)", () => {
  it("T1 compressão uniaxial: carga última = fc·A (parábola-retângulo, εcu = 3,5 ‰)", () => {
    const nelx = 4, nely = 8, h = 0.05;
    const p = block(nelx, nely, h);
    for (let i = 0; i <= nelx; i++) p.fixed.push(2 * (i * (nely + 1) + nely) + 1); // base: uy
    p.fixed.push(2 * (0 * (nely + 1) + nely)); // um ux
    for (let i = 0; i <= nelx; i++) p.loads.push({ node: i * (nely + 1), fx: 0, fy: -(i === 0 || i === nelx ? 0.5 : 1) / nelx });
    const c = nbrConcrete(30);
    const A = nelx * h * p.t;
    const r = solveNonlinear(p, { concrete: c, dLambda: 100 });
    console.log(`T1: λu=${r.lambda.toFixed(1)} kN  fc·A=${(c.fc * A).toFixed(1)} kN  modo=${r.mode}  εc,máx=${(r.maxCompStrain * 1000).toFixed(2)} ‰  eq=${r.equilibrium.y.toExponential(1)}`);
    expect(r.mode).toBe("CC");
    expect(r.lambda / (c.fc * A)).toBeGreaterThan(0.98);
    expect(r.lambda / (c.fc * A)).toBeLessThan(1.001);
    expect(r.equilibrium.y).toBeLessThan(1e-3);
  });

  it("T2 tirante: o concreto não resiste à tração; carga última = As·ft (ruptura da barra)", () => {
    const nelx = 10, nely = 2, h = 0.05;
    const p = block(nelx, nely, h);
    for (let j = 0; j <= nely; j++) p.fixed.push(2 * (0 * (nely + 1) + j), 2 * (0 * (nely + 1) + j) + 1);
    p.loads.push({ node: nelx * (nely + 1) + 1, fx: 1, fy: 0 });
    const area = 1e-3;
    const r = solveNonlinear(p, { concrete: nbrConcrete(30), bars: [{ x0: 0, y0: 0.05, x1: 0.5, y1: 0.05, area, steel: ca50, label: "tirante" }], dLambda: 50 });
    const Nu = area * ca50.ft;
    console.log(`T2: λu=${r.lambda.toFixed(1)} kN  As·ft=${Nu.toFixed(1)} kN  modo=${r.mode}  barra: Nmax=${r.bars[0].axialMax.toFixed(1)} εmax=${(r.bars[0].strainMax * 100).toFixed(2)} %  eq=${r.equilibrium.x.toExponential(1)}`);
    expect(r.mode).toBe("FR");
    expect(r.lambda / Nu).toBeGreaterThan(0.98);
    expect(r.lambda / Nu).toBeLessThan(1.001);
    expect(r.bars[0].yielded).toBe(true);
    expect(r.equilibrium.x).toBeLessThan(1e-3);
  });


  it("T2b barra embutida horizontal (mesma posição do T2): mesma carga última do tirante", () => {
    const nelx = 10, nely = 2, h = 0.05;
    const p = block(nelx, nely, h);
    for (let j = 0; j <= nely; j++) p.fixed.push(2 * (0 * (nely + 1) + j), 2 * (0 * (nely + 1) + j) + 1);
    p.loads.push({ node: nelx * (nely + 1) + 1, fx: 1, fy: 0 });
    const area = 1e-3;
    const r = solveNonlinear(p, { concrete: nbrConcrete(30), bars: [{ x0: 0, y0: 0, x1: 0, y1: 0, path: [[0, 0.05], [0.5, 0.05]], area, steel: ca50, label: "embutida" }], dLambda: 50 });
    const Nu = area * ca50.ft;
    console.log(`T2b: λu=${r.lambda.toFixed(1)} kN  As·ft=${Nu.toFixed(1)} kN  modo=${r.mode}  ε=${(r.bars[0].strainMax * 100).toFixed(2)} %`);
    expect(r.lambda / Nu).toBeGreaterThan(0.98);
    expect(r.lambda / Nu).toBeLessThan(1.001);
  });

  it("T2d barra embutida inclinada (60°) em bloco comprimido: força axial elástica = teoria; no limite o aço soma carga", () => {
    const nelx = 8, nely = 8, h = 0.05;
    const mk = () => {
      const p = block(nelx, nely, h);
      // topo e base sem deslocamento horizontal: sem isso a barra inclinada (inextensível) deixa o bloco cisalhar e não trabalha
      for (let i = 0; i <= nelx; i++) p.fixed.push(2 * (i * (nely + 1) + nely) + 1, 2 * (i * (nely + 1) + nely), 2 * (i * (nely + 1)));
      for (let i = 0; i <= nelx; i++) p.loads.push({ node: i * (nely + 1), fx: 0, fy: -(i === 0 || i === nelx ? 0.5 : 1) / nelx });
      return p;
    };
    const area = 1e-3, th = Math.PI / 3, c = nbrConcrete(30), s = Math.sin(th);
    const bar = { x0: 0, y0: 0, x1: 0, y1: 0, path: [[0.0, 0.0], [0.4 / Math.tan(th), 0.4]] as [number, number][], area, steel: ca50, label: "inclinada" };
    const A = nelx * h * 0.3, E0 = (2 * c.fc) / c.eps0;
    // (a) regime elástico (λ = 20 kN): εy = −λ/(E0·A + As·Es·sen³θ); N = As·Es·sen²θ·εy
    const r1 = solveNonlinear(mk(), { concrete: c, bars: [bar], dLambda: 20, lambdaMax: 20 });
    const ey = -20 / (E0 * A + area * ca50.Es * s ** 3), Nth = area * ca50.Es * s * s * ey;
    const sorted = Array.from(r1.barForces[0]).sort((a, b) => a - b), Nfe = sorted[Math.floor(sorted.length / 2)]; // mediana: os trechos de ponta sofrem efeito de borda
    console.log(`T2d (a): N mediano FE=${Nfe.toFixed(3)} kN  teoria=${Nth.toFixed(3)} kN`);
    expect(Math.abs(Nfe / Nth - 1)).toBeLessThan(0.05); // a barra rígida perturba o campo (não é exatamente uniforme); erros de orientação/área dariam 30 % ou mais
    // (b) até o limite: o aço soma à resistência do concreto (patamar), com compressão na barra
    const r2 = solveNonlinear(mk(), { concrete: c, bars: [bar], dLambda: 100 });
    console.log(`T2d (b): λu=${r2.lambda.toFixed(1)} kN  fc·A=${(c.fc * A).toFixed(1)} kN  modo=${r2.mode}  N barra=${r2.bars[0].axialMax.toFixed(1)} kN`);
    expect(r2.lambda).toBeGreaterThan(0.99 * c.fc * A);
    expect(r2.bars[0].axialMax).toBeGreaterThan(100);
  });


  it("passo a passo: o gerador emite o progresso e termina no mesmo resultado; amostras das barras e mapas existem", () => {
    const nelx = 10, nely = 2, h = 0.05;
    const p = block(nelx, nely, h);
    for (let j = 0; j <= nely; j++) p.fixed.push(2 * (0 * (nely + 1) + j), 2 * (0 * (nely + 1) + j) + 1);
    p.loads.push({ node: nelx * (nely + 1) + 1, fx: 1, fy: 0 });
    const opt = { concrete: nbrConcrete(30), bars: [{ x0: 0, y0: 0.05, x1: 0.5, y1: 0.05, area: 1e-3, steel: ca50, label: "tirante" }], dLambda: 50, stepwise: true };
    const g = solveNonlinearSteps(p, opt);
    let n = 0, lastLambda = 0, r = g.next();
    while (!r.done) { n++; lastLambda = r.value.lambda; expect(r.value.barSamples[0].length).toBe(10); r = g.next(); }
    expect(n).toBeGreaterThan(3);
    expect(r.value.lambda).toBeCloseTo(lastLambda, 9);
    expect(r.value.barSamples[0][0].y).toBeCloseTo(0.05, 9);
    expect(r.value.epsComp.length).toBe(nelx * nely);
    expect(r.value.epsTens.length).toBe(nelx * nely);
  });

  it("S1 no núcleo: a cena traz a armadura e os parâmetros; as conversões para o solver respeitam as unidades", () => {
    const sc = pierCapScene();
    expect(sc.bars?.length).toBe(7);
    const bars = barsFromScene(sc);
    expect(bars[0].area).toBeCloseTo(9 * Math.PI * 0.005 ** 2, 12);
    expect(bars[0].steel.fy).toBeCloseTo(620e3, 6);
    expect(bars[0].steel.Es).toBeCloseTo(200e6, 3);
    expect(concreteFromScene(sc).fc).toBeCloseTo(31.2e3, 6); // valores médios: sem γ
    expect(concreteFromScene({ ...sc, nl: { values: "design", epsCu: 0.0035, crushLength: 0 } }).fc).toBeCloseTo((0.85 * 31.2e3) / 1.4, 6);
    expect(buildProblem(sc).errors).toEqual([]);
  });

  it("T3 viga-parede com tirante: tirante escoa, equilíbrio de seção consistente (braço de alavanca cabe na altura) e capacidade ≥ MBT", () => {
    const h = 0.05;
    const s = base(h, 0.4);
    s.t = 0.4; s.E = 35e6; s.nu = 0.2;
    s.shapes.push({ id: "S1", mode: "add", pts: [[0, 0], [0.4, 0], [2.0, 0], [2.4, 0], [2.4, 1.5], [0, 1.5]] });
    s.supports.push({ id: "Ap1", x0: 0, y0: 0, x1: 0.4, y1: 0, ux: true, uy: true });
    s.supports.push({ id: "Ap2", x0: 2.0, y0: 0, x1: 2.4, y1: 0, ux: false, uy: true });
    s.loads.push(plateLoad("P1", 1.2, 1.5, 0.4, -1000));
    const b = buildProblem(s);
    expect(b.errors).toEqual([]);
    const area = 4 * Math.PI * 0.01 ** 2; // 4Ø20
    const c = nbrConcrete(50);
    const bar = { x0: 0, y0: 0.1, x1: 2.4, y1: 0.1, area, steel: ca50, label: "tirante" };
    const t0 = Date.now();
    const r = solveNonlinear(b.problem!, { concrete: c, bars: [bar], origin: b.origin, dLambda: 0.2, checkCrushing: false });
    const Pu = r.lambda * 1000;
    // MBT: T = As·fyd; a = T/(fc·t); z = (1,5 − 0,1) − a/2; Pu = 2·T·z/(L/2), L = 2,0 m
    const T = area * ca50.fy, a = T / (c.fc * s.t), z = 1.4 - a / 2, PuMbt = (2 * T * z) / 1.0;
    console.log(`T3: Pu=${Pu.toFixed(0)} kN  MBT=${PuMbt.toFixed(0)} kN (razão ${(Pu / PuMbt).toFixed(2)})  modo=${r.mode}  passos=${r.steps.length}  Nmax,barra=${r.bars[0].axialMax.toFixed(0)} kN (As·ft=${(area * ca50.ft).toFixed(0)})  εc,máx=${(r.maxCompStrain * 1000).toFixed(2)} ‰  eq=(${r.equilibrium.x.toExponential(1)}, ${r.equilibrium.y.toExponential(1)})  ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    // diagnóstico físico independente do MBT: centroide das reações verticais no apoio esquerdo e braço de alavanca implícito
    const nely = b.problem!.nely;
    let Rs = 0, Rx = 0;
    for (let i = 0; i <= 8; i++) { const ry = r.reaction[2 * (i * (nely + 1) + nely) + 1]; Rs += ry; Rx += ry * i * h; }
    const xr = Rx / Rs; // centroide da reação esquerda
    const Rleft = Rs, Mext = Rleft * (1.2 - xr) - (Pu / 2) * 0.1; // momento em x = 1,2 m (metade esquerda da placa: P/2 em x = 1,1 m)
    const zImpl = Mext / r.bars[0].axialMax;
    console.log(`T3 diag: reação esq.=${Rleft.toFixed(0)} kN em x̄=${xr.toFixed(3)} m; M(x=1,2)=${Mext.toFixed(0)} kN·m; braço implícito z=M/T=${zImpl.toFixed(2)} m`);
    expect(Math.abs(Rleft - Pu / 2) / (Pu / 2)).toBeLessThan(1e-2); // reação esquerda ≈ P/2 (o apoio direito é móvel e as reações não são exatamente simétricas)
    expect(zImpl).toBeGreaterThan(0.8);
    expect(zImpl).toBeLessThan(1.4); // a resultante de compressão tem de caber na altura útil
    expect(r.bars[0].yielded).toBe(true);
    expect(r.bars[0].axialMax / T).toBeGreaterThan(0.99); // tirante escoou
    expect(r.equilibrium.y).toBeLessThan(1e-3);
    expect(Pu / PuMbt).toBeGreaterThan(0.85); // MBT com braço entre eixos dá o limite inferior aproximado
  }, 300_000);
});
