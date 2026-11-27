import type { DesignCodeId, Ver } from "./codes";
import { codeById, fcdOfCode, strutDesignStrength } from "./codes";
import { clampFck } from "./concrete";
import { STEEL_CLASSES } from "./nonlinear";
import type { BarSpec, Scene } from "./scene";
import { isLineLoad, pointInPolygon, sceneBounds } from "./scene";

export type StmMemberKind = "strut" | "tie";
export type StmNodeKind = "CCC" | "CCT" | "CTT";
export type StmSteelClass = "CA50" | "CA60" | "B500B";

export interface StmNode {
  id: number;
  x: number;
  y: number;
  role: "load" | "support" | "interior";
  kind: StmNodeKind;
  /** Applied external force [kN] */
  fx: number;
  fy: number;
  /** Support reaction [kN] */
  rx: number;
  ry: number;
  uxFixed: boolean;
  uyFixed: boolean;
  /** Bearing/support plate width or estimated nodal width [m] */
  plateWidth: number;
  /** Nodal compressive stress [MPa] */
  sigmaMPa: number;
  /** Allowable nodal stress (fcd1/fcd2/fcd3) [MPa] */
  sigmaLimitMPa: number;
  /** Utilization ratio (sigmaMPa / sigmaLimitMPa) */
  utilization: number;
  ok: boolean;
  /** Minimum angle [deg] between any strut and tie meeting at this node, or null */
  minAngleDeg: number | null;
  angleOk: boolean;
}

export interface StmMember {
  id: number;
  n1: number;
  n2: number;
  kind: StmMemberKind;
  /** Axial force [kN]: N < 0 strut, N > 0 tie */
  N: number;
  /** Length [m] */
  length: number;
  /** Orientation angle [deg] in [0, 180) */
  angleDeg: number;
  /** Required reinforcement area [cm²] (ties only; 0 for struts) */
  AsReqCm2: number;
  /** Required strut width [m] (struts only; 0 for ties) */
  wReqM: number;
  /** Estimated available strut width [m] (struts only; 0 for ties) */
  wAvailM: number;
  /** Compressive stress [MPa] (struts only; 0 for ties) */
  sigmaMPa: number;
  /** Limit stress [MPa]: sigmaRdMax for struts, fyd for ties */
  sigmaLimitMPa: number;
  /** Utilization ratio */
  utilization: number;
  ok: boolean;
}

export interface StmOptions {
  /** Optional topology density field on the Problem grid (nelx * nely) */
  rho?: Float64Array | number[];
  /** Minimum density threshold when `rho` is provided (default 0.5) */
  rhoThreshold?: number;
  /** Design code profile (default from scene.nl?.code or "NBR6118") */
  codeId?: DesignCodeId;
  /** Steel class for tie As_req (default "CA50" for NBR6118/ACI318, "B500B" for EC2/MC2010) */
  steelClass?: StmSteelClass;
  /** Grid columns for ground structure candidate nodes */
  gridCols?: number;
  /** Grid rows for ground structure candidate nodes */
  gridRows?: number;
  /** Max iterative area-update iterations (default 60) */
  maxIterations?: number;
}

export interface StmModel {
  nodes: StmNode[];
  members: StmMember[];
  /** Maximum nodal equilibrium residual on free DOFs [kN] */
  residual: number;
  /** Xia, Langelaar & Hendriks (2020) Eq. (1) Suitable Truss Structure index in [0, 1] */
  sts: number;
  codeId: DesignCodeId;
  steelClass: StmSteelClass;
  fckMPa: number;
  fydMPa: number;
  fcdMPa: number;
  fcd1MPa: number;
  fcd2MPa: number;
  fcd3MPa: number;
  sigmaRdMaxMPa: number;
  minAngleLimitDeg: number;
  nodeLimitsVerified: Ver;
  totalAsReqCm2: number;
  /** Σ (As_req * L) [cm³] */
  totalSteelVolumeCm3: number;
  maxNodeUtil: number;
  maxStrutUtil: number;
  ok: boolean;
  warnings: string[];
}

interface RawNode {
  x: number;
  y: number;
  role: "load" | "support" | "interior";
  fx: number;
  fy: number;
  uxFixed: boolean;
  uyFixed: boolean;
  plateWidth: number;
}

interface RawBar {
  n1: number;
  n2: number;
  L: number;
  c: number;
  s: number;
  area: number;
}

