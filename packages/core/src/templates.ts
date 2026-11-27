import type { BarSpec, Scene } from "./scene";
import { rectPts } from "./scene";
import { base, plateLoad } from "./presets";
import { STEEL_CLASSES, type SteelClass } from "./nonlinear";
import { barAreaCm2 } from "./rebar";

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

export interface DeepBeamTemplateParams {
  L: number; H: number; t: number; h: number;
  bearing: number; loadKN: number; fck: number;
  opening?: { x: number; y: number; w: number; h: number } | null;
}

/** Template paramétrico de viga-parede biapoiada com carga central no topo e abertura opcional. */
export function templateDeepBeam(p: DeepBeamTemplateParams): Scene {
  const s = base(p.h, p.bearing);
  s.t = p.t; s.fck = p.fck;
  const sup = Math.min(Math.max(p.bearing / 2, p.h * 2), p.L * 0.15);
  s.shapes.push({
    id: "S1", mode: "add",
    pts: [[0, 0], [r4(sup), 0], [r4(p.L - sup), 0], [r4(p.L), 0], [r4(p.L), r4(p.H)], [r4(p.L / 2), r4(p.H)], [0, r4(p.H)]],
  });
  if (p.opening && p.opening.w > 0 && p.opening.h > 0) {
    s.shapes.push({ id: "A1", mode: "cut", pts: rectPts(p.opening.x, p.opening.y, p.opening.w, p.opening.h) });
  }
  s.supports.push({ id: "Ap1", x0: 0, y0: 0, x1: r4(sup), y1: 0, ux: true, uy: true });
  s.supports.push({ id: "Ap2", x0: r4(p.L - sup), y0: 0, x1: r4(p.L), y1: 0, ux: false, uy: true });
  s.loads.push(plateLoad("P1", r4(p.L / 2), r4(p.H), p.bearing, -Math.abs(p.loadKN)));
  s.nl = { values: "design", epsCu: 0.0035, crushLength: p.t, crushAuto: true, code: "NBR6118" };
  return s;
}

export interface CorbelTemplateParams {
  colW: number; colH: number; corbA: number; corbH: number; corbY: number;
  t: number; h: number; bearing: number; fvKN: number; fhKN: number; fck: number;
}

/** Template paramétrico de pilar com consolo curto engastado na base e no topo. */
export function templateCorbel(p: CorbelTemplateParams): Scene {
  const s = base(p.h, p.bearing);
  s.t = p.t; s.fck = p.fck;
  const y0 = p.corbY, y1 = p.corbY + p.corbH, x1 = p.colW + p.corbA;
  const loadX = Math.min(x1 - p.bearing / 2 - p.h, p.colW + p.corbA * 0.65);
  s.shapes.push({
    id: "S1", mode: "add",
    pts: [
      [0, 0], [r4(p.colW), 0], [r4(p.colW), r4(y0)], [r4(x1), r4(y0 + p.corbH * 0.45)],
      [r4(x1), r4(y1)], [r4(p.colW), r4(y1)], [r4(p.colW), r4(p.colH)], [0, r4(p.colH)],
    ],
  });
  s.supports.push({ id: "Ap1", x0: 0, y0: 0, x1: r4(p.colW), y1: 0, ux: true, uy: true });
  s.supports.push({ id: "Ap2", x0: 0, y0: r4(p.colH), x1: r4(p.colW), y1: r4(p.colH), ux: true, uy: false });
  const lx0 = Math.max(p.colW, loadX - p.bearing / 2), lx1 = Math.min(x1, loadX + p.bearing / 2);
  s.loads.push({ id: "P1", x: r4(lx0), y: r4(y1), x1: r4(lx1), y1: r4(y1), fx: p.fhKN, fy: -Math.abs(p.fvKN) });
  s.nl = { values: "design", epsCu: 0.0035, crushLength: p.t, crushAuto: true, code: "NBR6118" };
  return s;
}

export interface FrameCornerTemplateParams {
  colW: number; colH: number; beamL: number; beamH: number;
  t: number; h: number; qKNm: number; fck: number;
}

