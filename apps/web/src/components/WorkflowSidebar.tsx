import React, { useMemo, useState } from "react";
import {
  BAR_DIAMETERS,
  CSFM_DEFAULTS,
  FCK_MIN,
  STEEL_CLASSES,
  buildProblem,
  cappedAutoFilterRadius,
  clampFck,
  codeById,
  generateStirrupGroup,
  isLineLoad,
  lineLoadIntensity,
  nearestEdgePoint,
  sceneBounds,
  sceneEdges,
  strutDesignStrength,
  supportFlags,
  supportKind,
} from "@stm/core";
import type { BenchmarkEntry, DesignCodeId, Scene, SupportKind } from "@stm/core";
import {
  Activity,
  Box,
  Cpu,
  Eraser,
  Grid,
  Play,
  Plus,
  Scale,
  Sparkles,
  Square,
  Target,
  Trash2,
} from "lucide-react";
import type { CsfmSummary, FrameMsg, RebarToolConfig, Selection, TabId, Tool } from "../types/app";
import { NormasTab } from "./NormasTab";

interface WorkflowSidebarProps {
  tab: TabId;
  onTabChange: (t: TabId) => void;
  scene: Scene;
  onSceneChange: (updater: (prev: Scene) => Scene, clearResults?: boolean) => void;
  codeId: DesignCodeId;
  onSelectCode: (id: DesignCodeId) => void;
  sel: Selection;
  onSelChange: (s: Selection) => void;
  geomLocked: boolean;
  supportKindDefault: SupportKind;
  onSupportKindDefaultChange: (k: SupportKind) => void;
  rebarCfg: RebarToolConfig;
  onRebarCfgChange: (c: RebarToolConfig) => void;
  tool: Tool;
  onToolChange: (t: Tool) => void;
  hoverBarId: string | null;
  onHoverBarChange: (id: string | null) => void;
  nextId: (prefix: string) => string;
  // otimização
  optMethod: "beso" | "simp";
  onOptMethodChange: (m: "beso" | "simp") => void;
  volfrac: number;
  onVolfracChange: (v: number) => void;
  rmin: number;
  onRminChange: (v: number) => void;
  rminAuto: boolean;
  onRminAutoChange: (v: boolean) => void;
  // execução
  runningMode: "opt" | "nl" | null;
  onRunElastic: () => void;
  onRunCsfmLinear: () => void;
  onRunOpt: () => void;
  onRunNl: () => void;
  onStop: () => void;
  onClearResults: () => void;
  onClearAll: () => void;
  // estado atual
  frame: FrameMsg | null;
  csfm: CsfmSummary | null;
  benchmark: BenchmarkEntry | null;
  onToast: (msg: string) => void;
}

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

