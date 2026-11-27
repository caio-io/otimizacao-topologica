import type { BarSpec, Scene } from "./scene";
import { rectPts } from "./scene";
import { base, pierCapScene, plateLoad } from "./presets";

/**
 * Catálogo de benchmarks fiéis às publicações disponíveis localmente (PDFs do acervo):
 *  - Kaufmann et al. (2020) — CSFM Book, Cap. 6.5 (Geevar & Menon, 2018): S1, S2 e S3 (Tabs. 6.14–6.17);
 *  - Queiroz & Leonel (2025), Ed. 119, pp. 32–37, Fig. 6 e Tab. 1: viga-parede 10 × 7 m (maciça, Pos. 2 e Pos. 6);
 *  - Xia, Langelaar & Hendriks (2020), Fig. 15a e §3.2: Caso I (viga-parede 7,5 × 4,7 m com abertura);
 *  - Borges (2022), §7.1 (Goodchild et al., 2014): viga alta 5,0 × 1,5 m, C35, largura de biela a21 = 323,6 mm.
 *
 * Todos os parâmetros numéricos de referência abaixo foram conferidos diretamente nos PDFs locais.
 */

export type BenchmarkCategory = "nl" | "opt" | "stm";

export interface BenchmarkReference {
  /** nome curto da métrica principal (ex.: "Carga última por apoio (P/4)") */
  metricLabel: string;
  /** unidade exibida */
  unit: string;
  /** valor experimental ou publicado de referência principal */
  publishedValue: number;
  /** texto de origem do valor publicado (ex.: "Ensaio Geevar & Menon: 556 kN (CC+FY)") */
  publishedNote: string;
  /** faixa numérica publicada no artigo/livro, se houver */
  modelRange?: [number, number];
  modelRangeNote?: string;
  /** faixa esperada conhecida do nosso solver atual (transparência sobre incerteza) */
  expectedHere?: string;
  /** divisor para converter carga total P em métrica publicada (ex.: 4 para P/4 nas cabeças de pilar S1–S5) */
  loadDivisor?: number;
  /** recomendação de método e parâmetros para reproduzir o benchmark */
  recommended?: { mode: "nl" | "opt" | "elastic"; method?: "simp" | "beso"; volfrac?: number; rmin?: number };
}

export interface BenchmarkEntry {
  id: string;
  title: string;
  shortTitle: string;
  citation: string;
  sourceFile: string;
  category: BenchmarkCategory;
  summary: string;
  reference: BenchmarkReference;
  createScene: () => Scene;
}

/**
 * Cabeças de pilar S1, S2 e S3 de Geevar & Menon (2018), conforme Kaufmann et al. (2020), Tabs. 6.14–6.17 (pp. 136–139).
 * Geometria externa comum (1,20 × 0,98 m); espessura t = 2·lb; posição exata das barras aproximada da Fig. 6.22c.
 */
