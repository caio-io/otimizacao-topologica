import { describe, it } from "vitest";
import { buildProblem, simp, steelVolume } from "../src";
import { queirozScene } from "./helpers/queiroz";

/**
 * Queiroz & Leonel (2025), Fig. 6: viga-parede 10 × 7 m, t = 0,20 m, E = 28,567 GPa, ν = 0,15, duas forças de 100 kN
 * no topo (x = 3,5 e 6,5 m), apoios em x = 0,5 m (fixo) e 9,5 m (móvel), abertura quadrada de 1,5 m em 9 posições:
 * colunas x0 = 1,0 / 2,625 / 4,25 m (posições 1-3, 4-6, 7-9) e linhas y0 = 1,0 / 2,75 / 4,5 m (de baixo para cima).
 */
// lento: CALIBRACAO=1 npx vitest run test/calibracao.queiroz.test.ts
describe.skipIf(!process.env.CALIBRACAO)("Calibração — Queiroz & Leonel (2025), viga-parede com abertura", () => {
  it("volume de aço por posição de abertura (SIMP 30 %)", () => {
    const paper: Record<string, number> = { "0": 888, "1": 986, "2": 1097, "3": 1019, "4": 888, "5": 891, "6": 1126, "7": 888, "8": 888, "9": 888 };
    for (const rmin of [2, 3]) {
      const rows: string[] = []; let ref = 0;
      for (const pos of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) {
        const sc = queirozScene(pos || null);
        const b = buildProblem(sc);
        if (!b.problem) { rows.push(`pos ${pos}: ERRO ${b.errors.join("; ")}`); continue; }
        const p = b.problem;
        let r: any;
        for (const q of simp(p, { volfrac: 0.3, penal: 3, rmin, maxIter: 150, tol: 0.01 })) r = q;
        const solid = Uint8Array.from(r.rho, (v: number, e: number) => (v > 0.5 || p.mask[e] === 2 ? 1 : 0));
        const V = steelVolume(p, solid);
        if (pos === 0) ref = V;
        const dif = ref ? (V / ref - 1) * 100 : 0;
        const pd = (paper[String(pos)] / 888 - 1) * 100;
        rows.push(`pos ${pos}: aço=${V.toFixed(0)} cm³  Δ=${dif.toFixed(1)} %  (artigo ${paper[String(pos)]} cm³, Δ=${pd.toFixed(1)} %)  it=${r.iter} C=${r.compliance.toExponential(3)}`);
      }
      console.log(`--- SIMP 30 %, rmin=${rmin} elementos (h = 0,125 m, ${80 * 56} elementos)\n` + rows.join("\n"));
    }
  }, 3_600_000);
});
