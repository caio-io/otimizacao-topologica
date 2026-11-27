import type { Problem } from "./types";
import { buildModel, elementStiffness, solveBandedAssembled } from "./fe";
import type { Scene } from "./scene";
import { codeById, fcdOfCode } from "./codes";

/**
 * Nível 2 do roteiro CSFM: análise não linear de peças planas de concreto com armadura 1D.
 *
 * Hipóteses (livro do CSFM, cap. 3.2–3.3 e eq. 3.12):
 *  - concreto sem resistência à tração (σ1 = 0 se ε1 > 0); rigidez residual numérica só na matriz, nunca na tensão;
 *  - direções principais de tensão e de deformação coincidem (fissuras girantes);
 *  - em cada direção principal vale a lei uniaxial parábola-retângulo (ν = 0 nas direções principais), SEM
 *    amolecimento por tração transversal (kc2 = 1) — isso é o Nível 3;
 *  - armadura = barras de treliça sobre arestas da malha, ADERÊNCIA PERFEITA (só para teste de equilíbrio
 *    e capacidade; não é modelo de projeto);
 *  - solução por rigidez secante com correção pelo resíduo e controle de carga com bissecção.
 * Unidades: kN e m (tensões em kN/m²).
 */

export interface ConcreteLaw {
  /** resistência de projeto à compressão no patamar [kN/m²] */
  fc: number;
  /** deformação ao início do patamar (0,002) */
  eps0: number;
  /** deformação última na compressão (0,0035) — usada como limite de verificação */
  epsu: number;
}

/** Parábola-retângulo da NBR 6118/EC2: fc = 0,85·fck/γc (fck ≤ 50 MPa), εc2 = 2 ‰, εcu = 3,5 ‰. */
export const nbrConcrete = (fckMPa: number, gammaC = 1.4): ConcreteLaw => ({
  fc: (0.85 * fckMPa * 1000) / gammaC, eps0: 0.002, epsu: 0.0035,
});

export interface SteelLaw {
  /** tensão de escoamento [kN/m²] (1 MPa = 1e3 kN/m²) */
  fy: number;
  /** tensão última na ruptura [kN/m²] */
  ft: number;
  /** módulo de elasticidade do aço [kN/m²] (1 GPa = 1e6 kN/m²) */
  Es: number;
  /** tension stiffening simplificado (interno): comportamento médio da barra na tração, ver `withTensionStiffening` */
  ts?: { sigCr: number; epsCr: number; delta: number; epsU0: number };
  /** deformação na ruptura (fração adimensional, ex.: 0,05 = 5 %) */
  epsU: number;
}

/** Aço CA-50 com valores de projeto em unidades do solver [kN/m²]: fyd = 500/1,15 MPa, ft = 1,08·fy, Es = 210 GPa, εu = 5 %. */
export const ca50: SteelLaw = { fy: 500e3 / 1.15, ft: 1.08 * (500e3 / 1.15), Es: 210e6, epsU: 0.05 };

/**
 * Classes de aço passivo em unidades de entrada da cena (`BarSpec`):
 *  - `fy` e `ft` em **MPa** (valores de PROJETO: fyd = fyk/1,15);
 *  - `Es` em **GPa**;
 *  - `epsU` adimensional (fração).
 * A conversão para o solver (`kN/m²`) ocorre em `barsFromScene()` (`fy/ft × 1e3`, `Es × 1e6`).
 *
 * CA-50 / CA-60: ft/fy e εu são valores ASSUMIDOS (coerentes com as classes B e A do fib MC2010) — confirmar na NBR 7480.
 */
export const STEEL_CLASSES = {
  CA50: { label: "CA-50", fy: 500 / 1.15, ft: (1.08 * 500) / 1.15, Es: 210, epsU: 0.05 },
  CA60: { label: "CA-60", fy: 600 / 1.15, ft: (1.05 * 600) / 1.15, Es: 210, epsU: 0.025 },
  /** aço europeu B500B: ft/fy = 1,08 e εu = 5 % (livro do CSFM, p. 22); γs = 1,15 e Es = 200 GPa conferidos no fib MC2010 (Bol. 65, Tab. 4.5-8 e p. 186; fonte secundária para EC2) */
  B500B: { label: "B500B", fy: 500 / 1.15, ft: (1.08 * 500) / 1.15, Es: 200, epsU: 0.05 },
} as const;
export type SteelClass = keyof typeof STEEL_CLASSES;

export interface Bar {
  /** extremidades em coordenadas da cena; a barra precisa ser horizontal ou vertical e estar sobre linhas da malha */
  x0: number; y0: number; x1: number; y1: number;
  /** área total da armadura [m²] */
  area: number;
  steel: SteelLaw;
  label?: string;
  /**
   * Poligonal da barra em coordenadas da cena. Se existir, a barra é EMBUTIDA (aderência perfeita, qualquer direção,
   * sem GDLs próprios): a deformação axial da barra é a do concreto na sua direção, avaliada em trechos de h/4.
   * Sem `path`, a barra tem de ser horizontal/vertical sobre linhas da malha (elementos de treliça).
   */
  path?: [number, number][];
  /** polilinhas adicionais com a mesma área e aço (grupo de barras iguais, p. ex. estribos); só vale com `path` */
  more?: [number, number][][];
}

export interface NlOptions {
  concrete: ConcreteLaw;
  bars?: Bar[];
  /** origem da malha na cena (BuildResult.origin); padrão (0,0) */
  origin?: { x: number; y: number };
  /** verifica |ε3| ≥ epsu no concreto como critério de ruptura (padrão: sim) */
  checkCrushing?: boolean;
  /**
   * comprimento de esmagamento [m]: se informado, o critério |ε3| ≥ epsu usa a deformação de compressão MÉDIA numa janela
   * desse comprimento (como recomenda o livro do CSFM), em vez do valor em cada ponto — evita parada precoce por picos
   * locais sob placas (dependência de malha).
   */
  crushLength?: number;
  /** usa a janela antiga (raio = round(lc/2h), dividida pela área total incluindo vazios) — só para comparação */
  crushLegacy?: boolean;
  /** passo inicial de carga, em múltiplos da carga de referência (padrão 0,1) */
  dLambda?: number;
  /** carga máxima, em múltiplos da carga de referência (padrão 1e4) */
  lambdaMax?: number;
  /** tolerância do resíduo relativo (padrão 1e-4) */
  tol?: number;
  /** emite um `NlStep` a cada passo convergido (uso em `solveNonlinearSteps`, p. ex. para mostrar o progresso) */
  stepwise?: boolean;
  /** busca linear: se o passo completo de correção piora o equilíbrio, testa frações (1/2, 1/4, 1/8, 1/16) e fica com a melhor (padrão: sim) */
  lineSearch?: boolean;
  /** usa a rigidez tangente (com piso) no lugar da secante; converge bem mais perto do patamar (padrão: sim) */
  tangent?: boolean;
  /** rigidez residual do concreto fissurado como fração de E0 (só na matriz; padrão 1e-4) */
  ecrRatio?: number;
  /** tolerância do 1º passo = tol × este fator (padrão 1): o 1º passo forma o padrão de fissuras e pode estagnar perto da tolerância */
  firstStepTolFactor?: number;
  /** diagnóstico: chamado a cada iteração do Newton (resíduo relativo, fração da busca linear, nº de elementos fissurados e quantos mudaram de estado) */
  trace?: (t: { lam: number; it: number; rel: number; alpha: number; cracked: number; changed: number; maxEpsC: number }) => void;
  /** amolecimento da compressão por tração transversal: kc2(ε1) multiplica fc (e kc2·ε0 no pico); true usa `kc2Provisional` */
  kc2?: boolean | ((eps1: number) => number);
  /** elemento do concreto: "q4" (padrão) ou "qm6" (EXPERIMENTAL: passa na compressão uniaxial, mas diverge no S1 fissurado; ver docs) */
  element?: "q4" | "qm6";
  /** placas de apoio/carga elásticas (aço): a fileira de elementos sob cada trecho carregado ou apoiado deixa de ser concreto (E na mesma unidade da tensão do concreto) */
  plates?: { E: number; nu?: number };
  /** tension stiffening simplificado em todas as barras: resistência à tração do concreto fct [kN/m²] e taxa efetiva ρeff (ver `withTensionStiffening`) */
  tensionStiffening?: { fct: number; rhoEff: number };
  maxIt?: number;
}