export function pierCapSpecimenScene(spec: "S1" | "S2" | "S3", h = 0.04): Scene {
  if (spec === "S1") return pierCapScene(h, 0.13);
  const cfg = spec === "S2"
    ? { lb: 0.145, fc: 35.7, as1N: 13, as1Dia: 8, hasAs2: false, ahN: 6, sh: 0.058, fyMain: 631, ftMain: 681 }
    : { lb: 0.145, fc: 30.1, as1N: 13, as1Dia: 8, hasAs2: true, ahN: 6, sh: 0.058, fyMain: 631, ftMain: 681 };
  const s = base(h, cfg.lb);
  s.t = 2 * cfg.lb; s.E = 30e6; s.nu = 0.2; s.fck = cfg.fc;
  s.nl = { values: "mean", epsCu: 0.0035, crushLength: s.t, crushAuto: true };
  const xa = 0.14 - cfg.lb / 2, xb = 0.14 + cfg.lb / 2, xc = 1.06 - cfg.lb / 2, xd = 1.06 + cfg.lb / 2;
  s.shapes.push({
    id: "S1", mode: "add",
    pts: [[0, 0], [xa, 0], [xb, 0], [xc, 0], [xd, 0], [1.2, 0], [1.2, 0.16], [0.92, 0.48], [0.92, 0.98], [0.28, 0.98], [0.28, 0.48], [0, 0.16]],
  });
  s.supports.push({ id: "Ap1", x0: xa, y0: 0, x1: xb, y1: 0, ux: true, uy: true });
  s.supports.push({ id: "Ap2", x0: xc, y0: 0, x1: xd, y1: 0, ux: true, uy: true });
  s.loads.push(plateLoad("P1", 0.6, 0.98, 0.48, -4000));

  const rMain = cfg.as1Dia / 20; // cm
  const areaMain = cfg.as1N * Math.PI * rMain * rMain;
  const bars: BarSpec[] = [{
    id: "B1", label: `As1 (${cfg.as1N}Ø${cfg.as1Dia})`, steelClass: "custom",
    areaCm2: areaMain, fy: cfg.fyMain, ft: cfg.ftMain, Es: 200, epsU: 0.05,
    path: [[0.403, 0.60], [0.04, 0.16], [0.04, 0.03], [1.16, 0.03], [1.16, 0.16], [0.797, 0.60]],
  }];
  if (cfg.hasAs2) {
    bars.push({
      id: "B2", label: `As2 (${cfg.as1N}Ø${cfg.as1Dia})`, steelClass: "custom",
      areaCm2: areaMain, fy: cfg.fyMain, ft: cfg.ftMain, Es: 200, epsU: 0.05,
      path: [[0.04, 0.06], [1.16, 0.06]],
    });
  }
  const nLayers = Math.floor((0.46 - 0.09) / cfg.sh) + 1;
  for (let k = 0; k < nLayers; k++) {
    const y = Math.round((0.09 + cfg.sh * k) * 1000) / 1000;
    const xe = y <= 0.16 ? 0 : (0.28 * (y - 0.16)) / 0.32;
    bars.push({
      id: `B${bars.length + 1}`, label: `Ah${k + 1} (${cfg.ahN}Ø4)`, steelClass: "custom",
      areaCm2: cfg.ahN * Math.PI * 0.2 ** 2, fy: 605, ft: 653, Es: 200, epsU: 0.05,
      path: [[xe + 0.03, y], [1.2 - xe - 0.03, y]],
    });
  }
  s.bars = bars;
  return s;
}

/** Queiroz & Leonel (2025), Ed. 119, Fig. 6 e Tab. 1: viga-parede 10 × 7 m, abertura 1,5 m em posições 1..9 (null = maciça). */
const Q_X0 = [1.0, 2.625, 4.25], Q_Y0 = [1.0, 2.75, 4.5];
const Q_POS: Record<number, [number, number]> = {};
for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) Q_POS[c * 3 + r + 1] = [Q_X0[c], Q_Y0[r]];

export function queirozBeamScene(pos: number | null, h = 0.125): Scene {
  const s = base(h, 0.25);
  s.t = 0.2; s.E = 28.567e6; s.nu = 0.15; s.fck = 30;
  s.shapes.push({ id: "S1", mode: "add", pts: [[0, 0], [0.375, 0], [0.625, 0], [9.375, 0], [9.625, 0], [10, 0], [10, 7], [0, 7]] });
  if (pos && Q_POS[pos]) s.shapes.push({ id: "A1", mode: "cut", pts: rectPts(Q_POS[pos][0], Q_POS[pos][1], 1.5, 1.5) });
  s.supports.push({ id: "Ap1", x0: 0.375, y0: 0, x1: 0.625, y1: 0, ux: true, uy: true });
  s.supports.push({ id: "Ap2", x0: 9.375, y0: 0, x1: 9.625, y1: 0, ux: false, uy: true });
  s.loads.push(plateLoad("P1", 3.5, 7, 0.25, -100));
  s.loads.push(plateLoad("P2", 6.5, 7, 0.25, -100));
  return s;
}

