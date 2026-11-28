import React, { useMemo, useState } from "react";
import { templateCorbel, templateDeepBeam, templateFrameCorner, templateWalkingColumn, walkingColumnSummary } from "@stm/core";
import type { Scene } from "@stm/core";
import { X } from "lucide-react";

interface TemplateModalProps {
  open: boolean;
  onClose: () => void;
  onCreate: (scene: Scene, label: string) => void;
}

type TplKind = "deepBeam" | "corbel" | "frameCorner" | "walkingColumn";

export const TemplateModal: React.FC<TemplateModalProps> = ({ open, onClose, onCreate }) => {
  const [kind, setKind] = useState<TplKind>("walkingColumn");

  // Viga-parede
  const [dbL, setDbL] = useState(3.0);
  const [dbH, setDbH] = useState(1.5);
  const [dbT, setDbT] = useState(0.25);
  const [dbLoad, setDbLoad] = useState(1000);
  const [dbFck, setDbFck] = useState(30);
  const [dbOpen, setDbOpen] = useState(false);

  // Consolo
  const [cbColW, setCbColW] = useState(0.5);
  const [cbColH, setCbColH] = useState(2.2);
  const [cbA, setCbA] = useState(0.55);
  const [cbH, setCbH] = useState(0.65);
  const [cbT, setCbT] = useState(0.3);
  const [cbFv, setCbFv] = useState(450);
  const [cbFh, setCbFh] = useState(45);

  // Nó de pórtico
  const [fcColW, setFcColW] = useState(0.4);
  const [fcColH, setFcColH] = useState(2.6);
  const [fcBeamL, setFcBeamL] = useState(2.6);
  const [fcBeamH, setFcBeamH] = useState(0.5);
  const [fcT, setFcT] = useState(0.3);
  const [fcQ, setFcQ] = useState(180);

  // Walking Column (3 pavimentos)
  const [wcName, setWcName] = useState("Edifício Exemplo");
  const [wcStoryH, setWcStoryH] = useState(3.0);
  const [wcFck, setWcFck] = useState(35);
  const [wcTopAxisX, setWcTopAxisX] = useState(1.0);
  const [wcEcc, setWcEcc] = useState(0.8);
  const [wcTopW, setWcTopW] = useState(0.5);
  const [wcBotW, setWcBotW] = useState(0.5);
  const [wcT, setWcT] = useState(0.4);
  const [wcSlabH, setWcSlabH] = useState(0.2);
  const [wcLoadN, setWcLoadN] = useState(1800);
  const [wcLoadH, setWcLoadH] = useState(0);
  const [wcRebar, setWcRebar] = useState(true);

  const wcParams = useMemo(() => ({
    buildingName: wcName.trim() || "Edifício",
    storyH: wcStoryH,
    topAxisX: wcTopAxisX,
    eccentricity: wcEcc,
    topColW: wcTopW,
    botColW: wcBotW,
    t: wcT,
    slabH: wcSlabH,
    fck: wcFck,
    loadTopKN: wcLoadN,
    horizTopKN: wcLoadH,
    includeRebar: wcRebar,
  }), [wcName, wcStoryH, wcTopAxisX, wcEcc, wcTopW, wcBotW, wcT, wcSlabH, wcFck, wcLoadN, wcLoadH, wcRebar]);

  const wcSum = useMemo(() => walkingColumnSummary(wcParams), [wcParams]);

  if (!open) return null;

  const handleApply = () => {
    if (kind === "deepBeam") {
      const sc = templateDeepBeam({
        L: dbL, H: dbH, t: dbT, h: Math.max(0.025, Math.round((dbL / 80) * 200) / 200),
        bearing: Math.min(0.4, dbL * 0.1), loadKN: dbLoad, fck: dbFck,
        opening: dbOpen ? { x: dbL * 0.22, y: dbH * 0.35, w: dbL * 0.2, h: dbH * 0.32 } : null,
      });
      onCreate(sc, `Viga-parede ${dbL}×${dbH} m`);
    } else if (kind === "corbel") {
      const sc = templateCorbel({
        colW: cbColW, colH: cbColH, corbA: cbA, corbH: cbH, corbY: cbColH * 0.42,
        t: cbT, h: 0.04, bearing: Math.min(0.2, cbA * 0.4), fvKN: cbFv, fhKN: cbFh, fck: 30,
      });
      onCreate(sc, `Consolo curto (${cbFv} kN)`);
    } else if (kind === "frameCorner") {
      const sc = templateFrameCorner({
        colW: fcColW, colH: fcColH, beamL: fcBeamL, beamH: fcBeamH,
        t: fcT, h: 0.05, qKNm: fcQ, fck: 30,
      });
      onCreate(sc, `Nó de pórtico (${fcQ} kN/m)`);
    } else {
      const sc = templateWalkingColumn(wcParams);
      onCreate(sc, `${wcParams.buildingName} — Walking Column (e=${wcEcc.toFixed(2)} m)`);
    }
    onClose();
  };

  // Coordenadas do mini preview SVG do Walking Column
  const svgPadX = 0.4;
  const svgMinX = wcSum.xMidL - svgPadX;
  const svgW = Math.max(1.2, wcSum.midColW + 2 * svgPadX);
  const svgH = wcSum.totalH + 0.8;
  const sx = (x: number) => ((x - svgMinX) / svgW) * 160 + 10;
  const sy = (y: number) => 175 - (y / svgH) * 155;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 no-print">
      <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-2xl max-h-[92vh] overflow-y-auto">
        <div className="px-4 py-3 bg-slate-900 text-white flex items-center justify-between sticky top-0 z-10">
          <div>
            <h2 className="text-sm font-semibold">Novo Modelo Paramétrico (Região D)</h2>
            <p className="text-[11px] text-slate-400">Gera geometria, apoios e carregamento prontos para análise</p>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-slate-800 text-slate-300">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="grid grid-cols-4 gap-2">
            {([
              ["walkingColumn", "Walking Column"],
              ["deepBeam", "Viga-parede"],
              ["corbel", "Consolo curto"],
              ["frameCorner", "Nó de pórtico"],
            ] as const).map(([id, lbl]) => (
              <button
                key={id}
                type="button"
                onClick={() => setKind(id)}
                className={`py-2 px-2.5 rounded-lg border text-xs font-semibold transition-colors ${
                  kind === id
                    ? "bg-blue-50 border-blue-500 text-blue-700"
                    : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                }`}
              >
                {lbl}
              </button>
            ))}
          </div>

          {kind === "walkingColumn" && (
            <div className="grid grid-cols-1 md:grid-cols-[1fr_195px] gap-4 text-xs">
              <div className="space-y-3">
                {/* 1) Edifício & Concreto */}
                <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 space-y-2">
                  <div className="text-[10.5px] font-bold uppercase tracking-wider text-slate-500">1. Edifício & Concreto</div>
                  <div className="grid grid-cols-3 gap-2">
                    <label className="space-y-1 col-span-3 sm:col-span-1">
                      <span className="text-slate-600">Nome do edifício</span>
                      <input type="text" value={wcName} onChange={(e) => setWcName(e.target.value)} className="w-full px-2 py-1.5 border border-slate-300 rounded-md bg-white" />
                    </label>
                    <label className="space-y-1">
                      <span className="text-slate-600">Pé-direito H (m)</span>
                      <input type="number" step="0.1" min="2.0" value={wcStoryH} onChange={(e) => setWcStoryH(+e.target.value)} className="w-full px-2 py-1.5 border border-slate-300 rounded-md bg-white" />
                    </label>
                    <label className="space-y-1">
                      <span className="text-slate-600">fck (MPa)</span>
                      <input type="number" step="5" min="25" value={wcFck} onChange={(e) => setWcFck(+e.target.value)} className="w-full px-2 py-1.5 border border-slate-300 rounded-md bg-white" />
                    </label>
                  </div>
                </div>

                {/* 2) Pilares (3 pavimentos) */}
                <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 space-y-2">
                  <div className="text-[10.5px] font-bold uppercase tracking-wider text-slate-500">2. Pilares (3 pavimentos — intermediário automático)</div>
                  <div className="grid grid-cols-3 gap-2">
                    <label className="space-y-1">
                      <span className="text-slate-600">Eixo pilar sup. X (m)</span>
                      <input type="number" step="0.1" value={wcTopAxisX} onChange={(e) => setWcTopAxisX(+e.target.value)} className="w-full px-2 py-1.5 border border-slate-300 rounded-md bg-white" />
                    </label>
                    <label className="space-y-1">
                      <span className="text-slate-600">Excentricidade e (m)</span>
                      <input type="number" step="0.1" value={wcEcc} onChange={(e) => setWcEcc(+e.target.value)} className="w-full px-2 py-1.5 border border-slate-300 rounded-md bg-white" />
                    </label>
                    <label className="space-y-1">
                      <span className="text-slate-600">Espessura t (m)</span>
                      <input type="number" step="0.05" min="0.15" value={wcT} onChange={(e) => setWcT(+e.target.value)} className="w-full px-2 py-1.5 border border-slate-300 rounded-md bg-white" />
                    </label>
                    <label className="space-y-1">
                      <span className="text-slate-600">Larg. pilar sup. (m)</span>
                      <input type="number" step="0.05" min="0.2" value={wcTopW} onChange={(e) => setWcTopW(+e.target.value)} className="w-full px-2 py-1.5 border border-slate-300 rounded-md bg-white" />
                    </label>
                    <label className="space-y-1">
                      <span className="text-slate-600">Larg. pilar inf. (m)</span>
                      <input type="number" step="0.05" min="0.2" value={wcBotW} onChange={(e) => setWcBotW(+e.target.value)} className="w-full px-2 py-1.5 border border-slate-300 rounded-md bg-white" />
                    </label>
                    <div className="rounded-md bg-blue-50 border border-blue-200 px-2 py-1 flex flex-col justify-center">
                      <span className="text-[10px] text-blue-700 font-semibold">Intermediário (auto)</span>
                      <span className="font-mono text-[11px] font-bold text-blue-900">
                        b = {wcSum.midColW.toFixed(2)} m
                      </span>
                      <span className="font-mono text-[9.5px] text-blue-700">
                        [{wcSum.xMidL.toFixed(2)} ; {wcSum.xMidR.toFixed(2)}]
                      </span>
                    </div>
                  </div>
                </div>

                {/* 3) Laje do diafragma + 4) Carregamentos */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 space-y-2">
                    <div className="text-[10.5px] font-bold uppercase tracking-wider text-slate-500">3. Laje do Diafragma</div>
                    <label className="space-y-1 block">
                      <span className="text-slate-600">Espessura da laje h_laje (m)</span>
                      <input type="number" step="0.02" min="0.1" max="0.8" value={wcSlabH} onChange={(e) => setWcSlabH(+e.target.value)} className="w-full px-2 py-1.5 border border-slate-300 rounded-md bg-white" />
                    </label>
                    <p className="text-[10px] text-slate-500 leading-tight">
                      Diafragmas rígidos nos 2 lados (<code>Diaf1E/D</code>, <code>Diaf2E/D</code>) — clique e pressione Delete para apagar algum lado.
                    </p>
                  </div>

                  <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 space-y-2">
                    <div className="text-[10.5px] font-bold uppercase tracking-wider text-slate-500">4. Carregamentos</div>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="space-y-1">
                        <span className="text-slate-600">Carga N (kN)</span>
                        <input type="number" step="100" min="10" value={wcLoadN} onChange={(e) => setWcLoadN(+e.target.value)} className="w-full px-2 py-1.5 border border-slate-300 rounded-md bg-white" />
                      </label>
                      <label className="space-y-1">
                        <span className="text-slate-600">Horiz. V (kN)</span>
                        <input type="number" step="20" value={wcLoadH} onChange={(e) => setWcLoadH(+e.target.value)} className="w-full px-2 py-1.5 border border-slate-300 rounded-md bg-white" />
                      </label>
                    </div>
                    <label className="flex items-center gap-2 pt-0.5 cursor-pointer">
                      <input type="checkbox" checked={wcRebar} onChange={(e) => setWcRebar(e.target.checked)} className="rounded border-slate-300 text-blue-600" />
                      <span className="text-[11px] text-slate-700 font-medium">Gerar armadura inicial (Nível 2)</span>
                    </label>
                  </div>
                </div>
              </div>

              {/* Preview SVG + Pré-diagnóstico */}
              <div className="flex flex-col justify-between gap-2 p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Esquema (tocos {wcSum.stubH.toFixed(2)} m)</div>
                  <svg viewBox="0 0 180 185" className="w-full h-44 bg-white rounded border border-slate-200">
                    {/* Linhas de eixo */}
                    <line x1={sx(wcTopAxisX)} y1={10} x2={sx(wcTopAxisX)} y2={175} stroke="#94a3b8" strokeDasharray="3 2" strokeWidth="0.8" />
                    <line x1={sx(wcSum.xBotAxis)} y1={10} x2={sx(wcSum.xBotAxis)} y2={175} stroke="#94a3b8" strokeDasharray="3 2" strokeWidth="0.8" />
                    {/* Toco inferior (Pav. 1) */}
                    <rect x={sx(wcSum.xBotL)} y={sy(wcSum.stubH)} width={Math.max(4, sx(wcSum.xBotR) - sx(wcSum.xBotL))} height={Math.max(4, sy(0) - sy(wcSum.stubH))} fill="#cbd5e1" stroke="#334155" strokeWidth="1" />
                    {/* Pav. 2 (intermediário envolvente) */}
                    <rect x={sx(wcSum.xMidL)} y={sy(wcSum.stubH + wcStoryH + wcSlabH)} width={Math.max(6, sx(wcSum.xMidR) - sx(wcSum.xMidL))} height={Math.max(6, sy(wcSum.stubH) - sy(wcSum.stubH + wcStoryH + wcSlabH))} fill="#bfdbfe" stroke="#1d4ed8" strokeWidth="1.2" />
                    {/* Toco superior (Pav. 3) */}
                    <rect x={sx(wcSum.xTopL)} y={sy(wcSum.totalH)} width={Math.max(4, sx(wcSum.xTopR) - sx(wcSum.xTopL))} height={Math.max(4, sy(wcSum.stubH + wcStoryH + wcSlabH) - sy(wcSum.totalH))} fill="#cbd5e1" stroke="#334155" strokeWidth="1" />
                    {/* Faixas das lajes (diafragmas nos 2 lados) */}
                    <line x1={8} y1={sy(wcSum.stubH + wcSlabH / 2)} x2={172} y2={sy(wcSum.stubH + wcSlabH / 2)} stroke="#64748b" strokeWidth="1.6" strokeDasharray="4 2" />
                    <line x1={8} y1={sy(wcSum.stubH + wcStoryH + wcSlabH / 2)} x2={172} y2={sy(wcSum.stubH + wcStoryH + wcSlabH / 2)} stroke="#64748b" strokeWidth="1.6" strokeDasharray="4 2" />
                    {/* Seta de carga N */}
                    <line x1={sx(wcTopAxisX)} y1={4} x2={sx(wcTopAxisX)} y2={sy(wcSum.totalH) - 2} stroke="#d9460f" strokeWidth="1.6" />
                    <polygon points={`${sx(wcTopAxisX)},${sy(wcSum.totalH)} ${sx(wcTopAxisX) - 3.5},${sy(wcSum.totalH) - 6} ${sx(wcTopAxisX) + 3.5},${sy(wcSum.totalH) - 6}`} fill="#d9460f" />
                    <text x={12} y={sy(wcSum.stubH + wcStoryH + wcSlabH / 2) - 4} fontSize="7.5" fill="#475569" fontWeight="bold">Diaf. 2 (E/D)</text>
                    <text x={12} y={sy(wcSum.stubH + wcSlabH / 2) - 4} fontSize="7.5" fill="#475569" fontWeight="bold">Diaf. 1 (E/D)</text>
                  </svg>
                </div>
                <div className="space-y-1 text-[10.5px] font-mono bg-white border border-slate-200 rounded p-2">
                  <div className="flex justify-between"><span className="text-slate-500">H_diaf est.:</span><strong>±{wcSum.estimatedThrustKN.toFixed(0)} kN</strong></div>
                  <div className="flex justify-between"><span className="text-slate-500">As,diaf (+laje):</span><strong>{wcSum.estimatedDiafAsCm2.toFixed(1)} cm²</strong></div>
                  <div className="flex justify-between"><span className="text-slate-500">Biela θ / e/H:</span><span>{wcSum.strutAngleDeg.toFixed(0)}° ({wcSum.eccRatio.toFixed(2)})</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Taxa ν = N/Ac·fcd:</span><span className={wcSum.axialRatioNu > 0.7 ? "text-red-600 font-bold" : ""}>{wcSum.axialRatioNu.toFixed(2)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Malha auto h:</span><span>{(wcSum.meshH * 100).toFixed(0)} cm</span></div>
                </div>
              </div>
            </div>
          )}

          {kind === "deepBeam" && (
            <div className="grid grid-cols-2 gap-3 text-xs">
              <label className="space-y-1">
                <span className="text-slate-600">Comprimento L (m)</span>
                <input type="number" step="0.1" min="0.5" value={dbL} onChange={(e) => setDbL(+e.target.value)} className="w-full px-2.5 py-1.5 border border-slate-300 rounded-md" />
              </label>
              <label className="space-y-1">
                <span className="text-slate-600">Altura H (m)</span>
                <input type="number" step="0.1" min="0.4" value={dbH} onChange={(e) => setDbH(+e.target.value)} className="w-full px-2.5 py-1.5 border border-slate-300 rounded-md" />
              </label>
              <label className="space-y-1">
                <span className="text-slate-600">Espessura t (m)</span>
                <input type="number" step="0.05" min="0.1" value={dbT} onChange={(e) => setDbT(+e.target.value)} className="w-full px-2.5 py-1.5 border border-slate-300 rounded-md" />
              </label>
              <label className="space-y-1">
                <span className="text-slate-600">Carga central P (kN)</span>
                <input type="number" step="50" min="10" value={dbLoad} onChange={(e) => setDbLoad(+e.target.value)} className="w-full px-2.5 py-1.5 border border-slate-300 rounded-md" />
              </label>
              <label className="space-y-1">
                <span className="text-slate-600">fck (MPa)</span>
                <input type="number" step="5" min="25" value={dbFck} onChange={(e) => setDbFck(+e.target.value)} className="w-full px-2.5 py-1.5 border border-slate-300 rounded-md" />
              </label>
              <label className="flex items-center gap-2 pt-5 cursor-pointer">
                <input type="checkbox" checked={dbOpen} onChange={(e) => setDbOpen(e.target.checked)} className="rounded border-slate-300 text-blue-600" />
                <span className="text-slate-700 font-medium">Incluir abertura</span>
              </label>
            </div>
          )}

          {kind === "corbel" && (
            <div className="grid grid-cols-2 gap-3 text-xs">
              <label className="space-y-1">
                <span className="text-slate-600">Largura pilar (m)</span>
                <input type="number" step="0.05" min="0.25" value={cbColW} onChange={(e) => setCbColW(+e.target.value)} className="w-full px-2.5 py-1.5 border border-slate-300 rounded-md" />
              </label>
              <label className="space-y-1">
                <span className="text-slate-600">Altura pilar (m)</span>
                <input type="number" step="0.1" min="1.0" value={cbColH} onChange={(e) => setCbColH(+e.target.value)} className="w-full px-2.5 py-1.5 border border-slate-300 rounded-md" />
              </label>
              <label className="space-y-1">
                <span className="text-slate-600">Balanço consolo a (m)</span>
                <input type="number" step="0.05" min="0.2" value={cbA} onChange={(e) => setCbA(+e.target.value)} className="w-full px-2.5 py-1.5 border border-slate-300 rounded-md" />
              </label>
              <label className="space-y-1">
                <span className="text-slate-600">Altura consolo h (m)</span>
                <input type="number" step="0.05" min="0.25" value={cbH} onChange={(e) => setCbH(+e.target.value)} className="w-full px-2.5 py-1.5 border border-slate-300 rounded-md" />
              </label>
              <label className="space-y-1">
                <span className="text-slate-600">Espessura t (m)</span>
                <input type="number" step="0.05" min="0.15" value={cbT} onChange={(e) => setCbT(+e.target.value)} className="w-full px-2.5 py-1.5 border border-slate-300 rounded-md" />
              </label>
              <label className="space-y-1">
                <span className="text-slate-600">Carga vertical Fv (kN)</span>
                <input type="number" step="50" min="10" value={cbFv} onChange={(e) => setCbFv(+e.target.value)} className="w-full px-2.5 py-1.5 border border-slate-300 rounded-md" />
              </label>
              <label className="space-y-1 col-span-2">
                <span className="text-slate-600">Força horizontal Fh (kN, + para fora)</span>
                <input type="number" step="10" value={cbFh} onChange={(e) => setCbFh(+e.target.value)} className="w-full px-2.5 py-1.5 border border-slate-300 rounded-md" />
              </label>
            </div>
          )}

          {kind === "frameCorner" && (
            <div className="grid grid-cols-2 gap-3 text-xs">
              <label className="space-y-1">
                <span className="text-slate-600">Largura pilar (m)</span>
                <input type="number" step="0.05" min="0.25" value={fcColW} onChange={(e) => setFcColW(+e.target.value)} className="w-full px-2.5 py-1.5 border border-slate-300 rounded-md" />
              </label>
              <label className="space-y-1">
                <span className="text-slate-600">Altura pilar (m)</span>
                <input type="number" step="0.1" min="1.2" value={fcColH} onChange={(e) => setFcColH(+e.target.value)} className="w-full px-2.5 py-1.5 border border-slate-300 rounded-md" />
              </label>
              <label className="space-y-1">
                <span className="text-slate-600">Vão livre viga (m)</span>
                <input type="number" step="0.1" min="1.0" value={fcBeamL} onChange={(e) => setFcBeamL(+e.target.value)} className="w-full px-2.5 py-1.5 border border-slate-300 rounded-md" />
              </label>
              <label className="space-y-1">
                <span className="text-slate-600">Altura viga (m)</span>
                <input type="number" step="0.05" min="0.3" value={fcBeamH} onChange={(e) => setFcBeamH(+e.target.value)} className="w-full px-2.5 py-1.5 border border-slate-300 rounded-md" />
              </label>
              <label className="space-y-1">
                <span className="text-slate-600">Espessura t (m)</span>
                <input type="number" step="0.05" min="0.15" value={fcT} onChange={(e) => setFcT(+e.target.value)} className="w-full px-2.5 py-1.5 border border-slate-300 rounded-md" />
              </label>
              <label className="space-y-1">
                <span className="text-slate-600">Carga distribuída q (kN/m)</span>
                <input type="number" step="20" min="10" value={fcQ} onChange={(e) => setFcQ(+e.target.value)} className="w-full px-2.5 py-1.5 border border-slate-300 rounded-md" />
              </label>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
            <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-md border border-slate-300 text-xs text-slate-700 hover:bg-slate-50">
              Cancelar
            </button>
            <button type="button" onClick={handleApply} className="px-4 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold">
              Criar modelo
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
