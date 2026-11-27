/**
 * Resistência de bielas segundo Borges (2022), §7 (eqs. 7.27–7.30), no formato do EC2/Schlaich:
 *   fcd = 0,85·fck/γc ;  σRd,max = k·(1 − fck/250)·fcd ;  largura da biela a = F/(t·σRd,max)
 * k = 1,0 biela comum · 0,85 nós CCT · 0,60 biela com tração transversal/sem armadura. Unidades: MPa, kN, m.
 */
export const GAMMA_C = 1.4;
export const FCK_MIN = 25;
export const K_STRUT = { biela: 1.0, nóCCT: 0.85, semReforço: 0.6 } as const;

/** fck efetivo: no mínimo 25 MPa (valores inválidos viram o mínimo) */
export const clampFck = (fck: number) => (Number.isFinite(fck) ? Math.max(FCK_MIN, fck) : FCK_MIN);

export const fcd = (fck: number, gammaC = GAMMA_C) => (0.85 * clampFck(fck)) / gammaC;

/** tensão resistente máxima de biela/nó [MPa] */
export const sigmaRdMax = (fck: number, k: number = K_STRUT.biela, gammaC = GAMMA_C) =>
  k * (1 - clampFck(fck) / 250) * fcd(fck, gammaC);

/** largura mínima da biela [m] para uma força F [kN] e espessura t [m] */
export function strutWidth(F: number, t: number, fck: number, k: number = K_STRUT.biela, gammaC = GAMMA_C): number {
  return Math.abs(F) / (t * sigmaRdMax(fck, k, gammaC) * 1000);
}

/**
 * Raio do filtro (em elementos) que impõe largura mínima `a` [m]. Calibração empírica (BESO, viga-parede, 35%):
 * a largura mínima medida nas cristas do mapa de distância ≈ 1,1–1,3·rmin·h, logo rmin ≈ a/h é conservador.
 */
export const filterRadiusForWidth = (a: number, h: number) => a / h;

/**
 * Limita o raio do filtro automático pela menor largura sólida característica da peça (ex.: fuste de pilar com consolo),
 * evitando que `2·rmin` exceda ~30 % do membro mais estreito e impeça a convergência do BESO.
 */
export function cappedAutoFilterRadius(
  a: number,
  h: number,
  mask?: Uint8Array,
  nelx?: number,
  nely?: number,
): number {
  const raw = Math.max(1.5, Math.ceil(filterRadiusForWidth(a, h) * 2) / 2);
  let maxR = 12;
  if (mask && nelx && nely) {
    const rowCounts: number[] = [];
    for (let j = 0; j < nely; j++) {
      let c = 0;
      for (let i = 0; i < nelx; i++) if (mask[i * nely + j] !== 0) c++;
      if (c > 0) rowCounts.push(c);
    }
    const colCounts: number[] = [];
    for (let i = 0; i < nelx; i++) {
      let c = 0;
      for (let j = 0; j < nely; j++) if (mask[i * nely + j] !== 0) c++;
      if (c > 0) colCounts.push(c);
    }
    rowCounts.sort((x, y) => x - y);
    colCounts.sort((x, y) => x - y);
    const medRow = rowCounts.length ? rowCounts[Math.floor(rowCounts.length * 0.25)] : nelx;
    const medCol = colCounts.length ? colCounts[Math.floor(colCounts.length * 0.25)] : nely;
    const minSpan = Math.min(medRow, medCol);
    maxR = Math.min(12, Math.max(2.5, Math.floor(minSpan * 0.14 * 2) / 2));
  }
  return Math.min(maxR, raw);
}
