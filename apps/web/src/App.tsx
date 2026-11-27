import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CSFM_DEFAULTS, buildProblem, cappedAutoFilterRadius, codeById, stmTiesToBarSpecs, strutDesignStrength, tensionZones } from "@stm/core";
import type { DesignCodeId, Scene, StmModel, SupportKind, XiaIndices } from "@stm/core";
import { HeaderBar } from "./components/HeaderBar";
import { ReportModal } from "./components/ReportModal";
import { ResultsDock } from "./components/ResultsDock";
import { TemplateModal } from "./components/TemplateModal";
import { ViewportCanvas } from "./components/ViewportCanvas";
import type { ViewportHandle } from "./components/ViewportCanvas";
import { WorkflowSidebar } from "./components/WorkflowSidebar";
import {
  DEFAULT_MODEL_ID,
  MODEL_CATALOG,
  loadRecentProjects,
  loadSavedScene,
  maxNumericId,
  parseProjectFile,
  saveRecentProject,
  saveScene,
  serializeProjectFile,
} from "./state/sceneStorage";
import type { ProjectFileV1, RecentProjectEntry } from "./state/sceneStorage";
import { exportStmSvg } from "./canvas/renderer";
import type { CsfmSummary, FrameMsg, RebarToolConfig, Selection, StmDisplayMode, TabId, Tool, ViewMode, WorkerOut } from "./types/app";