export type NlMode = "CC" | "FR" | "divergencia" | "lambdaMax";

export interface NlBarResult {
  label: string; axialMax: number; strainMax: number; yielded: boolean;
  /** fator de carga λ em que a barra passou a escoar (null = não escoou) */
  yieldLambda: number | null;
  /** posição (cena, m) do trecho com a maior força axial no estado último */
  maxAt: { x: number; y: number } | null;
  /** a barra atingiu o limite εu (a falha ocorre no passo seguinte ao último em equilíbrio) */
  ruptured: boolean;
}

/** onde e quanto o concreto está esmagando (critério de esmagamento por média numa janela) */
export interface CrushInfo {
  /** deformação de compressão do critério (média na janela) e o limite εcu */
  strain: number; limit: number; ratio: number;
  /** centro da janela crítica [m, cena] e seu retângulo */
  x: number; y: number;
  window: { x0: number; y0: number; x1: number; y1: number };
  /** elemento de maior compressão pontual e seu valor */
  peak: { x: number; y: number; strain: number };
}

/** resumo do fim da análise: o que falhou, onde e com que carga */
export interface NlFailure {
  mode: NlMode;
  /** λ da última carga em equilíbrio (limite inferior da falha) */
  lambda: number;
  /** concreto: janela crítica no estado que violou o critério (modo CC) */
  crush: CrushInfo | null;
  /** barra que atingiu εu (modo FR) */
  bar: { label: string; at: { x: number; y: number } | null } | null;
}

export interface NlResult {
  /** fator de carga último (múltiplo da carga de referência do Problem) */
  lambda: number;
  mode: NlMode;
  u: Float64Array;
  bars: NlBarResult[];
  /** maior encurtamento principal no concreto [‰ como fração] */
  maxCompStrain: number;
  /** equilíbrio global: |ΣR + ΣF| / |ΣF| em x e y */
  equilibrium: { x: number; y: number };
  steps: { lambda: number; its: number; rel: number }[];
  /** reação por GDL [kN] (R = fint − λ·fRaw nos GDLs restringidos; zero nos demais) */
  reaction: Float64Array;
  /** forças axiais [kN] por elemento de barra no estado último, na ordem das barras */
  barForces: Float64Array[];
  /** encurtamento principal médio por elemento (compressão, valor positivo) */
  epsComp: Float64Array;
  /** deformação principal de tração média por elemento (> 0 ⇒ concreto fissurado) */
  epsTens: Float64Array;
  /** pontos de amostra das barras com a força axial [kN] (para desenho) */
  barSamples: { x: number; y: number; N: number }[][];
  /** deformação de compressão usada no critério de esmagamento (média na janela, se `crushLength`) */
  crushStrain: number;
  /** tensões médias do concreto por elemento [σx, σy, τxy] em kN/m², 3 valores por elemento */
  stress: Float64Array;
  /** avisos (p. ex. trechos de barra ligados ao elemento vizinho numa malha grossa) */
  notes: string[];
  /** janela crítica de esmagamento no último estado em equilíbrio */
  crush: CrushInfo;
  /** o que falhou e onde */
  failure: NlFailure;
  /** primeiro passo em que o concreto passou de 95 % de ε0 (início do patamar) */
  firstPlateau: { lambda: number; step: number } | null;
  /** iterações totais de equilíbrio e avaliações extras da busca linear (diagnóstico de desempenho) */
  work: { iterations: number; lineSearchTrials: number };
}

/** estado de um passo de carga convergido (só emitido com `stepwise: true`) */
export interface NlStep {
  lambda: number; its: number;
  u: Float64Array; epsComp: Float64Array; epsTens: Float64Array;
  barSamples: { x: number; y: number; N: number }[][];
  maxEpsC: number; crushStrain: number; notes: string[]; stress: Float64Array;
  crush: CrushInfo;
}

interface BarEl { a: number; b: number; cx: number; cy: number; bar: number }

const GP = 1 / Math.sqrt(3);
const XI = [-1, 1, 1, -1], ETA = [-1, -1, 1, 1];

/**
 * kc2 PROVISÓRIO (compression softening por tração transversal ε1, Kaufmann et al., 2020, Fig. 3.1e, p. 16: só há gráfico no livro).
 * Leitura aproximada do gráfico: kc2 = 1 até ε1 = 1 ‰; reta até (6 ‰; 0,65); depois a forma do MC2010 final,
 * 1/(1,2 + 55·ε1), que coincide visualmente com a curva do livro (NÃO verificada em fonte). Não substitui a fonte.
 */
export function kc2Provisional(eps1: number): number {
  if (eps1 <= 0.001) return 1;
  if (eps1 <= 0.006) return 1 - ((eps1 - 0.001) / 0.005) * 0.35;
  return 1 / (1.2 + 55 * eps1);
}

function concreteSigma(c: ConcreteLaw, e: number) {
  if (e <= c.eps0) { const r = 1 - e / c.eps0; return c.fc * (1 - r * r); }
  return c.fc;
}

/**
 * Tension stiffening SIMPLIFICADO (Modelo da Corda Tracionada, fissuração estabilizada; Kaufmann et al., 2020, Eq. 3.2–3.3, p. 20):
 * a barra passa a ter a lei média σsr(εm), com σsr a tensão na fissura (a que define a força). Trecho ε ≤ σy usa a Eq. 3.3 (1ª linha):
 * εm = (σsr − Δ)/Es, Δ = λ·fct·(1−ρeff)/(2·ρeff), λ = 0,67. Antes da fissuração: reta da origem a (εcr, σcr = fct(1−ρeff)/ρeff).
 * Depois do escoamento: ramo de endurecimento do aço nu deslocado de Δ/Es (aproximação NOSSA, não é a Eq. 3.3 completa), o que
 * reduz a ductilidade (εu efetivo = εu − Δ/Es). fct e ρeff vêm do usuário; ρeff real depende da geometria (Fig. 3.3 do livro).
 */
export function withTensionStiffening(s: SteelLaw, fct: number, rhoEff: number, lambda = 0.67): SteelLaw {
  if (!(rhoEff > 0 && rhoEff < 1)) throw new Error(`withTensionStiffening: rhoEff inválido (${rhoEff}); esperado 0 < rhoEff < 1`);
  if (!(fct >= 0)) throw new Error(`withTensionStiffening: fct inválido (${fct}); esperado fct >= 0`);
  const sigCr0 = (fct * (1 - rhoEff)) / rhoEff;
  const sigCr = Math.min(sigCr0, 0.9 * s.fy), delta = (lambda / 2) * sigCr;
  const epsCr = (sigCr - delta) / s.Es;
  return { ...s, epsU: s.epsU - delta / s.Es, ts: { sigCr, epsCr, delta, epsU0: s.epsU } };
}

/**
 * Resolve A·X = B (A n×n, B n×m, ambos em linhas) por eliminação com pivô parcial; B vira X.
 * Retorna `false` se algum pivô for nulo/quase nulo (≤ 1e-300) ou não finito, sem mascarar a singularidade.
 */