export const WorkflowSidebar: React.FC<WorkflowSidebarProps> = (props) => {
  const {
    tab, onTabChange, scene, onSceneChange, codeId, onSelectCode,
    sel, onSelChange, geomLocked, supportKindDefault, onSupportKindDefaultChange,
    rebarCfg, onRebarCfgChange, tool, onToolChange, hoverBarId, onHoverBarChange, nextId,
    optMethod, onOptMethodChange, volfrac, onVolfracChange, rmin, onRminChange, rminAuto, onRminAutoChange,
    runningMode, onRunElastic, onRunCsfmLinear, onRunOpt, onRunNl, onStop, onClearResults, onClearAll,
    frame, csfm, benchmark, onToast,
  } = props;

  const code = codeById(codeId);

  // Estado local do gerador de estribos/malha
  const [stOrient, setStOrient] = useState<"vertical" | "horizontal">("vertical");
  const [stCoverCm, setStCoverCm] = useState(3);
  const [stSpacingCm, setStSpacingCm] = useState(15);
  const [stLegs, setStLegs] = useState(2);
  const [stDia, setStDia] = useState(6.3);
  const [stBounds, setStBounds] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);

  const meshStatus = useMemo(() => {
    try {
      const r = buildProblem(scene);
      if (!r.problem) return { tone: "bad" as const, text: r.errors[0] ?? "Modelo inválido." };
      let n = 0;
      for (const v of r.problem.mask) if (v) n++;
      const nf = n.toLocaleString("pt-BR");
      if (scene.h > 0.05) return { tone: "warn" as const, text: `${nf} elem. · h = ${scene.h} m (malha grossa para Nível 2)` };
      if (n > 12000) return { tone: "warn" as const, text: `${nf} elem. · h = ${scene.h} m (malha pesada; máx. 20 000)` };
      return { tone: "ok" as const, text: `${nf} elem. · h = ${scene.h} m (malha adequada)` };
    } catch (e) {
      return { tone: "bad" as const, text: String((e as Error).message ?? e) };
    }
  }, [scene]);

  const bielaSummary = useMemo(() => {
    const fck = clampFck(scene.fck ?? 30);
    let F: number;
    let origem: string;
    if (frame && frame.reactions.length) {
      F = Math.max(...frame.reactions.map((r) => Math.hypot(r.rx, r.ry)));
      origem = "maior reação";
    } else {
      const tot = scene.loads.reduce((a, l) => a + Math.hypot(l.fx, l.fy), 0);
      F = tot / Math.max(1, scene.supports.length);
      origem = "carga ÷ apoios";
    }
    const sd = strutDesignStrength(code, fck);
    const a = F > 0 ? Math.abs(F) / (scene.t * sd.sigma * 1000) : 0;
    const prob = buildProblem(scene).problem;
    const rCalc = F > 0 ? cappedAutoFilterRadius(a, scene.h, prob?.mask, prob?.nelx, prob?.nely) : rmin;
    return { F, origem, sd, a, rCalc };
  }, [scene, frame, code, rmin]);

  const effectiveRmin = rminAuto ? bielaSummary.rCalc : rmin;

  const projectToEdge = (x: number, y: number): [number, number] => {
    const q = nearestEdgePoint(scene, x, y);
    return q ? [r4(q.x), r4(q.y)] : [x, y];
  };

  const reprojectScene = (s: Scene): Scene => {
    const proj = (x: number, y: number): [number, number] => {
      const q = nearestEdgePoint(s, x, y);
      return q ? [r4(q.x), r4(q.y)] : [x, y];
    };
    return {
      ...s,
      loads: s.loads.map((l) => {
        const [x, y] = proj(l.x, l.y);
        if (l.x1 !== undefined && l.y1 !== undefined) {
          const [x1, y1] = proj(l.x1, l.y1);
          return { ...l, x, y, x1, y1 };
        }
        return { ...l, x, y };
      }),
      supports: s.supports.map((sp) => {
        const [x0, y0] = proj(sp.x0, sp.y0);
        const [x1, y1] = proj(sp.x1, sp.y1);
        return { ...sp, x0, y0, x1, y1 };
      }),
    };
  };

  const nlParams = scene.nl ?? { values: "design" as const, epsCu: code.epsCu, crushLength: scene.t, crushAuto: true, code: codeId };
  const crushAuto = nlParams.crushAuto !== false;

  const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
    { id: "modelo", label: "Modelo", icon: <Box className="w-3.5 h-3.5" /> },
    { id: "otim", label: "Topologia", icon: <Sparkles className="w-3.5 h-3.5" /> },
    { id: "armadura", label: "Armadura", icon: <Grid className="w-3.5 h-3.5" /> },
    { id: "nl", label: "Nível 2", icon: <Cpu className="w-3.5 h-3.5" /> },
    { id: "normas", label: "Normas", icon: <Scale className="w-3.5 h-3.5" /> },
  ];

  const handleGenerateStirrups = () => {
    const b = stBounds ?? sceneBounds(scene);
    if (!b) { onToast("Defina uma geometria primeiro."); return; }
    const steelChoice = code.steelClasses.includes("CA60")
      ? "CA60"
      : code.steelClasses[0] ?? "CA50";
    const grp = generateStirrupGroup({
      id: nextId("B"),
      x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1,
      orientation: stOrient,
      cover: Math.max(0.01, stCoverCm / 100),
      spacing: Math.max(0.03, stSpacingCm / 100),
      legs: Math.max(1, Math.round(stLegs)),
      diaMm: stDia,
      steelClass: steelChoice,
    });
    if (!grp) { onToast("Região muito pequena para o cobrimento/espaçamento informado."); return; }
    onSceneChange((prev) => ({ ...prev, bars: [...(prev.bars ?? []), grp] }), true);
    onToast(`Grupo "${grp.label}" adicionado (${1 + (grp.extra?.length ?? 0)} barras).`);
  };

  const steelOptionsForBar = (current?: string): [string, string][] => {
    const out: [string, string][] = code.steelClasses.map((k) => [k, STEEL_CLASSES[k].label]);
    if (current && current !== "custom" && !code.steelClasses.includes(current as never) && current in STEEL_CLASSES) {
      out.push([current, `${STEEL_CLASSES[current as keyof typeof STEEL_CLASSES].label} (fora da norma)`]);
    }
    out.push(["custom", "Ensaio"]);
    return out;
  };

  return (
    <aside className="w-92 bg-white border-r border-slate-200 flex flex-col min-h-0 shrink-0 no-print">
      {/* Navegação por estágios */}
      <nav className="grid grid-cols-5 border-b border-slate-200 bg-slate-50">
        {tabs.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onTabChange(t.id)}
              className={`flex flex-col items-center justify-center gap-0.5 py-2 px-1 text-[11px] font-semibold border-b-2 transition-colors ${
                active
                  ? "border-blue-600 text-blue-700 bg-white"
                  : "border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-100/70"
              }`}
            >
              {t.icon}
              <span>{t.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Conteúdo da aba ativa */}
      <div className="flex-1 overflow-y-auto p-3.5 space-y-4">
        {/* ─── ABA 1: MODELO ─── */}
        {tab === "modelo" && (
          <>
            <section className="space-y-2">
              <h2 className="text-[10.5px] font-bold uppercase tracking-wider text-slate-400">Malha & Materiais</h2>
              <div className="grid grid-cols-2 gap-2.5 text-xs">
                <label className="space-y-1">
                  <span className="text-slate-600">Elemento h (m)</span>
                  <input
                    type="number" step="0.005" min="0.005" value={scene.h}
                    onChange={(e) => { const v = +e.target.value; if (v > 0) onSceneChange((p) => ({ ...p, h: v }), true); }}
                    className="w-full px-2 py-1 border border-slate-300 rounded-md font-mono-tech"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-slate-600">Espessura t (m)</span>
                  <input
                    type="number" step="0.01" min="0.05" value={scene.t}
                    onChange={(e) => {
                      const v = +e.target.value;
                      if (v > 0) onSceneChange((p) => ({ ...p, t: v, nl: p.nl && p.nl.crushAuto !== false ? { ...p.nl, crushLength: v } : p.nl }), true);
                    }}
                    className="w-full px-2 py-1 border border-slate-300 rounded-md font-mono-tech"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-slate-600">fck (MPa)</span>
                  <input
                    type="number" step="1" min={FCK_MIN} value={scene.fck ?? 30}
                    onChange={(e) => {
                      const raw = +e.target.value;
                      const v = clampFck(raw);
                      if (raw < FCK_MIN) onToast(`fck mínimo: ${FCK_MIN} MPa.`);
                      else if (v > 50) onToast("Atenção: fck > 50 MPa — εc2 = 2,0 ‰ e εcu = 3,5 ‰ valem para fck ≤ 50 MPa.");
                      onSceneChange((p) => ({ ...p, fck: v }), !!frame?.nl);
                    }}
                    className="w-full px-2 py-1 border border-slate-300 rounded-md font-mono-tech"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-slate-600">Placa carga (m)</span>
                  <input
                    type="number" step="0.05" min="0" value={scene.bearing}
                    onChange={(e) => {
                      const v = +e.target.value;
                      if (v < 0) return;
                      onSceneChange((p) => {
                        const loads = p.loads.map((l) => {
                          if (l.point) return l;
                          const mx = isLineLoad(l) ? (l.x + l.x1) / 2 : l.x;
                          const my = isLineLoad(l) ? (l.y + l.y1) / 2 : l.y;
                          const q = nearestEdgePoint(p, mx, my);
                          if (!q || !(v > 0)) {
                            const cp = { ...l, x: r4(mx), y: r4(my) };
                            delete cp.x1; delete cp.y1;
                            return cp;
                          }
                          const ed = sceneEdges(p)[q.edge], L = Math.hypot(ed[2] - ed[0], ed[3] - ed[1]);
                          if (!L) return l;
                          const ux = (ed[2] - ed[0]) / L, uy = (ed[3] - ed[1]) / L;
                          const d = (mx - ed[0]) * ux + (my - ed[1]) * uy;
                          const lo = Math.max(0, d - v / 2), hi = Math.min(L, d + v / 2);
                          return { ...l, x: r4(ed[0] + lo * ux), y: r4(ed[1] + lo * uy), x1: r4(ed[0] + hi * ux), y1: r4(ed[1] + hi * uy) };
                        });
                        return { ...p, bearing: v, loads };
                      }, true);
                    }}
                    className="w-full px-2 py-1 border border-slate-300 rounded-md font-mono-tech"
                  />
                </label>
              </div>

              <div className={`px-2.5 py-1.5 rounded-md border text-[11px] font-medium ${
                meshStatus.tone === "ok"
                  ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                  : meshStatus.tone === "warn"
                  ? "bg-amber-50 border-amber-200 text-amber-800"
                  : "bg-red-50 border-red-200 text-red-800"
              }`}>
                {meshStatus.text}
              </div>

              <label className="block text-xs space-y-1">
                <span className="text-slate-600">Tipo de apoio ao desenhar</span>
                <select
                  value={supportKindDefault}
                  onChange={(e) => onSupportKindDefaultChange(e.target.value as SupportKind)}
                  className="w-full px-2 py-1 border border-slate-300 rounded-md text-xs bg-white"
                >
                  <option value="fixo">Fixo (restringe ux e uy)</option>
                  <option value="movel-x">Móvel ↔ (desliza em x; restringe uy)</option>
                  <option value="movel-y">Móvel ↕ (desliza em y; restringe ux)</option>
                </select>
              </label>
            </section>

            {/* Ações de pré-análise */}
            <section className="space-y-1.5">
              <h2 className="text-[10.5px] font-bold uppercase tracking-wider text-slate-400">Análise Linear & Ações</h2>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={onRunElastic} className="px-2.5 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-white text-xs font-medium">
                  Campo elástico
                </button>
                <button type="button" onClick={onRunCsfmLinear} className="px-2.5 py-1.5 rounded-md bg-blue-50 hover:bg-blue-100 text-blue-800 border border-blue-200 text-xs font-medium">
                  CSFM linear
                </button>
                <button type="button" onClick={onClearResults} className="inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 text-xs">
                  <Eraser className="w-3.5 h-3.5" /> Limpar result.
                </button>
                <button type="button" onClick={onClearAll} className="inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-md border border-red-200 text-red-700 hover:bg-red-50 text-xs">
                  <Trash2 className="w-3.5 h-3.5" /> Limpar tudo
                </button>
              </div>
              {csfm && (
                <div className="p-2.5 rounded-md bg-red-50/70 border border-red-200 text-[11px] text-slate-700 space-y-0.5">
                  <div className="font-semibold text-red-900">
                    Zonas tracionadas (σ1 &gt; {CSFM_DEFAULTS.threshold * 100}% máx.) · ΣAs ≈{" "}
                    {csfm.zones.reduce((a, z) => a + z.As, 0).toFixed(1)} cm²
                  </div>
                  {csfm.zones.map((z) => (
                    <div key={z.id} className="font-mono-tech">
                      Z{z.id + 1}: T ≈ {z.T.toFixed(0)} kN · As ≈ {z.As.toFixed(1)} cm² ({((z.theta * 180) / Math.PI).toFixed(0)}°)
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Lista de itens da cena */}
            <section className="space-y-1.5">
              <h2 className="text-[10.5px] font-bold uppercase tracking-wider text-slate-400">Elementos do Modelo</h2>
              <div className="max-h-40 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100 text-xs">
                {scene.shapes.map((s) => (
                  <button
                    key={s.id} type="button" onClick={() => onSelChange({ kind: "shape", id: s.id })}
                    className={`w-full text-left px-2.5 py-1.5 flex justify-between hover:bg-slate-50 ${sel?.id === s.id ? "bg-blue-50 text-blue-800" : ""}`}
                  >
                    <span><strong>{s.id}</strong> · {s.mode === "add" ? "concreto" : "abertura"}</span>
                    <span className="text-slate-400 text-[11px]">{s.pts.length} vért.</span>
                  </button>
                ))}
                {scene.supports.map((s) => (
                  <button
                    key={s.id} type="button" onClick={() => onSelChange({ kind: "support", id: s.id })}
                    className={`w-full text-left px-2.5 py-1.5 flex justify-between hover:bg-slate-50 ${sel?.id === s.id ? "bg-blue-50 text-blue-800" : ""}`}
                  >
                    <span><strong>{s.id}</strong> · apoio</span>
                    <span className="text-slate-400 text-[11px]">{supportKind(s)}</span>
                  </button>
                ))}
                {scene.loads.map((l) => (
                  <button
                    key={l.id} type="button" onClick={() => onSelChange({ kind: "load", id: l.id })}
                    className={`w-full text-left px-2.5 py-1.5 flex justify-between hover:bg-slate-50 ${sel?.id === l.id ? "bg-blue-50 text-blue-800" : ""}`}
                  >
                    <span><strong>{l.id}</strong> · {isLineLoad(l) ? `${lineLoadIntensity(l).toFixed(0)} kN/m` : "pontual"}</span>
                    <span className="font-mono-tech text-slate-500 text-[11px]">Fy={l.fy} kN</span>
                  </button>
                ))}
              </div>
            </section>

            {/* Propriedades do item selecionado */}
            {sel && (
              <section className="p-2.5 rounded-lg border border-blue-200 bg-blue-50/40 space-y-2 text-xs">
                <div className="font-semibold text-blue-800">Selecionado: {sel.id}</div>
                {sel.kind === "load" && (() => {
                  const l = scene.loads.find((q) => q.id === sel.id);
                  if (!l) return null;
                  return (
                    <div className="grid grid-cols-2 gap-2">
                      <label className="space-y-0.5">
                        <span className="text-slate-600 text-[11px]">Fx (kN)</span>
                        <input
                          type="number" step="10" value={l.fx}
                          onChange={(e) => onSceneChange((p) => ({ ...p, loads: p.loads.map((q) => q.id === l.id ? { ...q, fx: +e.target.value } : q) }), true)}
                          className="w-full px-2 py-1 border border-slate-300 rounded bg-white font-mono-tech"
                        />
                      </label>
                      <label className="space-y-0.5">
                        <span className="text-slate-600 text-[11px]">Fy (kN, − baixo)</span>
                        <input
                          type="number" step="10" value={l.fy}
                          onChange={(e) => onSceneChange((p) => ({ ...p, loads: p.loads.map((q) => q.id === l.id ? { ...q, fy: +e.target.value } : q) }), true)}
                          className="w-full px-2 py-1 border border-slate-300 rounded bg-white font-mono-tech"
                        />
                      </label>
                      <label className="space-y-0.5">
                        <span className="text-slate-600 text-[11px]">x (m)</span>
                        <input
                          type="number" step="0.05" value={l.x}
                          onChange={(e) => {
                            const [nx, ny] = projectToEdge(+e.target.value, l.y);
                            onSceneChange((p) => ({ ...p, loads: p.loads.map((q) => q.id === l.id ? { ...q, x: nx, y: ny } : q) }), true);
                          }}
                          className="w-full px-2 py-1 border border-slate-300 rounded bg-white font-mono-tech"
                        />
                      </label>
                      <label className="space-y-0.5">
                        <span className="text-slate-600 text-[11px]">y (m)</span>
                        <input
                          type="number" step="0.05" value={l.y}
                          onChange={(e) => {
                            const [nx, ny] = projectToEdge(l.x, +e.target.value);
                            onSceneChange((p) => ({ ...p, loads: p.loads.map((q) => q.id === l.id ? { ...q, x: nx, y: ny } : q) }), true);
                          }}
                          className="w-full px-2 py-1 border border-slate-300 rounded bg-white font-mono-tech"
                        />
                      </label>
                    </div>
                  );
                })()}
                {sel.kind === "support" && (() => {
                  const sp = scene.supports.find((q) => q.id === sel.id);
                  if (!sp) return null;
                  return (
                    <label className="block space-y-1">
                      <span className="text-slate-600 text-[11px]">Tipo de apoio</span>
                      <select
                        value={supportKind(sp)}
                        onChange={(e) => {
                          const fl = supportFlags(e.target.value as SupportKind);
                          onSceneChange((p) => ({ ...p, supports: p.supports.map((q) => q.id === sp.id ? { ...q, ...fl } : q) }), true);
                        }}
                        className="w-full px-2 py-1 border border-slate-300 rounded bg-white text-xs"
                      >
                        <option value="fixo">Fixo (ux, uy)</option>
                        <option value="movel-x">Móvel ↔ (só uy)</option>
                        <option value="movel-y">Móvel ↕ (só ux)</option>
                      </select>
                    </label>
                  );
                })()}
                {sel.kind === "shape" && (() => {
                  const sh = scene.shapes.find((q) => q.id === sel.id);
                  if (!sh) return null;
                  const lk = geomLocked && sh.mode === "add";
                  return (
                    <div className="space-y-2">
                      <label className="block space-y-1">
                        <span className="text-slate-600 text-[11px]">Vértices (x,y; …) em m {lk ? "· travado" : ""}</span>
                        <input
                          type="text"
                          disabled={lk}
                          defaultValue={sh.pts.map((p) => `${p[0]},${p[1]}`).join("; ")}
                          key={sh.id + sh.pts.length}
                          onBlur={(e) => {
                            const pts = e.target.value.split(";").map((t) => t.split(",").map(Number)).filter((p) => p.length === 2 && p.every(Number.isFinite)) as [number, number][];
                            if (pts.length >= 3) onSceneChange((p) => reprojectScene({ ...p, shapes: p.shapes.map((q) => q.id === sh.id ? { ...q, pts } : q) }), true);
                          }}
                          className="w-full px-2 py-1 border border-slate-300 rounded bg-white font-mono-tech text-[11px] disabled:opacity-50"
                        />
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox" disabled={lk} checked={sh.mode === "cut"}
                          onChange={(e) => onSceneChange((p) => ({ ...p, shapes: p.shapes.map((q) => q.id === sh.id ? { ...q, mode: e.target.checked ? "cut" : "add" } : q) }), true)}
                        />
                        <span>É abertura (subtrai concreto)</span>
                      </label>
                    </div>
                  );
                })()}
              </section>
            )}
          </>
        )}

        {/* ─── ABA 2: TOPOLOGIA ─── */}
        {tab === "otim" && (
          <div className="space-y-4 text-xs">
            <div className="space-y-2.5">
              <h2 className="text-[10.5px] font-bold uppercase tracking-wider text-slate-400">Parâmetros de Otimização</h2>
              <label className="block space-y-1">
                <span className="text-slate-600">Método</span>
                <select
                  value={optMethod}
                  onChange={(e) => onOptMethodChange(e.target.value as "beso" | "simp")}
                  className="w-full px-2.5 py-1.5 border border-slate-300 rounded-md bg-white"
                >
                  <option value="beso">BESO soft-kill (proteção de conectividade)</option>
                  <option value="simp">SIMP (p = 3 · filtro de sensibilidade + OC)</option>
                </select>
              </label>

              <label className="block space-y-1">
                <div className="flex justify-between">
                  <span className="text-slate-600">Fração de volume alvo</span>
                  <strong className="font-mono-tech text-slate-900">{Math.round(volfrac * 100)} %</strong>
                </div>
                <input
                  type="range" min={0.15} max={0.8} step={0.05} value={volfrac}
                  onChange={(e) => onVolfracChange(+e.target.value)}
                  className="w-full accent-blue-600"
                />
                <div className="text-[10.5px] text-slate-500">
                  Faixas da literatura: 40 % (Xia et al.), 30–40 % (Queiroz &amp; Leonel), 20–80 % (IDEA).
                </div>
              </label>

              <div className="space-y-1.5 p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                <div className="flex items-center justify-between">
                  <span className="text-slate-700 font-medium">Raio do filtro (rmin)</span>
                  <label className="flex items-center gap-1.5 text-[11px] text-blue-700 font-medium cursor-pointer">
                    <input type="checkbox" checked={rminAuto} onChange={(e) => onRminAutoChange(e.target.checked)} className="rounded text-blue-600" />
                    <span>Automático (biela)</span>
                  </label>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="range" min={1.5} max={12} step={0.5}
                    disabled={rminAuto}
                    value={effectiveRmin}
                    onChange={(e) => onRminChange(+e.target.value)}
                    className="flex-1 accent-blue-600 disabled:opacity-50"
                  />
                  <span className="font-mono-tech font-semibold text-slate-800 min-w-14 text-right">{effectiveRmin} elem.</span>
                </div>
                <div className="text-[10.5px] text-slate-600 leading-snug">
                  <strong>{code.short}:</strong> σRd,máx = {bielaSummary.sd.sigma.toFixed(1)} MPa · F = {bielaSummary.F.toFixed(0)} kN ({bielaSummary.origem}) → largura a = {(bielaSummary.a * 100).toFixed(1)} cm ({(effectiveRmin * scene.h * 100).toFixed(1)} cm no filtro).
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={runningMode === "opt" ? onStop : onRunOpt}
              className={`w-full py-2.5 px-4 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 shadow-xs transition-colors ${
                runningMode === "opt"
                  ? "bg-red-600 hover:bg-red-700 text-white"
                  : "bg-blue-600 hover:bg-blue-700 text-white"
              }`}
            >
              {runningMode === "opt" ? <Square className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              <span>{runningMode === "opt" ? "Parar otimização" : "Otimizar topologia"}</span>
            </button>

            {benchmark && (benchmark.category === "opt" || benchmark.category === "stm") && (
              <div className="p-3 rounded-lg bg-teal-50/70 border border-teal-200 space-y-1.5 text-[11px]">
                <div className="font-semibold text-teal-900 flex items-center gap-1.5">
                  <Target className="w-3.5 h-3.5" />
                  <span>{benchmark.title}</span>
                </div>
                <div className="text-slate-700">{benchmark.summary}</div>
                <div className="text-slate-600"><strong>Referência:</strong> {benchmark.reference.publishedNote}</div>
                {benchmark.reference.recommended?.mode === "opt" && (
                  <button
                    type="button"
                    onClick={() => {
                      const rec = benchmark.reference.recommended!;
                      if (rec.method) onOptMethodChange(rec.method);
                      if (rec.volfrac) onVolfracChange(rec.volfrac);
                      if (rec.rmin) { onRminAutoChange(false); onRminChange(rec.rmin); }
                      onToast("Parâmetros recomendados do benchmark aplicados.");
                    }}
                    className="mt-1 px-2.5 py-1 rounded bg-teal-700 hover:bg-teal-800 text-white text-[11px] font-medium"
                  >
                    Aplicar parâmetros do artigo
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* ─── ABA 3: ARMADURA ─── */}
        {tab === "armadura" && (
          <div className="space-y-4 text-xs">
            {/* Armadura inteligente por face */}
            <section className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-2.5">
              <div className="flex items-center justify-between">
                <h2 className="text-[10.5px] font-bold uppercase tracking-wider text-slate-500">Armadura Inteligente (Face)</h2>
                <button
                  type="button"
                  onClick={() => onToolChange(tool === "rebar" ? "select" : "rebar")}
                  className={`px-2 py-0.5 rounded text-[11px] font-semibold border ${
                    tool === "rebar" ? "bg-emerald-600 text-white border-emerald-600" : "bg-white text-emerald-700 border-emerald-300 hover:bg-emerald-50"
                  }`}
                >
                  {tool === "rebar" ? "Ativa na tela" : "Desenhar na tela"}
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <label className="space-y-0.5">
                  <span className="text-[11px] text-slate-600">Cobr. (cm)</span>
                  <input
                    type="number" step="0.5" min="0.5" value={Math.round(rebarCfg.cover * 1000) / 10}
                    onChange={(e) => onRebarCfgChange({ ...rebarCfg, cover: Math.max(0.005, +e.target.value / 100 || 0.03) })}
                    className="w-full px-1.5 py-1 border border-slate-300 rounded bg-white font-mono-tech"
                  />
                </label>
                <label className="space-y-0.5">
                  <span className="text-[11px] text-slate-600">Ø (mm)</span>
                  <select
                    value={rebarCfg.dia}
                    onChange={(e) => onRebarCfgChange({ ...rebarCfg, dia: +e.target.value })}
                    className="w-full px-1.5 py-1 border border-slate-300 rounded bg-white font-mono-tech"
                  >
                    {BAR_DIAMETERS.map((d) => <option key={d} value={d}>{String(d).replace(".", ",")}</option>)}
                  </select>
                </label>
                <label className="space-y-0.5">
                  <span className="text-[11px] text-slate-600">Qtd (n)</span>
                  <input
                    type="number" min="1" step="1" value={rebarCfg.n}
                    onChange={(e) => onRebarCfgChange({ ...rebarCfg, n: Math.max(1, Math.round(+e.target.value) || 1) })}
                    className="w-full px-1.5 py-1 border border-slate-300 rounded bg-white font-mono-tech"
                  />
                </label>
                <label className="space-y-0.5">
                  <span className="text-[11px] text-slate-600">Forma</span>
                  <select
                    value={rebarCfg.form}
                    onChange={(e) => onRebarCfgChange({ ...rebarCfg, form: e.target.value as RebarToolConfig["form"] })}
                    className="w-full px-1.5 py-1 border border-slate-300 rounded bg-white"
                  >
                    <option value="reta">Reta</option>
                    <option value="L">Em L</option>
                    <option value="U">Em U</option>
                  </select>
                </label>
                <label className="space-y-0.5">
                  <span className="text-[11px] text-slate-600">Perna (m)</span>
                  <input
                    type="number" step="0.05" min="0.05" value={rebarCfg.leg}
                    onChange={(e) => onRebarCfgChange({ ...rebarCfg, leg: Math.max(0.05, +e.target.value || 0.5) })}
                    className="w-full px-1.5 py-1 border border-slate-300 rounded bg-white font-mono-tech"
                  />
                </label>
                <label className="space-y-0.5">
                  <span className="text-[11px] text-slate-600">Aço</span>
                  <select
                    value={rebarCfg.steel}
                    onChange={(e) => onRebarCfgChange({ ...rebarCfg, steel: e.target.value as RebarToolConfig["steel"] })}
                    className="w-full px-1.5 py-1 border border-slate-300 rounded bg-white"
                  >
                    {(code.steelClasses.length ? code.steelClasses : (["CA50", "CA60"] as const)).map((k) => (
                      <option key={k} value={k}>{STEEL_CLASSES[k].label}</option>
                    ))}
                  </select>
                </label>
              </div>
            </section>

            {/* Gerador rápido de estribos / malha */}
            <section className="p-3 rounded-lg bg-white border border-slate-200 space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="text-[10.5px] font-bold uppercase tracking-wider text-slate-500">Estribos / Malha Distribuída</h2>
                <button
                  type="button"
                  onClick={() => {
                    const b = sceneBounds(scene);
                    if (b) setStBounds(b);
                  }}
                  className="text-[10.5px] text-blue-600 hover:underline font-medium"
                >
                  Usar caixa da peça
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <label className="space-y-0.5">
                  <span className="text-[11px] text-slate-600">Direção</span>
                  <select value={stOrient} onChange={(e) => setStOrient(e.target.value as "vertical" | "horizontal")} className="w-full px-1.5 py-1 border border-slate-300 rounded bg-white">
                    <option value="vertical">Vertical</option>
                    <option value="horizontal">Horizontal</option>
                  </select>
                </label>
                <label className="space-y-0.5">
                  <span className="text-[11px] text-slate-600">Espaç. (cm)</span>
                  <input type="number" step="1" min="4" value={stSpacingCm} onChange={(e) => setStSpacingCm(+e.target.value)} className="w-full px-1.5 py-1 border border-slate-300 rounded font-mono-tech" />
                </label>
                <label className="space-y-0.5">
                  <span className="text-[11px] text-slate-600">Cobr. (cm)</span>
                  <input type="number" step="0.5" min="1" value={stCoverCm} onChange={(e) => setStCoverCm(+e.target.value)} className="w-full px-1.5 py-1 border border-slate-300 rounded font-mono-tech" />
                </label>
                <label className="space-y-0.5">
                  <span className="text-[11px] text-slate-600">Ramos</span>
                  <input type="number" step="1" min="1" value={stLegs} onChange={(e) => setStLegs(+e.target.value)} className="w-full px-1.5 py-1 border border-slate-300 rounded font-mono-tech" />
                </label>
                <label className="space-y-0.5 col-span-2">
                  <span className="text-[11px] text-slate-600">Diâmetro Ø (mm)</span>
                  <select value={stDia} onChange={(e) => setStDia(+e.target.value)} className="w-full px-1.5 py-1 border border-slate-300 rounded bg-white font-mono-tech">
                    {BAR_DIAMETERS.map((d) => <option key={d} value={d}>Ø {String(d).replace(".", ",")} mm</option>)}
                  </select>
                </label>
              </div>
              {stBounds && (
                <div className="grid grid-cols-4 gap-1.5 text-[10.5px]">
                  {(["x0", "y0", "x1", "y1"] as const).map((k) => (
                    <label key={k} className="space-y-0.5">
                      <span className="text-slate-500">{k} (m)</span>
                      <input
                        type="number" step="0.05" value={stBounds[k]}
                        onChange={(e) => setStBounds({ ...stBounds, [k]: +e.target.value })}
                        className="w-full px-1 py-0.5 border border-slate-300 rounded font-mono-tech"
                      />
                    </label>
                  ))}
                </div>
              )}
              <button
                type="button"
                onClick={handleGenerateStirrups}
                className="w-full py-1.5 px-3 rounded-md bg-slate-800 hover:bg-slate-700 text-white text-xs font-medium inline-flex items-center justify-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Gerar grupo distribuído</span>
              </button>
            </section>

            {/* Lista de barras do modelo */}
            <section className="space-y-2">
              <h2 className="text-[10.5px] font-bold uppercase tracking-wider text-slate-400">
                Barras do Modelo ({scene.bars?.length ?? 0})
              </h2>
              {!(scene.bars?.length) ? (
                <p className="text-[11px] text-slate-500">Nenhuma barra lançada (análise considerará apenas concreto sem tração).</p>
              ) : (
                <div className="space-y-1.5">
                  {scene.bars.map((b) => (
                    <div
                      key={b.id}
                      onMouseEnter={() => onHoverBarChange(b.id)}
                      onMouseLeave={() => onHoverBarChange(null)}
                      className={`p-2 rounded-lg border transition-colors ${
                        hoverBarId === b.id ? "border-blue-400 bg-blue-50/40" : "border-slate-200 bg-white"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1 mb-1.5">
                        <span className="font-semibold text-slate-800 truncate">{b.label}</span>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {b.extra && <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">{1 + b.extra.length}×</span>}
                          <button
                            type="button"
                            onClick={() => onSceneChange((p) => ({ ...p, bars: (p.bars ?? []).filter((q) => q.id !== b.id) }), true)}
                            className="p-0.5 text-slate-400 hover:text-red-600"
                            title="Remover barra"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-1.5 text-[11px]">
                        <select
                          value={b.steelClass ?? "custom"}
                          onChange={(e) => {
                            const v = e.target.value as NonNullable<typeof b.steelClass>;
                            onSceneChange((p) => ({
                              ...p,
                              bars: (p.bars ?? []).map((q) => {
                                if (q.id !== b.id) return q;
                                if (v === "custom") return { ...q, steelClass: "custom" };
                                const c = STEEL_CLASSES[v];
                                return { ...q, steelClass: v, fy: c.fy, ft: c.ft, Es: c.Es, epsU: c.epsU };
                              }),
                            }), true);
                          }}
                          className="px-1 py-0.5 border border-slate-300 rounded bg-white"
                        >
                          {steelOptionsForBar(b.steelClass).map(([v, lbl]) => <option key={v} value={v}>{lbl}</option>)}
                        </select>
                        <input
                          type="number" step="any" min="0.01" title="As (cm²)"
                          value={Math.round(b.areaCm2 * 1000) / 1000}
                          onChange={(e) => {
                            const v = +e.target.value;
                            if (v > 0) onSceneChange((p) => ({ ...p, bars: (p.bars ?? []).map((q) => q.id === b.id ? { ...q, areaCm2: v } : q) }), true);
                          }}
                          className="px-1.5 py-0.5 border border-slate-300 rounded font-mono-tech"
                        />
                        <input
                          type="number" step="any" min="1" title="fy (MPa)"
                          disabled={(b.steelClass ?? "custom") !== "custom"}
                          value={Math.round(b.fy * 10) / 10}
                          onChange={(e) => {
                            const v = +e.target.value;
                            const es = b.Es > 0 ? b.Es : 210, epsU = b.epsU > 0 ? b.epsU : 0.05;
                            if (Number.isFinite(v) && v > 0 && v / (es * 1000) < epsU) {
                              const ratio = b.fy > 0 && b.ft >= b.fy ? Math.max(1.05, b.ft / b.fy) : 1.08;
                              onSceneChange((p) => ({ ...p, bars: (p.bars ?? []).map((q) => q.id === b.id ? { ...q, fy: v, ft: v * ratio } : q) }), true);
                            } else if (Number.isFinite(v) && v > 0) {
                              onToast(`fy = ${v} MPa incompatível com Es = ${es} GPa e εu.`);
                            }
                          }}
                          className="px-1.5 py-0.5 border border-slate-300 rounded font-mono-tech disabled:bg-slate-100 disabled:text-slate-500"
                        />
                      </div>
                      <details className="mt-1.5 text-[10.5px] text-slate-500">
                        <summary className="cursor-pointer hover:text-slate-800">Editar vértices ({b.path.length} pts)</summary>
                        <input
                          type="text"
                          defaultValue={b.path.map((pt) => `${pt[0]},${pt[1]}`).join("; ")}
                          key={b.id + JSON.stringify(b.path)}
                          onBlur={(e) => {
                            const pts = e.target.value.split(";").map((t) => t.split(",").map(Number)).filter((p) => p.length === 2 && p.every(Number.isFinite)) as [number, number][];
                            if (pts.length >= 2) onSceneChange((p) => ({ ...p, bars: (p.bars ?? []).map((q) => q.id === b.id ? { ...q, path: pts } : q) }), true);
                          }}
                          className="mt-1 w-full px-1.5 py-1 border border-slate-300 rounded font-mono-tech text-slate-700"
                        />
                      </details>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}

        {/* ─── ABA 4: NÍVEL 2 & BENCHMARK ─── */}
        {tab === "nl" && (
          <div className="space-y-4 text-xs">
            {benchmark && (
              <div className="p-3 rounded-lg bg-teal-50/70 border border-teal-200 space-y-1 text-[11px]">
                <div className="font-semibold text-teal-900 flex items-center gap-1.5">
                  <Target className="w-3.5 h-3.5 shrink-0" />
                  <span>{benchmark.title}</span>
                </div>
                <div className="text-slate-700">{benchmark.summary}</div>
                <div className="text-slate-600"><strong>Publicado:</strong> {benchmark.reference.publishedNote}</div>
                {benchmark.reference.modelRangeNote && <div className="text-slate-600">{benchmark.reference.modelRangeNote}</div>}
                {benchmark.reference.expectedHere && <div className="text-slate-500 italic">{benchmark.reference.expectedHere}</div>}
              </div>
            )}

            <section className="space-y-2.5">
              <h2 className="text-[10.5px] font-bold uppercase tracking-wider text-slate-400">Parâmetros Nível 2 (CSFM)</h2>
              <div className="grid grid-cols-2 gap-2.5">
                <label className="space-y-1">
                  <span className="text-slate-600">Resistências</span>
                  <select
                    value={nlParams.values}
                    onChange={(e) => onSceneChange((p) => ({ ...p, nl: { ...nlParams, values: e.target.value as "mean" | "design" } }), true)}
                    className="w-full px-2 py-1 border border-slate-300 rounded-md bg-white"
                  >
                    <option value="design">Projeto (fcd da norma)</option>
                    <option value="mean">Médias (ensaio · fc = fck)</option>
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-slate-600">εcu (‰)</span>
                  <input
                    type="number" step="0.1" min="1" value={Math.round(nlParams.epsCu * 10000) / 10}
                    onChange={(e) => onSceneChange((p) => ({ ...p, nl: { ...nlParams, epsCu: Math.max(0.001, +e.target.value / 1000) } }), true)}
                    className="w-full px-2 py-1 border border-slate-300 rounded-md font-mono-tech"
                  />
                </label>
              </div>

              <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-slate-700 font-medium">Comprimento de esmagamento (lc)</span>
                  <label className="flex items-center gap-1.5 text-[11px] text-blue-700 font-medium cursor-pointer">
                    <input
                      type="checkbox" checked={crushAuto}
                      onChange={(e) => onSceneChange((p) => ({ ...p, nl: { ...nlParams, crushAuto: e.target.checked, crushLength: e.target.checked ? p.t : nlParams.crushLength } }), true)}
                      className="rounded text-blue-600"
                    />
                    <span>Automático (= t)</span>
                  </label>
                </div>
                <input
                  type="number" step="0.02" min="0" disabled={crushAuto}
                  value={crushAuto ? scene.t : nlParams.crushLength}
                  onChange={(e) => onSceneChange((p) => ({ ...p, nl: { ...nlParams, crushAuto: false, crushLength: Math.max(0, +e.target.value) } }), true)}
                  className="w-full px-2 py-1 border border-slate-300 rounded-md bg-white font-mono-tech disabled:bg-slate-100 disabled:text-slate-500"
                />
                <div className="text-[10.5px] text-slate-500">
                  Livro do CSFM (Cap. 6, pp. 18/104/137): média de ε3 sobre a espessura da peça ({scene.t} m).
                </div>
              </div>
            </section>

            <button
              type="button"
              onClick={runningMode === "nl" ? onStop : onRunNl}
              className={`w-full py-2.5 px-4 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 shadow-xs transition-colors ${
                runningMode === "nl"
                  ? "bg-red-600 hover:bg-red-700 text-white"
                  : "bg-blue-600 hover:bg-blue-700 text-white"
              }`}
            >
              {runningMode === "nl" ? <Square className="w-4 h-4" /> : <Activity className="w-4 h-4" />}
              <span>{runningMode === "nl" ? "Parar análise não linear" : "Rodar análise não linear (Nível 2)"}</span>
            </button>

            {frame?.nl && (
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-1.5 text-[11px] text-slate-700">
                <div className="font-semibold text-slate-900">
                  Diagnóstico: P = {(frame.nl.lambda * (frame.P0 ?? 0)).toFixed(0)} kN (λ = {frame.nl.lambda.toFixed(3)})
                </div>
                {frame.nl.failure?.crush && (
                  <div className="text-red-800">
                    <strong>Esmagamento CC</strong> em ({frame.nl.failure.crush.x.toFixed(2)}; {frame.nl.failure.crush.y.toFixed(2)}) m:
                    média {(frame.nl.failure.crush.strain * 1000).toFixed(2)} ‰ / {(frame.nl.failure.crush.limit * 1000).toFixed(1)} ‰
                    (pico pontual {(frame.nl.failure.crush.peak.strain * 1000).toFixed(1)} ‰).
                  </div>
                )}
                {frame.nl.failure?.bar && (
                  <div className="text-red-800">
                    <strong>Ruptura da barra {frame.nl.failure.bar.label}</strong> (ε ≥ εu).
                  </div>
                )}
                {frame.nl.firstPlateau && (
                  <div>
                    Início do patamar (≥ 95 % ε0): λ = {frame.nl.firstPlateau.lambda.toFixed(3)} (passo {frame.nl.firstPlateau.step}).
                  </div>
                )}
                <div className="text-[10.5px] text-slate-500 italic pt-1 border-t border-slate-200">
                  Nível 2 (sem kc2 nem tension stiffening): protótipo para equilíbrio e capacidade; não substitui projeto.
                </div>
              </div>
            )}
          </div>
        )}

        {/* ─── ABA 5: NORMAS ─── */}
        {tab === "normas" && (
          <NormasTab fck={scene.fck ?? 30} activeCodeId={codeId} onSelectCode={onSelectCode} />
        )}
      </div>
    </aside>
  );
};