export const App: React.FC = () => {
  const initialSaved = useMemo(() => loadSavedScene(), []);
  const defaultOpt = useMemo(() => MODEL_CATALOG.find((m) => m.id === DEFAULT_MODEL_ID) ?? MODEL_CATALOG[0], []);

  const [modelId, setModelId] = useState<string>(initialSaved ? "custom" : defaultOpt.id);
  const [scene, setScene] = useState<Scene>(() => initialSaved ?? defaultOpt.createScene());
  const [tab, setTab] = useState<TabId>(() => (initialSaved ? "modelo" : defaultOpt.benchmark?.category === "nl" ? "nl" : "modelo"));
  const [tool, setTool] = useState<Tool>("select");
  const [sel, setSel] = useState<Selection>(null);
  const [geomLocked, setGeomLocked] = useState<boolean>(() => localStorage.getItem("stm-lock") === "1");
  const [supportKindDefault, setSupportKindDefault] = useState<SupportKind>("fixo");
  const [rebarCfg, setRebarCfg] = useState<RebarToolConfig>({
    cover: 0.03, dia: 12.5, n: 4, steel: "CA50", form: "reta", leg: 0.5,
  });
  const [hoverBarId, setHoverBarId] = useState<string | null>(null);

  const [optMethod, setOptMethod] = useState<"beso" | "simp">("beso");
  const [volfrac, setVolfrac] = useState(0.35);
  const [rmin, setRmin] = useState(2.5);
  const [rminAuto, setRminAuto] = useState(true);

  const [frames, setFrames] = useState<FrameMsg[]>([]);
  const [frameIndex, setFrameIndex] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>("nlutil");
  const [showMesh, setShowMesh] = useState(false);
  const [csfm, setCsfm] = useState<CsfmSummary | null>(null);
  const [runningMode, setRunningMode] = useState<"opt" | "nl" | null>(null);
  const [stm, setStm] = useState<StmModel | null>(null);
  const [stmDisplayMode, setStmDisplayMode] = useState<StmDisplayMode>("both");
  const [recentProjects, setRecentProjects] = useState<RecentProjectEntry[]>(() => loadRecentProjects());
  const [runningStm, setRunningStm] = useState(false);
  const [xiaMetrics, setXiaMetrics] = useState<{ steelVolCm3: number; xia: XiaIndices } | null>(null);
  const [computingXia, setComputingXia] = useState(false);

  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportPng, setReportPng] = useState<string | null>(null);

  const idCounterRef = useRef(maxNumericId(scene));
  const nextId = useCallback((prefix: string) => `${prefix}${idCounterRef.current++}`, []);

  const viewportRef = useRef<ViewportHandle | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const tokenRef = useRef(0);
  const pendingCsfmRef = useRef(false);
  const sceneRef = useRef(scene);
  sceneRef.current = scene;

  const codeId: DesignCodeId = scene.nl?.code ?? "NBR6118";
  const activeModel = useMemo(() => MODEL_CATALOG.find((m) => m.id === modelId) ?? null, [modelId]);
  const benchmark = activeModel?.benchmark ?? null;
  const currentFrame = frames[Math.min(frameIndex, Math.max(0, frames.length - 1))] ?? null;
  const lastFrame = frames.length ? frames[frames.length - 1] : null;

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    window.setTimeout(() => setToastMsg((cur) => (cur === msg ? null : cur)), 3800);
  }, []);

  // Inicializa Web Worker
  useEffect(() => {
    const wk = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    workerRef.current = wk;
    wk.onmessage = (ev: MessageEvent<WorkerOut>) => {
      const m = ev.data;
      if (m.token !== tokenRef.current) return;
      if (m.kind === "error") {
        setErrors(m.errors);
        setWarnings(m.warnings);
        setRunningMode(null);
        setRunningStm(false);
        setComputingXia(false);
        return;
      }
      if (m.kind === "stm") {
        setStm(m.stm);
        setRunningStm(false);
        setViewMode("stm");
        if (m.stm.warnings.length) setWarnings(m.stm.warnings);
        return;
      }
      if (m.kind === "metrics") {
        setXiaMetrics({ steelVolCm3: m.steelVolCm3, xia: m.xia });
        setComputingXia(false);
        return;
      }
      setErrors([]);
      if (m.warnings?.length) setWarnings(m.warnings);
      if (m.elastic && pendingCsfmRef.current) {
        pendingCsfmRef.current = false;
        const cz = tensionZones({ ...m.dims, t: sceneRef.current.t }, m.mask, m.field, { ...CSFM_DEFAULTS });
        setCsfm(cz);
        setViewMode("csfm");
      }
      setFrames((prev) => {
        const next = [...prev, m];
        if (m.nl && prev.length === 0) {
          setViewMode((vm) => (vm.startsWith("nl") ? vm : "nlcrack"));
        } else if (!m.nl && !m.elastic && prev.length === 0) {
          setViewMode("topo");
        }
        setFrameIndex(next.length - 1);
        return next;
      });
      if (m.done) setRunningMode(null);
    };
    return () => wk.terminate();
  }, []);

  const clearResults = useCallback(() => {
    tokenRef.current++;
    workerRef.current?.postMessage({ stop: true });
    setRunningMode(null);
    setRunningStm(false);
    setComputingXia(false);
    setFrames([]);
    setFrameIndex(0);
    setCsfm(null);
    setStm(null);
    setXiaMetrics(null);
    setErrors([]);
    setWarnings([]);
  }, []);

  const handleSceneChange = useCallback(
    (updater: (prev: Scene) => Scene, clear = true) => {
      if (clear) clearResults();
      setScene((prev) => {
        const next = updater(prev);
        saveScene(next);
        return next;
      });
    },
    [clearResults],
  );

  const handleSelectModel = (id: string) => {
    if (id === "custom") return;
    if (geomLocked && !window.confirm("A geometria está travada. Carregar o modelo substitui tudo. Continuar?")) return;
    const item = MODEL_CATALOG.find((m) => m.id === id);
    if (!item) return;
    clearResults();
    const sc = item.createScene();
    saveScene(sc);
    setScene(sc);
    setModelId(id);
    setSel(null);
    idCounterRef.current = maxNumericId(sc);
    if (item.benchmark?.category === "nl" || sc.bars?.length) {
      setTab("nl");
      setViewMode("nlcrack");
    } else if (item.benchmark?.category === "opt") {
      setTab("otim");
      setViewMode("topo");
      const rec = item.benchmark.reference.recommended;
      if (rec?.method) setOptMethod(rec.method);
      if (rec?.volfrac) setVolfrac(rec.volfrac);
      if (rec?.rmin) { setRminAuto(false); setRmin(rec.rmin); }
    } else {
      setTab("modelo");
      setViewMode("topo");
    }
    window.setTimeout(() => viewportRef.current?.fitView(), 30);
  };

  const handleSelectCode = (id: DesignCodeId) => {
    const c = codeById(id);
    handleSceneChange(
      (prev) => ({
        ...prev,
        nl: {
          values: prev.nl?.values ?? "design",
          epsCu: c.epsCu,
          crushLength: prev.nl?.crushAuto !== false ? prev.t : prev.nl?.crushLength ?? prev.t,
          crushAuto: prev.nl?.crushAuto ?? true,
          code: id,
        },
      }),
      true,
    );
    if (c.steelClasses.length && !c.steelClasses.includes(rebarCfg.steel)) {
      setRebarCfg((rc) => ({ ...rc, steel: c.steelClasses[0] }));
    }
  };

  const sendWorker = (payload: object) => {
    tokenRef.current++;
    workerRef.current?.postMessage({ ...payload, token: tokenRef.current });
  };

  const handleRunElastic = () => {
    clearResults();
    pendingCsfmRef.current = false;
    setViewMode("topo");
    sendWorker({ mode: "elastic", scene });
  };

  const handleRunCsfmLinear = () => {
    clearResults();
    pendingCsfmRef.current = true;
    sendWorker({ mode: "elastic", scene });
  };

  const handleRunOpt = () => {
    clearResults();
    let effRmin = rmin;
    if (rminAuto) {
      const fck = scene.fck ?? 30;
      const tot = scene.loads.reduce((a, l) => a + Math.hypot(l.fx, l.fy), 0);
      const F = tot / Math.max(1, scene.supports.length);
      const sd = strutDesignStrength(codeById(codeId), fck);
      const a = F > 0 ? Math.abs(F) / (scene.t * sd.sigma * 1000) : 0;
      const prob = buildProblem(scene).problem;
      if (a > 0) effRmin = cappedAutoFilterRadius(a, scene.h, prob?.mask, prob?.nelx, prob?.nely);
    }
    setRunningMode("opt");
    setViewMode("topo");
    sendWorker({ mode: "opt", scene, method: optMethod, volfrac, rmin: effRmin });
  };

  const handleRunStm = () => {
    setRunningStm(true);
    setErrors([]);
    setWarnings([]);
    sendWorker({
      mode: "stm",
      scene,
      rho: lastFrame && !lastFrame.elastic && !lastFrame.nl ? lastFrame.rho : undefined,
      codeId,
      steelClass: rebarCfg.steel,
    });
  };

  const handleConvertStmTies = () => {
    if (!stm) return;
    const newBars = stmTiesToBarSpecs(stm, rebarCfg.steel).map((b) => ({
      ...b,
      id: nextId("B"),
    }));
    if (!newBars.length) {
      showToast("Nenhum tirante encontrado no STM para converter.");
      return;
    }
    handleSceneChange(
      (prev) => ({ ...prev, bars: [...(prev.bars ?? []), ...newBars] }),
      false,
    );
    setTab("nl");
    showToast(`${newBars.length} tirante(s) convertido(s) em barras para o Nível 2.`);
  };

  const handleRunNl = () => {
    clearResults();
    const nlWarns: string[] = [];
    if (scene.bars?.length && scene.h > 0.05) {
      nlWarns.push(`Malha grossa (h = ${scene.h} m): a capacidade no Nível 2 tende a ser superestimada. Use h ≤ 0,04 m para referência.`);
    }
    if ((scene.fck ?? 30) > 50) {
      nlWarns.push(`fck = ${scene.fck} MPa (> 50 MPa): εc2 = 2,0 ‰ e εcu = 3,5 ‰ valem apenas para fck ≤ 50 MPa.`);
    }
    const c = codeById(codeId);
    if (scene.nl?.values === "design" && c.epsUd != null && scene.bars?.some((b) => b.epsU > c.epsUd! + 1e-9)) {
      nlWarns.push(`Atenção (${c.short}): barras com εu acima de εud = ${(c.epsUd * 1000).toFixed(1)} ‰ da norma.`);
    }
    if (nlWarns.length) setWarnings(nlWarns);
    setRunningMode("nl");
    setViewMode("nlcrack");
    sendWorker({ mode: "nl", scene });
  };

  const handleStop = () => {
    workerRef.current?.postMessage({ stop: true });
  };

  const handleComputeXia = () => {
    if (!lastFrame) return;
    setComputingXia(true);
    sendWorker({ mode: "metrics", scene, rho: lastFrame.rho });
  };

  const handleClearAll = () => {
    if (!window.confirm(geomLocked
      ? "Limpar aberturas, apoios, forças e resultados (a geometria principal travada e as armaduras são mantidas)?"
      : "Limpar tudo (geometria, armaduras, apoios, forças e resultados)?")) return;
    clearResults();
    setSel(null);
    if (!geomLocked) setModelId("custom");
    handleSceneChange((prev) => ({
      ...prev,
      shapes: geomLocked ? prev.shapes.filter((s) => s.mode === "add") : [],
      loads: [],
      supports: [],
      bars: geomLocked ? prev.bars : [],
    }), false);
  };

  const handleExportJson = () => {
    const name = activeModel?.label ?? "Projeto STM";
    const proj = serializeProjectFile({
      name,
      scene,
      ui: { modelId, tab, viewMode, optMethod, volfrac, rmin, rminAuto },
      results: stm ? { stm } : undefined,
    });
    setRecentProjects(saveRecentProject(proj));
    const blob = new Blob([JSON.stringify(proj, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `stm-projeto-${modelId.replace(/[^a-z0-9-]/gi, "_")}.stm.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("Projeto salvo (.stm.json) e adicionado aos recentes.");
  };

  const applyProjectFile = (proj: ProjectFileV1) => {
    clearResults();
    saveScene(proj.scene);
    setScene(proj.scene);
    setModelId(proj.ui?.modelId && MODEL_CATALOG.some((m) => m.id === proj.ui?.modelId) ? proj.ui.modelId : "custom");
    if (proj.ui?.tab) setTab(proj.ui.tab as TabId);
    if (proj.ui?.viewMode) setViewMode(proj.ui.viewMode as ViewMode);
    if (proj.ui?.optMethod) setOptMethod(proj.ui.optMethod);
    if (typeof proj.ui?.volfrac === "number") setVolfrac(proj.ui.volfrac);
    if (typeof proj.ui?.rmin === "number") setRmin(proj.ui.rmin);
    if (typeof proj.ui?.rminAuto === "boolean") setRminAuto(proj.ui.rminAuto);
    if (proj.results?.stm) setStm(proj.results.stm);
    setSel(null);
    idCounterRef.current = maxNumericId(proj.scene);
    window.setTimeout(() => viewportRef.current?.fitView(), 30);
  };

  const handleImportJson = (text: string) => {
    const proj = parseProjectFile(text);
    if (!proj) { showToast("Arquivo .stm.json / JSON inválido ou com parâmetros fora dos limites físicos."); return; }
    applyProjectFile(proj);
    setRecentProjects(saveRecentProject(proj));
    showToast(`Projeto "${proj.name}" carregado com sucesso.`);
  };

  const handleExportStmSvg = () => {
    const svg = exportStmSvg(scene, stm, stmDisplayMode);
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `stm-contornos-${modelId.replace(/[^a-z0-9-]/gi, "_")}.svg`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("Desenho vetorial SVG exportado.");
  };

  return (
    <div className="h-screen flex flex-col bg-slate-100 overflow-hidden">
      <HeaderBar
        modelId={modelId}
        onSelectModel={handleSelectModel}
        codeId={codeId}
        onSelectCode={handleSelectCode}
        onOpenTemplates={() => setTemplatesOpen(true)}
        onExportJson={handleExportJson}
        onImportJson={handleImportJson}
        recentProjects={recentProjects}
        onLoadRecentProject={(entry) => {
          applyProjectFile(entry.file);
          showToast(`Projeto recente "${entry.name}" aberto.`);
        }}
        onOpenReport={() => {
          setReportPng(viewportRef.current?.capturePng() ?? null);
          setReportOpen(true);
        }}
      />

      <div className="flex-1 flex min-h-0">
        <WorkflowSidebar
          tab={tab}
          onTabChange={setTab}
          scene={scene}
          onSceneChange={handleSceneChange}
          codeId={codeId}
          onSelectCode={handleSelectCode}
          sel={sel}
          onSelChange={setSel}
          geomLocked={geomLocked}
          supportKindDefault={supportKindDefault}
          onSupportKindDefaultChange={setSupportKindDefault}
          rebarCfg={rebarCfg}
          onRebarCfgChange={setRebarCfg}
          tool={tool}
          onToolChange={setTool}
          hoverBarId={hoverBarId}
          onHoverBarChange={setHoverBarId}
          nextId={nextId}
          optMethod={optMethod}
          onOptMethodChange={setOptMethod}
          volfrac={volfrac}
          onVolfracChange={setVolfrac}
          rmin={rmin}
          onRminChange={setRmin}
          rminAuto={rminAuto}
          onRminAutoChange={setRminAuto}
          runningMode={runningMode}
          runningStm={runningStm}
          onRunElastic={handleRunElastic}
          onRunCsfmLinear={handleRunCsfmLinear}
          onRunOpt={handleRunOpt}
          onRunStm={handleRunStm}
          onConvertStmTies={handleConvertStmTies}
          onRunNl={handleRunNl}
          onStop={handleStop}
          onClearResults={clearResults}
          onClearAll={handleClearAll}
          frame={currentFrame}
          csfm={csfm}
          stm={stm}
          benchmark={benchmark}
          onToast={showToast}
        />

        <main className="flex-1 flex flex-col min-w-0 min-h-0">
          <ViewportCanvas
            ref={viewportRef}
            scene={scene}
            onSceneChange={handleSceneChange}
            frame={currentFrame}
            frameIndex={frameIndex}
            frameCount={frames.length}
            onFrameIndexChange={setFrameIndex}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            showMesh={showMesh}
            onShowMeshChange={setShowMesh}
            csfm={csfm}
            stm={stm}
            stmDisplayMode={stmDisplayMode}
            onStmDisplayModeChange={setStmDisplayMode}
            onExportStmSvg={handleExportStmSvg}
            tool={tool}
            onToolChange={setTool}
            sel={sel}
            onSelChange={setSel}
            geomLocked={geomLocked}
            onGeomLockedChange={(v) => { setGeomLocked(v); localStorage.setItem("stm-lock", v ? "1" : "0"); }}
            supportKindDefault={supportKindDefault}
            rebarCfg={rebarCfg}
            hoverBarId={hoverBarId}
            onHoverBarChange={setHoverBarId}
            nextId={nextId}
            onToast={showToast}
            errors={errors}
            warnings={warnings}
          />

          <ResultsDock
            frame={currentFrame}
            lastFrame={lastFrame}
            frameIndex={frameIndex}
            onSelectFrame={setFrameIndex}
            benchmark={benchmark}
            xiaMetrics={xiaMetrics}
            onComputeXia={handleComputeXia}
            computingXia={computingXia}
            stm={stm}
            viewMode={viewMode}
          />
        </main>
      </div>

      {/* Toast global */}
      {toastMsg && (
        <div className="fixed bottom-4 right-4 z-50 px-3.5 py-2 rounded-lg bg-slate-900 text-white text-xs shadow-xl border border-slate-700 no-print">
          {toastMsg}
        </div>
      )}

      <TemplateModal
        open={templatesOpen}
        onClose={() => setTemplatesOpen(false)}
        onCreate={(sc, lbl) => {
          clearResults();
          saveScene(sc);
          setScene(sc);
          setModelId("custom");
          setSel(null);
          idCounterRef.current = maxNumericId(sc);
          setTab("modelo");
          window.setTimeout(() => viewportRef.current?.fitView(), 30);
          showToast(`Template "${lbl}" criado.`);
        }}
      />

      <ReportModal
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        scene={scene}
        codeId={codeId}
        modelTitle={activeModel?.label ?? "Modelo Personalizado"}
        benchmark={benchmark}
        frame={lastFrame}
        stm={stm}
        snapshotPng={reportPng}
      />
    </div>
  );
};