function luSolve(A: Float64Array, n: number, B: Float64Array, m: number): boolean {
  for (let k = 0; k < n; k++) {
    let piv = k;
    for (let r = k + 1; r < n; r++) if (Math.abs(A[r * n + k]) > Math.abs(A[piv * n + k])) piv = r;
    if (!(Math.abs(A[piv * n + k]) > 1e-300)) return false;
    if (piv !== k) {
      for (let c = 0; c < n; c++) { const t = A[k * n + c]; A[k * n + c] = A[piv * n + c]; A[piv * n + c] = t; }
      for (let c = 0; c < m; c++) { const t = B[k * m + c]; B[k * m + c] = B[piv * m + c]; B[piv * m + c] = t; }
    }
    for (let r = k + 1; r < n; r++) {
      const f = A[r * n + k] / A[k * n + k];
      for (let c = k; c < n; c++) A[r * n + c] -= f * A[k * n + c];
      for (let c = 0; c < m; c++) B[r * m + c] -= f * B[k * m + c];
    }
  }
  for (let k = n - 1; k >= 0; k--) for (let c = 0; c < m; c++) {
    let acc = B[k * m + c];
    for (let j = k + 1; j < n; j++) acc -= A[k * n + j] * B[j * m + c];
    B[k * m + c] = acc / A[k * n + k];
  }
  return true;
}

function steelSigma(s: SteelLaw, eps: number) {
  if (s.ts && eps > 0) {
    const { sigCr, epsCr, delta, epsU0 } = s.ts, ey = s.fy / s.Es, Esh = (s.ft - s.fy) / Math.max(epsU0 - ey, 1e-12);
    if (eps <= epsCr) return (sigCr * eps) / epsCr;
    const epsYm = (s.fy - delta) / s.Es;
    if (eps <= epsYm) return delta + s.Es * eps;
    return s.fy + Esh * (Math.min(eps, s.epsU) + delta / s.Es - ey);
  }
  const a = Math.abs(eps), ey = s.fy / s.Es, sg = Math.sign(eps);
  if (a <= ey) return s.Es * eps;
  const Esh = (s.ft - s.fy) / Math.max(s.epsU - ey, 1e-12);
  return sg * (s.fy + Esh * (Math.min(a, s.epsU) - ey));
}


/** maior média de `v` (campo por elemento nelx×nely, índice i*nely+j) numa janela quadrada de raio R elementos */
function windowMax(v: Float64Array, nelx: number, nely: number, R: number): number {
  if (R <= 0) return v.reduce((m, x) => Math.max(m, x), 0);
  const W = nelx + 1, H = nely + 1, S = new Float64Array(W * H); // soma acumulada
  for (let i = 0; i < nelx; i++) for (let j = 0; j < nely; j++) S[(i + 1) * H + (j + 1)] = v[i * nely + j] + S[i * H + (j + 1)] + S[(i + 1) * H + j] - S[i * H + j];
  let best = 0;
  for (let i = 0; i < nelx; i++) for (let j = 0; j < nely; j++) {
    if (v[i * nely + j] === 0) continue;
    // janela fixa (2R+1)² deslocada para caber na malha, dividida pela área inteira (elementos vazios contam zero)
    const i0 = Math.max(0, Math.min(nelx - (2 * R + 1), i - R)), j0 = Math.max(0, Math.min(nely - (2 * R + 1), j - R));
    const i1 = Math.min(nelx, i0 + 2 * R + 1), j1 = Math.min(nely, j0 + 2 * R + 1);
    const sum = S[i1 * H + j1] - S[i0 * H + j1] - S[i1 * H + j0] + S[i0 * H + j0];
    best = Math.max(best, sum / ((2 * R + 1) * (2 * R + 1)));
  }
  return best;
}

/**
 * Maior média de `v` numa janela quadrada de (2R+1)² elementos (deslocada para caber na malha), dividida pelo número de
 * elementos de CONCRETO dentro da janela — vazios fora da peça não diluem a média nas bordas.
 */
function windowArgMasked(v: Float64Array, mask: Uint8Array, nelx: number, nely: number, R: number): { best: number; e: number; i0: number; j0: number; i1: number; j1: number } {
  let be = 0;
  for (let e = 1; e < v.length; e++) if (v[e] > v[be]) be = e;
  if (R <= 0) return { best: v[be], e: be, i0: Math.floor(be / nely), j0: be % nely, i1: Math.floor(be / nely) + 1, j1: (be % nely) + 1 };
  const W = nelx + 1, H = nely + 1, S = new Float64Array(W * H), M = new Float64Array(W * H);
  for (let i = 0; i < nelx; i++) for (let j = 0; j < nely; j++) {
    const k = (i + 1) * H + (j + 1), e = i * nely + j;
    S[k] = v[e] + S[i * H + (j + 1)] + S[(i + 1) * H + j] - S[i * H + j];
    M[k] = (mask[e] !== 0 ? 1 : 0) + M[i * H + (j + 1)] + M[(i + 1) * H + j] - M[i * H + j];
  }
  let best = 0, bi = 0, bj = 0, bi0 = 0, bj0 = 0, bi1 = 0, bj1 = 0;
  const n = 2 * R + 1;
  for (let i = 0; i < nelx; i++) for (let j = 0; j < nely; j++) {
    if (v[i * nely + j] === 0) continue;
    const i0 = Math.max(0, Math.min(nelx - n, i - R)), j0 = Math.max(0, Math.min(nely - n, j - R));
    const i1 = Math.min(nelx, i0 + n), j1 = Math.min(nely, j0 + n);
    const sum = S[i1 * H + j1] - S[i0 * H + j1] - S[i1 * H + j0] + S[i0 * H + j0];
    const cnt = M[i1 * H + j1] - M[i0 * H + j1] - M[i1 * H + j0] + M[i0 * H + j0];
    if (cnt > 0 && sum / cnt > best) { best = sum / cnt; bi = i; bj = j; bi0 = i0; bj0 = j0; bi1 = i1; bj1 = j1; }
  }
  return { best, e: bi * nely + bj, i0: bi0, j0: bj0, i1: bi1, j1: bj1 };
}

function windowMaxMasked(v: Float64Array, mask: Uint8Array, nelx: number, nely: number, R: number): number {
  return windowArgMasked(v, mask, nelx, nely, R).best;
}

function steelTangent(s: SteelLaw, eps: number) {
  if (s.ts && eps > 0) {
    const { sigCr, epsCr, delta, epsU0 } = s.ts, ey = s.fy / s.Es;
    if (eps <= epsCr) return sigCr / epsCr;
    if (eps <= (s.fy - delta) / s.Es) return s.Es;
    return Math.max((s.ft - s.fy) / Math.max(epsU0 - ey, 1e-12), 1e-3 * s.Es);
  }
  const ey = s.fy / s.Es;
  if (Math.abs(eps) <= ey) return s.Es;
  return Math.max((s.ft - s.fy) / Math.max(s.epsU - ey, 1e-12), 1e-3 * s.Es);
}

