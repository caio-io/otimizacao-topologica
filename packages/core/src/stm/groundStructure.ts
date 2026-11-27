import type { Scene } from "../scene";
import { isLineLoad, pointInPolygon, sceneBounds } from "../scene";
import type { RawBar, RawNode } from "./types";

/** Checks whether `(x, y)` lies inside the solid scene geometry (respecting `add` and `cut` order). */
export function pointInScene(s: Scene, x: number, y: number): boolean {
  let inside = false;
  for (const sh of s.shapes) {
    if (pointInPolygon(x, y, sh.pts)) inside = sh.mode === "add";
  }
  return inside;
}

/**
 * Checks whether a point is inside the solid concrete (and above `rhoThreshold` if `rho` is provided).
 */
export function createSolidTester(s: Scene, rho?: Float64Array | number[], rhoThreshold = 0.5) {
  const b = sceneBounds(s);
  if (!b) return () => false;
  const nelx = Math.round((b.x1 - b.x0) / s.h);
  const nely = Math.round((b.y1 - b.y0) / s.h);
  const hasRho = !!rho && rho.length === nelx * nely;

  const isRhoSolid = (x: number, y: number): boolean => {
    if (!hasRho || !rho) return true;
    const iCenter = Math.floor((x - b.x0) / s.h);
    const jCenter = Math.floor((b.y1 - y) / s.h);
    let maxVal = 0;
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        const ii = iCenter + di;
        const jj = jCenter + dj;
        if (ii >= 0 && ii < nelx && jj >= 0 && jj < nely) {
          const val = rho[ii * nely + jj];
          if (val > maxVal) maxVal = val;
        }
      }
    }
    return maxVal >= rhoThreshold;
  };

  return (x: number, y: number): boolean => {
    if (!pointInScene(s, x, y)) return false;
    return isRhoSolid(x, y);
  };
}

export function isSegmentInSolid(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  h: number,
  isSolid: (x: number, y: number) => boolean,
): boolean {
  const L = Math.hypot(x2 - x1, y2 - y1);
  if (L < 1e-9) return false;
  const steps = Math.max(12, Math.ceil(L / Math.max(0.5 * h, 1e-3)));
  for (let k = 1; k < steps; k++) {
    const t = k / steps;
    if (!isSolid(x1 + t * (x2 - x1), y1 + t * (y2 - y1))) return false;
  }
  return true;
}

export function buildGroundStructure(
  scene: Scene,
  isSolid: (x: number, y: number) => boolean,
  opts: { gridCols?: number; gridRows?: number },
): { rawNodes: RawNode[]; bars: RawBar[] } {
  const bounds = sceneBounds(scene);
  if (!bounds) throw new Error("Cena sem geometria definida para extração de STM.");

  const W = bounds.x1 - bounds.x0;
  const H = bounds.y1 - bounds.y0;
  const rawNodes: RawNode[] = [];
  const mergeDist = Math.max(0.03 * Math.min(W, H), scene.h * 1.5);

  const addOrMergeNode = (cand: RawNode) => {
    for (const n of rawNodes) {
      if (Math.hypot(n.x - cand.x, n.y - cand.y) <= mergeDist) {
        n.fx += cand.fx;
        n.fy += cand.fy;
        n.uxFixed = n.uxFixed || cand.uxFixed;
        n.uyFixed = n.uyFixed || cand.uyFixed;
        n.plateWidth = Math.max(n.plateWidth, cand.plateWidth);
        if (cand.role === "support") n.role = "support";
        else if (cand.role === "load" && n.role === "interior") n.role = "load";
        return;
      }
    }
    rawNodes.push({ ...cand });
  };

  for (const ld of scene.loads) {
    const cx = isLineLoad(ld) ? 0.5 * (ld.x + ld.x1) : ld.x;
    const cy = isLineLoad(ld) ? 0.5 * (ld.y + ld.y1) : ld.y;
    const pw = isLineLoad(ld) ? Math.hypot(ld.x1 - ld.x, ld.y1 - ld.y) : scene.bearing;
    addOrMergeNode({
      x: cx, y: cy, role: "load", fx: ld.fx, fy: ld.fy, uxFixed: false, uyFixed: false,
      plateWidth: Math.max(pw, scene.h),
    });
  }

  for (const sp of scene.supports) {
    const cx = 0.5 * (sp.x0 + sp.x1);
    const cy = 0.5 * (sp.y0 + sp.y1);
    const pw = Math.hypot(sp.x1 - sp.x0, sp.y1 - sp.y0);
    addOrMergeNode({
      x: cx, y: cy, role: "support", fx: 0, fy: 0, uxFixed: sp.ux, uyFixed: sp.uy,
      plateWidth: Math.max(pw, scene.bearing, scene.h),
    });
  }

  const cols = opts.gridCols ?? Math.max(5, Math.min(8, Math.round(4 + (2.5 * W) / Math.max(W, H))));
  const rows = opts.gridRows ?? Math.max(4, Math.min(7, Math.round(4 + (2.5 * H) / Math.max(W, H))));
  const epsX = Math.min(0.04 * W, scene.h * 1.5);
  const epsY = Math.min(0.04 * H, scene.h * 1.5);

  const xs: number[] = [];
  for (let i = 0; i < cols; i++) {
    const frac = cols === 1 ? 0.5 : i / (cols - 1);
    xs.push(bounds.x0 + epsX + frac * (W - 2 * epsX));
  }
  const ys: number[] = [];
  for (let j = 0; j < rows; j++) {
    const frac = rows === 1 ? 0.5 : j / (rows - 1);
    ys.push(bounds.y0 + epsY + frac * (H - 2 * epsY));
  }

  const specialX = rawNodes.map((n) => n.x);
  const specialY = rawNodes.map((n) => n.y);
  const pushInterior = (x: number, y: number) => {
    if (isSolid(x, y)) {
      addOrMergeNode({ x, y, role: "interior", fx: 0, fy: 0, uxFixed: false, uyFixed: false, plateWidth: scene.bearing });
    }
  };
  for (const sx of specialX) for (const y of ys) pushInterior(sx, y);
  for (const sy of specialY) for (const x of xs) pushInterior(x, sy);
  for (const x of xs) for (const y of ys) pushInterior(x, y);

  const nAll = rawNodes.length;
  const bars: RawBar[] = [];
  for (let i = 0; i < nAll; i++) {
    for (let j = i + 1; j < nAll; j++) {
      const a = rawNodes[i], b = rawNodes[j];
      const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy);
      if (L < 1e-6) continue;
      if (!isSegmentInSolid(a.x, a.y, b.x, b.y, scene.h, isSolid)) continue;

      let hasIntermediate = false;
      for (let k = 0; k < nAll; k++) {
        if (k === i || k === j) continue;
        const p = rawNodes[k];
        const tProj = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (L * L);
        if (tProj > 0.02 && tProj < 0.98) {
          const distPerp = Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / L;
          if (distPerp < 0.25 * mergeDist) { hasIntermediate = true; break; }
        }
      }
      if (hasIntermediate) continue;
      bars.push({ n1: i, n2: j, L, c: dx / L, s: dy / L, area: 1.0 });
    }
  }

  if (bars.length === 0) {
    throw new Error("Ground Structure não gerou barras válidas dentro do domínio sólido.");
  }
  return { rawNodes, bars };
}