/** Dense symmetric/general linear solver (Gaussian elimination with partial pivoting) for small systems (<= 250 DOFs). */
function solveLinearDense(A: Float64Array, b: Float64Array, n: number): Float64Array | null {
  const M = new Float64Array(n * n);
  M.set(A);
  const rhs = new Float64Array(b);
  for (let k = 0; k < n; k++) {
    let piv = k;
    let maxVal = Math.abs(M[k * n + k]);
    for (let i = k + 1; i < n; i++) {
      const v = Math.abs(M[i * n + k]);
      if (v > maxVal) {
        maxVal = v;
        piv = i;
      }
    }
    if (maxVal < 1e-14) return null;
    if (piv !== k) {
      for (let j = k; j < n; j++) {
        const tmp = M[k * n + j];
        M[k * n + j] = M[piv * n + j];
        M[piv * n + j] = tmp;
      }
      const tb = rhs[k];
      rhs[k] = rhs[piv];
      rhs[piv] = tb;
    }
    const diag = M[k * n + k];
    for (let i = k + 1; i < n; i++) {
      const factor = M[i * n + k] / diag;
      if (factor === 0) continue;
      for (let j = k + 1; j < n; j++) {
        M[i * n + j] -= factor * M[k * n + j];
      }
      rhs[i] -= factor * rhs[k];
    }
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let sum = rhs[i];
    for (let j = i + 1; j < n; j++) sum -= M[i * n + j] * x[j];
    x[i] = sum / M[i * n + i];
  }
  return x;
}

function pointInScene(s: Scene, x: number, y: number): boolean {
  let inside = false;
  for (const sh of s.shapes) {
    if (pointInPolygon(x, y, sh.pts)) inside = sh.mode === "add";
  }
  return inside;
}

/**
 * Checks whether a point is inside the solid concrete (and above `rhoThreshold` if `rho` is provided).
 */
function createSolidTester(s: Scene, rho?: Float64Array | number[], rhoThreshold = 0.5) {
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

function isSegmentInSolid(
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
    const px = x1 + t * (x2 - x1);
    const py = y1 + t * (y2 - y1);
    if (!isSolid(px, py)) return false;
  }
  return true;
}

/** Estimate available perpendicular width [m] around segment midpoint inside the solid domain. */
function estimateAvailableWidth(
  s: Scene,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  plate1: number,
  plate2: number,
): number {
  const L = Math.hypot(x2 - x1, y2 - y1);
  if (L < 1e-9) return 0;
  const nx = -(y2 - y1) / L;
  const ny = (x2 - x1) / L;
  const mx = 0.5 * (x1 + x2);
  const my = 0.5 * (y1 + y2);
  const step = Math.max(s.h * 0.5, 0.005);
  const maxReach = Math.max(plate1, plate2, s.bearing, 0.5 * L);

  let dPos = 0;
  while (dPos + step <= maxReach && pointInScene(s, mx + (dPos + step) * nx, my + (dPos + step) * ny)) {
    dPos += step;
  }
  let dNeg = 0;
  while (dNeg + step <= maxReach && pointInScene(s, mx - (dNeg + step) * nx, my - (dNeg + step) * ny)) {
    dNeg += step;
  }
  const geomW = dPos + dNeg;
  const minPlate = Math.min(plate1, plate2);
  // Strut width is bounded by the available solid width and at least the smaller nodal plate width when in solid
  return Math.max(geomW > 1e-4 ? Math.min(geomW, Math.max(minPlate, 0.25 * L)) : minPlate, s.h);
}

