import { describe, it } from "vitest";
import { buildProblem, simp, steelVolume } from "../src";
import { queirozScene } from "./helpers/queiroz";

const PAPER: Record<number, number> = { 0: 0, 1: 11.0, 2: 23.5, 3: 14.8, 4: 0, 5: 0.3, 6: 26.8, 7: 0, 8: 0, 9: 0 };

function caso(pos: number, h: number, rmin: number, tol: number, maxIter: number) {
  const p = buildProblem(queirozScene(pos || null, h)).problem!;
  let r: any;
  for (const q of simp(p, { volfrac: 0.3, penal: 3, rmin, maxIter, tol })) r = q;
  const solid = Uint8Array.from(r.rho, (v: number, e: number) => (v > 0.5 || p.mask[e] === 2 ? 1 : 0));
  const grey = r.rho.reduce((s: number, v: number, e: number) => s + (p.mask[e] === 1 && v > 0.1 && v < 0.9 ? 1 : 0), 0) / p.mask.reduce((s: number, m: number) => s + (m === 1 ? 1 : 0), 0);
  return { V5: steelVolume(p, solid), Vall: steelVolume(p, solid, 435e3, Infinity), it: r.iter, C: r.compliance, grey };
}

// lento: CALIBRACAO2=a|b  npx vitest run test/calibracao.queiroz2.test.ts
describe.skipIf(!(globalThis as any).process?.env?.CALIBRACAO2)("Queiroz & Leonel — refinamento", () => {
  it("A: convergência estrita (tol 0,001; até 300 it.) em h = 0,125 m, filtros 2/3/4 e duas métricas", () => {
    if ((globalThis as any).process?.env?.CALIBRACAO2 !== "a") return;
    for (const rmin of [2, 3, 4]) {
      const res: Record<number, ReturnType<typeof caso>> = {};
      for (const pos of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) res[pos] = caso(pos, 0.125, rmin, 0.001, 300);
      const rows = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((pos) => {
        const d5 = (res[pos].V5 / res[0].V5 - 1) * 100, da = (res[pos].Vall / res[0].Vall - 1) * 100;
        return `pos ${pos}: Δ(σ1>-5σ2)=${d5.toFixed(1)} %  Δ(σ1>0)=${da.toFixed(1)} %  artigo=${PAPER[pos].toFixed(1)} %  it=${res[pos].it} cinza=${(res[pos].grey * 100).toFixed(1)} %  aço0=${res[pos].V5.toFixed(0)}`;
      });
      console.log(`--- A: rmin=${rmin} (h=0,125)\n` + rows.join("\n"));
    }
  }, 3_600_000);
  it("B: malha fina h = 0,0625 m (17 920 el.), filtro 0,375 m, posições 0, 1, 2, 3, 6", () => {
    if ((globalThis as any).process?.env?.CALIBRACAO2 !== "b") return;
    const res: Record<number, ReturnType<typeof caso>> = {};
    for (const pos of [0, 1, 2, 3, 6]) res[pos] = caso(pos, 0.0625, 6, 0.002, 200);
    const rows = [0, 1, 2, 3, 6].map((pos) => {
      const d5 = (res[pos].V5 / res[0].V5 - 1) * 100, da = (res[pos].Vall / res[0].Vall - 1) * 100;
      return `pos ${pos}: Δ(σ1>-5σ2)=${d5.toFixed(1)} %  Δ(σ1>0)=${da.toFixed(1)} %  artigo=${PAPER[pos].toFixed(1)} %  it=${res[pos].it} cinza=${(res[pos].grey * 100).toFixed(1)} %  aço0=${res[pos].V5.toFixed(0)}`;
    });
    console.log(`--- B: h=0,0625 rmin=6\n` + rows.join("\n"));
  }, 7_200_000);
});
