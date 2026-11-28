import React, { useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  STEEL_CLASSES,
  arcFrom3Points,
  barAreaCm2,
  isLineLoad,
  nearestEdgePoint,
  nearestFace,
  parallelLayerOffset,
  pointInPolygon,
  rectPts,
  sceneEdges,
  smartBarPaths,
  supportFlags,
} from "@stm/core";
import type { LoadSpec, Scene, Shape, StmModel, SupportKind, SupportSpec } from "@stm/core";
import {
  ArrowDown,
  ArrowDownToLine,
  Download,
  Grid,
  Layers,
  Lock,
  Maximize2,
  MousePointer2,
  Pentagon,
  RectangleHorizontal,
  Spline,
  SquareDashed,
  Triangle,
  Unlock,
} from "lucide-react";
import {
  computeFitTransform,
  distSeg,
  inspectHoverPoint,
  renderViewport,
  screenToWorld,
  worldToScreenX,
  worldToScreenY,
} from "../canvas/renderer";
import type { ViewportTransform } from "../canvas/renderer";
import type { CsfmSummary, FrameMsg, RebarToolConfig, Selection, StmDisplayMode, Tool, ViewMode } from "../types/app";

export interface ViewportHandle {
  fitView: () => void;
  capturePng: () => string | null;
}

interface ViewportCanvasProps {
  scene: Scene;
  onSceneChange: (updater: (prev: Scene) => Scene, clearResults?: boolean) => void;
  frame: FrameMsg | null;
  frameIndex: number;
  frameCount: number;
  onFrameIndexChange: (idx: number) => void;
  viewMode: ViewMode;
  onViewModeChange: (v: ViewMode) => void;
  showMesh: boolean;
  onShowMeshChange: (v: boolean) => void;
  csfm: CsfmSummary | null;
  stm: StmModel | null;
  stmDisplayMode: StmDisplayMode;
  onStmDisplayModeChange: (m: StmDisplayMode) => void;
  onExportStmSvg: () => void;
  tool: Tool;
  onToolChange: (t: Tool) => void;
  sel: Selection;
  onSelChange: (s: Selection) => void;
  geomLocked: boolean;
  onGeomLockedChange: (v: boolean) => void;
  supportKindDefault: SupportKind;
  rebarCfg: RebarToolConfig;
  hoverBarId: string | null;
  onHoverBarChange: (id: string | null) => void;
  nextId: (prefix: string) => string;
  onToast: (msg: string) => void;
  errors: string[];
  warnings: string[];
}

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

const GRAD_COMP = "linear-gradient(90deg,#edf1f6,#ffb8a8,#7f1d1d)";
const GRAD_UTIL = "linear-gradient(90deg,#edf1f6,#fcd34d,#dc2626,#7f1d1d)";
const GRAD_BAR = "linear-gradient(90deg,hsl(125,82%,40%),hsl(60,82%,40%),hsl(0,82%,40%))";

const LEGENDS: Record<ViewMode, { title: string; items: [string, string][] }> = {
  topo: {
    title: "Topologia + trajetórias",
    items: [
      ["#dc2626", "tração (tirante)"],
      ["#1d4ed8", "compressão (biela)"],
      ["#94a3b8", "material otimizado"],
    ],
  },
  s1: { title: "Tração principal σ1", items: [["#dc2626", "tração principal σ1 (p97)"]] },
  s2: { title: "Compressão principal σ2", items: [["#1d4ed8", "compressão principal σ2 (p97)"]] },
  def: { title: "Deformada (ampliada)", items: [["#cbd5e1", "contorno original"], ["#2563eb", "deslocamento"]] },
  csfm: {
    title: "CSFM linear (estimativa)",
    items: [["#fca5a5", "zona tracionada"], ["#7f1d1d", "direção sugerida do tirante"]],
  },
  stm: {
    title: "Modelo de Bielas e Tirantes (STM)",
    items: [
      ["#1d4ed8", "biela (compressão, tracejado)"],
      ["#dc2626", "tirante (tração, T e As)"],
      ["#16a34a", "nó CCC/CCT/CTT ≤ 100 %"],
      ["#b91c1c", "nó/biela > 100 % ou ângulo"],
    ],
  },
  nlconc: {
    title: "Nível 2 · Deformação ε3/εcu",
    items: [[GRAD_COMP, "ε3 / εcu: 0 → 100 %"], ["#7f1d1d", "esmagado (≥ εcu)"], ["dash", "janela de esmagamento"], [GRAD_BAR, "barra: 0 → 100 % fy"]],
  },
  nlcrack: {
    title: "Nível 2 · Fissuras orientadas",
    items: [["#dbeafe", "região fissurada (ε1 > 0)"], ["#1e3a8a", "traço da fissura (⊥ ε1)"], [GRAD_BAR, "barra tracionada (0→100% fy)"], ["hsl(215,75%,45%)", "barra comprimida"]],
  },
  nlstress: {
    title: "Nível 2 · Tensões |σ3|/fc",
    items: [[GRAD_COMP, "|σ3| / fc: 0 → 100 %"], ["#7f1d1d", "atingiu patamar fc"], ["dash", "janela de esmagamento"]],
  },
  nlutil: {
    title: "Nível 2 · Utilização (%)",
    items: [[GRAD_UTIL, "utilização 0 → 100 %"], ["#7f1d1d", "limite atingido (≥ 100 %)"], ["dash", "região crítica CC"], [GRAD_BAR, "barra: 0 → 100 % fy"]],
  },
};

