import React from "react";
import {
  CODE_ORDER,
  DESIGN_CODES,
  STEEL_CLASSES,
  clampFck,
  combine,
  fcdOfCode,
  strutDesignStrength,
} from "@stm/core";
import type { DesignCode, DesignCodeId, Ver } from "@stm/core";

interface NormasTabProps {
  fck: number;
  activeCodeId: DesignCodeId;
  onSelectCode: (id: DesignCodeId) => void;
}

const fmt = (v: number, d = 2) => v.toFixed(d).replace(".", ",");

const cellTone = (ok?: Ver) => {
  if (ok === true) return "bg-emerald-50 text-emerald-900";
  if (ok === "sec") return "bg-sky-50 text-sky-900";
  if (ok === false) return "bg-amber-50 text-amber-900";
  return "text-slate-400";
};

export const NormasTab: React.FC<NormasTabProps> = ({ fck, activeCodeId, onSelectCode }) => {
  const fckEff = clampFck(fck);
  type Cell = { t: string; ok?: Ver };

  const rows: [string, (c: DesignCode) => Cell][] = [
    ["γc", (c) => ({ t: fmt(c.gammaC, 2), ok: c.fields.gammaC })],
    ["αcc", (c) => ({ t: fmt(c.alphaCc, 2), ok: c.fields.alphaCc })],
    [`fcd (MPa) · C${fckEff}`, (c) => ({ t: fmt(fcdOfCode(c, fckEff), 1), ok: combine(c.fields.gammaC, c.fields.alphaCc) })],
    ["εc2 (‰)", (c) => ({ t: fmt(c.epsC0 * 1000, 1), ok: c.fields.epsC0 })],
    ["εcu (‰)", (c) => ({ t: fmt(c.epsCu * 1000, 1), ok: c.fields.epsCu })],
    ["γs", (c) => ({ t: fmt(c.gammaS, 2), ok: c.fields.gammaS })],
    ["εud aço (‰)", (c) => (c.epsUd == null ? { t: "—" } : { t: fmt(c.epsUd * 1000, 1), ok: c.fields.epsUd })],
    ["Aços", (c) => (c.steelClasses.length ? { t: c.steelClasses.map((k) => STEEL_CLASSES[k].label).join(", "), ok: c.fields.steel } : { t: "—" })],
    ["Biela σRd,máx", (c) => {
      const d = strutDesignStrength(c, fckEff);
      return { t: fmt(d.sigma, 1) + (d.fallback ? " (NBR)" : ""), ok: d.fallback ? false : d.verified };
    }],
    ["Biela traç. ⊥", (c) => (c.strut ? { t: fmt(c.strut.tensionNormal(fckEff) * fcdOfCode(c, fckEff), 1), ok: combine(c.fields.gammaC, c.fields.alphaCc) } : { t: "—" })],
    ["Biela traç. ∠", (c) => (c.strut ? { t: fmt(c.strut.tensionOblique(fckEff) * fcdOfCode(c, fckEff), 1), ok: combine(c.fields.gammaC, c.fields.alphaCc) } : { t: "—" })],
    ["φ (STM)", (c) => (c.phi != null ? { t: fmt(c.phi, 2), ok: "sec" } : { t: "—" })],
  ];

  return (
    <div className="space-y-3 text-xs">
      <div className="flex flex-wrap gap-1.5 text-[10.5px]">
        <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 font-medium">Fonte primária</span>
        <span className="px-2 py-0.5 rounded bg-sky-50 text-sky-800 border border-sky-200 font-medium">Fonte secundária</span>
        <span className="px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200 font-medium">Provisório</span>
      </div>

      <div className="overflow-x-auto border border-slate-200 rounded-lg">
        <table className="w-full border-collapse text-[11px]">
          <thead>
            <tr className="bg-slate-100 border-b border-slate-200">
              <th className="text-left p-1.5 font-semibold text-slate-600">Parâmetro</th>
              {CODE_ORDER.map((id) => {
                const c = DESIGN_CODES[id];
                const act = id === activeCodeId;
                return (
                  <th key={id} className={`p-1.5 text-center border-l border-slate-200 ${act ? "bg-blue-50 text-blue-800" : "text-slate-700"}`}>
                    <div className="font-semibold leading-tight">{c.short}</div>
                    {act ? (
                      <div className="text-[9.5px] font-bold text-blue-600 mt-0.5">ativa</div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onSelectCode(id)}
                        className="mt-1 px-1.5 py-0.5 rounded bg-white border border-slate-300 hover:bg-slate-50 text-[10px] font-medium text-slate-700"
                      >
                        Usar
                      </button>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map(([lbl, fn]) => (
              <tr key={lbl} className="border-b border-slate-100 last:border-0">
                <td className="p-1.5 text-slate-600 font-medium">{lbl}</td>
                {CODE_ORDER.map((id) => {
                  const cell = fn(DESIGN_CODES[id]);
                  const act = id === activeCodeId;
                  return (
                    <td key={id} className={`p-1.5 text-center border-l border-slate-100 font-mono-tech ${cellTone(cell.ok)} ${act ? "ring-1 ring-inset ring-blue-300" : ""}`}>
                      {cell.t}
                      {cell.ok === false && <sup className="text-[8.5px] ml-0.5">prov</sup>}
                      {cell.ok === "sec" && <sup className="text-[8.5px] ml-0.5">sec</sup>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-2">
        {CODE_ORDER.map((id) => {
          const c = DESIGN_CODES[id];
          return (
            <details key={id} open={id === activeCodeId} className="border border-slate-200 rounded-lg bg-white p-2.5 text-[11px]">
              <summary className="cursor-pointer font-semibold text-slate-800">{c.name}</summary>
              <div className="mt-2 space-y-1.5 text-slate-600">
                <div>
                  <strong className="text-emerald-800">Conferido:</strong>
                  <ul className="list-disc pl-4 mt-0.5 space-y-0.5">
                    {c.status.verificado.map((t, i) => <li key={i}>{t}</li>)}
                  </ul>
                </div>
                <div>
                  <strong className="text-amber-800">Pendente:</strong>
                  <ul className="list-disc pl-4 mt-0.5 space-y-0.5">
                    {c.status.pendente.map((t, i) => <li key={i}>{t}</li>)}
                  </ul>
                </div>
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
};