/** Solve 2D truss K*u = F, returning displacements and bar axial forces, or null if singular. */
function solveTruss(
  nNodes: number,
  bars: readonly RawBar[],
  nodes: readonly RawNode[],
  E: number,
  reg = 0,
): { u: Float64Array; forces: Float64Array } | null {
  const ndof = 2 * nNodes;
  const K = new Float64Array(ndof * ndof);
  const F = new Float64Array(ndof);
  const fixed = new Uint8Array(ndof);

  for (let i = 0; i < nNodes; i++) {
    F[2 * i] = nodes[i].fx;
    F[2 * i + 1] = nodes[i].fy;
    if (nodes[i].uxFixed) fixed[2 * i] = 1;
    if (nodes[i].uyFixed) fixed[2 * i + 1] = 1;
  }

  let kSum = 0;
  let kCount = 0;
  for (const b of bars) {
    if (b.area <= 0) continue;
    const ke = (E * b.area) / b.L;
    kSum += ke;
    kCount++;
    const cc = b.c * b.c * ke;
    const ss = b.s * b.s * ke;
    const cs = b.c * b.s * ke;
    const d1x = 2 * b.n1;
    const d1y = 2 * b.n1 + 1;
    const d2x = 2 * b.n2;
    const d2y = 2 * b.n2 + 1;

    K[d1x * ndof + d1x] += cc;
    K[d1x * ndof + d1y] += cs;
    K[d1y * ndof + d1x] += cs;
    K[d1y * ndof + d1y] += ss;

    K[d2x * ndof + d2x] += cc;
    K[d2x * ndof + d2y] += cs;
    K[d2y * ndof + d2x] += cs;
    K[d2y * ndof + d2y] += ss;

    K[d1x * ndof + d2x] -= cc;
    K[d1x * ndof + d2y] -= cs;
    K[d1y * ndof + d2x] -= cs;
    K[d1y * ndof + d2y] -= ss;

    K[d2x * ndof + d1x] -= cc;
    K[d2x * ndof + d1y] -= cs;
    K[d2y * ndof + d1x] -= cs;
    K[d2y * ndof + d1y] -= ss;
  }

  const kReg = reg > 0 && kCount > 0 ? reg * (kSum / kCount) : 0;
  for (let d = 0; d < ndof; d++) {
    if (fixed[d]) {
      for (let j = 0; j < ndof; j++) {
        K[d * ndof + j] = 0;
        K[j * ndof + d] = 0;
      }
      K[d * ndof + d] = 1;
      F[d] = 0;
    } else if (kReg > 0) {
      K[d * ndof + d] += kReg;
    }
  }

  const u = solveLinearDense(K, F, ndof);
  if (!u) return null;

  const forces = new Float64Array(bars.length);
  for (let e = 0; e < bars.length; e++) {
    const b = bars[e];
    if (b.area <= 0) continue;
    const du = u[2 * b.n2] - u[2 * b.n1];
    const dv = u[2 * b.n2 + 1] - u[2 * b.n1 + 1];
    forces[e] = ((E * b.area) / b.L) * (b.c * du + b.s * dv);
  }
  return { u, forces };
}

/**
 * Computes the Suitable Truss Structure (STS) index of Xia, Langelaar & Hendriks (2020), Eq. (1):
 *   STS = (1 / n) * Σ |N_e| / (|N_e| + |V_e|)
 * using a 2D slender Euler-Bernoulli beam model with rectangular cross-section
 * (width = t, height = 0.01 * t).
 */
export function computeStmSts(
  nodes: readonly { x: number; y: number; uxFixed: boolean; uyFixed: boolean }[],
  members: readonly { n1: number; n2: number }[],
  loads: readonly { node: number; fx: number; fy: number }[],
  t: number,
  E: number,
): number {
  const nNodes = nodes.length;
  const nElem = members.length;
  if (nNodes === 0 || nElem === 0) return 0;

  const hBeam = 0.01 * t;
  const A = t * hBeam;
  const I = (t * hBeam * hBeam * hBeam) / 12;
  const ndof = 3 * nNodes;
  const K = new Float64Array(ndof * ndof);
  const F = new Float64Array(ndof);
  const fixed = new Uint8Array(ndof);

  for (let i = 0; i < nNodes; i++) {
    if (nodes[i].uxFixed) fixed[3 * i] = 1;
    if (nodes[i].uyFixed) fixed[3 * i + 1] = 1;
  }
  for (const l of loads) {
    F[3 * l.node] += l.fx;
    F[3 * l.node + 1] += l.fy;
  }

  const elemData: { n1: number; n2: number; L: number; c: number; s: number }[] = [];
  for (const m of members) {
    const p1 = nodes[m.n1];
    const p2 = nodes[m.n2];
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const L = Math.hypot(dx, dy);
    if (L < 1e-9) continue;
    const c = dx / L;
    const s = dy / L;
    elemData.push({ n1: m.n1, n2: m.n2, L, c, s });

    const ea = (E * A) / L;
    const ei12 = (12 * E * I) / (L * L * L);
    const ei6 = (6 * E * I) / (L * L);
    const ei4 = (4 * E * I) / L;
    const ei2 = (2 * E * I) / L;

    // Local stiffness matrix (6x6): [u1, v1, th1, u2, v2, th2]
    const kl = [
      [ea, 0, 0, -ea, 0, 0],
      [0, ei12, ei6, 0, -ei12, ei6],
      [0, ei6, ei4, 0, -ei6, ei2],
      [-ea, 0, 0, ea, 0, 0],
      [0, -ei12, -ei6, 0, ei12, -ei6],
      [0, ei6, ei2, 0, -ei6, ei4],
    ];
    // Transformation T^T * kl * T
    const T = [
      [c, s, 0, 0, 0, 0],
      [-s, c, 0, 0, 0, 0],
      [0, 0, 1, 0, 0, 0],
      [0, 0, 0, c, s, 0],
      [0, 0, 0, -s, c, 0],
      [0, 0, 0, 0, 0, 1],
    ];
    const tmp = Array.from({ length: 6 }, () => new Float64Array(6));
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 6; j++) {
        let sum = 0;
        for (let k = 0; k < 6; k++) sum += kl[i][k] * T[k][j];
        tmp[i][j] = sum;
      }
    }
    const dofs = [3 * m.n1, 3 * m.n1 + 1, 3 * m.n1 + 2, 3 * m.n2, 3 * m.n2 + 1, 3 * m.n2 + 2];
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 6; j++) {
        let kg = 0;
        for (let k = 0; k < 6; k++) kg += T[k][i] * tmp[k][j];
        K[dofs[i] * ndof + dofs[j]] += kg;
      }
    }
  }

  // Tiny rotational stabilization for pin-jointed mechanisms if any
  const kRotReg = 1e-12 * ((E * I) / 1.0);
  for (let i = 0; i < nNodes; i++) {
    K[(3 * i + 2) * ndof + (3 * i + 2)] += kRotReg;
  }

  for (let d = 0; d < ndof; d++) {
    if (fixed[d]) {
      for (let j = 0; j < ndof; j++) {
        K[d * ndof + j] = 0;
        K[j * ndof + d] = 0;
      }
      K[d * ndof + d] = 1;
      F[d] = 0;
    }
  }

  const u = solveLinearDense(K, F, ndof);
  if (!u) return 0;

  let stsSum = 0;
  let validCount = 0;
  for (const el of elemData) {
    const u1 = u[3 * el.n1];
    const v1 = u[3 * el.n1 + 1];
    const th1 = u[3 * el.n1 + 2];
    const u2 = u[3 * el.n2];
    const v2 = u[3 * el.n2 + 1];
    const th2 = u[3 * el.n2 + 2];

    const duLocal = el.c * (u2 - u1) + el.s * (v2 - v1);
    const dvLocal = -el.s * (u2 - u1) + el.c * (v2 - v1);
    const Ne = ((E * A) / el.L) * duLocal;
    const Ve = ((12 * E * I) / (el.L * el.L * el.L)) * dvLocal - ((6 * E * I) / (el.L * el.L)) * (th1 + th2);
    const denom = Math.abs(Ne) + Math.abs(Ve);
    if (denom > 1e-12) {
      stsSum += Math.abs(Ne) / denom;
      validCount++;
    }
  }
  return validCount > 0 ? stsSum / validCount : 0;
}

