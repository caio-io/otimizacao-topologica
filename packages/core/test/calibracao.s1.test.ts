import { describe, it } from "vitest";
import { buildProblem, solveNonlinear } from "../src";
import { S1, s1Bars, s1Scene } from "./helpers/s1";

// lento: CALIBRACAO=1 npx vitest run test/calibracao.s1.test.ts
describe.skipIf(!(globalThis as any).process?.env?.CALIBRACAO)("Calibração — cabeça de pilar S1 (livro do CSFM, cap. 6.5)", () => {
  it("carga última por apoio (P/4) com εcu = 3,5 ‰, 2,0 ‰ e sem critério de esmagamento", () => {
    const h = Number((globalThis as any).process?.env?.S1H ?? 0.02);
    const b = buildProblem(s1Scene(h));
    if (!b.problem) throw new Error(b.errors.join("; "));
    console.log(`S1: h=${h} m, ${b.problem.nelx * b.problem.nely} elementos, avisos: ${b.warnings.join(" | ") || "—"}`);
    const todos = { a: ["εcu=3,5‰", 0.0035, true], b: ["εcu=2,0‰", 0.002, true], c: ["sem critério", 0.0035, false], d: ["εcu=50‰ (parada padrão do CSFM)", 0.05, true] } as const;
    console.log(`S1 comprimento de esmagamento = ${(globalThis as any).process?.env?.S1LC ?? "pontual"}`);
    const sel = String((globalThis as any).process?.env?.S1CASES ?? "d").split("") as (keyof typeof todos)[];
    for (const [nome, epsu, chk] of sel.map((k) => todos[k])) {
      const t0 = Date.now();
      const r = solveNonlinear(b.problem, {
        concrete: { fc: S1.fc, eps0: 0.002, epsu }, bars: s1Bars(), origin: b.origin, checkCrushing: chk, dLambda: 0.1, maxIt: 200, crushLength: Number((globalThis as any).process?.env?.S1LC ?? 0) || undefined,
      });
      const Pu = (r.lambda * 4000) / 4;
      console.log(`S1 ${nome}: Pu/apoio=${Pu.toFixed(0)} kN (ensaio ${S1.expPerSupport}; CSFM M0 ${S1.csfm.M0}, M3 ${S1.csfm.M3}) modo=${r.mode} ` +
        `As1: N=${r.bars[0].axialMax.toFixed(0)} kN ε=${(r.bars[0].strainMax * 1000).toFixed(2)}‰ esc=${r.bars[0].yielded}  ` +
        `Ah: ${r.bars.slice(1).map((x) => x.axialMax.toFixed(0)).join("/")} kN  εc,máx=${(r.maxCompStrain * 1000).toFixed(2)}‰ passos=${r.steps.length} eq=${r.equilibrium.y.toExponential(1)} ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    }
  }, 3_600_000);
});
