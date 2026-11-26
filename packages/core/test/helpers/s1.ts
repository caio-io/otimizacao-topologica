import { base, plateLoad } from "../../src";
import type { Bar, Scene, SteelLaw } from "../../src";

/**
 * Cabeça de pilar S1 de Geevar & Menon (2018), como modelada no livro do CSFM (Fig. 6.22–6.23, Tab. 6.14–6.15), em estado plano:
 * largura 1,20 m, altura 0,98 m (base reta 0,16 m, flare 0,32 m de 1,20 a 0,64 m, pilar reto 0,50 m), espessura = 2·lb = 0,26 m,
 * quatro apoios (2 no plano) de 0,13 m centrados em x = 0,14 e 1,06 m, fixos nas duas direções (neoprene fino); carga
 * distribuída no topo em 0,48 m (largura da placa lida da Fig. 6.23). Carga total do ensaio = 4 × reação por apoio.
 * Armadura: As1 = 9Ø10 (laço em U com pernas dobradas ao longo do flare), 6 camadas horizontais Ah = 4Ø4 a cada 75 mm.
 */
export const S1 = { fc: 31.2e3, expPerSupport: 556, csfm: { M0: 629, M1: 610, M2: 609, M3: 568 } };

export function s1Scene(h: number, bearing = 0.13): Scene {
  const s = base(h, bearing);
  s.t = 0.26; s.E = 30e6; s.nu = 0.2;
  const xa = 0.14 - bearing / 2, xb = 0.14 + bearing / 2, xc = 1.06 - bearing / 2, xd = 1.06 + bearing / 2;
  s.shapes.push({
    id: "S1", mode: "add",
    pts: [[0, 0], [xa, 0], [xb, 0], [xc, 0], [xd, 0], [1.2, 0], [1.2, 0.16], [0.92, 0.48], [0.92, 0.98], [0.28, 0.98], [0.28, 0.48], [0, 0.16]],
  });
  s.supports.push({ id: "Ap1", x0: xa, y0: 0, x1: xb, y1: 0, ux: true, uy: true });
  s.supports.push({ id: "Ap2", x0: xc, y0: 0, x1: xd, y1: 0, ux: true, uy: true });
  s.loads.push(plateLoad("P1", 0.6, 0.98, 0.48, -4000));
  return s;
}

const As1steel: SteelLaw = { fy: 620e3, ft: 670e3, Es: 200e6, epsU: 0.05 };
const Ahsteel: SteelLaw = { fy: 605e3, ft: 653e3, Es: 200e6, epsU: 0.05 };

export function s1Bars(): Bar[] {
  const bars: Bar[] = [{
    x0: 0, y0: 0, x1: 0, y1: 0, area: 9 * Math.PI * 0.005 ** 2, steel: As1steel, label: "As1",
    path: [[0.403, 0.60], [0.04, 0.16], [0.04, 0.03], [1.16, 0.03], [1.16, 0.16], [0.797, 0.60]],
  }];
  const cover = 0.03;
  for (let k = 0; k < 6; k++) {
    const y = 0.09 + 0.075 * k, xe = y <= 0.16 ? 0 : (0.28 * (y - 0.16)) / 0.32;
    bars.push({
      x0: 0, y0: 0, x1: 0, y1: 0, area: 4 * Math.PI * 0.002 ** 2, steel: Ahsteel, label: `Ah${k + 1}`,
      path: [[xe + cover, y], [1.2 - xe - cover, y]],
    });
  }
  return bars;
}
