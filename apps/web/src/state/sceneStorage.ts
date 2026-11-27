/// <reference types="vite/client" />
import { BENCHMARKS, SCENE_PRESETS } from "@stm/core";
import type { BenchmarkEntry, Scene, StmModel } from "@stm/core";

const localMods = import.meta.glob("../../../../packages/core/src/presets.local.ts", { eager: true }) as Record<
  string,
  { LOCAL_SCENE_PRESETS?: Record<string, () => Scene> }
>;

export interface ModelOption {
  id: string;
  label: string;
  group: "Exemplos públicos" | "Benchmarks dos artigos" | "Modelos locais";
  benchmark?: BenchmarkEntry;
  createScene: () => Scene;
}

export function buildModelCatalog(): ModelOption[] {
  const out: ModelOption[] = [];
  for (const bm of BENCHMARKS) {
    out.push({
      id: `bm:${bm.id}`,
      label: bm.shortTitle,
      group: "Benchmarks dos artigos",
      benchmark: bm,
      createScene: bm.createScene,
    });
  }
  for (const [k, fn] of Object.entries(SCENE_PRESETS)) {
    if (k.includes("S1")) continue; // S1 já está em destaque nos Benchmarks
    out.push({
      id: `preset:${k}`,
      label: k,
      group: "Exemplos públicos",
      createScene: fn,
    });
  }
  const locals: Record<string, () => Scene> = Object.assign(
    {},
    ...Object.values(localMods).map((m) => m.LOCAL_SCENE_PRESETS ?? {}),
  );
  for (const [k, fn] of Object.entries(locals)) {
    out.push({
      id: `local:${k}`,
      label: k,
      group: "Modelos locais",
      createScene: fn,
    });
  }
  return out;
}

export const MODEL_CATALOG: ModelOption[] = buildModelCatalog();
export const DEFAULT_MODEL_ID = "bm:csfm-s1";

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const okPt = (p: unknown): p is [number, number] => Array.isArray(p) && p.length === 2 && p.every(num);

export function validateSceneObject(o: any): Scene | null {
  if (!o || typeof o !== "object") return null;
  if (!num(o.h) || o.h <= 0 || !num(o.bearing) || o.bearing < 0 || !num(o.t) || o.t <= 0 || !num(o.E) || o.E <= 0 || !num(o.nu) || o.nu <= -1 || o.nu >= 0.5) return null;
  if (!Array.isArray(o.shapes) || !o.shapes.every((q: any) => typeof q.id === "string" && (q.mode === "add" || q.mode === "cut") && Array.isArray(q.pts) && q.pts.length >= 3 && q.pts.every(okPt))) return null;
  if (!Array.isArray(o.loads) || !o.loads.every((l: any) => typeof l.id === "string" && [l.x, l.y, l.fx, l.fy].every(num))) return null;
  if (!Array.isArray(o.supports) || !o.supports.every((s: any) => typeof s.id === "string" && [s.x0, s.y0, s.x1, s.y1].every(num) && typeof s.ux === "boolean" && typeof s.uy === "boolean")) return null;
  const okBar = (b: any) =>
    b && typeof b.id === "string" && typeof b.label === "string" && Array.isArray(b.path) && b.path.length >= 2 && b.path.every(okPt) &&
    [b.areaCm2, b.fy, b.ft, b.Es, b.epsU].every((v: unknown) => num(v) && v > 0) &&
    b.ft >= b.fy && b.fy / (b.Es * 1000) < b.epsU;
  if (o.bars !== undefined && !(Array.isArray(o.bars) && o.bars.every(okBar))) delete o.bars;
  const okTendon = (td: any) =>
    td && typeof td.id === "string" && typeof td.label === "string" && Array.isArray(td.path) && td.path.length >= 2 && td.path.every(okPt) &&
    [td.areaCm2, td.Ep, td.fpy, td.fpu, td.epsU].every((v: unknown) => num(v) && v > 0) &&
    num(td.P0) && td.P0 >= 0 && td.fpu >= td.fpy;
  if (o.tendons !== undefined && !(Array.isArray(o.tendons) && o.tendons.every(okTendon))) delete o.tendons;
  if (o.nl !== undefined && !(o.nl && (o.nl.values === "mean" || o.nl.values === "design") && num(o.nl.epsCu) && o.nl.epsCu > 0 && num(o.nl.crushLength) && o.nl.crushLength >= 0)) delete o.nl;
  if (o.nl && !["NBR6118", "EC2", "MC2010", "ACI318"].includes(o.nl.code)) delete o.nl.code;
  return o as Scene;
}

export function loadSavedScene(): Scene | null {
  try {
    const raw = localStorage.getItem("stm-scene");
    if (!raw) return null;
    return validateSceneObject(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function saveScene(s: Scene): void {
  try {
    localStorage.setItem("stm-scene", JSON.stringify(s));
  } catch {
    /* ignore storage quota */
  }
}

export function maxNumericId(s: Scene): number {
  let n = 100;
  for (const q of [...s.shapes, ...s.loads, ...s.supports, ...(s.bars ?? []), ...(s.tendons ?? [])]) {
    n = Math.max(n, (parseInt(q.id.replace(/\D/g, ""), 10) || 0) + 1);
  }
  return n;
}

export interface ProjectFileV1 {
  version: 1;
  name: string;
  savedAt: string;
  scene: Scene;
  ui?: {
    modelId?: string;
    tab?: string;
    viewMode?: string;
    optMethod?: "beso" | "simp";
    volfrac?: number;
    rmin?: number;
    rminAuto?: boolean;
  };
  results?: {
    stm?: StmModel | null;
  };
}

export interface RecentProjectEntry {
  id: string;
  name: string;
  savedAt: string;
  file: ProjectFileV1;
}

const RECENT_KEY = "stm-recent-projects";

export function serializeProjectFile(proj: Omit<ProjectFileV1, "version" | "savedAt">): ProjectFileV1 {
  return {
    version: 1,
    savedAt: new Date().toISOString(),
    ...proj,
  };
}

export function parseProjectFile(text: string): ProjectFileV1 | null {
  try {
    const raw = JSON.parse(text);
    if (raw && typeof raw === "object" && raw.version === 1 && raw.scene) {
      const scene = validateSceneObject(raw.scene);
      if (!scene) return null;
      return {
        version: 1,
        name: typeof raw.name === "string" && raw.name.trim() ? raw.name : "Projeto STM",
        savedAt: typeof raw.savedAt === "string" ? raw.savedAt : new Date().toISOString(),
        scene,
        ui: raw.ui && typeof raw.ui === "object" ? raw.ui : undefined,
        results: raw.results && typeof raw.results === "object" ? raw.results : undefined,
      };
    }
    const legacy = validateSceneObject(raw);
    if (!legacy) return null;
    return {
      version: 1,
      name: "Modelo importado",
      savedAt: new Date().toISOString(),
      scene: legacy,
    };
  } catch {
    return null;
  }
}

export function loadRecentProjects(): RecentProjectEntry[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter((e) => e && typeof e.id === "string" && typeof e.name === "string" && e.file?.version === 1);
  } catch {
    return [];
  }
}

export function saveRecentProject(file: ProjectFileV1): RecentProjectEntry[] {
  const existing = loadRecentProjects().filter((e) => e.name !== file.name);
  const entry: RecentProjectEntry = {
    id: `${Date.now()}`,
    name: file.name,
    savedAt: file.savedAt,
    file: { ...file, results: undefined }, // evita estourar quota do localStorage com resultados pesados
  };
  const next = [entry, ...existing].slice(0, 6);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* ignore storage quota */
  }
  return next;
}
