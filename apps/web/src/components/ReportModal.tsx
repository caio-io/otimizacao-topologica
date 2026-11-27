import React from "react";
import { codeById, fcdOfCode, strutDesignStrength } from "@stm/core";
import type { BenchmarkEntry, DesignCodeId, Scene, StmModel } from "@stm/core";
import { Printer, X } from "lucide-react";
import type { FrameMsg } from "../types/app";
import { LoadDispChart } from "./LoadDispChart";

interface ReportModalProps {
  open: boolean;
  onClose: () => void;
  scene: Scene;
  codeId: DesignCodeId;
  modelTitle: string;
  benchmark: BenchmarkEntry | null;
  frame: FrameMsg | null;
  stm: StmModel | null;
  snapshotPng: string | null;
}

export const ReportModal: React.FC<ReportModalProps> = ({
  open,
  onClose,
  scene,
  codeId,
  modelTitle,
  benchmark,
  frame,
  stm,
  snapshotPng,
}) => {
  if (!open) return null;
  const code = codeById(codeId);
  const fck = scene.fck ?? 30;
  const fcd = fcdOfCode(code, fck);
  const strut = strutDesignStrength(code, fck);
  const nl = frame?.nl;
  const div = benchmark?.reference.loadDivisor ?? 1;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 print-only">
      <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden print-only">
        <div className="px-5 py-3 bg-slate-900 text-white flex items-center justify-between no-print">
          <div>
            <h2 className="text-sm font-semibold">Memória de Cálculo & Relatório Técnico</h2>
            <p className="text-[11px] text-slate-400">Pronto para impressão ou salvar como PDF pelo navegador</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Imprimir / PDF</span>
            </button>
            <button type="button" onClick={onClose} className="p-1.5 rounded hover:bg-slate-800 text-slate-300">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="p-6 overflow-y-auto space-y-5 text-xs text-slate-800 leading-relaxed">
          {/* Cabeçalho do relatório */}
          <div className="border-b-2 border-slate-900 pb-3 flex items-end justify-between">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">STM-TopOpt · Relatório de Análise</div>
              <h1 className="text-lg font-bold text-slate-900">{modelTitle}</h1>
            </div>
            <div className="text-right font-mono-tech text-[11px] text-slate-600">
              <div>Norma: <strong>{code.name}</strong></div>
              <div>Data: {new Date().toLocaleDateString("pt-BR")}</div>
            </div>
          </div>

          {/* Aviso de transparência */}
          <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-[11px]">
            <strong>Nota técnica de validade:</strong> Protótipo computacional para estudo de regiões D em estado plano de tensão (2D).
            O Nível 2 considera concreto sem tração, parábola-retângulo e aderência perfeita (sem <code>kc2</code> nem <em>tension stiffening</em> ativos por padrão).
            Não substitui a verificação completa e a responsabilidade técnica do engenheiro projetista.
          </div>

          {/* Captura da vista */}
          {snapshotPng && (
            <div className="border border-slate-200 rounded-lg p-2 bg-white">
              <img src={snapshotPng} alt="Vista do modelo" className="w-full max-h-80 object-contain mx-auto" />
            </div>
          )}

          {/* Parâmetros de entrada */}
          <div className="grid grid-cols-2 gap-4">
            <div className="border border-slate-200 rounded-lg p-3">
              <h3 className="font-bold uppercase text-[10.5px] tracking-wider text-slate-500 mb-2">Geometria & Materiais</h3>
              <dl className="grid grid-cols-2 gap-y-1 font-mono-tech text-[11px]">
                <dt className="text-slate-500 font-sans">Espessura t</dt><dd className="text-right">{scene.t} m</dd>
                <dt className="text-slate-500 font-sans">Elemento h</dt><dd className="text-right">{scene.h} m</dd>
                <dt className="text-slate-500 font-sans">fck</dt><dd className="text-right">{fck} MPa</dd>
                <dt className="text-slate-500 font-sans">fcd ({code.short})</dt><dd className="text-right">{fcd.toFixed(2)} MPa</dd>
                <dt className="text-slate-500 font-sans">σRd,máx biela</dt><dd className="text-right">{strut.sigma.toFixed(2)} MPa</dd>
                <dt className="text-slate-500 font-sans">Barras lançadas</dt><dd className="text-right">{scene.bars?.length ?? 0}</dd>
              </dl>
            </div>

            <div className="border border-slate-200 rounded-lg p-3">
              <h3 className="font-bold uppercase text-[10.5px] tracking-wider text-slate-500 mb-2">Rastreabilidade Normativa ({code.short})</h3>
              <ul className="list-disc pl-4 space-y-1 text-[11px] text-slate-700">
                {code.status.verificado.map((v, i) => <li key={`v${i}`}>{v}</li>)}
              </ul>
              <div className="mt-2 text-[10.5px] text-amber-800">
                <strong>Pendente de conferência:</strong> {code.status.pendente.join("; ")}.
              </div>
            </div>
          </div>

          {/* Resultados Nível 2 + Curva P-δ */}
          {nl && (
            <div className="grid grid-cols-2 gap-4 items-start">
              <div className="border border-slate-200 rounded-lg p-3 space-y-2">
                <h3 className="font-bold uppercase text-[10.5px] tracking-wider text-slate-500">Resumo Nível 2 (CSFM)</h3>
                <dl className="grid grid-cols-2 gap-y-1 font-mono-tech text-[11px]">
                  <dt className="text-slate-500 font-sans">Carga última P</dt>
                  <dd className="text-right font-bold">{(nl.lambda * (frame?.P0 ?? 0)).toFixed(0)} kN (λ = {nl.lambda.toFixed(3)})</dd>
                  {div > 1 && (
                    <>
                      <dt className="text-slate-500 font-sans">Carga por apoio (P/{div})</dt>
                      <dd className="text-right font-bold">{((nl.lambda * (frame?.P0 ?? 0)) / div).toFixed(0)} kN</dd>
                    </>
                  )}
                  <dt className="text-slate-500 font-sans">Modo de ruptura</dt><dd className="text-right">{nl.mode ?? "—"}</dd>
                  <dt className="text-slate-500 font-sans">Utilização concreto |σ3|/fc</dt><dd className="text-right">{(nl.utilization.concreteStress * 100).toFixed(0)} %</dd>
                  <dt className="text-slate-500 font-sans">Esmagamento ε/εcu</dt><dd className="text-right">{(nl.utilization.concreteCrush * 100).toFixed(0)} % (lc = {nl.crushLength} m)</dd>
                  <dt className="text-slate-500 font-sans">Utilização aço |σs|/fy</dt><dd className="text-right">{(nl.utilization.steelStress * 100).toFixed(0)} %</dd>
                  <dt className="text-slate-500 font-sans">Resíduo equilíbrio</dt><dd className="text-right">{(Math.max(nl.equilibrium.x, nl.equilibrium.y) * 100).toExponential(1)} %</dd>
                </dl>
              </div>
              <div className="border border-slate-200 rounded-lg p-3">
                <h3 className="font-bold uppercase text-[10.5px] tracking-wider text-slate-500 mb-1">Curva Carga × Deslocamento</h3>
                <LoadDispChart
                  curve={nl.curve}
                  refLoadKN={benchmark?.category === "nl" ? benchmark.reference.publishedValue : undefined}
                  loadDivisor={div}
                  height={145}
                />
              </div>
            </div>
          )}

          {/* Comparação com Benchmark */}
          {benchmark && (
            <div className="border border-teal-200 bg-teal-50/60 rounded-lg p-3 space-y-1">
              <h3 className="font-bold text-teal-900">Referência de Benchmark — {benchmark.title}</h3>
              <div className="text-[11px] text-slate-700"><strong>Fonte:</strong> {benchmark.citation} ({benchmark.sourceFile})</div>
              <div className="text-[11px] text-slate-700"><strong>Publicado:</strong> {benchmark.reference.publishedNote}</div>
              {benchmark.reference.modelRangeNote && <div className="text-[11px] text-slate-600">{benchmark.reference.modelRangeNote}</div>}
            </div>
          )}

          {/* Resumo STM */}
          {stm && (
            <div className="border border-slate-200 rounded-lg p-3 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-bold uppercase text-[10.5px] tracking-wider text-slate-500">
                  Verificação STM — Bielas, Tirantes e Nós ({stm.codeId})
                </h3>
                <span className={`px-2 py-0.5 rounded text-[10.5px] font-bold ${stm.ok ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}`}>
                  {stm.ok ? "APROVADO" : "REPROVADO"}
                </span>
              </div>
              <dl className="grid grid-cols-3 gap-2 font-mono-tech text-[11px] bg-slate-50 p-2 rounded">
                <div><span className="text-slate-500 font-sans">STS (Xia):</span> <strong>{(stm.sts * 100).toFixed(1)} %</strong></div>
                <div><span className="text-slate-500 font-sans">Resíduo nodal:</span> <strong>{stm.residual.toExponential(1)} kN</strong></div>
                <div><span className="text-slate-500 font-sans">ΣAs,req ({stm.steelClass}):</span> <strong>{stm.totalAsReqCm2.toFixed(2)} cm²</strong></div>
                <div><span className="text-slate-500 font-sans">fcd1 / fcd2 / fcd3:</span> <strong>{stm.fcd1MPa.toFixed(1)} / {stm.fcd2MPa.toFixed(1)} / {stm.fcd3MPa.toFixed(1)} MPa</strong></div>
                <div><span className="text-slate-500 font-sans">Máx. util. biela:</span> <strong>{(stm.maxStrutUtil * 100).toFixed(0)} %</strong></div>
                <div><span className="text-slate-500 font-sans">Máx. util. nó:</span> <strong>{(stm.maxNodeUtil * 100).toFixed(0)} %</strong></div>
              </dl>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="font-semibold text-[11px] text-slate-700 mb-1">Membros ({stm.members.length})</div>
                  <table className="w-full text-[10.5px] font-mono-tech">
                    <thead>
                      <tr className="border-b border-slate-300 text-slate-600">
                        <th className="text-left py-0.5 font-sans">ID</th>
                        <th className="text-left py-0.5 font-sans">Tipo</th>
                        <th className="text-right py-0.5">N (kN)</th>
                        <th className="text-right py-0.5">As / σ</th>
                        <th className="text-right py-0.5">Util.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stm.members.map((m) => (
                        <tr key={m.id} className="border-b border-slate-100">
                          <td className="py-0.5">M{m.id}</td>
                          <td className="py-0.5 font-sans">{m.kind === "tie" ? "Tirante" : "Biela"}</td>
                          <td className="text-right py-0.5">{m.N.toFixed(1)}</td>
                          <td className="text-right py-0.5">
                            {m.kind === "tie" ? `${m.AsReqCm2.toFixed(2)} cm²` : `${m.sigmaMPa.toFixed(1)} MPa`}
                          </td>
                          <td className="text-right py-0.5">{(m.utilization * 100).toFixed(0)} %</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div>
                  <div className="font-semibold text-[11px] text-slate-700 mb-1">Nós ({stm.nodes.length})</div>
                  <table className="w-full text-[10.5px] font-mono-tech">
                    <thead>
                      <tr className="border-b border-slate-300 text-slate-600">
                        <th className="text-left py-0.5 font-sans">Nó</th>
                        <th className="text-left py-0.5 font-sans">Classe</th>
                        <th className="text-right py-0.5">σ / lim (MPa)</th>
                        <th className="text-right py-0.5">Util.</th>
                        <th className="text-right py-0.5">Âng.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stm.nodes.map((n) => (
                        <tr key={n.id} className="border-b border-slate-100">
                          <td className="py-0.5">N{n.id}</td>
                          <td className="py-0.5 font-sans">{n.kind}</td>
                          <td className="text-right py-0.5">{n.sigmaMPa.toFixed(1)}/{n.sigmaLimitMPa.toFixed(1)}</td>
                          <td className="text-right py-0.5">{(n.utilization * 100).toFixed(0)} %</td>
                          <td className="text-right py-0.5">{n.minAngleDeg != null ? `${n.minAngleDeg.toFixed(0)}°` : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Tabela de barras */}
          {nl && nl.bars.length > 0 && (
            <div className="border border-slate-200 rounded-lg p-3">
              <h3 className="font-bold uppercase text-[10.5px] tracking-wider text-slate-500 mb-2">Esforços nas Barras</h3>
              <table className="w-full text-[11px] font-mono-tech">
                <thead>
                  <tr className="border-b border-slate-300 text-slate-600">
                    <th className="text-left py-1 font-sans">Barra</th>
                    <th className="text-right py-1">N máx (kN)</th>
                    <th className="text-right py-1">ε máx (‰)</th>
                    <th className="text-right py-1">Escoou</th>
                    <th className="text-right py-1">P escoamento (kN)</th>
                  </tr>
                </thead>
                <tbody>
                  {nl.bars.map((b) => (
                    <tr key={b.label} className="border-b border-slate-100">
                      <td className="text-left py-1 font-sans">{b.label}</td>
                      <td className="text-right py-1">{b.axialMax.toFixed(1)}</td>
                      <td className="text-right py-1">{(b.strainMax * 1000).toFixed(2)}</td>
                      <td className="text-right py-1">{b.yielded ? "sim" : "não"}</td>
                      <td className="text-right py-1">{b.yieldLambda != null ? (b.yieldLambda * (frame?.P0 ?? 0)).toFixed(0) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
