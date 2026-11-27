/// <reference types="vite/client" />
import { BENCHMARKS, SCENE_PRESETS } from "@stm/core";
import type { BenchmarkEntry, Scene } from "@stm/core";

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
  for (const q of [...s.shapes, ...s.loads, ...s.supports, ...(s.bars ?? [])]) {
    n = Math.max(n, (parseInt(q.id.replace(/\D/g, ""), 10) || 0) + 1);
  }
  return n;
}
