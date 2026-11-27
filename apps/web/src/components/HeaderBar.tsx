import React, { useRef } from "react";
import { CODE_ORDER, DESIGN_CODES, codeById } from "@stm/core";
import type { DesignCodeId } from "@stm/core";
import { BookOpen, Download, FileText, LayoutTemplate, Upload } from "lucide-react";
import { MODEL_CATALOG } from "../state/sceneStorage";

interface HeaderBarProps {
  modelId: string;
  onSelectModel: (id: string) => void;
  codeId: DesignCodeId;
  onSelectCode: (id: DesignCodeId) => void;
  onOpenTemplates: () => void;
  onExportJson: () => void;
  onImportJson: (text: string) => void;
  onOpenReport: () => void;
}

export const HeaderBar: React.FC<HeaderBarProps> = ({
  modelId,
  onSelectModel,
  codeId,
  onSelectCode,
  onOpenTemplates,
  onExportJson,
  onImportJson,
  onOpenReport,
}) => {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const code = codeById(codeId);
  const fieldVals = Object.values(code.fields);
  const hasProv = fieldVals.includes(false);
  const hasSec = fieldVals.includes("sec");
  const badge = hasProv
    ? { text: "Provisório", cls: "bg-amber-500/20 text-amber-200 border-amber-400/40" }
    : hasSec
    ? { text: "Secundária", cls: "bg-sky-500/20 text-sky-200 border-sky-400/40" }
    : { text: "Primária", cls: "bg-emerald-500/20 text-emerald-200 border-emerald-400/40" };

  const groups = ["Benchmarks dos artigos", "Exemplos públicos", "Modelos locais"] as const;

  return (
    <header className="h-12 bg-slate-900 text-slate-100 px-3.5 flex items-center gap-3 border-b border-slate-800 shrink-0 no-print">
      <div className="flex items-center gap-2 mr-1">
        <div className="w-7 h-7 rounded-md bg-blue-600 flex items-center justify-center font-bold text-xs tracking-tight shadow-xs">
          STM
        </div>
        <div className="leading-tight">
          <h1 className="text-sm font-semibold tracking-tight text-white">STM-TopOpt</h1>
          <div className="text-[10.5px] text-slate-400 hidden sm:block">
            Bielas e Tirantes · CSFM · Benchmarks
          </div>
        </div>
      </div>

      <div className="h-6 w-px bg-slate-700 hidden md:block" />

      {/* Seletor de Modelo / Benchmark */}
      <label className="flex items-center gap-1.5 text-xs text-slate-300">
        <BookOpen className="w-3.5 h-3.5 text-blue-400 shrink-0" />
        <span className="hidden lg:inline">Modelo</span>
        <select
          aria-label="Selecionar modelo ou benchmark"
          value={modelId}
          onChange={(e) => onSelectModel(e.target.value)}
          className="bg-slate-800 text-slate-100 border border-slate-700 rounded-md px-2 py-1 text-xs max-w-64 sm:max-w-72 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {groups.map((grp) => {
            const items = MODEL_CATALOG.filter((m) => m.group === grp);
            if (!items.length) return null;
            return (
              <optgroup key={grp} label={grp}>
                {items.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </optgroup>
            );
          })}
          <option value="custom">— Minha geometria —</option>
        </select>
      </label>

      {/* Seletor de Norma */}
      <label className="flex items-center gap-1.5 text-xs text-slate-300">
        <span className="hidden lg:inline">Norma</span>
        <select
          aria-label="Selecionar norma"
          value={codeId}
          onChange={(e) => onSelectCode(e.target.value as DesignCodeId)}
          className="bg-slate-800 text-slate-100 border border-slate-700 rounded-md px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {CODE_ORDER.map((id) => (
            <option key={id} value={id}>
              {DESIGN_CODES[id].short}
            </option>
          ))}
        </select>
        <span
          className={`hidden xl:inline-block px-1.5 py-0.5 text-[10px] font-medium rounded border ${badge.cls}`}
          title="Status de conferência da norma nas fontes locais (detalhes na aba Normas)"
        >
          {badge.text}
        </span>
      </label>

      <div className="flex-1" />

      {/* Ações rápidas */}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={onOpenTemplates}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 text-xs font-medium transition-colors"
          title="Criar região D paramétrica (viga-parede, consolo, nó de pórtico)"
        >
          <LayoutTemplate className="w-3.5 h-3.5 text-blue-400" />
          <span className="hidden md:inline">Templates</span>
        </button>

        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="inline-flex items-center gap-1 px-2 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs transition-colors"
          title="Importar cena JSON"
        >
          <Upload className="w-3.5 h-3.5" />
          <span className="hidden xl:inline">Importar</span>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            f.text().then(onImportJson);
            e.target.value = "";
          }}
        />

        <button
          type="button"
          onClick={onExportJson}
          className="inline-flex items-center gap-1 px-2 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs transition-colors"
          title="Exportar cena JSON"
        >
          <Download className="w-3.5 h-3.5" />
          <span className="hidden xl:inline">JSON</span>
        </button>

        <button
          type="button"
          onClick={onOpenReport}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition-colors shadow-xs"
          title="Gerar memória de cálculo / relatório imprimível"
        >
          <FileText className="w-3.5 h-3.5" />
          <span>Relatório</span>
        </button>
      </div>
    </header>
  );
};