const HINTS: Record<Tool, string> = {
  select: "Clique para selecionar · Arraste formas/cargas · Botão direito: panorâmica · Roda: zoom · Delete exclui",
  "rect+": "Arraste na tela para desenhar um retângulo de concreto",
  "rect-": "Arraste na tela para recortar uma abertura retangular",
  "poly+": "Clique os vértices do polígono · Duplo clique ou Enter fecha · Esc cancela",
  "poly-": "Clique os vértices da abertura poligonal · Duplo clique ou Enter fecha · Esc cancela",
  load: "Clique sobre uma face azul pontilhada para aplicar carga pontual",
  qload: "Clique (placa) ou arraste ao longo de uma face para carga distribuída",
  support: "Arraste ao longo de uma face para apoio distribuído (ou clique para pontual)",
  rebar: "Aproxime de uma face para pré-visualizar · Tab alterna camada acima/abaixo · Clique para criar",
  arcbar: "Clique 3 pontos (início, meio e fim) para desenhar barra curva em arco · Esc cancela",
};

export const ViewportCanvas = React.forwardRef<ViewportHandle, ViewportCanvasProps>((props, ref) => {
  const {
    scene, onSceneChange, frame, frameIndex, frameCount, onFrameIndexChange,
    viewMode, onViewModeChange, showMesh, onShowMeshChange, csfm, stm,
    stmDisplayMode, onStmDisplayModeChange, onExportStmSvg,
    tool, onToolChange, sel, onSelChange, geomLocked, onGeomLockedChange,
    supportKindDefault, rebarCfg, hoverBarId, onHoverBarChange, nextId, onToast,
    errors, warnings,
  } = props;

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const cvRef = useRef<HTMLCanvasElement | null>(null);
  const viewRef = useRef<ViewportTransform>({ s: 100, ox: 80, oy: 400 });
  const fittedRef = useRef(false);
  const lastSizeRef = useRef({ w: 0, h: 0 });
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  const dragRef = useRef<null | { type: string; start: [number, number]; cur: [number, number]; orig?: any }>(null);
  const panRef = useRef<null | { x: number; y: number }>(null);
  const polyDraftRef = useRef<[number, number][]>([]);
  const arcDraftRef = useRef<[number, number][]>([]);
  const layerDirRef = useRef<1 | -1>(1);
  const hoverWorldRef = useRef<[number, number]>([0, 0]);
  const hoverGripRef = useRef<[number, number] | null>(null);
  const rebarPreviewRef = useRef<{ path: [number, number][]; extra?: [number, number][][]; a: [number, number]; b: [number, number] } | null>(null);

  const [coords, setCoords] = useState<[number, number] | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; title?: string; lines: string[] } | null>(null);

  const drawNow = useCallback(() => {
    const cv = cvRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth, h = cv.clientHeight;
    if (w < 10 || h < 10) return;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    renderViewport({
      ctx, width: w, height: h, view: viewRef.current, scene, frame, viewMode, showMesh, csfm, stm, stmDisplayMode,
      sel, hoverBarId, tool, hoverGrip: hoverGripRef.current, rebarPreview: rebarPreviewRef.current,
      rebarCfg, dragOverlay: dragRef.current, polyDraft: polyDraftRef.current, arcDraft: arcDraftRef.current, hoverWorld: hoverWorldRef.current,
    });
  }, [scene, frame, viewMode, showMesh, csfm, stm, stmDisplayMode, sel, hoverBarId, tool, rebarCfg]);

  const fitView = useCallback(() => {
    const cv = cvRef.current;
    if (!cv || cv.clientWidth < 20) return;
    viewRef.current = computeFitTransform(scene, cv.clientWidth, cv.clientHeight);
    drawNow();
  }, [scene, drawNow]);

  useImperativeHandle(ref, () => ({
    fitView,
    capturePng: () => cvRef.current?.toDataURL("image/png") ?? null,
  }), [fitView]);

  const drawNowRef = useRef(drawNow);
  drawNowRef.current = drawNow;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth > 50 && el.clientHeight > 50) {
        const dw = Math.abs(el.clientWidth - lastSizeRef.current.w);
        const dh = Math.abs(el.clientHeight - lastSizeRef.current.h);
        if (!fittedRef.current || dw > 60 || dh > 60) {
          fittedRef.current = true;
          lastSizeRef.current = { w: el.clientWidth, h: el.clientHeight };
          viewRef.current = computeFitTransform(sceneRef.current, el.clientWidth, el.clientHeight);
        }
      }
      drawNowRef.current();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => { drawNow(); }, [drawNow]);

  const snap = (v: number) => r4(Math.round(v / scene.h) * scene.h);

  const edgeGrip = (px: number, py: number, maxPx = 24, only?: number) => {
    const [wxm, wym] = screenToWorld(viewRef.current, px, py);
    const q = nearestEdgePoint(scene, wxm, wym, only);
    if (!q || q.dist * viewRef.current.s > maxPx) return null;
    const e = sceneEdges(scene)[q.edge], L = Math.hypot(e[2] - e[0], e[3] - e[1]);
    let d = q.t * L;
    if (d < 0.5 * scene.h) d = 0;
    else if (L - d < 0.5 * scene.h) d = L;
    else d = Math.round(d / scene.h) * scene.h;
    const t = L ? Math.min(1, d / L) : 0;
    return { x: r4(e[0] + t * (e[2] - e[0])), y: r4(e[1] + t * (e[3] - e[1])), edge: q.edge };
  };

  const plateOnEdge = (edge: number, cx: number, cy: number) => {
    const e = sceneEdges(scene)[edge];
    if (!e || !(scene.bearing > 0)) return null;
    const L = Math.hypot(e[2] - e[0], e[3] - e[1]);
    if (!L) return null;
    const ux = (e[2] - e[0]) / L, uy = (e[3] - e[1]) / L;
    const d = (cx - e[0]) * ux + (cy - e[1]) * uy, hw = scene.bearing / 2;
    const lo = Math.max(0, d - hw), hi = Math.min(L, d + hw);
    if (hi - lo < 1e-6) return null;
    return { x: r4(e[0] + lo * ux), y: r4(e[1] + lo * uy), x1: r4(e[0] + hi * ux), y1: r4(e[1] + hi * uy) };
  };

  const onPoly = (pts: [number, number][], x: number, y: number) => {
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      if (distSeg(x, y, a[0], a[1], b[0], b[1]) < 2e-3) return true;
    }
    return false;
  };

  const hitTest = (px: number, py: number): Selection => {
    const v = viewRef.current;
    for (const l of scene.loads) {
      if (isLineLoad(l)) {
        if (distSeg(px, py, worldToScreenX(v, l.x), worldToScreenY(v, l.y), worldToScreenX(v, l.x1), worldToScreenY(v, l.y1)) < 36) return { kind: "load", id: l.id };
        continue;
      }
      const F = Math.hypot(l.fx, l.fy) || 1, ux = l.fx / F, uy = l.fy / F;
      const x = worldToScreenX(v, l.x), y = worldToScreenY(v, l.y);
      if (distSeg(px, py, x, y, x - ux * 52, y + uy * 52) < 10) return { kind: "load", id: l.id };
    }
    for (const s of scene.supports) {
      if (distSeg(px, py, worldToScreenX(v, s.x0), worldToScreenY(v, s.y0), worldToScreenX(v, s.x1), worldToScreenY(v, s.y1)) < 12) return { kind: "support", id: s.id };
    }
    const [x, y] = screenToWorld(v, px, py);
    for (let i = scene.shapes.length - 1; i >= 0; i--) {
      if (pointInPolygon(x, y, scene.shapes[i].pts)) return { kind: "shape", id: scene.shapes[i].id };
    }
    return null;
  };

  const shapeLocked = (id: string) => geomLocked && scene.shapes.find((q) => q.id === id)?.mode === "add";

  const finishPoly = useCallback(() => {
    const pts = polyDraftRef.current;
    if (pts.length >= 3) {
      const add = tool === "poly+";
      const sh: Shape = { id: nextId(add ? "S" : "A"), mode: add ? "add" : "cut", pts: pts.map((p) => [...p] as [number, number]) };
      onSceneChange((prev) => ({ ...prev, shapes: [...prev.shapes, sh] }), true);
      onSelChange({ kind: "shape", id: sh.id });
      onToolChange("select");
    }
    polyDraftRef.current = [];
    drawNow();
  }, [tool, nextId, onSceneChange, onSelChange, onToolChange, drawNow]);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const tag = (ev.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (ev.key === "Tab" && tool === "rebar") {
        ev.preventDefault();
        layerDirRef.current = layerDirRef.current === 1 ? -1 : 1;
        onToast(layerDirRef.current === 1 ? "Camada paralela: acima (para dentro do concreto)" : "Camada paralela: abaixo");
      }
      if (ev.key === "Enter" && tool.startsWith("poly")) finishPoly();
      if (ev.key === "Escape") {
        polyDraftRef.current = [];
        arcDraftRef.current = [];
        dragRef.current = null;
        rebarPreviewRef.current = null;
        onToolChange("select");
        drawNow();
      }
      if ((ev.key === "Delete" || ev.key === "Backspace") && sel) {
        if (sel.kind === "shape" && shapeLocked(sel.id)) {
          onToast("Geometria principal travada — destrave para excluir.");
          return;
        }
        onSceneChange((prev) => ({
          ...prev,
          shapes: prev.shapes.filter((s) => s.id !== sel.id),
          loads: prev.loads.filter((l) => l.id !== sel.id),
          supports: prev.supports.filter((s) => s.id !== sel.id),
        }), true);
        onSelChange(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tool, sel, finishPoly, geomLocked, scene.shapes, onSceneChange, onSelChange, onToolChange, onToast, drawNow]);

  const evPos = (ev: React.MouseEvent): [number, number] => {
    const r = cvRef.current!.getBoundingClientRect();
    return [ev.clientX - r.left, ev.clientY - r.top];
  };

  const handleMouseDown = (ev: React.MouseEvent) => {
    const [px, py] = evPos(ev);
    if (ev.button === 2 || ev.button === 1) { panRef.current = { x: px, y: py }; return; }
    const [wxm, wym] = screenToWorld(viewRef.current, px, py);
    const p: [number, number] = [snap(wxm), snap(wym)];
    if (tool === "select") {
      const h = hitTest(px, py);
      onSelChange(h);
      if (h?.kind === "load") dragRef.current = { type: "moveLoad", start: [wxm, wym], cur: [wxm, wym] };
      else if (h?.kind === "shape" && !shapeLocked(h.id)) {
        const sh = scene.shapes.find((s) => s.id === h.id)!;
        dragRef.current = {
          type: "moveShape", start: [wxm, wym], cur: [wxm, wym],
          orig: { pts: sh.pts.map((q) => [...q]), loads: scene.loads.map((l) => ({ ...l })), sups: scene.supports.map((s) => ({ ...s })) },
        };
      } else if (h?.kind === "shape") onToast("Geometria principal travada — só aberturas, forças e apoios podem ser movidos.");
    } else if (tool === "load" || tool === "qload" || tool === "support") {
      const g = edgeGrip(px, py, 28);
      if (!g) { onToast("Clique sobre um lado do contorno (linhas azuis pontilhadas)."); return; }
      if (tool === "support" || tool === "qload") dragRef.current = { type: "support", start: [g.x, g.y], cur: [g.x, g.y] };
    } else if (geomLocked && (tool === "rect+" || tool === "poly+")) {
      onToast("Geometria principal travada.");
    } else if (tool === "rebar" || tool === "arcbar") {
      /* criado no click */
    } else if (tool === "poly+" || tool === "poly-") {
      polyDraftRef.current.push(p);
    } else {
      dragRef.current = { type: tool, start: p, cur: p };
    }
    drawNow();
  };

  const handleMouseMove = (ev: React.MouseEvent) => {
    const [px, py] = evPos(ev);
    if (panRef.current) {
      viewRef.current = {
        ...viewRef.current,
        ox: viewRef.current.ox + (px - panRef.current.x),
        oy: viewRef.current.oy + (py - panRef.current.y),
      };
      panRef.current = { x: px, y: py };
      drawNow();
      return;
    }
    const [wxm, wym] = screenToWorld(viewRef.current, px, py);
    setCoords([wxm, wym]);
    hoverWorldRef.current = [snap(wxm), snap(wym)];

    if (tool === "rebar") {
      const f = nearestFace(scene, wxm, wym, 42 / viewRef.current.s);
      if (f) {
        const opts = { form: rebarCfg.form, cover: rebarCfg.cover, dia: rebarCfg.dia, end: (f.t < 0.5 ? 0 : 1) as 0 | 1, legLen: rebarCfg.leg };
        const layer = parallelLayerOffset(scene, { shape: f.shape, i: f.i }, opts, layerDirRef.current);
        const paths = smartBarPaths(scene, { shape: f.shape, i: f.i }, { ...opts, cover: layer.effectiveCover });
        rebarPreviewRef.current = paths.length > 0 ? { path: paths[0], extra: paths.length > 1 ? paths.slice(1) : undefined, a: f.a, b: f.b } : null;
      } else rebarPreviewRef.current = null;
    } else rebarPreviewRef.current = null;

    const gr = tool === "load" || tool === "qload" || tool === "support" || dragRef.current?.type === "moveLoad" ? edgeGrip(px, py, 40) : null;
    hoverGripRef.current = gr ? [gr.x, gr.y] : null;

    const d = dragRef.current;
    if (d) {
      setTooltip(null);
      if (d.type === "moveLoad" && sel) {
        const v = edgeGrip(px, py, 60);
        if (v) {
          onSceneChange((prev) => ({
            ...prev,
            loads: prev.loads.map((l) => {
              if (l.id !== sel.id) return l;
              const pl = isLineLoad(l) ? plateOnEdge(v.edge, v.x, v.y) : null;
              if (pl) return { ...l, ...pl };
              const cp = { ...l, x: v.x, y: v.y };
              delete cp.x1; delete cp.y1;
              return cp;
            }),
          }), true);
        }
      } else if (d.type === "moveShape" && sel) {
        const dx = snap(wxm - d.start[0]), dy = snap(wym - d.start[1]);
        const o = d.orig;
        onSceneChange((prev) => ({
          ...prev,
          shapes: prev.shapes.map((sh) => sh.id === sel.id ? { ...sh, pts: o.pts.map((q: number[]) => [r4(q[0] + dx), r4(q[1] + dy)] as [number, number]) } : sh),
          loads: prev.loads.map((l, i) => {
            const O = o.loads[i];
            const nl = { ...l };
            if (onPoly(o.pts, O.x, O.y)) { nl.x = r4(O.x + dx); nl.y = r4(O.y + dy); }
            if (O.x1 !== undefined && onPoly(o.pts, O.x1, O.y1)) { nl.x1 = r4(O.x1 + dx); nl.y1 = r4(O.y1 + dy); }
            return nl;
          }),
          supports: prev.supports.map((s, i) => {
            const O = o.sups[i];
            const ns = { ...s };
            if (onPoly(o.pts, O.x0, O.y0)) { ns.x0 = r4(O.x0 + dx); ns.y0 = r4(O.y0 + dy); }
            if (onPoly(o.pts, O.x1, O.y1)) { ns.x1 = r4(O.x1 + dx); ns.y1 = r4(O.y1 + dy); }
            return ns;
          }),
        }), true);
      } else if (d.type === "support") {
        const edges = sceneEdges(scene);
        let best: { x: number; y: number } | null = null, bd = Infinity;
        edges.forEach((e, i) => {
          if (distSeg(d.start[0], d.start[1], e[0], e[1], e[2], e[3]) > 2e-3) return;
          const g = edgeGrip(px, py, 1e9, i);
          if (g) {
            const dist = Math.hypot(worldToScreenX(viewRef.current, g.x) - px, worldToScreenY(viewRef.current, g.y) - py);
            if (dist < bd) { bd = dist; best = g; }
          }
        });
        if (best) d.cur = [(best as any).x, (best as any).y];
      } else {
        d.cur = hoverWorldRef.current;
      }
      drawNow();
      return;
    }

    if (tool === "select") {
      const info = inspectHoverPoint(px, py, viewRef.current, scene, frame, viewMode, stm);
      if (info) {
        if (info.barId !== hoverBarId) onHoverBarChange(info.barId);
        setTooltip({ x: ev.clientX, y: ev.clientY, title: info.title, lines: info.lines });
      } else {
        if (hoverBarId !== null) onHoverBarChange(null);
        setTooltip(null);
      }
    } else {
      setTooltip(null);
    }
    drawNow();
  };

  const handleMouseUp = () => {
    panRef.current = null;
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    if (d.type === "moveLoad" || d.type === "moveShape") { drawNow(); return; }
    const [a, b] = [d.start, d.cur];
    if (tool === "rect+" || tool === "rect-") {
      const w = Math.abs(b[0] - a[0]), h = Math.abs(b[1] - a[1]);
      if (w >= scene.h && h >= scene.h) {
        const sh: Shape = { id: nextId(tool === "rect+" ? "S" : "A"), mode: tool === "rect+" ? "add" : "cut", pts: rectPts(Math.min(a[0], b[0]), Math.min(a[1], b[1]), w, h) };
        onSceneChange((prev) => ({ ...prev, shapes: [...prev.shapes, sh] }), true);
        onSelChange({ kind: "shape", id: sh.id });
        onToolChange("select");
      }
    } else if (tool === "qload") {
      let seg: { x: number; y: number; x1: number; y1: number } | null = { x: a[0], y: a[1], x1: b[0], y1: b[1] };
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) < scene.h) {
        const q = nearestEdgePoint(scene, a[0], a[1]);
        seg = q ? plateOnEdge(q.edge, a[0], a[1]) : null;
      }
      if (!seg) { onToast("Arraste ao longo de um lado (ou clique com placa > 0) para criar carga distribuída."); drawNow(); return; }
      const l: LoadSpec = { id: nextId("Q"), ...seg, fx: 0, fy: -100 };
      onSceneChange((prev) => ({ ...prev, loads: [...prev.loads, l] }), true);
      onSelChange({ kind: "load", id: l.id });
      onToolChange("select");
    } else if (tool === "support") {
      const sp: SupportSpec = { id: nextId("Ap"), x0: a[0], y0: a[1], x1: b[0], y1: b[1], ...supportFlags(supportKindDefault) };
      onSceneChange((prev) => ({ ...prev, supports: [...prev.supports, sp] }), true);
      onSelChange({ kind: "support", id: sp.id });
      onToolChange("select");
    }
    drawNow();
  };

  const handleClick = (ev: React.MouseEvent) => {
    if (ev.button !== 0) return;
    if (tool === "rebar") {
      const rp = rebarPreviewRef.current;
      if (!rp) { onToast("Aproxime o cursor de uma face da peça para criar a barra."); return; }
      if (!(rebarCfg.steel in STEEL_CLASSES)) { onToast("A norma ativa não possui classe de aço conferida."); return; }
      const c = STEEL_CLASSES[rebarCfg.steel];
      const id = nextId("B");
      onSceneChange((prev) => {
        const k = (prev.bars?.length ?? 0) + 1;
        return {
          ...prev,
          bars: [
            ...(prev.bars ?? []),
            {
              id,
              label: `As${k} (${rebarCfg.n}Ø${String(rebarCfg.dia).replace(".", ",")})`,
              path: rp.path.map((q) => [...q] as [number, number]),
              extra: rp.extra?.map((seg) => seg.map((q) => [...q] as [number, number])),
              areaCm2: barAreaCm2(rebarCfg.n, rebarCfg.dia),
              steelClass: rebarCfg.steel,
              fy: c.fy, ft: c.ft, Es: c.Es, epsU: c.epsU,
            },
          ],
        };
      }, true);
      return;
    }
    if (tool === "arcbar") {
      const [px, py] = evPos(ev);
      const [wxm, wym] = screenToWorld(viewRef.current, px, py);
      const pt: [number, number] = [snap(wxm), snap(wym)];
      arcDraftRef.current.push(pt);
      if (arcDraftRef.current.length >= 3) {
        const [p1, p2, p3] = arcDraftRef.current;
        arcDraftRef.current = [];
        const pts = arcFrom3Points(p1, p2, p3, Math.max(0.002, scene.h / 8));
        const id = nextId("B");
        const c = STEEL_CLASSES[rebarCfg.steel];
        onSceneChange((prev) => {
          const k = (prev.bars?.length ?? 0) + 1;
          return {
            ...prev,
            bars: [
              ...(prev.bars ?? []),
              {
                id,
                label: `As${k} Arco (${rebarCfg.n}Ø${String(rebarCfg.dia).replace(".", ",")})`,
                path: pts,
                curve: { type: "arc", p1, p2, p3 },
                areaCm2: barAreaCm2(rebarCfg.n, rebarCfg.dia),
                steelClass: rebarCfg.steel,
                fy: c.fy, ft: c.ft, Es: c.Es, epsU: c.epsU,
              },
            ],
          };
        }, true);
        onToast("Barra em arco adicionada.");
      }
      drawNow();
      return;
    }
    if (tool === "load") {
      const [px, py] = evPos(ev);
      const v = edgeGrip(px, py, 28);
      if (!v) return;
      const l: LoadSpec = { id: nextId("P"), x: v.x, y: v.y, fx: 0, fy: -100, point: true };
      onSceneChange((prev) => ({ ...prev, loads: [...prev.loads, l] }), true);
      onSelChange({ kind: "load", id: l.id });
      onToolChange("select");
    }
  };

  const handleWheel = (ev: React.WheelEvent) => {
    const [px, py] = evPos(ev);
    const [x, y] = screenToWorld(viewRef.current, px, py);
    const factor = ev.deltaY < 0 ? 1.12 : 1 / 1.12;
    const ns = Math.max(5, Math.min(5000, viewRef.current.s * factor));
    viewRef.current = { s: ns, ox: px - x * ns, oy: py + y * ns };
    drawNow();
  };

  const tools: { id: Tool; label: string; icon: React.ReactNode; geo?: boolean }[] = [
    { id: "select", label: "Selecionar", icon: <MousePointer2 className="w-3.5 h-3.5" /> },
    { id: "rect+", label: "Retângulo", icon: <RectangleHorizontal className="w-3.5 h-3.5" />, geo: true },
    { id: "rect-", label: "Abertura", icon: <SquareDashed className="w-3.5 h-3.5" /> },
    { id: "poly+", label: "Polígono", icon: <Pentagon className="w-3.5 h-3.5" />, geo: true },
    { id: "poly-", label: "Ab. Polig.", icon: <Layers className="w-3.5 h-3.5" /> },
    { id: "load", label: "Pontual", icon: <ArrowDown className="w-3.5 h-3.5" /> },
    { id: "qload", label: "Distribuída", icon: <ArrowDownToLine className="w-3.5 h-3.5" /> },
    { id: "support", label: "Apoio", icon: <Triangle className="w-3.5 h-3.5" /> },
    { id: "rebar", label: "Armadura", icon: <Grid className="w-3.5 h-3.5" /> },
    { id: "arcbar", label: "Arco 3 pts", icon: <Spline className="w-3.5 h-3.5" /> },
  ];

  const legend = LEGENDS[viewMode];

  return (
    <div className="flex flex-col flex-1 min-w-0 min-h-0 bg-white">
      {/* Toolbar CAD */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-slate-200 bg-white flex-wrap no-print">
        {tools.map((t) => {
          const disabled = !!(t.geo && geomLocked);
          const active = tool === t.id;
          return (
            <button
              key={t.id}
              type="button"
              disabled={disabled}
              onClick={() => onToolChange(t.id)}
              title={HINTS[t.id]}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                active
                  ? "bg-blue-600 text-white border-blue-600 shadow-xs"
                  : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
              }`}
            >
              {t.icon}
              <span>{t.label}</span>
            </button>
          );
        })}
        <div className="h-5 w-px bg-slate-200 mx-1" />
        <button
          type="button"
          onClick={() => {
            const next = !geomLocked;
            onGeomLockedChange(next);
            if (next && (tool === "rect+" || tool === "poly+")) onToolChange("select");
          }}
          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium border ${
            geomLocked
              ? "bg-amber-50 text-amber-800 border-amber-300"
              : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
          }`}
          title="Travar geometria principal (aberturas, cargas e apoios continuam editáveis)"
        >
          {geomLocked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
          <span>{geomLocked ? "Travada" : "Travar"}</span>
        </button>
        <button
          type="button"
          onClick={fitView}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
          title="Enquadrar modelo na tela"
        >
          <Maximize2 className="w-3.5 h-3.5" />
          <span>Enquadrar</span>
        </button>
        <span className="text-[11px] text-slate-500 ml-auto hidden xl:inline truncate max-w-md">{HINTS[tool]}</span>
      </div>

      {/* Barra de Pós-Processamento / Vista */}
      <div className="flex items-center gap-4 px-3 py-1.5 border-b border-slate-200 bg-slate-50 text-xs text-slate-700 flex-wrap no-print">
        <label className="flex items-center gap-2 font-medium">
          <span className="text-slate-500">Vista</span>
          <select
            value={viewMode}
            onChange={(e) => onViewModeChange(e.target.value as ViewMode)}
            className="px-2 py-1 rounded border border-slate-300 bg-white text-slate-800 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <optgroup label="Análise Não Linear (Nível 2 · CSFM)">
              <option value="nlutil">Taxa de utilização (% concreto + aço)</option>
              <option value="nlcrack">Fissuras orientadas (⊥ ε1) e armadura</option>
              <option value="nlconc">Deformação de compressão ε3 / εcu</option>
              <option value="nlstress">Tensão principal de compressão |σ3| / fc</option>
            </optgroup>
            <optgroup label="Otimização & Campo Elástico">
              <option value="topo">Topologia + trajetórias σ1/σ2</option>
              <option value="stm">STM — Bielas, tirantes e nós</option>
              <option value="s1">Tração principal σ1</option>
              <option value="s2">Compressão principal σ2</option>
              <option value="def">Deformada ampliada</option>
              <option value="csfm">CSFM linear — zonas tracionadas</option>
            </optgroup>
          </select>
        </label>

        <label className="flex items-center gap-1.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showMesh}
            onChange={(e) => onShowMeshChange(e.target.checked)}
            className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
          />
          <span>Malha</span>
        </label>

        {viewMode === "stm" && (
          <div className="flex items-center gap-1.5">
            <span className="text-slate-500">STM:</span>
            {(["both", "axes", "contours"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => onStmDisplayModeChange(mode)}
                className={`px-2 py-0.5 rounded border text-[11px] font-medium ${
                  stmDisplayMode === mode
                    ? "bg-blue-600 text-white border-blue-600"
                    : "bg-white text-slate-600 border-slate-300 hover:bg-slate-100"
                }`}
              >
                {mode === "both" ? "Ambos" : mode === "axes" ? "Eixos" : "Contornos"}
              </button>
            ))}
            <button
              type="button"
              onClick={onExportStmSvg}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 text-[11px] font-medium"
              title="Exportar desenho vetorial SVG (contornos CAST + barras)"
            >
              <Download className="w-3 h-3" />
              <span>SVG</span>
            </button>
          </div>
        )}

        {frameCount > 1 && (
          <label className="flex items-center gap-2">
            <span className="text-slate-500">Passo</span>
            <input
              type="range"
              min={0}
              max={frameCount - 1}
              value={Math.min(frameIndex, frameCount - 1)}
              onChange={(e) => onFrameIndexChange(+e.target.value)}
              className="w-36 accent-blue-600"
            />
            <span className="font-mono-tech text-[11px] text-slate-600 min-w-14">
              {frameIndex + 1}/{frameCount}
            </span>
          </label>
        )}

        {frame?.nl && (
          <span className="ml-auto font-mono-tech text-[11px] px-2 py-0.5 rounded bg-blue-50 text-blue-800 border border-blue-200">
            λ = {frame.nl.lambda.toFixed(3)} · P = {(frame.nl.lambda * (frame.P0 ?? 0)).toFixed(0)} kN
          </span>
        )}
      </div>

      {/* Área do Canvas */}
      <div ref={wrapRef} className="relative flex-1 min-h-0 overflow-hidden bg-white">
        <canvas
          ref={cvRef}
          onContextMenu={(e) => e.preventDefault()}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onClick={handleClick}
          onDoubleClick={() => {
            if (tool.startsWith("poly")) {
              polyDraftRef.current.pop();
              finishPoly();
            }
          }}
          onWheel={handleWheel}
          onMouseLeave={() => {
            panRef.current = null;
            setCoords(null);
            setTooltip(null);
            if (hoverBarId !== null) onHoverBarChange(null);
          }}
          className={`absolute inset-0 w-full h-full block ${tool === "select" ? "cursor-default" : "cursor-crosshair"}`}
        />

        {/* Coordenadas do cursor */}
        <div className="absolute left-3 top-2.5 px-2.5 py-1 rounded-md bg-white/92 backdrop-blur-xs border border-slate-200 shadow-xs text-[11px] font-mono-tech text-slate-600 pointer-events-none">
          X: <strong className="text-slate-900">{coords ? coords[0].toFixed(2) : "—"}</strong> m · Y:{" "}
          <strong className="text-slate-900">{coords ? coords[1].toFixed(2) : "—"}</strong> m
        </div>

        {/* Legenda */}
        <div className="absolute right-3 top-2.5 px-3 py-2 rounded-lg bg-white/94 backdrop-blur-xs border border-slate-200 shadow-xs text-[11px] pointer-events-none min-w-48">
          <div className="font-semibold text-slate-800 border-b border-slate-200 pb-1 mb-1.5">{legend.title}</div>
          <div className="space-y-1">
            {legend.items.map(([sw, lbl]) => (
              <div key={lbl} className="flex items-center gap-2 text-slate-600">
                <span
                  className={`inline-block w-6 h-2.5 rounded-xs shrink-0 ${
                    sw === "dash" ? "border-2 border-dashed border-red-600 bg-transparent" : "border border-slate-900/20"
                  }`}
                  style={sw === "dash" ? undefined : { background: sw }}
                />
                <span>{lbl}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Mensagens de erro / aviso sobre o canvas */}
        {(errors.length > 0 || warnings.length > 0) && (
          <div className="absolute left-3 bottom-3 max-w-xl space-y-1 pointer-events-none">
            {errors.map((e, i) => (
              <div key={`e${i}`} className="px-2.5 py-1.5 rounded-md bg-red-50/95 border border-red-200 text-red-900 text-xs shadow-xs">
                {e}
              </div>
            ))}
            {warnings.map((w, i) => (
              <div key={`w${i}`} className="px-2.5 py-1.5 rounded-md bg-amber-50/95 border border-amber-200 text-amber-900 text-xs shadow-xs">
                {w}
              </div>
            ))}
          </div>
        )}

        {/* Tooltip técnico flutuante */}
        {tooltip && (
          <div
            className="fixed z-40 pointer-events-none max-w-xs px-2.5 py-1.5 rounded-md bg-slate-900/95 text-slate-100 text-[11.5px] shadow-lg leading-snug"
            style={{
              left: Math.min(window.innerWidth - 290, tooltip.x + 14),
              top: Math.min(window.innerHeight - 100, tooltip.y + 14),
            }}
          >
            {tooltip.title && <div className="font-semibold text-amber-300 mb-0.5">{tooltip.title}</div>}
            {tooltip.lines.map((l, i) => (
              <div key={i} className="font-mono-tech text-[11px]">{l}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});