/** Template paramétrico de nó de pórtico em L (pilar + viga engastados no canto). */
export function templateFrameCorner(p: FrameCornerTemplateParams): Scene {
  const s = base(p.h, p.colW);
  s.t = p.t; s.fck = p.fck;
  const totalL = p.colW + p.beamL, yBot = p.colH - p.beamH;
  const supW = Math.min(0.3, p.beamL * 0.15);
  s.shapes.push({
    id: "S1", mode: "add",
    pts: [[0, 0], [r4(p.colW), 0], [r4(p.colW), r4(yBot)], [r4(totalL - supW), r4(yBot)], [r4(totalL), r4(yBot)], [r4(totalL), r4(p.colH)], [0, r4(p.colH)]],
  });
  s.supports.push({ id: "Ap1", x0: 0, y0: 0, x1: r4(p.colW), y1: 0, ux: true, uy: true });
  s.supports.push({ id: "Ap2", x0: r4(totalL - supW), y0: r4(yBot), x1: r4(totalL), y1: r4(yBot), ux: true, uy: true });
  s.loads.push({ id: "Q1", x: 0, y: r4(p.colH), x1: r4(totalL), y1: r4(p.colH), fx: 0, fy: -r4(Math.abs(p.qKNm) * totalL) });
  s.nl = { values: "design", epsCu: 0.0035, crushLength: p.t, crushAuto: true, code: "NBR6118" };
  return s;
}

export interface StirrupGroupParams {
  id: string;
  label?: string;
  /** retângulo de distribuição em coordenadas da cena [m] */
  x0: number; y0: number; x1: number; y1: number;
  /** "vertical" = estribos verticais espaçados em x; "horizontal" = barras horizontais espaçadas em y */
  orientation: "vertical" | "horizontal";
  /** cobrimento [m] em relação às faces do retângulo */
  cover: number;
  /** espaçamento centro-a-centro [m] */
  spacing: number;
  /** nº de ramos por estribo/camada (ex.: 2 para estribo fechado de 2 ramos) */
  legs: number;
  /** diâmetro [mm] */
  diaMm: number;
  steelClass: SteelClass;
}

/** Gera um grupo de barras distribuídas (estribos ou malha) como `BarSpec` com `path` + `extra`. */
export function generateStirrupGroup(p: StirrupGroupParams): BarSpec | null {
  const xa = Math.min(p.x0, p.x1) + p.cover, xb = Math.max(p.x0, p.x1) - p.cover;
  const ya = Math.min(p.y0, p.y1) + p.cover, yb = Math.max(p.y0, p.y1) - p.cover;
  if (!(xb > xa + 1e-4) || !(yb > ya + 1e-4) || !(p.spacing > 1e-4) || !(p.legs >= 1)) return null;
  const lines: [number, number][][] = [];
  if (p.orientation === "vertical") {
    const span = xb - xa;
    const count = Math.max(1, Math.floor(span / p.spacing) + 1);
    const step = count > 1 ? span / (count - 1) : 0;
    for (let k = 0; k < count; k++) {
      const x = r4(xa + k * step);
      lines.push([[x, r4(ya)], [x, r4(yb)]]);
    }
  } else {
    const span = yb - ya;
    const count = Math.max(1, Math.floor(span / p.spacing) + 1);
    const step = count > 1 ? span / (count - 1) : 0;
    for (let k = 0; k < count; k++) {
      const y = r4(ya + k * step);
      lines.push([[r4(xa), y], [r4(xb), y]]);
    }
  }
  const st = STEEL_CLASSES[p.steelClass];
  const orientTxt = p.orientation === "vertical" ? "Estribos V" : "Distribuída H";
  return {
    id: p.id,
    label: p.label || `${orientTxt} (${p.legs}Ø${String(p.diaMm).replace(".", ",")} c/${Math.round(p.spacing * 100)})`,
    path: lines[0],
    extra: lines.length > 1 ? lines.slice(1) : undefined,
    areaCm2: barAreaCm2(p.legs, p.diaMm),
    steelClass: p.steelClass,
    fy: st.fy, ft: st.ft, Es: st.Es, epsU: st.epsU,
  };
}