/** Xia, Langelaar & Hendriks (2020), Fig. 15a: Caso I — viga-parede 7,5 × 4,7 m com abertura 1,5 × 1,5 m. */
export function xiaCase1Scene(h = 0.05, plate = 0.15): Scene {
  const s = base(h, plate);
  s.t = 0.3; s.E = 20e6; s.nu = 0.2; s.fck = 30;
  s.shapes.push({ id: "S1", mode: "add", pts: [[0, 0], [plate, 0], [7.5 - plate, 0], [7.5, 0], [7.5, 4.7], [0, 4.7]] });
  s.shapes.push({ id: "A1", mode: "cut", pts: rectPts(0.5, 0.5, 1.5, 1.5) });
  s.supports.push({ id: "Ap1", x0: 0, y0: 0, x1: plate, y1: 0, ux: true, uy: true });
  s.supports.push({ id: "Ap2", x0: 7.5 - plate, y0: 0, x1: 7.5, y1: 0, ux: false, uy: true });
  s.loads.push(plateLoad("P1", 4.7, 4.7, plate, -3000));
  return s;
}

/**
 * Borges (2022), §7.1 (Goodchild et al., 2014): viga alta 5,0 × 1,5 × 0,45 m apoiada em pilares de 0,60 m
 * (vão entre eixos 4,40 m), carga de cálculo na placa de 0,45 m (Gk = 1256 kN, Qk = 480 kN ⇒ Fd ≈ 2416 kN em x = 1,55 m),
 * concreto C35 (fck = 35 MPa).
 */
export function borgesGoodchildScene(h = 0.05): Scene {
  const s = base(h, 0.45);
  s.t = 0.45; s.E = 34e6; s.nu = 0.2; s.fck = 35;
  s.nl = { values: "design", epsCu: 0.0035, crushLength: 0.45, crushAuto: true, code: "EC2" };
  s.shapes.push({
    id: "S1", mode: "add",
    pts: [[0, 0], [0.6, 0], [4.4, 0], [5.0, 0], [5.0, 1.5], [1.775, 1.5], [1.325, 1.5], [0, 1.5]],
  });
  s.supports.push({ id: "Ap1", x0: 0, y0: 0, x1: 0.6, y1: 0, ux: true, uy: true });
  s.supports.push({ id: "Ap2", x0: 4.4, y0: 0, x1: 5.0, y1: 0, ux: false, uy: true });
  s.loads.push(plateLoad("P1", 1.55, 1.5, 0.45, -2416));
  return s;
}

