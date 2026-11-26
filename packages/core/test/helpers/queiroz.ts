import { base, plateLoad, rectPts } from "../../src";
import type { Scene } from "../../src";

/** Queiroz & Leonel (2025), Fig. 6 — ver calibracao.queiroz.test.ts */
const X0 = [1.0, 2.625, 4.25], Y0 = [1.0, 2.75, 4.5];
const POS: Record<number, [number, number]> = {};
for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) POS[c * 3 + r + 1] = [X0[c], Y0[r]];

export function queirozScene(pos: number | null, h = 0.125): Scene {
  const s = base(h, 0.25);
  s.t = 0.2; s.E = 28.567e6; s.nu = 0.15;
  s.shapes.push({ id: "S1", mode: "add", pts: [[0, 0], [0.375, 0], [0.625, 0], [9.375, 0], [9.625, 0], [10, 0], [10, 7], [0, 7]] });
  if (pos) s.shapes.push({ id: "A1", mode: "cut", pts: rectPts(POS[pos][0], POS[pos][1], 1.5, 1.5) });
  s.supports.push({ id: "Ap1", x0: 0.375, y0: 0, x1: 0.625, y1: 0, ux: true, uy: true });
  s.supports.push({ id: "Ap2", x0: 9.375, y0: 0, x1: 9.625, y1: 0, ux: false, uy: true });
  s.loads.push(plateLoad("P1", 3.5, 7, 0.25, -100));
  s.loads.push(plateLoad("P2", 6.5, 7, 0.25, -100));
  return s;
}