export function* solveNonlinearSteps(p: Problem, opt: NlOptions): Generator<NlStep, NlResult> {
  const { nelx, nely, h, t } = p;
  const m = buildModel(p);
  const { ndof, edof } = m;
  const c = opt.concrete;
  const ts = opt.tensionStiffening;
  const bars = (opt.bars ?? []).map((b) => (ts ? { ...b, steel: withTensionStiffening(b.steel, ts.fct, ts.rhoEff) } : b));
  const origin = opt.origin ?? { x: 0, y: 0 };
  const tol = opt.tol ?? 1e-4, maxIt = opt.maxIt ?? 150;
  const check = opt.checkCrushing ?? true;
  const E0 = (2 * c.fc) / c.eps0, Ecr = (opt.ecrRatio ?? 1e-4) * E0;
  const useTan = opt.tangent ?? true;
  const Efloor = 1e-3 * E0;

  // ---- barras → elementos de treliça sobre arestas da malha
  const nodeId = (i: number, j: number) => i * (nely + 1) + j;
  const barEls: BarEl[] = [];
  bars.forEach((bar, k) => {
    if (bar.path || bar.more) return;
    const ci = (x: number) => Math.round((x - origin.x) / h), cj = (y: number) => nely - Math.round((y - origin.y) / h);
    const i0 = ci(bar.x0), i1 = ci(bar.x1), j0 = cj(bar.y0), j1 = cj(bar.y1);
    const onGrid = Math.abs(origin.x + i0 * h - bar.x0) < 1e-6 && Math.abs(origin.x + i1 * h - bar.x1) < 1e-6
      && Math.abs(origin.y + (nely - j0) * h - bar.y0) < 1e-6 && Math.abs(origin.y + (nely - j1) * h - bar.y1) < 1e-6;
    if (!onGrid || (i0 !== i1 && j0 !== j1)) throw new Error(`barra ${bar.label ?? k}: precisa ser horizontal ou vertical e estar sobre linhas da malha`);
    if (i0 !== i1) {
      const [a, b] = i0 < i1 ? [i0, i1] : [i1, i0];
      for (let i = a; i < b; i++) barEls.push({ a: nodeId(i, j0), b: nodeId(i + 1, j0), cx: 1, cy: 0, bar: k });
    } else {
      const [a, b] = j0 > j1 ? [j0, j1] : [j1, j0]; // j cresce para baixo: de baixo (j grande) para cima
      for (let j = a; j > b; j--) barEls.push({ a: nodeId(i0, j), b: nodeId(i0, j - 1), cx: 0, cy: 1, bar: k });
    }
  });

  // ---- barras embutidas: trechos de ~h/4 com o vetor g (ε_axial = g·u_e) do elemento que contém o ponto médio
  interface Piece { e: number; g: Float64Array; len: number; bar: number; xm: number; ym: number }
  const pieces: Piece[] = [];
  let projected = 0; // trechos cujo elemento natural é vazio (malha grossa) e foram ligados ao elemento de concreto vizinho
  bars.forEach((bar, k) => {
    if (!bar.path) return;
    for (const path of [bar.path, ...(bar.more ?? [])]) for (let q = 0; q + 1 < path.length; q++) {
      const [xa, ya] = path[q], [xb, yb] = path[q + 1];
      const L = Math.hypot(xb - xa, yb - ya);
      if (L < 1e-9) continue;
      const n = Math.max(1, Math.ceil(L / (h / 4))), len = L / n, cs = (xb - xa) / L, sn = (yb - ya) / L;
      const m0 = cs * cs, m1 = sn * sn, m2 = cs * sn;
      for (let r = 0; r < n; r++) {
        const x = xa + ((r + 0.5) / n) * (xb - xa) - origin.x, y = ya + ((r + 0.5) / n) * (yb - ya) - origin.y;
        const ie = Math.min(nelx - 1, Math.max(0, Math.floor(x / h))), jy = Math.min(nely - 1, Math.max(0, Math.floor(y / h)));
        let iu = ie, ju = jy; // coluna e linha (de baixo para cima) do elemento hospedeiro
        if (p.mask[ie * nely + (nely - 1 - jy)] === 0) {
          // o contorno inclinado vira "escada" na malha: o elemento que contém o ponto pode ser vazio mesmo com a barra dentro
          // da peça. Usa o elemento de concreto mais próximo (até 3 elementos) e prende as coordenadas locais ao elemento.
          let best = Infinity;
          for (let di = -3; di <= 3; di++) for (let dj = -3; dj <= 3; dj++) {
            const ci = ie + di, cj = jy + dj;
            if (ci < 0 || cj < 0 || ci >= nelx || cj >= nely || p.mask[ci * nely + (nely - 1 - cj)] === 0) continue;
            const dx = Math.max(ci * h - x, 0, x - (ci + 1) * h), dy = Math.max(cj * h - y, 0, y - (cj + 1) * h), d = dx * dx + dy * dy;
            if (d < best) { best = d; iu = ci; ju = cj; }
          }
          if (best === Infinity) throw new Error(`barra ${bar.label ?? k}: trecho fora da geometria em (${(x + origin.x).toFixed(3)}, ${(y + origin.y).toFixed(3)}); refine a malha (elemento menor)`);
          projected++;
        }
        const e = iu * nely + (nely - 1 - ju);
        const clamp = (v: number) => Math.max(-1, Math.min(1, v));
        const xi = clamp(2 * (x - iu * h) / h - 1), eta = clamp(2 * (y - ju * h) / h - 1);
        const g = new Float64Array(8);
        for (let a = 0; a < 4; a++) {
          const dnx = (XI[a] * (1 + ETA[a] * eta)) / (2 * h), dny = (ETA[a] * (1 + XI[a] * xi)) / (2 * h);
          g[2 * a] = m0 * dnx + m2 * dny;
          g[2 * a + 1] = m1 * dny + m2 * dnx;
        }
        pieces.push({ e, g, len, bar: k, xm: x + origin.x, ym: y + origin.y });
      }
    }
  });

  const notes: string[] = projected ? [`${projected} trechos de barra caíram em elementos vazios (malha grossa) e foram ligados ao elemento de concreto vizinho; refine a malha para mais precisão.`] : [];

  // posição de cada amostra de força, na mesma ordem em que `assemble` empilha as forças de cada barra
  const nodeXY = (n: number): [number, number] => [origin.x + Math.floor(n / (nely + 1)) * h, origin.y + (nely - (n % (nely + 1))) * h];
  const samplePos: [number, number][][] = bars.map(() => []);
  for (const be of barEls) { const a = nodeXY(be.a), b = nodeXY(be.b); samplePos[be.bar].push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]); }
  for (const pc of pieces) samplePos[pc.bar].push([pc.xm, pc.ym]);
  const samplesOf = (a: { barForces: Float64Array[] }) => bars.map((_, k) => Array.from(a.barForces[k], (N, q) => ({ x: samplePos[k][q][0], y: samplePos[k][q][1], N })));
  // janela física: n = 2R+1 elementos com n·h ≈ lc (a versão antiga usava R = round(lc/2h), isto é, n·h ≈ lc + h, e dividia pela área total)
  const crushWin = (eps: Float64Array) => opt.crushLegacy
    ? windowMax(eps, nelx, nely, Math.max(0, Math.round((opt.crushLength ?? 0) / (2 * h))))
    : windowMaxMasked(eps, cmask, nelx, nely, Math.max(0, Math.round(((opt.crushLength ?? 0) / h - 1) / 2)));
  const crushOf = (a: { epsEl: Float64Array; maxEpsC: number }) => (opt.crushLength ? crushWin(a.epsEl) : a.maxEpsC);
  const rCrush = Math.max(0, Math.round(((opt.crushLength ?? 0) / h - 1) / 2));
  const elXY = (e: number) => ({ x: origin.x + (Math.floor(e / nely) + 0.5) * h, y: origin.y + (nely - (e % nely) - 0.5) * h });
  /** detalhes da janela crítica de esmagamento para um campo de compressão por elemento */
  const crushDetail = (eps: Float64Array): CrushInfo => {
    const w = windowArgMasked(eps, cmask, nelx, nely, rCrush);
    let pe = 0;
    for (let e = 1; e < eps.length; e++) if (eps[e] > eps[pe]) pe = e;
    const x0 = origin.x + w.i0 * h, x1 = origin.x + w.i1 * h, y1 = origin.y + (nely - w.j0) * h, y0 = origin.y + (nely - w.j1) * h;
    return { strain: w.best, limit: c.epsu, ratio: w.best / c.epsu, x: (x0 + x1) / 2, y: (y0 + y1) / 2, window: { x0, y0, x1, y1 }, peak: { ...elXY(pe), strain: eps[pe] } };
  };

  // GDLs sem rigidez (só tocam vazios) viram restrições
  const used = new Uint8Array(ndof);
  for (let e = 0; e < nelx * nely; e++) if (p.mask[e] !== 0) for (let a = 0; a < 8; a++) used[edof[e * 8 + a]] = 1;
  for (const be of barEls) for (const n of [be.a, be.b]) { used[2 * n] = 1; used[2 * n + 1] = 1; }
  const fixedEff = new Uint8Array(ndof);
  for (let d = 0; d < ndof; d++) fixedEff[d] = m.isFixed[d] || !used[d] ? 1 : 0;

  // ---- placas elásticas: elementos com ≥ 2 nós carregados/apoiados (a fileira diretamente sob o trecho de contato)
  const plateEl = new Uint8Array(nelx * nely);
  let nPlates = 0;
  const cmask = Uint8Array.from(p.mask); // máscara de concreto (placas ficam de fora da janela de esmagamento)
  let KEplate: Float64Array | null = null;
  if (opt.plates) {
    const contact = new Uint8Array((nelx + 1) * (nely + 1));
    for (const l of p.loads) contact[l.node] = 1;
    for (const d of p.fixed) contact[d >> 1] = 1;
    for (let e = 0; e < nelx * nely; e++) {
      if (p.mask[e] === 0) continue;
      const i = Math.floor(e / nely), j = e % nely;
      const cnt = contact[i * (nely + 1) + j] + contact[i * (nely + 1) + j + 1] + contact[(i + 1) * (nely + 1) + j] + contact[(i + 1) * (nely + 1) + j + 1];
      if (cnt >= 2) { plateEl[e] = 1; cmask[e] = 0; nPlates++; }
    }
    notes.push(`${nPlates} elementos de placa de aço (E = ${opt.plates.E.toExponential(1)}) sob cargas e apoios`);
    KEplate = elementStiffness(opt.plates.nu ?? 0.3).map((v) => v * opt.plates!.E * t);
  }

  const bw = 2 * nely + 5, w = bw + 1;
  const dV = (h / 2) * (h / 2) * t;
  const fRef = m.f;

  // pré-cálculo das derivadas das funções de forma nos 4 pontos de Gauss
  const dNx = new Float64Array(16), dNy = new Float64Array(16);
  for (let g = 0; g < 4; g++) {
    const xi = (g & 1 ? 1 : -1) * GP, eta = (g & 2 ? 1 : -1) * GP;
    for (let a = 0; a < 4; a++) {
      dNx[g * 4 + a] = (XI[a] * (1 + ETA[a] * eta)) / (2 * h);
      dNy[g * 4 + a] = (ETA[a] * (1 + XI[a] * xi)) / (2 * h);
    }
  }

  interface Asm { L: Float64Array; fint: Float64Array; maxEpsC: number; epsEl: Float64Array; epsT: Float64Array; sEl: Float64Array; barForces: Float64Array[]; barEps: number[]; yielded: boolean[]; singular: boolean }

  let maxEpsC = 0, epsEl = new Float64Array(0), epsT = new Float64Array(0), sEl = new Float64Array(0);
  const useQM6 = (opt.element ?? "q4") === "qm6";
  const alpha = new Float64Array(nelx * nely * 4);
  const Dm = new Float64Array(9);
  let sxm = 0, sym = 0, txm = 0;
  const kc2fn = opt.kc2 === true ? kc2Provisional : typeof opt.kc2 === "function" ? opt.kc2 : null;
  let secantOnly = false; // QM6: o laço local dos modos usa a rigidez secante (positiva e consistente com a lei), mais robusta que a tangente
  const epsU3 = new Float64Array(12), fa = new Float64Array(4), Kaa = new Float64Array(16), rhs4 = new Float64Array(4);
  const Kuu = new Float64Array(64), Kua = new Float64Array(32), Xm = new Float64Array(32), DBa = new Float64Array(12);
  // Ba (3×4) nos 4 pontos de Gauss: modos φ1 = ξ²−1 e φ2 = η²−1 para u (a1, a2) e v (a3, a4); lado h → fator 2/h
  const baG = new Float64Array(48);
  for (let g = 0; g < 4; g++) {
    const xi = (g & 1 ? 1 : -1) * GP, eta = (g & 2 ? 1 : -1) * GP, f = 2 / h;
    baG[g * 12 + 0] = f * 2 * xi;          // εx  ← a1
    baG[g * 12 + 4 + 3] = f * 2 * eta;     // εy  ← a4
    baG[g * 12 + 8 + 1] = f * 2 * eta;     // γxy ← a2
    baG[g * 12 + 8 + 2] = f * 2 * xi;      // γxy ← a3
  }
  /** lei do concreto num ponto de Gauss: deixa σ em (sxm, sym, txm) e D em Dm; book = true acumula os campos por elemento */
  const material = (ex: number, ey: number, gm: number, e: number, book: boolean) => {
    const avg = 0.5 * (ex + ey), rad = Math.hypot(0.5 * (ex - ey), 0.5 * gm);
    const e1 = avg + rad, e3 = avg - rad;
    if (book && e1 > 0) epsT[e] += e1 / 4;
    const th = 0.5 * Math.atan2(gm, ex - ey), cs = Math.cos(th), sn = Math.sin(th);
    const fresh = rad < 1e-14 && Math.abs(avg) < 1e-14;
    let s1 = 0, s3 = 0, E1 = Ecr, E3 = Ecr, kk = 1;
    if (fresh) { E1 = E3 = E0; }
    else {
      if (e1 < 0) { s1 = -concreteSigma(c, -e1); E1 = s1 / e1; }
      if (e3 < 0) {
        kk = kc2fn && e1 > 0 ? kc2fn(e1) : 1;
        s3 = -concreteSigma(kk < 1 ? { fc: c.fc * kk, eps0: c.eps0 * kk, epsu: c.epsu } : c, -e3); E3 = s3 / e3;
      }
      if (book && e3 < 0) { maxEpsC = Math.max(maxEpsC, -e3); epsEl[e] += -e3 / 4; }
    }
    const G = rad > 1e-12 ? (s1 - s3) / (2 * (e1 - e3)) : 0.25 * (E1 + E3);
    if (useTan && !secantOnly && !fresh) {
      if (e1 < 0) E1 = Math.max(Efloor, -e1 < c.eps0 ? E0 * (1 + e1 / c.eps0) : 0);
      if (e3 < 0) E3 = Math.max(Efloor, -e3 < c.eps0 * kk ? E0 * (1 + e3 / (c.eps0 * kk)) : 0);
    }
    const Gs = Math.max(G, 1e-6 * E0);
    sxm = s1 * cs * cs + s3 * sn * sn; sym = s1 * sn * sn + s3 * cs * cs; txm = (s1 - s3) * sn * cs;
    const sc = sn * cs, c2 = cs * cs, s2 = sn * sn;
    if (book) { sEl[3 * e] += sxm / 4; sEl[3 * e + 1] += sym / 4; sEl[3 * e + 2] += txm / 4; }
    const r1 = [c2, s2, sc], r3 = [s2, c2, -sc], rg = [-2 * sc, 2 * sc, c2 - s2];
    for (let r = 0; r < 3; r++) for (let q = 0; q < 3; q++) Dm[r * 3 + q] = E1 * r1[r] * r1[q] + E3 * r3[r] * r3[q] + Gs * rg[r] * rg[q];
  };

  const NOMAT = new Float64Array(0);
  /** needK = false: só forças internas e indicadores (para testar passos da busca linear, sem montar a matriz) */
  const assemble = (u: Float64Array, needK = true): Asm => {
    const L = needK ? new Float64Array(ndof * w) : NOMAT;
    const fint = new Float64Array(ndof);
    let singular = false;
    maxEpsC = 0; epsEl = new Float64Array(nelx * nely); epsT = new Float64Array(nelx * nely); sEl = new Float64Array(3 * nelx * nely);
    const ue = new Float64Array(8), Ke = new Float64Array(64), B = new Float64Array(24), DB = new Float64Array(24), fe = new Float64Array(8);
    for (let e = 0; e < nelx * nely; e++) {
      if (p.mask[e] === 0) continue;
      const b0 = e * 8;
      for (let a = 0; a < 8; a++) ue[a] = u[edof[b0 + a]];
      Ke.fill(0); fe.fill(0);
      if (plateEl[e]) {
        // placa de aço linear elástica
        for (let r = 0; r < 8; r++) { let acc = 0; for (let q = 0; q < 8; q++) acc += KEplate![r * 8 + q] * ue[q]; fe[r] = acc; }
        if (needK) Ke.set(KEplate!);
      } else if (!useQM6) for (let g = 0; g < 4; g++) {
        // Q4 compatível: deformações no ponto de Gauss
        let ex = 0, ey = 0, gm = 0;
        for (let a = 0; a < 4; a++) {
          const nx = dNx[g * 4 + a], ny = dNy[g * 4 + a], ux = ue[2 * a], uy = ue[2 * a + 1];
          ex += nx * ux; ey += ny * uy; gm += ny * ux + nx * uy;
        }
        material(ex, ey, gm, e, true);
        B.fill(0);
        for (let a = 0; a < 4; a++) {
          const nx = dNx[g * 4 + a], ny = dNy[g * 4 + a];
          B[2 * a] = nx; B[8 + 2 * a + 1] = ny; B[16 + 2 * a] = ny; B[16 + 2 * a + 1] = nx;
        }
        if (needK) for (let r = 0; r < 3; r++) for (let q = 0; q < 8; q++) DB[r * 8 + q] = Dm[r * 3] * B[q] + Dm[r * 3 + 1] * B[8 + q] + Dm[r * 3 + 2] * B[16 + q];
        for (let r = 0; r < 8; r++) {
          fe[r] += (B[r] * sxm + B[8 + r] * sym + B[16 + r] * txm) * dV;
          if (needK) for (let q = 0; q < 8; q++) Ke[r * 8 + q] += (B[r] * DB[q] + B[8 + r] * DB[8 + q] + B[16 + r] * DB[16 + q]) * dV;
        }
      } else {
        // QM6: 4 modos incompatíveis por elemento (α), resolvidos localmente a cada montagem (o material não tem histórico,
        // então α é função só de u) e condensados na rigidez
        for (let g = 0; g < 4; g++) {
          let ex = 0, ey = 0, gm = 0;
          for (let a = 0; a < 4; a++) {
            const nx = dNx[g * 4 + a], ny = dNy[g * 4 + a], ux = ue[2 * a], uy = ue[2 * a + 1];
            ex += nx * ux; ey += ny * uy; gm += ny * ux + nx * uy;
          }
          epsU3[3 * g] = ex; epsU3[3 * g + 1] = ey; epsU3[3 * g + 2] = gm;
        }
        const ao = e * 4;
        const strainAt = (g: number, k: number) => {
          let v = epsU3[3 * g + k];
          for (let c2 = 0; c2 < 4; c2++) v += baG[g * 12 + k * 4 + c2] * alpha[ao + c2];
          return v;
        };
        secantOnly = true;
        for (let it = 0; it < 30; it++) {
          fa.fill(0); Kaa.fill(0);
          for (let g = 0; g < 4; g++) {
            material(strainAt(g, 0), strainAt(g, 1), strainAt(g, 2), e, false);
            for (let r = 0; r < 4; r++) {
              fa[r] += (baG[g * 12 + r] * sxm + baG[g * 12 + 4 + r] * sym + baG[g * 12 + 8 + r] * txm) * dV;
              for (let q = 0; q < 4; q++) {
                let acc = 0;
                for (let i3 = 0; i3 < 3; i3++) for (let j3 = 0; j3 < 3; j3++) acc += baG[g * 12 + i3 * 4 + r] * Dm[i3 * 3 + j3] * baG[g * 12 + j3 * 4 + q];
                Kaa[r * 4 + q] += acc * dV;
              }
            }
          }
          for (let r = 0; r < 4; r++) rhs4[r] = -fa[r];
          if (!luSolve(Kaa.slice(), 4, rhs4, 1)) { singular = true; break; }
          let dm = 0;
          for (let r = 0; r < 4; r++) { alpha[ao + r] += rhs4[r]; dm = Math.max(dm, Math.abs(rhs4[r])); }
          if (dm < 1e-12) break;
        }
        secantOnly = false;
        Kuu.fill(0); Kua.fill(0); Kaa.fill(0);
        for (let g = 0; g < 4; g++) {
          material(strainAt(g, 0), strainAt(g, 1), strainAt(g, 2), e, true);
          B.fill(0);
          for (let a = 0; a < 4; a++) {
            const nx = dNx[g * 4 + a], ny = dNy[g * 4 + a];
            B[2 * a] = nx; B[8 + 2 * a + 1] = ny; B[16 + 2 * a] = ny; B[16 + 2 * a + 1] = nx;
          }
          for (let r = 0; r < 8; r++) fe[r] += (B[r] * sxm + B[8 + r] * sym + B[16 + r] * txm) * dV;
          if (!needK) continue;
          for (let r = 0; r < 3; r++) {
            for (let q = 0; q < 8; q++) DB[r * 8 + q] = Dm[r * 3] * B[q] + Dm[r * 3 + 1] * B[8 + q] + Dm[r * 3 + 2] * B[16 + q];
            for (let q = 0; q < 4; q++) DBa[r * 4 + q] = Dm[r * 3] * baG[g * 12 + q] + Dm[r * 3 + 1] * baG[g * 12 + 4 + q] + Dm[r * 3 + 2] * baG[g * 12 + 8 + q];
          }
          for (let r = 0; r < 8; r++) {
            for (let q = 0; q < 8; q++) Kuu[r * 8 + q] += (B[r] * DB[q] + B[8 + r] * DB[8 + q] + B[16 + r] * DB[16 + q]) * dV;
            for (let q = 0; q < 4; q++) Kua[r * 4 + q] += (B[r] * DBa[q] + B[8 + r] * DBa[4 + q] + B[16 + r] * DBa[8 + q]) * dV;
          }
          for (let r = 0; r < 4; r++) for (let q = 0; q < 4; q++)
            Kaa[r * 4 + q] += (baG[g * 12 + r] * DBa[q] + baG[g * 12 + 4 + r] * DBa[4 + q] + baG[g * 12 + 8 + r] * DBa[8 + q]) * dV;
        }
        if (needK) {
          // Ke = Kuu − Kua · Kaa⁻¹ · Kau (X = Kaa⁻¹ Kau, 4×8)
          for (let r = 0; r < 4; r++) for (let c2 = 0; c2 < 8; c2++) Xm[r * 8 + c2] = Kua[c2 * 4 + r];
          if (!luSolve(Kaa.slice(), 4, Xm, 8)) { singular = true; Ke.set(Kuu); }
          else for (let r = 0; r < 8; r++) for (let q = 0; q < 8; q++) {
            let acc = Kuu[r * 8 + q];
            for (let k = 0; k < 4; k++) acc -= Kua[r * 4 + k] * Xm[k * 8 + q];
            Ke[r * 8 + q] = acc;
          }
        }
      }
      for (let a = 0; a < 8; a++) {
        const i = edof[b0 + a];
        fint[i] += fe[a];
        if (!needK || fixedEff[i]) continue;
        for (let q = 0; q < 8; q++) {
          const j = edof[b0 + q];
          if (j > i || fixedEff[j]) continue;
          L[i * w + (bw - (i - j))] += Ke[a * 8 + q];
        }
      }
    }
    // barras
    const barForces = bars.map(() => new Float64Array(0));
    const perBar: number[][] = bars.map(() => []);
    const barEps = bars.map(() => 0), yielded = bars.map(() => false);
    for (const be of barEls) {
      const bar = bars[be.bar], s = bar.steel;
      const da = [2 * be.a, 2 * be.a + 1, 2 * be.b, 2 * be.b + 1];
      const eps = ((u[da[2]] - u[da[0]]) * be.cx + (u[da[3]] - u[da[1]]) * be.cy) / h;
      const sg = steelSigma(s, eps);
      const Esec = useTan ? steelTangent(s, eps) : Math.abs(eps) > 1e-12 ? Math.max(sg / eps, 1e-3 * s.Es) : s.Es;
      const k = (bar.area * Esec) / h, N = bar.area * sg;
      perBar[be.bar].push(N);
      barEps[be.bar] = Math.max(barEps[be.bar], Math.abs(eps));
      const eyT = s.ts ? (s.fy - s.ts.delta) / s.Es : s.fy / s.Es;
      if (eps > eyT || eps < -s.fy / s.Es) yielded[be.bar] = true;
      const dir = [-be.cx, -be.cy, be.cx, be.cy];
      for (let a = 0; a < 4; a++) {
        fint[da[a]] += N * dir[a];
        if (!needK || fixedEff[da[a]]) continue;
        for (let q = 0; q < 4; q++) {
          if (da[q] > da[a] || fixedEff[da[q]]) continue;
          L[da[a] * w + (bw - (da[a] - da[q]))] += k * dir[a] * dir[q];
        }
      }
    }
    for (const pc of pieces) {
      const bar = bars[pc.bar], st = bar.steel, b0 = pc.e * 8;
      let eps = 0;
      for (let a = 0; a < 8; a++) eps += pc.g[a] * u[edof[b0 + a]];
      const sg = steelSigma(st, eps);
      const Esec = useTan ? steelTangent(st, eps) : Math.abs(eps) > 1e-12 ? Math.max(sg / eps, 1e-3 * st.Es) : st.Es;
      const N = bar.area * sg, kk = bar.area * Esec * pc.len;
      perBar[pc.bar].push(N);
      barEps[pc.bar] = Math.max(barEps[pc.bar], Math.abs(eps));
      const eyT = st.ts ? (st.fy - st.ts.delta) / st.Es : st.fy / st.Es;
      if (eps > eyT || eps < -st.fy / st.Es) yielded[pc.bar] = true;
      for (let a = 0; a < 8; a++) {
        const i = edof[b0 + a];
        fint[i] += N * pc.len * pc.g[a];
        if (!needK || fixedEff[i]) continue;
        for (let q = 0; q < 8; q++) {
          const j = edof[b0 + q];
          if (j > i || fixedEff[j]) continue;
          L[i * w + (bw - (i - j))] += kk * pc.g[a] * pc.g[q];
        }
      }
    }
    perBar.forEach((arr, k) => { barForces[k] = Float64Array.from(arr); });
    return { L, fint, maxEpsC, epsEl, epsT, sEl, barForces, barEps, yielded, singular };
  };

  // ---- equilíbrio em um nível de carga: correção pelo resíduo com rigidez secante
  const rhsLam = new Float64Array(ndof), du = new Float64Array(ndof), R = new Float64Array(ndof);
  const useLS = opt.lineSearch ?? true;
  let lsTrials = 0; // total de avaliações extras de resíduo feitas pela busca linear (diagnóstico)
  const equilibrate = (lam: number, u0: Float64Array, itLimit = maxIt, tolEff = tol) => {
    let u = u0.slice();
    let nf = 0;
    for (let d = 0; d < ndof; d++) { rhsLam[d] = fixedEff[d] ? 0 : lam * fRef[d]; nf += rhsLam[d] * rhsLam[d]; }
    nf = Math.sqrt(nf) || 1;
    const resNorm = (a: { fint: Float64Array }) => {
      let n = 0;
      for (let d = 0; d < ndof; d++) { const r = fixedEff[d] ? 0 : rhsLam[d] - a.fint[d]; n += r * r; }
      return Math.sqrt(n);
    };
    let asm = assemble(u), rel = Infinity, its = 0;
    const prevCr = new Uint8Array(nelx * nely);
    for (; its < itLimit; its++) {
      if (asm.singular) return { ok: false, u, asm, rel, its };
      let nr = 0;
      for (let d = 0; d < ndof; d++) { R[d] = fixedEff[d] ? 0 : rhsLam[d] - asm.fint[d]; nr += R[d] * R[d]; }
      nr = Math.sqrt(nr);
      rel = nr / nf;
      if (rel < tolEff) return { ok: true, u, asm, rel, its };
      if (!solveBandedAssembled(asm.L, ndof, bw, fixedEff, R, du)) return { ok: false, u, asm, rel, its };
      // passo completo; com busca linear, se não reduz o resíduo tenta frações do passo e fica com a melhor
      let alphaUsed = 1;
      let uTry = u.map((v, d) => v + du[d]), bad = uTry.some((v) => !Number.isFinite(v));
      if (bad) return { ok: false, u, asm, rel, its };
      let asmTry = assemble(uTry);
      if (useLS) {
        const n1 = asmTry.singular ? Infinity : resNorm(asmTry);
        if (!(n1 < nr)) {
          let bestA = 1, bestN = n1;
          for (const a of [0.5, 0.25, 0.125, 0.0625]) {
            lsTrials++;
            const ua = u.map((v, d) => v + a * du[d]);
            const at = assemble(ua, false);
            const n = at.singular ? Infinity : resNorm(at);
            if (n < bestN) { bestN = n; bestA = a; }
            if (n < nr) break; // reduziu: basta
          }
          alphaUsed = bestA;
          if (bestA !== 1) { uTry = u.map((v, d) => v + bestA * du[d]); asmTry = assemble(uTry); }
        }
      }
      if (opt.trace) {
        let cr = 0, ch = 0;
        for (let e = 0; e < nelx * nely; e++) { const f = asmTry.epsT[e] > 1e-12 ? 1 : 0; cr += f; if (f !== prevCr[e]) { ch++; prevCr[e] = f; } }
        opt.trace({ lam, it: its, rel, alpha: alphaUsed, cracked: cr, changed: ch, maxEpsC: asmTry.maxEpsC });
      }
      u = uTry; asm = asmTry;
    }
    return { ok: false, u, asm, rel, its };
  };

  // ---- passo de carga com bissecção até o limite
  const steps: NlResult["steps"] = [];
  let lamGood = 0, uGood = new Float64Array(ndof), asmGood = assemble(uGood);
  let dl = opt.dLambda ?? 0.1;
  const lamMax = opt.lambdaMax ?? 1e4;
  let mode: NlMode = "lambdaMax";
  const dlMin = 1e-6;
  let everFailed = false;
  let firstPlateau: { lambda: number; step: number } | null = null;
  const yieldLam: (number | null)[] = bars.map(() => null);
  let failCrush: CrushInfo | null = null, failBarK = -1;
  for (let guard = 0; guard < 2000; guard++) {
    const lamTry = Math.min(lamGood + dl, lamMax);
    // o 1º passo forma todo o padrão de fissuras (independe da escala da carga, pois ft = 0) e pede muitas iterações: dar mais folga a ele
    const eq = equilibrate(lamTry, uGood, lamGood === 0 ? 4 * maxIt : maxIt, lamGood === 0 ? tol * (opt.firstStepTolFactor ?? 1) : tol);
    let failMode: NlMode | null = null;
    // classifica pelo estado (convergido ou última iteração): ruptura do aço, esmagamento ou divergência pura
    const epsCheck = opt.crushLength ? crushWin(eq.asm.epsEl) : eq.asm.maxEpsC;
    if (check && epsCheck >= c.epsu) failMode = "CC";
    for (let k = 0; k < bars.length; k++) if (eq.asm.barEps[k] >= bars[k].steel.epsU) failMode = "FR";
    // sem convergência: se o concreto chegou ao patamar (≥ 0,95·ε0) é esgotamento da resistência do concreto (CC),
    // como no livro (Tab. 4.5: "divergência por resistência do concreto atingida"); caso contrário, divergência pura
    if (!failMode && !eq.ok) failMode = eq.asm.maxEpsC >= 0.95 * c.eps0 ? "CC" : "divergencia";
    if (failMode) {
      mode = failMode; everFailed = true;
      if (failMode === "CC") failCrush = crushDetail(eq.asm.epsEl);
      if (failMode === "FR") failBarK = bars.findIndex((b, k) => eq.asm.barEps[k] >= b.steel.epsU);
      if (dl <= dlMin || dl <= 1e-3 * Math.max(lamGood, 1e-3)) break;
      dl /= 2;
      continue;
    }
    lamGood = lamTry; uGood = eq.u; asmGood = eq.asm;
    steps.push({ lambda: lamGood, its: eq.its, rel: eq.rel });
    if (!firstPlateau && asmGood.maxEpsC >= 0.95 * c.eps0) firstPlateau = { lambda: lamGood, step: steps.length };
    for (let k = 0; k < bars.length; k++) if (yieldLam[k] === null && asmGood.yielded[k]) yieldLam[k] = lamGood;
    if (opt.stepwise) yield { lambda: lamGood, its: eq.its, u: uGood.slice(), epsComp: asmGood.epsEl.slice(), epsTens: asmGood.epsT.slice(), barSamples: samplesOf(asmGood), maxEpsC: asmGood.maxEpsC, crushStrain: crushOf(asmGood), notes, stress: asmGood.sEl.slice(), crush: crushDetail(asmGood.epsEl) };
    if (lamGood >= lamMax) { mode = "lambdaMax"; break; }
    // o passo volta a crescer mesmo depois de uma falha (antes ficava preso no menor valor e esgotava o limite de passos)
    if (eq.its <= (everFailed ? 3 : 6)) dl = Math.min(dl * (everFailed ? 1.25 : 1.5), opt.dLambda ?? 0.1);
    if (guard === 1999) notes.push("limite de 2000 passos atingido antes da falha: o resultado é só um limite inferior");
  }

  const smpFinal = samplesOf(asmGood);
  const barMaxAt = (k: number): { x: number; y: number } | null => {
    let mx = -1, at: { x: number; y: number } | null = null;
    for (const q of smpFinal[k]) if (Math.abs(q.N) > mx) { mx = Math.abs(q.N); at = { x: q.x, y: q.y }; }
    return at;
  };

  // reações nos GDLs restringidos: R = fint − λ·fRaw; equilíbrio global: ΣR + λ·ΣF = 0
  let fx = 0, fy = 0, rx = 0, ry = 0;
  for (let d = 0; d < ndof; d += 2) {
    fx += lamGood * m.fRaw[d]; fy += lamGood * m.fRaw[d + 1];
    if (m.isFixed[d]) rx += asmGood.fint[d] - lamGood * m.fRaw[d];
    if (m.isFixed[d + 1]) ry += asmGood.fint[d + 1] - lamGood * m.fRaw[d + 1];
  }
  const reaction = new Float64Array(ndof);
  for (let d = 0; d < ndof; d++) if (m.isFixed[d]) reaction[d] = asmGood.fint[d] - lamGood * m.fRaw[d];
  const eqx = Math.abs(fx) > 1e-9 ? Math.abs(rx + fx) / Math.abs(fx) : Math.abs(rx);
  const eqy = Math.abs(fy) > 1e-9 ? Math.abs(ry + fy) / Math.abs(fy) : Math.abs(ry);

  return {
    lambda: lamGood, mode, u: uGood,
    bars: bars.map((b, k) => {
      const at = barMaxAt(k);
      return {
        label: b.label ?? `B${k + 1}`,
        axialMax: asmGood.barForces[k].reduce((s2, v) => Math.max(s2, Math.abs(v)), 0),
        strainMax: asmGood.barEps[k], yielded: asmGood.yielded[k],
        yieldLambda: yieldLam[k], maxAt: at, ruptured: (mode === "FR" && failBarK === k) || asmGood.barEps[k] >= b.steel.epsU,
      };
    }),
    maxCompStrain: asmGood.maxEpsC,
    equilibrium: { x: eqx, y: eqy },
    steps, barForces: asmGood.barForces, reaction,
    epsComp: asmGood.epsEl, epsTens: asmGood.epsT, barSamples: samplesOf(asmGood), crushStrain: crushOf(asmGood), notes, stress: asmGood.sEl,
    crush: crushDetail(asmGood.epsEl), firstPlateau,
    failure: {
      mode, lambda: lamGood,
      crush: mode === "CC" ? failCrush ?? crushDetail(asmGood.epsEl) : null,
      bar: mode === "FR" && failBarK >= 0 ? { label: bars[failBarK].label ?? `B${failBarK + 1}`, at: barMaxAt(failBarK) } : null,
    },
    work: { iterations: steps.reduce((a, s) => a + s.its, 0), lineSearchTrials: lsTrials },
  };
}

