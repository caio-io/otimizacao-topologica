import React, { useState } from "react";
import { templateCorbel, templateDeepBeam, templateFrameCorner } from "@stm/core";
import type { Scene } from "@stm/core";
import { X } from "lucide-react";

interface TemplateModalProps {
  open: boolean;
  onClose: () => void;
  onCreate: (scene: Scene, label: string) => void;
}

type TplKind = "deepBeam" | "corbel" | "frameCorner";

export const TemplateModal: React.FC<TemplateModalProps> = ({ open, onClose, onCreate }) => {
  const [kind, setKind] = useState<TplKind>("deepBeam");

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
    } else {
      const sc = templateFrameCorner({
        colW: fcColW, colH: fcColH, beamL: fcBeamL, beamH: fcBeamH,
        t: fcT, h: 0.05, qKNm: fcQ, fck: 30,
      });
      onCreate(sc, `Nó de pórtico (${fcQ} kN/m)`);
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 no-print">
      <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden">
        <div className="px-4 py-3 bg-slate-900 text-white flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold">Novo Modelo Paramétrico (Região D)</h2>
            <p className="text-[11px] text-slate-400">Gera geometria, apoios e carregamento prontos para análise</p>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-slate-800 text-slate-300">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="grid grid-cols-3 gap-2">
            {([
              ["deepBeam", "Viga-parede"],
              ["corbel", "Consolo curto"],
              ["frameCorner", "Nó de pórtico"],
            ] as const).map(([id, lbl]) => (
              <button
                key={id}
                type="button"
                onClick={() => setKind(id)}
                className={`py-2 px-3 rounded-lg border text-xs font-semibold transition-colors ${
                  kind === id
                    ? "bg-blue-50 border-blue-500 text-blue-700"
                    : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                }`}
              >
                {lbl}
              </button>
            ))}
          </div>

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