/** Removes degree-1 free interior nodes and merges collinear degree-2 free interior nodes. */
export function compactTruss(
  rawNodes: readonly RawNode[],
  inputBars: readonly RawBar[],
): { finalRawNodes: RawNode[]; finalRawBars: RawBar[] } {
  let curBars = inputBars.map((b) => ({ ...b }));
  const curNodes = rawNodes.map((n) => ({ ...n }));

  for (let pass = 0; pass < 10; pass++) {
    let changed = false;
    const adj: number[][] = Array.from({ length: curNodes.length }, () => []);
    for (let e = 0; e < curBars.length; e++) {
      adj[curBars[e].n1].push(e);
      adj[curBars[e].n2].push(e);
    }

    for (let i = 0; i < curNodes.length; i++) {
      const nd = curNodes[i];
      if (nd.role !== "interior" || nd.uxFixed || nd.uyFixed || Math.abs(nd.fx) > 1e-9 || Math.abs(nd.fy) > 1e-9) continue;
      if (adj[i].length === 1) {
        curBars[adj[i][0]].area = -1;
        changed = true;
      } else if (adj[i].length === 2) {
        const e1 = curBars[adj[i][0]], e2 = curBars[adj[i][1]];
        if (e1.area <= 0 || e2.area <= 0) continue;
        const o1 = e1.n1 === i ? e1.n2 : e1.n1;
        const o2 = e2.n1 === i ? e2.n2 : e2.n1;
        if (o1 === o2) continue;
        const v1x = curNodes[o1].x - nd.x, v1y = curNodes[o1].y - nd.y;
        const v2x = nd.x - curNodes[o2].x, v2y = nd.y - curNodes[o2].y;
        const l1 = Math.hypot(v1x, v1y), l2 = Math.hypot(v2x, v2y);
        const cross = Math.abs(v1x * v2y - v1y * v2x) / (l1 * l2);
        const dot = (v1x * v2x + v1y * v2y) / (l1 * l2);
        if (cross < 1e-3 && dot > 0.999) {
          const dx = curNodes[o1].x - curNodes[o2].x, dy = curNodes[o1].y - curNodes[o2].y, L = Math.hypot(dx, dy);
          curBars[adj[i][0]] = { n1: o2, n2: o1, L, c: dx / L, s: dy / L, area: 0.5 * (e1.area + e2.area) };
          curBars[adj[i][1]].area = -1;
          changed = true;
          break;
        }
      }
    }
    curBars = curBars.filter((b) => b.area > 0);
    if (!changed) break;
  }

  const used = new Set<number>();
  for (const b of curBars) { used.add(b.n1); used.add(b.n2); }
  const oldToNew = new Map<number, number>();
  const finalRawNodes: RawNode[] = [];
  for (let i = 0; i < curNodes.length; i++) {
    if (used.has(i)) {
      oldToNew.set(i, finalRawNodes.length);
      finalRawNodes.push(curNodes[i]);
    }
  }
  const finalRawBars = curBars.map((b) => ({
    ...b,
    n1: oldToNew.get(b.n1)!,
    n2: oldToNew.get(b.n2)!,
  }));
  return { finalRawNodes, finalRawBars };
}
