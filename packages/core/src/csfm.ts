import type { PrincipalField } from "./types";

/**
 * Ramo "campo de tensões" (inspirado no CSFM, ainda LINEAR): a partir do campo elástico do domínio cheio, identifica
 * as zonas tracionadas (σ1 acima de uma fração da tração máxima — o concreto não resiste à tração), calcula a força
 * do tirante em cada zona conexa (resultante em cortes perpendiculares à tração) e sugere a armadura As = T / fyd.
 *
 * NÃO é a verificação CSFM completa (sem não linearidade, sem redução de resistência por deformação transversal,
 * sem enrijecimento à tração, sem ELS/fissuração). É uma estimativa de dimensionamento para orientar o projeto.
 */
export interface TensionZone {
  id: number;
  /** elementos da zona (índices e = i*nely + j) */
  elements: number[];
  /** tração resultante estimada [kN] */
  T: number;
  /** armadura sugerida [cm²] */
  As: number;
  /** direção principal média da tração, ângulo em relação a x [rad] */
  theta: number;
  /** centroide [m], coordenadas da cena (y para cima) */
  cx: number; cy: number;
  /** tração máxima σ1 na zona [kN/m²] */
  s1max: number;
}

export interface CsfmOptions {
  /** fyk [MPa] */ fyk: number;
  /** γs */ gammaS: number;
  /** fração da tração máxima (percentil 98) abaixo da qual o elemento não conta como zona tracionada */
  threshold: number;
}
export const CSFM_DEFAULTS: CsfmOptions = { fyk: 500, gammaS: 1.15, threshold: 0.05 };

export function tensionZones(
  dims: { nelx: number; nely: number; h: number; ox: number; oy: number; t: number },
  mask: Uint8Array,
  field: PrincipalField,
  opt: Partial<CsfmOptions> = {},
): { zones: TensionZone[]; smax: number; fyd: number } {
  const { nelx, nely, h, ox, oy, t } = dims;
  const o = { ...CSFM_DEFAULTS, ...opt };
  const fyd = (o.fyk / o.gammaS) * 1000; // kN/m²
  const solid: number[] = [];
  for (let e = 0; e < mask.length; e++) if (mask[e]) solid.push(e);
  if (!solid.length) return { zones: [], smax: 0, fyd };
  const sorted = solid.map((e) => field.s1[e]).sort((a, b) => a - b);
  const smax = sorted[Math.min(sorted.length - 1, Math.floor(0.98 * sorted.length))]; // robusto a picos sob cargas/apoios
  if (!(smax > 0)) return { zones: [], smax: 0, fyd };
  const thr = o.threshold * smax;
  const inZone = (e: number) => mask[e] !== 0 && field.s1[e] > thr;

  const label = new Int32Array(mask.length).fill(-1);
  const zones: TensionZone[] = [];
  const top = oy + nely * h;
  for (const seed of solid) {
    if (label[seed] >= 0 || !inZone(seed)) continue;
    const id = zones.length, stack = [seed], els: number[] = [];
    label[seed] = id;
    while (stack.length) {
      const e = stack.pop()!;
      els.push(e);
      const i = Math.floor(e / nely), j = e % nely;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= nelx || jj >= nely) continue;
        const k = ii * nely + jj;
        if (label[k] < 0 && inZone(k)) { label[k] = id; stack.push(k); }
      }
    }
    // direção média da tração (ponderada por σ1) e centroide
    let sx = 0, sy = 0, cxs = 0, cys = 0, s1m = 0;
    for (const e of els) {
      const w = field.s1[e];
      sx += w * Math.cos(2 * field.theta[e]); sy += w * Math.sin(2 * field.theta[e]);
      const i = Math.floor(e / nely), j = e % nely;
      cxs += w * (ox + (i + 0.5) * h); cys += w * (top - (j + 0.5) * h);
      s1m = Math.max(s1m, w);
    }
    const wsum = els.reduce((a, e) => a + field.s1[e], 0);
    const theta = 0.5 * Math.atan2(sy, sx);
    // força do tirante = resultante de σ na direção da tração em cortes PERPENDICULARES a ela (fatias de largura h):
    // é o que o equilíbrio de momento pede (T = M/z). O valor é o máximo entre as fatias.
    const ux = Math.cos(theta), uy = Math.sin(theta);
    const slabs = new Map<number, number>();
    for (const e of els) {
      const i = Math.floor(e / nely), j = e % nely;
      const d = (ox + (i + 0.5) * h) * ux + (top - (j + 0.5) * h) * uy;
      const dth = field.theta[e] - theta;
      const su = field.s1[e] * Math.cos(dth) ** 2 + field.s2[e] * Math.sin(dth) ** 2;
      if (su <= 0) continue;
      const key = Math.round(d / h);
      slabs.set(key, (slabs.get(key) ?? 0) + su * h * t);
    }
    const T = Math.max(0, ...slabs.values());
    zones.push({ id, elements: els, T, As: (T / fyd) * 1e4, theta, cx: cxs / wsum, cy: cys / wsum, s1max: s1m });
  }
  // despreza zonas insignificantes (< 5% da maior)
  const Tmax = Math.max(...zones.map((z) => z.T), 0);
  const kept = zones.filter((z) => z.T >= 0.05 * Tmax).sort((a, b) => b.T - a.T);
  return { zones: kept, smax, fyd };
}
