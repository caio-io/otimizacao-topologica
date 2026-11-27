import React, { useState } from "react";
import type { BenchmarkEntry, XiaIndices } from "@stm/core";
import { Activity, BarChart3, ChevronDown, ChevronUp, Scale, Target } from "lucide-react";
import type { FrameMsg } from "../types/app";
import { LoadDispChart } from "./LoadDispChart";

interface ResultsDockProps {
  frame: FrameMsg | null;
  lastFrame: FrameMsg | null;
  frameIndex: number;
  onSelectFrame: (idx: number) => void;
  benchmark: BenchmarkEntry | null;
  xiaMetrics: { steelVolCm3: number; xia: XiaIndices } | null;
  onComputeXia: () => void;
  computingXia: boolean;
}

const MODES_PT: Record<string, string> = {
  CC: "Esmagamento do concreto (CC)",
  FR: "Ruptura da armadura (FR)",
  divergencia: "Divergência numérica",
  lambdaMax: "Carga máxima do cálculo",
  interrompida: "Interrompida pelo usuário",
};

const KpiBar: React.FC<{ label: string; ratio: number; detail: string }> = ({ label, ratio, detail }) => {
  const pct = Math.min(100, Math.max(0, ratio * 100));
  const tone = ratio >= 1 ? "bg-red-600" : ratio >= 0.8 ? "bg-amber-500" : "bg-emerald-600";
  const textTone = ratio >= 1 ? "text-red-700" : ratio >= 0.8 ? "text-amber-700" : "text-emerald-700";
  return (
    <div className="bg-white border border-slate-200 rounded-md px-2.5 py-1.5">
      <div className="flex items-baseline justify-between gap-2 text-[11px]">
        <span className="text-slate-600 font-medium">{label}</span>
        <span className={`font-mono-tech font-bold ${textTone}`}>{(ratio * 100).toFixed(0)} %</span>
      </div>
      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden my-1">
        <div className={`h-full rounded-full transition-all ${tone}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="text-[10px] text-slate-500 font-mono-tech truncate">{detail}</div>
    </div>
  );
};

export const ResultsDock: React.FC<ResultsDockProps> = ({
  frame,
  lastFrame,
  frameIndex,
  onSelectFrame,
  benchmark,
  xiaMetrics,
  onComputeXia,
  computingXia,
}) => {
  const [collapsed, setCollapsed] = useState(false);

  const nl = frame?.nl;
  const nlFinal = lastFrame?.nl;
  const P0 = frame?.P0 ?? 0;
  const P = nl ? nl.lambda * P0 : 0;
  const div = benchmark?.reference.loadDivisor ?? 1;

  // métrica atual comparada ao benchmark
  let measured: number | null = null;
  if (benchmark) {
    if (benchmark.category === "nl" && nlFinal) {
      measured = (nlFinal.lambda * (lastFrame?.P0 ?? 0)) / div;
    } else if (benchmark.id.startsWith("queiroz") && (xiaMetrics?.steelVolCm3 ?? lastFrame?.steelVolCm3) != null) {
      measured = xiaMetrics?.steelVolCm3 ?? lastFrame?.steelVolCm3 ?? null;
    } else if (benchmark.id === "xia-case1" && xiaMetrics) {
      measured = xiaMetrics.xia.trs;
    }
  }
  const diffPct = measured != null && benchmark ? ((measured / benchmark.reference.publishedValue) - 1) * 100 : null;

  return (
    <div className="border-t border-slate-300 bg-slate-50 shrink-0 no-print">
      {/* Barra de título do Dock */}
      <div className="h-8 px-3 flex items-center justify-between border-b border-slate-200 bg-slate-100/80 text-xs">
        <div className="flex items-center gap-3 min-w-0">
          <span className="font-semibold text-slate-700 uppercase tracking-wider text-[10.5px] flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5 text-blue-600" />
            Resultados & Verificação
          </span>
          {nl && (
            <span className="font-mono-tech text-[11px] text-slate-700 truncate">
              <strong>P = {P.toFixed(0)} kN</strong>
              {div > 1 ? ` (P/${div} = ${(P / div).toFixed(0)} kN)` : ""} ·{" "}
              <span className="text-slate-500">{MODES_PT[nl.mode ?? ""] ?? "calculando…"}</span>
            </span>
          )}
          {!nl && frame && !frame.elastic && (
            <span className="font-mono-tech text-[11px] text-slate-700">
              Iter {frame.iter} · Vol {(frame.volume * 100).toFixed(1)} % · C = {frame.compliance.toExponential(2)}
              {frame.steelVolCm3 != null ? ` · Aço ≈ ${frame.steelVolCm3.toFixed(0)} cm³` : ""}
            </span>
          )}
          {!nl && frame?.elastic && (
            <span className="text-[11px] text-slate-600">Campo elástico linear do domínio cheio</span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="inline-flex items-center gap-1 text-[11px] text-slate-600 hover:text-slate-900 px-1.5 py-0.5 rounded hover:bg-slate-200/70"
        >
          {collapsed ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          <span>{collapsed ? "Expandir" : "Recolher"}</span>
        </button>
      </div>

      {!collapsed && (
        <div className="p-2.5 max-h-56 overflow-y-auto">
          {!frame ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-center">
              <div className="text-xs text-slate-500 py-2">
                Nenhuma análise executada ainda. Use <strong>Rodar análise não linear (Nível 2)</strong>,{" "}
                <strong>Otimizar topologia</strong> ou <strong>Campo elástico</strong> no painel lateral.
              </div>
              {benchmark && (
                <div className="bg-white border border-teal-200 rounded-md p-2.5 text-xs">
                  <div className="flex items-center gap-1.5 font-semibold text-teal-800 mb-0.5">
                    <Target className="w-3.5 h-3.5" />
                    <span>Benchmark ativo: {benchmark.shortTitle}</span>
                  </div>
                  <div className="text-[11px] text-slate-600">{benchmark.reference.publishedNote}</div>
                  {benchmark.reference.modelRangeNote && (
                    <div className="text-[10.5px] text-slate-500">{benchmark.reference.modelRangeNote}</div>
                  )}
                </div>
              )}
            </div>
          ) : nl ? (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-2.5">
              {/* Coluna 1: Curva P-δ */}
              <div className="lg:col-span-4 bg-white border border-slate-200 rounded-md p-2">
                <div className="flex items-center justify-between text-[10.5px] font-semibold text-slate-600 uppercase tracking-wider mb-1">
                  <span>Curva Carga × Deslocamento (P–δ)</span>
                  <span className="font-mono-tech normal-case text-slate-500">
                    {nl.curve.length - 1} passos
                  </span>
                </div>
                <LoadDispChart
                  curve={nlFinal?.curve ?? nl.curve}
                  activeStepIndex={frameIndex}
                  onSelectStep={onSelectFrame}
                  refLoadKN={benchmark?.category === "nl" ? benchmark.reference.publishedValue : undefined}
                  refLabel={benchmark?.category === "nl" ? `Ensaio ${benchmark.reference.publishedValue} kN` : undefined}
                  loadDivisor={div}
                />
              </div>

              {/* Coluna 2: KPIs de utilização + Comparador de Benchmark */}
              <div className="lg:col-span-4 space-y-2">
                <div className="grid grid-cols-2 gap-1.5">
                  <KpiBar
                    label="Concreto |σ3|/fc"
                    ratio={nl.utilization.concreteStress}
                    detail={`${(nl.utilization.maxCompStress / 1000).toFixed(1)} / ${(nl.fc / 1000).toFixed(1)} MPa`}
                  />
                  <KpiBar
                    label="Esmagamento ε/εcu"
                    ratio={nl.utilization.concreteCrush}
                    detail={`${(nl.crushStrain * 1000).toFixed(2)} / ${(nl.epsCu * 1000).toFixed(1)} ‰`}
                  />
                  <KpiBar
                    label="Aço |σs|/fy"
                    ratio={nl.utilization.steelStress}
                    detail={nl.bars.some((b) => b.yielded) ? "armadura escoou" : "regime elástico"}
                  />
                  <KpiBar
                    label="Aço εs/εu"
                    ratio={nl.utilization.steelStrain}
                    detail={`eq. ${(Math.max(nl.equilibrium.x, nl.equilibrium.y) * 100).toExponential(1)} %`}
                  />
                </div>

                {benchmark && (
                  <div className="bg-teal-50/70 border border-teal-200 rounded-md px-2.5 py-1.5 text-[11px]">
                    <div className="flex items-center justify-between font-semibold text-teal-900">
                      <span className="flex items-center gap-1">
                        <Target className="w-3.5 h-3.5" />
                        Comparação · {benchmark.shortTitle}
                      </span>
                      {diffPct != null && (
                        <span className={`font-mono-tech px-1.5 py-0.5 rounded text-[10px] ${Math.abs(diffPct) <= 12 ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
                          {diffPct >= 0 ? "+" : ""}{diffPct.toFixed(1)} %
                        </span>
                      )}
                    </div>
                    <div className="text-slate-700 font-mono-tech mt-0.5">
                      Aqui: <strong>{measured?.toFixed(0)} {benchmark.reference.unit}</strong> vs. Ref.:{" "}
                      <strong>{benchmark.reference.publishedValue} {benchmark.reference.unit}</strong>
                    </div>
                    <div className="text-[10px] text-slate-600">{benchmark.reference.modelRangeNote ?? benchmark.reference.publishedNote}</div>
                  </div>
                )}
              </div>

              {/* Coluna 3: Tabela de barras + Reações */}
              <div className="lg:col-span-4 space-y-2">
                {nl.bars.length > 0 && (
                  <div className="bg-white border border-slate-200 rounded-md p-2 max-h-32 overflow-y-auto">
                    <div className="text-[10.5px] font-semibold text-slate-600 uppercase tracking-wider mb-1">
                      Barras no estado último
                    </div>
                    <table className="w-full text-[11px] font-mono-tech">
                      <thead>
                        <tr className="text-slate-500 border-b border-slate-200">
                          <th className="text-left py-0.5 font-sans">Barra</th>
                          <th className="text-right py-0.5">N (kN)</th>
                          <th className="text-right py-0.5">ε (‰)</th>
                          <th className="text-right py-0.5">Escoou</th>
                        </tr>
                      </thead>
                      <tbody>
                        {nl.bars.map((b) => (
                          <tr key={b.label} className="border-b border-slate-100 last:border-0">
                            <td className="text-left py-0.5 font-sans text-slate-700 truncate max-w-28">{b.label}</td>
                            <td className="text-right py-0.5">{b.axialMax.toFixed(0)}</td>
                            <td className="text-right py-0.5">{(b.strainMax * 1000).toFixed(2)}</td>
                            <td className={`text-right py-0.5 ${b.yielded ? "text-amber-700 font-semibold" : "text-slate-400"}`}>
                              {b.yielded ? (b.yieldLambda != null ? `${(b.yieldLambda * P0).toFixed(0)} kN` : "sim") : "não"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {frame.reactions.length > 0 && (
                  <div className="bg-white border border-slate-200 rounded-md px-2.5 py-1.5 text-[11px]">
                    <div className="flex items-center justify-between text-slate-600 font-medium mb-0.5">
                      <span className="flex items-center gap-1"><Scale className="w-3 h-3 text-teal-600" /> Reações de apoio</span>
                      <span className="font-mono-tech text-[10px] text-slate-500">
                        resíduo ({frame.residual.x.toFixed(2)}; {frame.residual.y.toFixed(2)}) kN
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 font-mono-tech text-[10.5px] text-slate-700">
                      {frame.reactions.map((r) => (
                        <span key={r.id}>
                          <strong>{r.id}</strong>: Rx={r.rx.toFixed(1)} · Ry={r.ry.toFixed(1)} kN
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* Resultados de Otimização / Elástico */
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-2.5">
              <div className="lg:col-span-4 bg-white border border-slate-200 rounded-md p-2.5 text-xs space-y-1">
                <div className="font-semibold text-slate-700 flex items-center gap-1.5">
                  <Scale className="w-3.5 h-3.5 text-teal-600" />
                  <span>Reações de apoio</span>
                </div>
                {frame.reactions.map((r) => (
                  <div key={r.id} className="flex justify-between font-mono-tech text-[11px] text-slate-700">
                    <strong>{r.id}</strong>
                    <span>Rx = {r.rx.toFixed(1)} · Ry = {r.ry.toFixed(1)} kN</span>
                  </div>
                ))}
                <div className="text-[10.5px] text-slate-500 font-mono-tech pt-1 border-t border-slate-100">
                  Resíduo global: ({frame.residual.x.toFixed(3)}; {frame.residual.y.toFixed(3)}) kN
                </div>
              </div>

              <div className="lg:col-span-4 bg-white border border-slate-200 rounded-md p-2.5 text-xs space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-700 flex items-center gap-1.5">
                    <BarChart3 className="w-3.5 h-3.5 text-blue-600" />
                    <span>Métricas de Topologia (Xia / Queiroz)</span>
                  </span>
                  {!frame.elastic && frame.done && (
                    <button
                      type="button"
                      disabled={computingXia}
                      onClick={onComputeXia}
                      className="px-2 py-0.5 rounded bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 text-[11px] font-medium disabled:opacity-50"
                    >
                      {computingXia ? "Calculando…" : "Calcular TRS/SR"}
                    </button>
                  )}
                </div>
                <div className="font-mono-tech text-[11px] text-slate-700 space-y-0.5">
                  {frame.steelVolCm3 != null && (
                    <div>Volume de aço (contínuo, CA-50): <strong>{frame.steelVolCm3.toFixed(0)} cm³</strong></div>
                  )}
                  {xiaMetrics && (
                    <>
                      <div>Índice TRS (Xia 2020): <strong>{xiaMetrics.xia.trs.toFixed(1)} %</strong></div>
                      <div>Relação SR (Xia 2020): <strong>{xiaMetrics.xia.sr.toFixed(3)} %</strong> · L = {xiaMetrics.xia.skeletonLength.toFixed(1)} m</div>
                    </>
                  )}
                  {!xiaMetrics && !frame.elastic && (
                    <div className="text-slate-500 font-sans text-[11px]">
                      Clique em <em>Calcular TRS/SR</em> após convergir para medir os índices de Xia et al. (2020).
                    </div>
                  )}
                </div>
              </div>

              {benchmark && (
                <div className="lg:col-span-4 bg-teal-50/70 border border-teal-200 rounded-md p-2.5 text-xs space-y-1">
                  <div className="flex items-center justify-between font-semibold text-teal-900">
                    <span className="flex items-center gap-1.5"><Target className="w-3.5 h-3.5" /> {benchmark.shortTitle}</span>
                    {diffPct != null && (
                      <span className="font-mono-tech text-[10.5px] px-1.5 py-0.5 rounded bg-white border border-teal-200 text-teal-800">
                        {diffPct >= 0 ? "+" : ""}{diffPct.toFixed(1)} %
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-700">{benchmark.reference.publishedNote}</div>
                  {benchmark.reference.expectedHere && (
                    <div className="text-[10.5px] text-slate-600">{benchmark.reference.expectedHere}</div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
