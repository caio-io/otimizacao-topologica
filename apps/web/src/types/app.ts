import type {
  CrushInfo,
  NlBarResult,
  NlCurvePoint,
  NlFailure,
  NlUtilization,
  PrincipalField,
  StmModel,
  TensionZone,
  XiaIndices,
} from "@stm/core";

export type TabId = "modelo" | "otim" | "armadura" | "nl" | "normas";

export type Tool =
  | "select"
  | "rect+"
  | "rect-"
  | "poly+"
  | "poly-"
  | "load"
  | "qload"
  | "support"
  | "rebar";

export type ViewMode =
  | "topo"
  | "s1"
  | "s2"
  | "def"
  | "csfm"
  | "stm"
  | "nlconc"
  | "nlcrack"
  | "nlstress"
  | "nlutil";

export type Selection = { kind: "shape" | "load" | "support"; id: string } | null;

export interface ReactionItem {
  id: string;
  rx: number;
  ry: number;
  x: number;
  y: number;
}

export interface NlFrameInfo {
  lambda: number;
  mode: "CC" | "FR" | "divergencia" | "lambdaMax" | "interrompida" | null;
  epsComp: Float64Array;
  epsTens: Float64Array;
  crackTheta: Float64Array;
  stress: Float64Array;
  barSamples: { x: number; y: number; N: number }[][];
  bars: NlBarResult[];
  maxEpsC: number;
  crushStrain: number;
  epsCu: number;
  fc: number;
  crushLength: number;
  equilibrium: { x: number; y: number };
  crush?: CrushInfo;
  failure?: NlFailure;
  firstPlateau?: { lambda: number; step: number } | null;
  curve: NlCurvePoint[];
  utilization: NlUtilization;
}

export interface FrameMsg {
  kind: "frame";
  token: number;
  dims: { nelx: number; nely: number; h: number; ox: number; oy: number };
  mask: Uint8Array;
  iter: number;
  compliance: number;
  volume: number;
  change: number;
  rho: Float64Array;
  u: Float64Array;
  field: PrincipalField;
  done: boolean;
  warnings: string[];
  elastic?: boolean;
  reactions: ReactionItem[];
  residual: { x: number; y: number };
  P0?: number;
  nl?: NlFrameInfo;
  steelVolCm3?: number;
}

export interface MetricsMsg {
  kind: "metrics";
  token: number;
  steelVolCm3: number;
  xia: XiaIndices;
}

export interface StmMsg {
  kind: "stm";
  token: number;
  stm: StmModel;
}

export interface ErrorMsg {
  kind: "error";
  token: number;
  errors: string[];
  warnings: string[];
}

export type WorkerOut = FrameMsg | MetricsMsg | StmMsg | ErrorMsg;

export interface CsfmSummary {
  zones: TensionZone[];
  smax: number;
  fyd: number;
}

export interface RebarToolConfig {
  cover: number; // m
  dia: number;   // mm
  n: number;
  steel: "CA50" | "CA60" | "B500B";
  form: "reta" | "L" | "U";
  leg: number;   // m
}
