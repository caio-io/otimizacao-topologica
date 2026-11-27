import type { DesignCodeId, Ver } from "../codes";
import type { Pt } from "../rebar";

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

export interface StmStrutContour {
  memberId: number;
  /** Polygon vertices in scene coordinates [m] (prismatic or bottle-shaped) */
  pts: Pt[];
  /** True when widened in mid-span as bottle-shaped strut (provisional 1:2 spread) */
  bottle: boolean;
  /** True when bottle spread uses provisional rule */
  provisional: boolean;
  utilization: number;
  ok: boolean;
}

export interface StmNodeContour {
  nodeId: number;
  kind: StmNodeKind;
  pts: Pt[];
  utilization: number;
  ok: boolean;
}

export interface StmGeometry {
  struts: StmStrutContour[];
  nodes: StmNodeContour[];
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
  /** Max iterative area-update iterations (default 120) */
  maxIterations?: number;
}

export interface StmModel {
  nodes: StmNode[];
  members: StmMember[];
  /** CAST-style strut and nodal zone contour polygons (computed on extraction) */
  geometry?: StmGeometry;
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

export interface RawNode {
  x: number;
  y: number;
  role: "load" | "support" | "interior";
  fx: number;
  fy: number;
  uxFixed: boolean;
  uyFixed: boolean;
  plateWidth: number;
}

export interface RawBar {
  n1: number;
  n2: number;
  L: number;
  c: number;
  s: number;
  area: number;
}