/**
 * Extracts and verifies a discrete Strut-and-Tie Model (STM) in axial equilibrium
 * from a `Scene` (and optional topology density `rho`) via the Ground Structure method.
 */
export function extractStm(scene: Scene, opts: StmOptions = {}): StmModel {
  const codeId: DesignCodeId = opts.codeId ?? scene.nl?.code ?? "NBR6118";
  const code = codeById(codeId);
  const defaultSteel: StmSteelClass = code.steelClasses.includes("CA50") ? "CA50" : "B500B";
  const steelClass: StmSteelClass = opts.steelClass ?? defaultSteel;
  const fckMPa = clampFck(scene.fck ?? 30);
  const fcdMPa = fcdOfCode(code, fckMPa);
  const alphaV2 = 1 - fckMPa / 250;
  // Borges (2022) / NBR 6118:2014 item 22.3.2 (Eqs. 2.4-2.7)
  const fcd1MPa = 0.85 * alphaV2 * fcdMPa;
  const fcd2MPa = 0.60 * alphaV2 * fcdMPa;
  const fcd3MPa = 0.72 * alphaV2 * fcdMPa;
  const strutRes = strutDesignStrength(code, fckMPa);
  const sigmaRdMaxMPa = strutRes.sigma;
  const fykMPa = steelClass === "CA60" ? 600 : 500;
  const fydMPa = (code.phi ?? 1) * (fykMPa / code.gammaS);
  const minAngleLimitDeg = codeId === "ACI318" ? 25.0 : 29.7;
  const nodeLimitsVerified: Ver = codeId === "NBR6118" ? "sec" : strutRes.verified;

  const warnings: string[] = [];
  const bounds = sceneBounds(scene);
  if (!bounds) {
    throw new Error("Cena sem geometria definida para extração de STM.");
  }

  const W = bounds.x1 - bounds.x0;
  const H = bounds.y1 - bounds.y0;
  const isSolid = createSolidTester(scene, opts.rho, opts.rhoThreshold ?? 0.5);

  // 1. Collect essential load and support nodes
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
      x: cx,
      y: cy,
      role: "load",
      fx: ld.fx,
      fy: ld.fy,
      uxFixed: false,
      uyFixed: false,
      plateWidth: Math.max(pw, scene.h),
    });
  }

  for (const sp of scene.supports) {
    const cx = 0.5 * (sp.x0 + sp.x1);
    const cy = 0.5 * (sp.y0 + sp.y1);
    const pw = Math.hypot(sp.x1 - sp.x0, sp.y1 - sp.y0);
    addOrMergeNode({
      x: cx,
      y: cy,
      role: "support",
      fx: 0,
      fy: 0,
      uxFixed: sp.ux,
      uyFixed: sp.uy,
      plateWidth: Math.max(pw, scene.bearing, scene.h),
    });
  }

  // 2. Add grid candidate nodes inside the solid domain (with small boundary inset so edge ties/struts sit cleanly)
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

  // Also add aligned projections of load/support coordinates inside the domain for clean orthogonal ties/struts
  const specialX = rawNodes.map((n) => n.x);
  const specialY = rawNodes.map((n) => n.y);
  for (const sx of specialX) {
    for (const y of ys) {
      if (isSolid(sx, y)) {
        addOrMergeNode({
          x: sx, y, role: "interior", fx: 0, fy: 0, uxFixed: false, uyFixed: false, plateWidth: scene.bearing,
        });
      }
    }
  }
  for (const sy of specialY) {
    for (const x of xs) {
      if (isSolid(x, sy)) {
        addOrMergeNode({
          x, y: sy, role: "interior", fx: 0, fy: 0, uxFixed: false, uyFixed: false, plateWidth: scene.bearing,
        });
      }
    }
  }
  for (const x of xs) {
    for (const y of ys) {
      if (isSolid(x, y)) {
        addOrMergeNode({
          x, y, role: "interior", fx: 0, fy: 0, uxFixed: false, uyFixed: false, plateWidth: scene.bearing,
        });
      }
    }
  }

  // 3. Build Ground Structure bars (skipping bars crossing voids and collinear overlapping bars)
  const nAll = rawNodes.length;
  const bars: RawBar[] = [];
  for (let i = 0; i < nAll; i++) {
    for (let j = i + 1; j < nAll; j++) {
      const a = rawNodes[i];
      const b = rawNodes[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const L = Math.hypot(dx, dy);
      if (L < 1e-6) continue;
      if (!isSegmentInSolid(a.x, a.y, b.x, b.y, scene.h, isSolid)) continue;

      // Skip if another node k lies strictly on segment (i, j) to prevent collinear overlap
      let hasIntermediate = false;
      for (let k = 0; k < nAll; k++) {
        if (k === i || k === j) continue;
        const p = rawNodes[k];
        const tProj = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (L * L);
        if (tProj > 0.02 && tProj < 0.98) {
          const distPerp = Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / L;
          if (distPerp < 0.25 * mergeDist) {
            hasIntermediate = true;
            break;
          }
        }
      }
      if (hasIntermediate) continue;

      bars.push({ n1: i, n2: j, L, c: dx / L, s: dy / L, area: 1.0 });
    }
  }

  if (bars.length === 0) {
    throw new Error("Ground Structure não gerou barras válidas dentro do domínio sólido.");
  }

  // 4. Iterative Ground Structure Optimization (Fully Stressed Design -> minimum Σ |N_e| L_e)
  const maxIter = opts.maxIterations ?? 120;
  const E = scene.E;
  let lastForces: Float64Array = new Float64Array(bars.length);
  const sigmaRef = 1000.0; // arbitrary reference stress for area scaling [kN/m²]

  for (let it = 0; it < maxIter; it++) {
    const res = solveTruss(nAll, bars, rawNodes, E, 1e-9);
    if (!res) break;
    lastForces = res.forces;
    let maxA = 0;
    for (let e = 0; e < bars.length; e++) {
      const targetA = Math.abs(res.forces[e]) / sigmaRef;
      bars[e].area = 0.3 * bars[e].area + 0.7 * targetA;
      if (bars[e].area > maxA) maxA = bars[e].area;
    }
    const floorA = maxA * 1e-8;
    for (let e = 0; e < bars.length; e++) {
      if (bars[e].area < floorA) bars[e].area = floorA;
    }
  }

  // 5. Safe pruning: try cutoffs from 5e-3 down to 0, keeping the cleanest truss with exact equilibrium (residual < 1e-6)
  let maxForce = 0;
  for (let e = 0; e < bars.length; e++) {
    const f = Math.abs(lastForces[e]);
    if (f > maxForce) maxForce = f;
  }

  // Helper to compact nodes and merge degree-2 collinear interior nodes
  const compactAndSolve = (inputBars: RawBar[]) => {
    let curBars = inputBars.map((b) => ({ ...b }));
    const curNodes = rawNodes.map((n) => ({ ...n }));

    // Iteratively remove degree-1 free interior nodes and merge collinear degree-2 free interior nodes
    for (let pass = 0; pass < 10; pass++) {
      let changed = false;
      const adj: number[][] = Array.from({ length: curNodes.length }, () => []);
      for (let e = 0; e < curBars.length; e++) {
        adj[curBars[e].n1].push(e);
        adj[curBars[e].n2].push(e);
      }

      for (let i = 0; i < curNodes.length; i++) {
        const nd = curNodes[i];
        if (nd.role !== "interior" || nd.uxFixed || nd.uyFixed || Math.abs(nd.fx) > 1e-9 || Math.abs(nd.fy) > 1e-9) {
          continue;
        }
        if (adj[i].length === 1) {
          curBars[adj[i][0]].area = -1;
          changed = true;
        } else if (adj[i].length === 2) {
          const e1 = curBars[adj[i][0]];
          const e2 = curBars[adj[i][1]];
          if (e1.area <= 0 || e2.area <= 0) continue;
          const o1 = e1.n1 === i ? e1.n2 : e1.n1;
          const o2 = e2.n1 === i ? e2.n2 : e2.n1;
          if (o1 === o2) continue;
          const v1x = curNodes[o1].x - nd.x;
          const v1y = curNodes[o1].y - nd.y;
          const v2x = nd.x - curNodes[o2].x;
          const v2y = nd.y - curNodes[o2].y;
          const l1 = Math.hypot(v1x, v1y);
          const l2 = Math.hypot(v2x, v2y);
          const cross = Math.abs(v1x * v2y - v1y * v2x) / (l1 * l2);
          const dot = (v1x * v2x + v1y * v2y) / (l1 * l2);
          if (cross < 1e-3 && dot > 0.999) {
            const dx = curNodes[o1].x - curNodes[o2].x;
            const dy = curNodes[o1].y - curNodes[o2].y;
            const L = Math.hypot(dx, dy);
            curBars[adj[i][0]] = {
              n1: o2,
              n2: o1,
              L,
              c: dx / L,
              s: dy / L,
              area: 0.5 * (e1.area + e2.area),
            };
            curBars[adj[i][1]].area = -1;
            changed = true;
            break;
          }
        }
      }
      curBars = curBars.filter((b) => b.area > 0);
      if (!changed) break;
    }

    // Keep only used nodes (plus all load/support nodes)
    const used = new Set<number>();
    for (const b of curBars) {
      used.add(b.n1);
      used.add(b.n2);
    }
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
  };

  const computeMaxResidual = (ns: readonly RawNode[], bs: readonly RawBar[], forces: Float64Array) => {
    const sfx = new Float64Array(ns.length);
    const sfy = new Float64Array(ns.length);
    for (let e = 0; e < bs.length; e++) {
      const b = bs[e];
      const N = forces[e];
      sfx[b.n1] -= N * b.c;
      sfy[b.n1] -= N * b.s;
      sfx[b.n2] += N * b.c;
      sfy[b.n2] += N * b.s;
    }
    let res = 0;
    for (let i = 0; i < ns.length; i++) {
      if (!ns[i].uxFixed) res = Math.max(res, Math.abs(ns[i].fx - sfx[i]));
      if (!ns[i].uyFixed) res = Math.max(res, Math.abs(ns[i].fy - sfy[i]));
    }
    return res;
  };

  let finalRawNodes: RawNode[] = [];
  let finalRawBars: RawBar[] = [];
  let exactSol: { u: Float64Array; forces: Float64Array } | null = null;

  for (const ratio of [1e-2, 5e-3, 1e-3, 1e-4, 1e-6, 0]) {
    const cutoff = ratio * maxForce;
    const candBars = bars.filter((_, e) => Math.abs(lastForces[e]) >= cutoff && Math.abs(lastForces[e]) > 1e-12);
    if (candBars.length === 0) continue;
    const compacted = compactAndSolve(candBars);
    const sol = solveTruss(compacted.finalRawNodes.length, compacted.finalRawBars, compacted.finalRawNodes, E, 0);
    if (sol && computeMaxResidual(compacted.finalRawNodes, compacted.finalRawBars, sol.forces) < 1e-6) {
      finalRawNodes = compacted.finalRawNodes;
      finalRawBars = compacted.finalRawBars;
      exactSol = sol;
      break;
    }
  }

  if (!exactSol) {
    const compacted = compactAndSolve(bars);
    finalRawNodes = compacted.finalRawNodes;
    finalRawBars = compacted.finalRawBars;
    exactSol =
      solveTruss(finalRawNodes.length, finalRawBars, finalRawNodes, E, 0) ??
      solveTruss(finalRawNodes.length, finalRawBars, finalRawNodes, E, 1e-11);
  }
  if (!exactSol) {
    throw new Error("Não foi possível resolver o equilíbrio axial da treliça STM extraída.");
  }

  // 6. Compute exact nodal equilibrium residuals and support reactions
  const nNodes = finalRawNodes.length;
  const sumBarFx = new Float64Array(nNodes);
  const sumBarFy = new Float64Array(nNodes);
  for (let e = 0; e < finalRawBars.length; e++) {
    const b = finalRawBars[e];
    const N = exactSol.forces[e];
    // Force exerted BY bar ON node n1 is +N*(c, s); ON node n2 is -N*(c, s)
    // Wait: K u = F means external force F = sum of internal end forces.
    // Internal force vector on n1 is (-N*c, -N*s) and on n2 is (+N*c, +N*s).
    sumBarFx[b.n1] -= N * b.c;
    sumBarFy[b.n1] -= N * b.s;
    sumBarFx[b.n2] += N * b.c;
    sumBarFy[b.n2] += N * b.s;
  }

  let residual = 0;
  for (let i = 0; i < nNodes; i++) {
    const nd = finalRawNodes[i];
    if (!nd.uxFixed) residual = Math.max(residual, Math.abs(nd.fx - sumBarFx[i]));
    if (!nd.uyFixed) residual = Math.max(residual, Math.abs(nd.fy - sumBarFy[i]));
  }

  // 7. Build verified StmMembers
  const members: StmMember[] = finalRawBars.map((b, id) => {
    const N = exactSol!.forces[id];
    const kind: StmMemberKind = N >= 0 ? "tie" : "strut";
    let angleDeg = (Math.atan2(b.s, b.c) * 180) / Math.PI;
    if (angleDeg < 0) angleDeg += 180;
    if (angleDeg >= 180) angleDeg -= 180;

    if (kind === "tie") {
      const AsReqCm2 = N / (fydMPa * 0.1);
      return {
        id,
        n1: b.n1,
        n2: b.n2,
        kind,
        N,
        length: b.L,
        angleDeg,
        AsReqCm2,
        wReqM: 0,
        wAvailM: 0,
        sigmaMPa: 0,
        sigmaLimitMPa: fydMPa,
        utilization: 0,
        ok: true,
      };
    } else {
      const absN = Math.abs(N);
      const wReqM = absN / (scene.t * sigmaRdMaxMPa * 1000);
      const p1 = finalRawNodes[b.n1];
      const p2 = finalRawNodes[b.n2];
      const wAvailM = estimateAvailableWidth(scene, p1.x, p1.y, p2.x, p2.y, p1.plateWidth, p2.plateWidth);
      const sigmaMPa = absN / (scene.t * wAvailM * 1000);
      const utilization = sigmaMPa / sigmaRdMaxMPa;
      return {
        id,
        n1: b.n1,
        n2: b.n2,
        kind,
        N,
        length: b.L,
        angleDeg,
        AsReqCm2: 0,
        wReqM,
        wAvailM,
        sigmaMPa,
        sigmaLimitMPa: sigmaRdMaxMPa,
        utilization,
        ok: utilization <= 1.0 + 1e-9,
      };
    }
  });

  // 8. Build verified StmNodes (CCC/CCT/CTT, fcd1/fcd2/fcd3, minimum angle)
  const nodes: StmNode[] = finalRawNodes.map((nd, id) => {
    const rx = nd.uxFixed ? sumBarFx[id] - nd.fx : 0;
    const ry = nd.uyFixed ? sumBarFy[id] - nd.fy : 0;

    const incident = members.filter((m) => m.n1 === id || m.n2 === id);
    const nTies = incident.filter((m) => m.kind === "tie").length;
    const kind: StmNodeKind = nTies === 0 ? "CCC" : nTies === 1 ? "CCT" : "CTT";
    const sigmaLimitMPa = kind === "CCC" ? fcd1MPa : kind === "CCT" ? fcd3MPa : fcd2MPa;

    // Bearing / nodal force magnitude
    const extForce = Math.hypot(nd.fx + rx, nd.fy + ry);
    const maxStrut = incident
      .filter((m) => m.kind === "strut")
      .reduce((acc, m) => Math.max(acc, Math.abs(m.N)), 0);
    const nodalForce = nd.role === "interior" ? maxStrut : Math.max(extForce, maxStrut);
    const sigmaMPa = nodalForce / (scene.t * nd.plateWidth * 1000);
    const utilization = sigmaMPa / sigmaLimitMPa;

    // Minimum angle between any strut and tie meeting at this node
    let minAngleDeg: number | null = null;
    const outwardVec = (m: StmMember): [number, number] => {
      const other = m.n1 === id ? finalRawNodes[m.n2] : finalRawNodes[m.n1];
      const dx = other.x - nd.x;
      const dy = other.y - nd.y;
      const len = Math.hypot(dx, dy) || 1;
      return [dx / len, dy / len];
    };
    const struts = incident.filter((m) => m.kind === "strut");
    const ties = incident.filter((m) => m.kind === "tie");
    for (const st of struts) {
      const [sx, sy] = outwardVec(st);
      for (const ti of ties) {
        const [tx, ty] = outwardVec(ti);
        const dot = Math.max(-1, Math.min(1, sx * tx + sy * ty));
        let ang = (Math.acos(dot) * 180) / Math.PI;
        if (ang > 90) ang = 180 - ang;
        if (minAngleDeg === null || ang < minAngleDeg) minAngleDeg = ang;
      }
    }
    const angleOk = minAngleDeg === null || minAngleDeg >= minAngleLimitDeg - 1e-6;
    if (!angleOk && minAngleDeg !== null) {
      warnings.push(
        `Nó ${id} (${kind}): ângulo mínimo biela-tirante ${minAngleDeg.toFixed(1)}° < ${minAngleLimitDeg.toFixed(1)}°.`,
      );
    }

    const ok = utilization <= 1.0 + 1e-9 && angleOk;
    return {
      id,
      x: nd.x,
      y: nd.y,
      role: nd.role,
      kind,
      fx: nd.fx,
      fy: nd.fy,
      rx,
      ry,
      uxFixed: nd.uxFixed,
      uyFixed: nd.uyFixed,
      plateWidth: nd.plateWidth,
      sigmaMPa,
      sigmaLimitMPa,
      utilization,
      ok,
      minAngleDeg,
      angleOk,
    };
  });

  // 9. Compute STS index (Xia et al. 2020, Eq. 1)
  const stsLoads = nodes
    .filter((n) => Math.abs(n.fx) > 1e-12 || Math.abs(n.fy) > 1e-12)
    .map((n) => ({ node: n.id, fx: n.fx, fy: n.fy }));
  const sts = computeStmSts(nodes, members, stsLoads, scene.t, E);

  let totalAsReqCm2 = 0;
  let totalSteelVolumeCm3 = 0;
  let maxStrutUtil = 0;
  for (const m of members) {
    if (m.kind === "tie") {
      totalAsReqCm2 += m.AsReqCm2;
      totalSteelVolumeCm3 += m.AsReqCm2 * m.length * 100; // cm² * (m*100) = cm³
    } else if (m.utilization > maxStrutUtil) {
      maxStrutUtil = m.utilization;
    }
  }
  const maxNodeUtil = nodes.reduce((acc, n) => Math.max(acc, n.utilization), 0);
  const ok = residual < 1e-6 && nodes.every((n) => n.ok) && members.every((m) => m.ok);

  if (residual >= 1e-6) {
    warnings.push(`Resíduo de equilíbrio nodal elevado: ${residual.toExponential(2)} kN.`);
  }

  return {
    nodes,
    members,
    residual,
    sts,
    codeId,
    steelClass,
    fckMPa,
    fydMPa,
    fcdMPa,
    fcd1MPa,
    fcd2MPa,
    fcd3MPa,
    sigmaRdMaxMPa,
    minAngleLimitDeg,
    nodeLimitsVerified,
    totalAsReqCm2,
    totalSteelVolumeCm3,
    maxNodeUtil,
    maxStrutUtil,
    ok,
    warnings,
  };
}

/**
 * Converts STM ties into embedded `BarSpec[]` reinforcement bars for Level 2 nonlinear analysis.
 */
export function stmTiesToBarSpecs(model: StmModel, steelClass: StmSteelClass = model.steelClass): BarSpec[] {
  const cls = STEEL_CLASSES[steelClass];
  const nodeMap = new Map(model.nodes.map((n) => [n.id, n]));
  return model.members
    .filter((m) => m.kind === "tie" && m.AsReqCm2 > 0)
    .map((m, idx) => {
      const p1 = nodeMap.get(m.n1)!;
      const p2 = nodeMap.get(m.n2)!;
      return {
        id: `STM_T${idx + 1}`,
        label: `Tirante T${idx + 1} (${m.AsReqCm2.toFixed(2)} cm²)`,
        path: [
          [Math.round(p1.x * 1e4) / 1e4, Math.round(p1.y * 1e4) / 1e4],
          [Math.round(p2.x * 1e4) / 1e4, Math.round(p2.y * 1e4) / 1e4],
        ],
        areaCm2: Math.round(m.AsReqCm2 * 100) / 100,
        steelClass,
        fy: cls.fy,
        ft: cls.ft,
        Es: cls.Es,
        epsU: cls.epsU,
      };
    });
}
