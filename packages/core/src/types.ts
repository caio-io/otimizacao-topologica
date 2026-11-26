/**
 * Convenções (valem para todo o core):
 *  - Malha regular de nelx × nely elementos Q4 (estado plano de tensão), lado h [m], espessura t [m].
 *  - Coluna i (0..nelx-1) cresce para a direita; linha j (0..nely-1) cresce PARA BAIXO (como imagem).
 *  - Nó (i,j) -> id = i*(nely+1)+j. GDLs: 2*id (ux, para a direita) e 2*id+1 (uy, para CIMA).
 *    Logo, carga vertical para baixo = fy NEGATIVO.
 *  - mask: 0 = vazio (passivo, ex.: abertura), 1 = domínio de projeto, 2 = sólido passivo.
 */
export interface Problem {
  nelx: number;
  nely: number;
  /** lado do elemento [m] */
  h: number;
  /** espessura [m] */
  t: number;
  /** módulo de elasticidade de referência [kN/m²] (só escala; não afeta topologia) */
  E: number;
  nu: number;
  mask: Uint8Array;
  /** GDLs restringidos */
  fixed: number[];
  /** cargas nodais [kN] */
  loads: { node: number; fx: number; fy: number }[];
  /** elemento do MEF linear: "qm6" (padrão, Q4 com modos incompatíveis) ou "q4" (puro; reproduz os resultados anteriores ao ramo CSFM) */
  element?: "q4" | "qm6";
}

export interface SimpOptions {
  volfrac: number;
  penal: number;
  /** raio do filtro em número de elementos */
  rmin: number;
  maxIter: number;
  tol: number;
  move?: number;
}

export interface BesoOptions {
  /** fração de volume final (sobre elementos do domínio de projeto) */
  volfrac: number;
  penal: number;
  rmin: number;
  /** taxa de evolução (fração do volume removida por iteração) */
  er: number;
  /** razão máxima de reinserção de elementos por iteração (fração de nAct) */
  arMax: number;
  maxIter: number;
  /** tolerância de convergência da flexibilidade (média móvel de 5 it.) */
  tol: number;
}

export interface IterInfo {
  iter: number;
  compliance: number;
  volume: number;
  change: number;
  rho: Float64Array;
  /** deslocamentos nodais da iteração (referência viva; copie se for guardar) */
  u?: Float64Array;
  /** módulo relativo de cada elemento usado no solve que gerou `u` */
  Ee?: Float64Array;
}

export interface PrincipalField {
  /** tensões principais [kN/m²] (tração +). s1 >= s2 */
  s1: Float64Array;
  s2: Float64Array;
  /** ângulo de s1 em relação ao eixo x (y para cima) [rad] */
  theta: Float64Array;
}
