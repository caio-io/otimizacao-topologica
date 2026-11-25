import type { PrincipalField, Problem } from "./types";
import { elementDofs } from "./fe";

/**
 * Tensões no centro de cada elemento (estado plano), com material sólido (sem penalização),
 * e tensões principais. Base do "campo de tensões" mostrado ao usuário e da futura
 * classificação biela (s2<0) / tirante (s1>0).
 */
export function principalStresses(p: Problem, u: Float64Array): PrincipalField {
  const nel = p.nelx * p.nely;
  const s1 = new Float64Array(nel), s2 = new Float64Array(nel), theta = new Float64Array(nel);
  // u vem de um solve com E=1 e espessura 1 ⇒ σ_real = (E_unit · B·u) / t  (E_real se cancela)
  const c = 1 / ((1 - p.nu * p.nu) * p.t);
  const xi = [-1, 1, 1, -1], eta = [-1, -1, 1, 1];
  const dof = new Int32Array(8);
  for (let i = 0; i < p.nelx; i++) {
    for (let j = 0; j < p.nely; j++) {
      const e = i * p.nely + j;
      elementDofs(p.nely, i, j, dof);
      let ex = 0, ey = 0, g = 0;
      for (let a = 0; a < 4; a++) {
        const dx = xi[a] / (2 * p.h), dy = eta[a] / (2 * p.h);
        const ux = u[dof[2 * a]], uy = u[dof[2 * a + 1]];
        ex += dx * ux; ey += dy * uy; g += dy * ux + dx * uy;
      }
      const sx = c * (ex + p.nu * ey), sy = c * (p.nu * ex + ey), txy = c * ((1 - p.nu) / 2) * g;
      const avg = 0.5 * (sx + sy), rad = Math.hypot(0.5 * (sx - sy), txy);
      s1[e] = avg + rad; s2[e] = avg - rad;
      theta[e] = 0.5 * Math.atan2(txy, 0.5 * (sx - sy));
    }
  }
  return { s1, s2, theta };
}
