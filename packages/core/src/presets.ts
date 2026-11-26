import type { Problem } from "./types";
import { buildProblem, rectPts } from "./scene";
import type { BarSpec, Scene } from "./scene";

export const base = (h: number, bearing: number): Scene => ({ h, bearing, t: 0.2, E: 30e6, nu: 0.2, shapes: [], loads: [], supports: [] });

/** Força aplicada em placa: carga distribuída uniforme de largura `w` centrada em (cx,cy), ao longo de uma aresta horizontal. */
export const plateLoad = (id: string, cx: number, cy: number, w: number, fy: number): Scene["loads"][number] =>
  ({ id, x: cx - w / 2, y: cy, x1: cx + w / 2, y1: cy, fx: 0, fy });

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
  s.loads.push(plateLoad("P1", 1.5, 1.5, s.bearing, -1000));
  return s;
}

/**
 * Cabeça de pilar S1 de Geevar & Menon (2018), como modelada no livro do CSFM (Fig. 6.22–6.23, Tab. 6.14–6.15):
 * pilar de 0,64 m que se abre num flare até a travessa de 1,20 m, apoiada em 4 pontos (2 no plano). Estado plano, espessura
 * 2·lb = 0,26 m, apoios de 0,13 m em x = 0,14 e 1,06 m fixos nas duas direções, carga de 4000 kN (referência) em 0,48 m no topo.
 * Armadura principal As1 = 9Ø10 em U com pernas dobradas e 6 camadas horizontais Ah = 4Ø4 (a cada 75 mm). A posição das
 * barras foi lida das figuras (aproximada). Valores médios de ensaio (sem coeficientes): fc = 31,2 MPa.
 */
export function pierCapScene(h = 0.04, bearing = 0.13): Scene {
  const s = base(h, bearing);
  s.t = 0.26; s.E = 30e6; s.nu = 0.2; s.fck = 31.2;
  s.nl = { values: "mean", epsCu: 0.0035, crushLength: 0.26 };
  const xa = 0.14 - bearing / 2, xb = 0.14 + bearing / 2, xc = 1.06 - bearing / 2, xd = 1.06 + bearing / 2;
  s.shapes.push({
    id: "S1", mode: "add",
    pts: [[0, 0], [xa, 0], [xb, 0], [xc, 0], [xd, 0], [1.2, 0], [1.2, 0.16], [0.92, 0.48], [0.92, 0.98], [0.28, 0.98], [0.28, 0.48], [0, 0.16]],
  });
  s.supports.push({ id: "Ap1", x0: xa, y0: 0, x1: xb, y1: 0, ux: true, uy: true });
  s.supports.push({ id: "Ap2", x0: xc, y0: 0, x1: xd, y1: 0, ux: true, uy: true });
  s.loads.push(plateLoad("P1", 0.6, 0.98, 0.48, -4000));
  const bars: BarSpec[] = [{
    id: "B1", label: "As1 (9Ø10)", areaCm2: 9 * Math.PI * 0.5 ** 2, fy: 620, ft: 670, Es: 200, epsU: 0.05,
    path: [[0.403, 0.60], [0.04, 0.16], [0.04, 0.03], [1.16, 0.03], [1.16, 0.16], [0.797, 0.60]],
  }];
  for (let k = 0; k < 6; k++) {
    const y = 0.09 + 0.075 * k, xe = y <= 0.16 ? 0 : (0.28 * (y - 0.16)) / 0.32;
    bars.push({ id: `B${k + 2}`, label: `Ah${k + 1} (4Ø4)`, areaCm2: 4 * Math.PI * 0.2 ** 2, fy: 605, ft: 653, Es: 200, epsU: 0.05, path: [[xe + 0.03, y], [1.2 - xe - 0.03, y]] });
  }
  s.bars = bars;
  return s;
}

export const SCENE_PRESETS: Record<string, () => Scene> = {
  "Viga-parede": () => deepBeamScene(false),
  "Viga-parede com abertura": () => deepBeamScene(true),
  "Cabeça de pilar S1 (CSFM, livro) — análise não linear": () => pierCapScene(),
};

const must = (s: Scene): Problem => {
  const r = buildProblem(s);
  if (!r.problem) throw new Error(r.errors.join("; "));
  return r.problem;
};
export const deepBeam = (opening = false) => must(deepBeamScene(opening));

export const PRESETS = {
  "Viga-parede": () => deepBeam(false),
  "Viga-parede com abertura": () => deepBeam(true),
} as const;
