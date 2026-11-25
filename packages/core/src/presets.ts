import type { Problem } from "./types";
import { buildProblem, rectPts } from "./scene";
import type { Scene } from "./scene";

const base = (h: number, bearing: number): Scene => ({ h, bearing, t: 0.2, E: 30e6, nu: 0.2, shapes: [], loads: [], supports: [] });

/** Viga-parede biapoiada, carga no topo. L=3.0 m, H=1.5 m. Forças e apoios sobre vértices do contorno. */
export function deepBeamScene(opening = false): Scene {
  const s = base(0.025, 0.3);
  s.shapes.push({
    id: "S1", mode: "add",
    pts: [[0, 0], [0.15, 0], [2.85, 0], [3, 0], [3, 1.5], [1.5, 1.5], [0, 1.5]],
  });
  if (opening) s.shapes.push({ id: "A1", mode: "cut", pts: rectPts(0.7, 0.6, 0.6, 0.5) });
  s.supports.push({ id: "Ap1", x0: 0, y0: 0, x1: 0.15, y1: 0, ux: true, uy: true });
  s.supports.push({ id: "Ap2", x0: 2.85, y0: 0, x1: 3, y1: 0, ux: false, uy: true });
  s.loads.push({ id: "P1", x: 1.5, y: 1.5, fx: 0, fy: -1000 });
  return s;
}

/** Pilar com consolo curto: carga na ponta do consolo + carga axial no pilar. */
export function corbelScene(): Scene {
  const s = base(0.01, 0.12);
  s.shapes.push({
    id: "S1", mode: "add",
    pts: [[0, 0], [0.28, 0], [0.28, 0.54], [0.7, 0.7], [0.7, 0.86], [0.58, 0.86], [0.28, 0.86], [0.28, 0.9], [0.14, 0.9], [0, 0.9]],
  });
  s.supports.push({ id: "Ap1", x0: 0, y0: 0, x1: 0.28, y1: 0, ux: true, uy: true });
  s.loads.push({ id: "P1", x: 0.58, y: 0.86, fx: 0, fy: -400 });
  s.loads.push({ id: "P2", x: 0.14, y: 0.9, fx: 0, fy: -800 });
  return s;
}

/** Pilar com dois consolos (simétrico): uma força em cada consolo + carga axial no topo. */
export function twoCorbelScene(): Scene {
  const s = base(0.01, 0.12);
  s.shapes.push({
    id: "S1", mode: "add",
    pts: [
      [0.42, 0], [0.7, 0], [0.7, 0.54], [1.12, 0.7], [1.12, 0.86], [1.0, 0.86], [0.7, 0.86], [0.7, 0.9],
      [0.56, 0.9], [0.42, 0.9], [0.42, 0.86], [0.12, 0.86], [0, 0.86], [0, 0.7], [0.42, 0.54],
    ],
  });
  s.supports.push({ id: "Ap1", x0: 0.42, y0: 0, x1: 0.7, y1: 0, ux: true, uy: true });
  s.loads.push({ id: "P1", x: 1.0, y: 0.86, fx: 0, fy: -400 });
  s.loads.push({ id: "P2", x: 0.12, y: 0.86, fx: 0, fy: -400 });
  s.loads.push({ id: "P3", x: 0.56, y: 0.9, fx: 0, fy: -800 });
  return s;
}

export const SCENE_PRESETS: Record<string, () => Scene> = {
  "Viga-parede": () => deepBeamScene(false),
  "Viga-parede com abertura": () => deepBeamScene(true),
  "Pilar com consolo": () => corbelScene(),
  "Pilar com 2 consolos": () => twoCorbelScene(),
};

const must = (s: Scene): Problem => {
  const r = buildProblem(s);
  if (!r.problem) throw new Error(r.errors.join("; "));
  return r.problem;
};
export const deepBeam = (opening = false) => must(deepBeamScene(opening));
export const corbel = () => must(corbelScene());
export const twoCorbel = () => must(twoCorbelScene());

export const PRESETS = {
  "Viga-parede": () => deepBeam(false),
  "Viga-parede com abertura": () => deepBeam(true),
  "Pilar com consolo": () => corbel(),
  "Pilar com 2 consolos": () => twoCorbel(),
} as const;