export const BENCHMARKS: BenchmarkEntry[] = [
  {
    id: "csfm-s1",
    title: "Benchmark CSFM — Cabeça de pilar S1 (Geevar & Menon)",
    shortTitle: "S1 · Cabeça de pilar (CSFM)",
    citation: "Kaufmann et al. (2020), Cap. 6.5, Tabs. 6.14–6.17 (pp. 136–139)",
    sourceFile: "CSFM_book_2020.pdf (PDF pp. 144–147)",
    category: "nl",
    summary: "Cabeça de pilar 1,20 × 0,98 m, t = 2·lb = 0,26 m, fc = 31,2 MPa, As1 = 9Ø10 e Ah = 4Ø4 c/ 75 mm. Valores médios de ensaio.",
    reference: {
      metricLabel: "Carga última por apoio real (P/4)",
      unit: "kN",
      publishedValue: 556,
      publishedNote: "Ensaio Geevar & Menon (2018): 556 kN (CC+FY)",
      modelRange: [568, 629],
      modelRangeNote: "CSFM livro: M3 568 · M2 609 · M1 610 · M0 629 kN (CC)",
      expectedHere: "Q4 (lc = 0,26 m): 539–615 kN (20–40 mm); h = 40 mm roda em ~10 s",
      loadDivisor: 4,
      recommended: { mode: "nl" },
    },
    createScene: () => pierCapSpecimenScene("S1", 0.04),
  },
  {
    id: "csfm-s2",
    title: "Benchmark CSFM — Cabeça de pilar S2 (Geevar & Menon)",
    shortTitle: "S2 · Cabeça de pilar (CSFM)",
    citation: "Kaufmann et al. (2020), Cap. 6.5, Tabs. 6.14–6.17 (pp. 136–139)",
    sourceFile: "CSFM_book_2020.pdf (PDF pp. 144–147)",
    category: "nl",
    summary: "Cabeça de pilar com placa lb = 145 mm (t = 0,29 m), fc = 35,7 MPa, As1 = 13Ø8 (fy = 631 MPa) e Ah = 6Ø4 c/ 58 mm.",
    reference: {
      metricLabel: "Carga última por apoio real (P/4)",
      unit: "kN",
      publishedValue: 767,
      publishedNote: "Ensaio Geevar & Menon (2018): 767 kN (CC+FY)",
      modelRange: [765, 846],
      modelRangeNote: "CSFM livro: M3 765 · M2 811 · M0 840 · M1 846 kN (CC)",
      expectedHere: "Modelo em Q4 sem kc2/TS (mesmas hipóteses da S1; geometria de barras aproximada da Fig. 6.22c)",
      loadDivisor: 4,
      recommended: { mode: "nl" },
    },
    createScene: () => pierCapSpecimenScene("S2", 0.04),
  },
  {
    id: "csfm-s3",
    title: "Benchmark CSFM — Cabeça de pilar S3 (As1 + As2)",
    shortTitle: "S3 · Cabeça de pilar (CSFM)",
    citation: "Kaufmann et al. (2020), Cap. 6.5, Tabs. 6.14–6.17 (pp. 136–139)",
    sourceFile: "CSFM_book_2020.pdf (PDF pp. 144–147)",
    category: "nl",
    summary: "Igual à S2 com armadura suplementar As2 = 13Ø8 (ρs,geo = 0,58 %) e concreto fc = 30,1 MPa.",
    reference: {
      metricLabel: "Carga última por apoio real (P/4)",
      unit: "kN",
      publishedValue: 859,
      publishedNote: "Ensaio Geevar & Menon (2018): 859 kN (CC+FY)",
      modelRange: [689, 770],
      modelRangeNote: "CSFM livro: M3 689 · M2 738 · M0 763 · M1 770 kN (CC)",
      expectedHere: "No próprio livro o CSFM é conservador na S3 (~−11 % vs. ensaio)",
      loadDivisor: 4,
      recommended: { mode: "nl" },
    },
    createScene: () => pierCapSpecimenScene("S3", 0.04),
  },
  {
    id: "queiroz-macica",
    title: "Benchmark Queiroz & Leonel — Viga-parede 10 × 7 m (maciça)",
    shortTitle: "Queiroz (2025) · Maciça",
    citation: "Queiroz & Leonel (2025), Ed. 119, Fig. 6 e Tab. 1 (pp. 35–36)",
    sourceFile: "src/Pesquisa e Desenvolvimento_estruturas_119.pdf",
    category: "opt",
    summary: "Viga-parede 10 × 7 m, t = 0,20 m, E = 28,567 GPa, ν = 0,15, 2 × 100 kN, SIMP p = 3, fração de volume 30 %.",
    reference: {
      metricLabel: "Volume de aço de referência (CA-50)",
      unit: "cm³",
      publishedValue: 888,
      publishedNote: "Tabela 1 do artigo: 888 cm³ (tirante extraído Fig. 8: 42,9 kN)",
      expectedHere: "Integração contínua (`steelVolume`): ≈ 814 cm³ (−8 %, diferença de métrica contínua vs. barra)",
      recommended: { mode: "opt", method: "simp", volfrac: 0.3, rmin: 3 },
    },
    createScene: () => queirozBeamScene(null, 0.125),
  },
  {
    id: "queiroz-pos6",
    title: "Benchmark Queiroz & Leonel — Abertura crítica Pos. 6",
    shortTitle: "Queiroz (2025) · Pos. 6 (+26,8%)",
    citation: "Queiroz & Leonel (2025), Ed. 119, Fig. 6–8 e Tab. 1 (pp. 35–36)",
    sourceFile: "src/Pesquisa e Desenvolvimento_estruturas_119.pdf",
    category: "opt",
    summary: "Pior posição de abertura da Tabela 1 (interrompe diretamente a biela diagonal): gera tirantes transversais ao redor da abertura.",
    reference: {
      metricLabel: "Volume de aço (variação vs. maciça)",
      unit: "cm³",
      publishedValue: 1126,
      publishedNote: "Tabela 1 do artigo: 1126 cm³ (+26,8 % vs. 888 cm³)",
      expectedHere: "SIMP 30 % (rmin = 3): acréscimo de +18 a +23 % (mesma posição crítica nº 1 do artigo)",
      recommended: { mode: "opt", method: "simp", volfrac: 0.3, rmin: 3 },
    },
    createScene: () => queirozBeamScene(6, 0.125),
  },
  {
    id: "xia-case1",
    title: "Benchmark Xia et al. (2020) — Caso I (viga-parede com abertura)",
    shortTitle: "Xia (2020) · Caso I",
    citation: "Xia, Langelaar & Hendriks (2020), Fig. 15a e §3.2 (CACAIE)",
    sourceFile: "src2/xia2020.pdf",
    category: "opt",
    summary: "Viga-parede 7,5 × 4,7 m, t = 0,30 m, abertura 1,5 × 1,5 m, carga 3000 kN em x = 4,7 m, SIMP 40 %.",
    reference: {
      metricLabel: "Índice TRS (similaridade da região tracionada)",
      unit: "%",
      publishedValue: 81.4,
      publishedNote: "Artigo SIMP malha fina I-11: TRS = 81,4 % (malha grossa I-10: 77,8 %)",
      modelRange: [77.8, 81.4],
      modelRangeNote: "Média de todos os 28 modelos do artigo: 72,3 ± 8,1 %",
      expectedHere: "SIMP 40 % (h = 0,05 m, rmin = 3): TRS ≈ 82–84 % (SR difere ~4×, em investigação)",
      recommended: { mode: "opt", method: "simp", volfrac: 0.4, rmin: 3 },
    },
    createScene: () => xiaCase1Scene(0.05, 0.15),
  },
  {
    id: "borges-goodchild",
    title: "Benchmark Borges (2022) — Viga alta de Goodchild (C35)",
    shortTitle: "Borges (2022) · Goodchild C35",
    citation: "Borges (2022, UFRGS), §7.1, Eqs. 7.26–7.30 (pp. 66–72)",
    sourceFile: "src/001143839.pdf",
    category: "stm",
    summary: "Viga alta 5,0 × 1,5 × 0,45 m (vão 4,40 m), carga assimétrica Fd = 2416 kN (placa 0,45 m), concreto C35 (EC2).",
    reference: {
      metricLabel: "Largura mínima da biela inclinada a21",
      unit: "mm",
      publishedValue: 323.6,
      publishedNote: "Eq. 7.29–7.30 (C35, γc = 1,5, F12 = 2484 kN): σRd,max = 17,1 MPa, a21 = 323,6 mm",
      expectedHere: "Nota: o filtro automático usa a reação de apoio (~1730 kN) como proxy de F12 (2484 kN)",
      recommended: { mode: "opt", method: "beso", volfrac: 0.4, rmin: 4 },
    },
    createScene: () => borgesGoodchildScene(0.05),
  },
];

export const benchmarkById = (id: string): BenchmarkEntry | undefined => BENCHMARKS.find((b) => b.id === id);
