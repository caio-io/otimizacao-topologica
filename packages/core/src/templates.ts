import type { BarSpec, Scene } from "./scene";
import { rectPts } from "./scene";
import { base, plateLoad } from "./presets";
import { STEEL_CLASSES, type SteelClass } from "./nonlinear";
import { barAreaCm2, clipPolylineToSolid } from "./rebar";

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
  /** Cena opcional: quando informada, recorta estribos/barras nas aberturas (`cut`) */
  scene?: Scene;
}

/** Gera um grupo de barras distribuídas (estribos ou malha) como `BarSpec` com `path` + `extra`. */
export function generateStirrupGroup(p: StirrupGroupParams): BarSpec | null {
  const xa = Math.min(p.x0, p.x1) + p.cover, xb = Math.max(p.x0, p.x1) - p.cover;
  const ya = Math.min(p.y0, p.y1) + p.cover, yb = Math.max(p.y0, p.y1) - p.cover;
  if (!(xb > xa + 1e-4) || !(yb > ya + 1e-4) || !(p.spacing > 1e-4) || !(p.legs >= 1)) return null;
  const rawLines: [number, number][][] = [];
  if (p.orientation === "vertical") {
    const span = xb - xa;
    const count = Math.max(1, Math.floor(span / p.spacing) + 1);
    const step = count > 1 ? span / (count - 1) : 0;
    for (let k = 0; k < count; k++) {
      const x = r4(xa + k * step);
      rawLines.push([[x, r4(ya)], [x, r4(yb)]]);
    }
  } else {
    const span = yb - ya;
    const count = Math.max(1, Math.floor(span / p.spacing) + 1);
    const step = count > 1 ? span / (count - 1) : 0;
    for (let k = 0; k < count; k++) {
      const y = r4(ya + k * step);
      rawLines.push([[r4(xa), y], [r4(xb), y]]);
    }
  }
  const lines = p.scene && p.scene.shapes.length > 0
    ? rawLines.flatMap((ln) => clipPolylineToSolid(p.scene!, ln))
    : rawLines;
  if (lines.length === 0) return null;
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

export interface WalkingColumnTemplateParams {
  /** Nome do edifício / identificação do projeto (usado no rótulo) */
  buildingName?: string;
  /** Pé-direito de cada pavimento [m] (modelo de 3 pavimentos: total = 3 × storyH) */
  storyH: number;
  /** Coordenada X do eixo do pilar superior (Pav. 3) [m] */
  topAxisX: number;
  /** Excentricidade horizontal até o eixo do pilar inferior (Pav. 1) [m]; >0 desloca para a direita */
  eccentricity: number;
  /** Largura do pilar superior no plano [m] */
  topColW: number;
  /** Largura do pilar inferior no plano [m] (padrão = topColW) */
  botColW?: number;
  /** Espessura fora do plano dos pilares [m] */
  t: number;
  /** Espessura (altura vertical) da laje do diafragma [m] */
  slabH: number;
  /** Resistência característica do concreto fck [MPa] */
  fck: number;
  /** Carga vertical de compressão no topo do pilar superior [kN] (valor positivo) */
  loadTopKN: number;
  /** Força horizontal opcional no topo do pilar superior [kN] (+ para a direita; padrão 0) */
  horizTopKN?: number;
  /** Altura do toco do pilar superior (acima da Laje 2) e inferior (abaixo da Laje 1) [m] (padrão Saint-Venant ≈ 1,25·b) */
  stubH?: number;
  /** Tamanho do elemento finito [m] (opcional: calculado automaticamente respeitando MAX_ELEMENTS) */
  h?: number;
  /** Gerar armadura inicial paramétrica para análise não linear Nível 2 (padrão true) */
  includeRebar?: boolean;
}

export interface WalkingColumnSummary {
  /** Coordenadas horizontais [m] do pilar superior, inferior e intermediário (autocomplete) */
  xTopL: number; xTopR: number;
  xBotAxis: number; xBotL: number; xBotR: number;
  xMidL: number; xMidR: number;
  midColW: number;
  midAxisX: number;
  /** Altura dos tocos superior/inferior [m], altura total modelada [m] e braço entre eixos das lajes [m] */
  stubH: number;
  totalH: number;
  zDiaf: number;
  /** Razão de excentricidade |e|/H e ângulo aproximado da biela diagonal [°] */
  eccRatio: number;
  strutAngleDeg: number;
  /** Força horizontal estimada de equilíbrio em cada diafragma (H ≈ N·|e|/zDiaf) [kN] */
  estimatedThrustKN: number;
  /** Armadura adicional estimada na laje (CA-50, fyd = 434,8 MPa) a somar à flexão [cm²] */
  estimatedDiafAsCm2: number;
  /** Taxa de força normal adimensional no pilar superior ν = N / (Ac · fcd) */
  axialRatioNu: number;
  /** Tamanho de elemento finito adotado [m] */
  meshH: number;
}

/** Calcula geometria (incluindo autocomplete do pilar intermediário envolvente) e indicadores do walking column de 3 pavimentos. */
export function walkingColumnSummary(p: WalkingColumnTemplateParams): WalkingColumnSummary {
  const storyH = Math.max(1.5, p.storyH);
  const slabH = Math.min(Math.max(0.1, p.slabH), storyH * 0.4);
  const topColW = Math.max(0.2, p.topColW);
  const botColW = Math.max(0.2, p.botColW ?? topColW);
  const xTopL = r4(p.topAxisX - topColW / 2);
  const xTopR = r4(p.topAxisX + topColW / 2);
  const xBotAxis = r4(p.topAxisX + p.eccentricity);
  const xBotL = r4(xBotAxis - botColW / 2);
  const xBotR = r4(xBotAxis + botColW / 2);
  const xMidL = Math.min(xTopL, xBotL);
  const xMidR = Math.max(xTopR, xBotR);
  const midColW = r4(xMidR - xMidL);
  const midAxisX = r4((xMidL + xMidR) / 2);
  // Toco de regularização (Saint-Venant): não precisa modelar o pé-direito inteiro acima/abaixo da transição
  const autoStub = Math.min(storyH, Math.max(0.75, 1.25 * Math.max(topColW, botColW)));
  const stubH = r4(Math.min(storyH, Math.max(0.4, p.stubH ?? autoStub)));
  const totalH = r4(2 * stubH + storyH + slabH);
  const zDiaf = r4(storyH);
  const absE = Math.abs(p.eccentricity);
  const eccRatio = absE / storyH;
  const strutAngleDeg = absE > 1e-6 ? (Math.atan2(storyH, absE) * 180) / Math.PI : 90;
  const loadN = Math.abs(p.loadTopKN);
  const estimatedThrustKN = (loadN * absE) / zDiaf;
  const fydKPa = (STEEL_CLASSES.CA50.fy) * 1e3; // kN/m²
  const estimatedDiafAsCm2 = (estimatedThrustKN / fydKPa) * 1e4;
  const fcdKPa = (p.fck / 1.4) * 1e3; // NBR 6118: fcd = fck / 1.4
  const axialRatioNu = loadN / Math.max(topColW * p.t * fcdKPa, 1e-6);

  // Resolução automática respeitando MAX_ELEMENTS = 20000 com folga (alvo ≤ 14000 elementos no bounding box)
  let meshH = p.h ?? 0.05;
  if (p.h === undefined) {
    const targetMax = 14000;
    const minH = Math.sqrt((midColW * totalH) / targetMax);
    const maxSlabH = Math.max(0.04, slabH / 2);
    meshH = Math.max(0.04, Math.min(maxSlabH, 0.08));
    if (minH > meshH) meshH = Math.ceil(minH * 100) / 100;
  }
  meshH = r4(Math.max(0.025, meshH));

  return {
    xTopL, xTopR, xBotAxis, xBotL, xBotR, xMidL, xMidR, midColW, midAxisX,
    stubH, totalH, zDiaf, eccRatio, strutAngleDeg, estimatedThrustKN, estimatedDiafAsCm2, axialRatioNu, meshH,
  };
}

/**
 * Template paramétrico de Walking Column de 3 pavimentos:
 * - Pavimento 1 (inferior): toco do pilar centrado em `topAxisX + eccentricity` (Saint-Venant)
 * - Pavimento 2 (intermediário): pilar envolvente gerado por autocomplete cobrindo os dois pilares
 * - Pavimento 3 (superior): toco do pilar centrado em `topAxisX` (Saint-Venant)
 * - Diafragmas rígidos (`ux` fixo, `uy` livre) nos DOIS lados das Lajes 1 e 2 (`Diaf1E/D`, `Diaf2E/D`),
 *   podendo o usuário clicar e excluir qualquer lado individualmente.
 */
export function templateWalkingColumn(p: WalkingColumnTemplateParams): Scene {
  const sum = walkingColumnSummary(p);
  const storyH = Math.max(1.5, p.storyH);
  const slabH = Math.min(Math.max(0.1, p.slabH), storyH * 0.4);
  const y1Bot = sum.stubH;
  const y1Top = r4(y1Bot + slabH);
  const y2Bot = r4(y1Bot + storyH);
  const y2Top = r4(y2Bot + slabH);
  const y3Top = sum.totalH;

  const s = base(sum.meshH, Math.min(p.topColW, p.botColW ?? p.topColW));
  s.t = p.t;
  s.fck = p.fck;

  // Polígono único CCW com vértices das faixas de laje em AMBOS os lados (xMidL e xMidR)
  const pts: [number, number][] = [
    [sum.xBotL, 0],
    [sum.xBotR, 0],
    [sum.xBotR, y1Bot],
  ];
  if (sum.xMidR > sum.xBotR + 1e-6) pts.push([sum.xMidR, y1Bot]);
  pts.push([sum.xMidR, y1Top], [sum.xMidR, y2Bot], [sum.xMidR, y2Top]);
  if (sum.xTopR < sum.xMidR - 1e-6) pts.push([sum.xTopR, y2Top]);
  pts.push([sum.xTopR, y3Top], [sum.xTopL, y3Top], [sum.xTopL, y2Top]);
  if (sum.xMidL < sum.xTopL - 1e-6) pts.push([sum.xMidL, y2Top]);
  pts.push([sum.xMidL, y2Bot], [sum.xMidL, y1Top], [sum.xMidL, y1Bot]);
  if (sum.xBotL > sum.xMidL + 1e-6) pts.push([sum.xBotL, y1Bot]);

  s.shapes.push({ id: "S1", mode: "add", pts });

  // Apoios: base do pilar inferior (fixo) + diafragmas rígidos nos DOIS lados das Lajes 1 e 2 (clicáveis/apagáveis)
  s.supports.push({ id: "ApBase", x0: sum.xBotL, y0: 0, x1: sum.xBotR, y1: 0, ux: true, uy: true });
  s.supports.push({ id: "Diaf1E", x0: sum.xMidL, y0: y1Bot, x1: sum.xMidL, y1: y1Top, ux: true, uy: false });
  s.supports.push({ id: "Diaf1D", x0: sum.xMidR, y0: y1Bot, x1: sum.xMidR, y1: y1Top, ux: true, uy: false });
  s.supports.push({ id: "Diaf2E", x0: sum.xMidL, y0: y2Bot, x1: sum.xMidL, y1: y2Top, ux: true, uy: false });
  s.supports.push({ id: "Diaf2D", x0: sum.xMidR, y0: y2Bot, x1: sum.xMidR, y1: y2Top, ux: true, uy: false });

  // Carregamento no topo do pilar superior
  s.loads.push({
    id: "P1",
    x: sum.xTopL, y: y3Top,
    x1: sum.xTopR, y1: y3Top,
    fx: p.horizTopKN ?? 0,
    fy: -Math.abs(p.loadTopKN),
  });

  if (p.includeRebar !== false) {
    const cover = 0.04;
    const ca50 = STEEL_CLASSES.CA50;
    const mkBar = (id: string, label: string, areaCm2: number, path: [number, number][]): BarSpec => ({
      id, label, steelClass: "CA50", areaCm2, fy: ca50.fy, ft: ca50.ft, Es: ca50.Es, epsU: ca50.epsU, path,
    });
    const colAs = Math.max(barAreaCm2(4, 16), r4(0.004 * p.topColW * p.t * 1e4)); // ≥ 0,4 % por face (0,8 % total)
    const tieAs = Math.max(barAreaCm2(4, 16), r4(sum.estimatedDiafAsCm2 * 1.15));
    const bars: BarSpec[] = [
      // Longitudinais do pilar superior ancoradas até a Laje 1
      mkBar("B1", "Long. Sup. Esq.", colAs, [[r4(sum.xTopL + cover), r4(y1Bot + cover)], [r4(sum.xTopL + cover), r4(y3Top - cover)]]),
      mkBar("B2", "Long. Sup. Dir.", colAs, [[r4(sum.xTopR - cover), r4(y1Bot + cover)], [r4(sum.xTopR - cover), r4(y3Top - cover)]]),
      // Longitudinais do pilar inferior ancoradas até a Laje 2
      mkBar("B3", "Long. Inf. Esq.", colAs, [[r4(sum.xBotL + cover), cover], [r4(sum.xBotL + cover), r4(y2Top - cover)]]),
      mkBar("B4", "Long. Inf. Dir.", colAs, [[r4(sum.xBotR - cover), cover], [r4(sum.xBotR - cover), r4(y2Top - cover)]]),
      // Tirantes horizontais nos níveis das Lajes 1 e 2 (diafragmas)
      mkBar("B5", "Tirante Diaf. 2 (Laje Sup.)", tieAs, [[r4(sum.xMidL + cover), r4(y2Top - slabH / 2)], [r4(sum.xMidR - cover), r4(y2Top - slabH / 2)]]),
      mkBar("B6", "Tirante Diaf. 1 (Laje Inf.)", tieAs, [[r4(sum.xMidL + cover), r4(y1Top - slabH / 2)], [r4(sum.xMidR - cover), r4(y1Top - slabH / 2)]]),
    ];

    // Estribos horizontais na zona de transição (Pav. 2) e nos pilares superior/inferior
    const stMid = generateStirrupGroup({
      id: "B7", label: "Estribos Transição (2Ø10 c/15)",
      x0: sum.xMidL, y0: y1Top, x1: sum.xMidR, y1: y2Bot,
      orientation: "horizontal", cover, spacing: 0.15, legs: 2, diaMm: 10, steelClass: "CA50", scene: s,
    });
    const stTop = generateStirrupGroup({
      id: "B8", label: "Estribos Pilar Sup. (2Ø8 c/20)",
      x0: sum.xTopL, y0: y2Top, x1: sum.xTopR, y1: y3Top,
      orientation: "horizontal", cover, spacing: 0.2, legs: 2, diaMm: 8, steelClass: "CA50", scene: s,
    });
    const stBot = generateStirrupGroup({
      id: "B9", label: "Estribos Pilar Inf. (2Ø8 c/20)",
      x0: sum.xBotL, y0: 0, x1: sum.xBotR, y1: y1Bot,
      orientation: "horizontal", cover, spacing: 0.2, legs: 2, diaMm: 8, steelClass: "CA50", scene: s,
    });
    if (stMid) bars.push(stMid);
    if (stTop) bars.push(stTop);
    if (stBot) bars.push(stBot);
    s.bars = bars;
  }

  s.nl = { values: "design", epsCu: 0.0035, crushLength: p.t, crushAuto: true, code: "NBR6118" };
  return s;
}
