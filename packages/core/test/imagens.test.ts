import { describe, it } from "vitest";
// @ts-ignore — sem @types/node no projeto; só roda sob Node (vitest)
import { writeFileSync } from "node:fs";
import { BESO_DEFAULTS, beso, buildModel, deepBeam, principalStresses, solveBanded } from "../src";

/** Gera as figuras do README (docs/img/*.svg). Uso: GERAR_IMG=1 npx vitest run test/imagens.test.ts */
function svgTopologia(opening: boolean, titulo: string, arquivo: string) {
  const p = deepBeam(opening);
  let r: any;
  for (const q of beso(p, { ...BESO_DEFAULTS, volfrac: 0.4, rmin: 3 })) r = q;
  const solid = Uint8Array.from(r.rho, (v: number, e: number) => (p.mask[e] === 2 || (p.mask[e] === 1 && v > 0.5) ? 1 : 0));
  const m = buildModel(p), u = new Float64Array(m.ndof);
  solveBanded(m, p.nely, Float64Array.from(solid, (s) => (s ? 1 : 1e-6)), u);
  const f = principalStresses(p, u);
  const cell = 4, W = p.nelx * cell, H = p.nely * cell, pad = 28;
  let rects = "";
  for (let j = 0; j < p.nely; j++) {
    let i = 0;
    while (i < p.nelx) {
      const e0 = i * p.nely + j;
      if (!solid[e0]) { i++; continue; }
      const tens = (e: number) => f.s1[e] > 0 && f.s1[e] > -5 * f.s2[e];
      const t0 = tens(e0);
      let k = i + 1;
      while (k < p.nelx && solid[k * p.nely + j] && tens(k * p.nely + j) === t0) k++;
      rects += `<rect x="${i * cell}" y="${j * cell}" width="${(k - i) * cell}" height="${cell}" fill="${t0 ? "#d64541" : "#2e6fbd"}"/>`;
      i = k;
    }
  }
  const outline = `<rect x="0" y="0" width="${W}" height="${H}" fill="none" stroke="#9aa5b1" stroke-width="1" stroke-dasharray="4 3"/>`;
  const legenda = `<g font-family="Segoe UI, Arial, sans-serif" font-size="12" fill="#3d4852"><rect x="0" y="${H + 12}" width="12" height="12" fill="#d64541"/><text x="18" y="${H + 22}">tração (tirantes)</text><rect x="130" y="${H + 12}" width="12" height="12" fill="#2e6fbd"/><text x="148" y="${H + 22}">compressão (bielas)</text></g>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W + 2 * pad}" height="${H + 2 * pad + 22}" viewBox="${-pad} ${-pad} ${W + 2 * pad} ${H + 2 * pad + 22}"><rect x="${-pad}" y="${-pad}" width="100%" height="100%" fill="#ffffff"/><text x="0" y="-10" font-family="Segoe UI, Arial, sans-serif" font-size="14" font-weight="600" fill="#1f2933">${titulo}</text>${outline}${rects}${legenda}</svg>`;
  writeFileSync(`../../docs/img/${arquivo}`, svg);
  return `${arquivo}: ${r.iter} it., volume ${(r.volume * 100).toFixed(1)} %, ${(svg.length / 1024).toFixed(0)} KB`;
}

describe.skipIf(!(globalThis as any).process?.env?.GERAR_IMG)("figuras do README", () => {
  it("viga-parede (com e sem abertura) — BESO 40 %", () => {
    console.log(svgTopologia(false, "Viga-parede — BESO, 40 % do volume", "viga-parede-beso.svg"));
    console.log(svgTopologia(true, "Viga-parede com abertura — BESO, 40 % do volume", "viga-parede-abertura-beso.svg"));
  }, 600_000);
});