/** versão síncrona: roda todos os passos e devolve o resultado final */
export function solveNonlinear(p: Problem, opt: NlOptions): NlResult {
  const g = solveNonlinearSteps(p, { ...opt, stepwise: false });
  let r = g.next();
  while (!r.done) r = g.next();
  return r.value;
}

/**
 * Converte barras da cena (`BarSpec`: `areaCm2` em cm², `fy`/`ft` em MPa, `Es` em GPa, `epsU` fração)
 * para unidades do solver (`Bar`: `area` em m², `fy`/`ft`/`Es` em kN/m²). Valida positividade e coerência `εy < εu`.
 */
export function barsFromScene(s: Scene): Bar[] {
  return (s.bars ?? []).map((b, k) => {
    const tag = b.label || `B${k + 1}`;
    const ok = (v: number) => Number.isFinite(v) && v > 0;
    if (!ok(b.areaCm2) || !ok(b.fy) || !ok(b.ft) || !ok(b.Es) || !ok(b.epsU))
      throw new Error(`barra ${tag}: parâmetros inválidos (areaCm2, fy, ft, Es e epsU devem ser positivos e finitos)`);
    if (b.ft < b.fy)
      throw new Error(`barra ${tag}: ft (${b.ft} MPa) não pode ser menor que fy (${b.fy} MPa)`);
    const fy = b.fy * 1e3, ft = b.ft * 1e3, Es = b.Es * 1e6; // MPa → kN/m², GPa → kN/m²
    if (fy / Es >= b.epsU)
      throw new Error(`barra ${tag}: deformação de escoamento fy/Es (${(fy / Es * 1000).toFixed(2)} ‰) deve ser menor que εu (${(b.epsU * 1000).toFixed(2)} ‰)`);
    return {
      x0: 0, y0: 0, x1: 0, y1: 0, path: b.path, more: b.extra, area: b.areaCm2 * 1e-4, label: b.label,
      steel: { fy, ft, Es, epsU: b.epsU },
    };
  });
}

/** concreto da cena: valores médios (fc = fck) ou de projeto (fcd da norma escolhida; padrão NBR 6118: 0,85·fck/1,4) */
export function concreteFromScene(s: Scene): ConcreteLaw {
  const fck = s.fck ?? 30, nl = s.nl ?? { values: "design", epsCu: 0.0035, crushLength: 0 };
  const code = codeById(nl.code);
  return nl.values === "mean"
    ? { fc: fck * 1000, eps0: code.epsC0, epsu: nl.epsCu }
    : { fc: fcdOfCode(code, fck) * 1000, eps0: code.epsC0, epsu: nl.epsCu };
}
