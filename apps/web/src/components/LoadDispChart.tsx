import React from "react";
import type { NlCurvePoint } from "@stm/core";

interface LoadDispChartProps {
  curve: NlCurvePoint[];
  activeStepIndex?: number;
  onSelectStep?: (stepIdx: number) => void;
  refLoadKN?: number;
  refLabel?: string;
  loadDivisor?: number;
  unitLabel?: string;
  height?: number;
}

export const LoadDispChart: React.FC<LoadDispChartProps> = ({
  curve,
  activeStepIndex,
  onSelectStep,
  refLoadKN,
  refLabel,
  loadDivisor = 1,
  unitLabel = "kN",
  height = 138,
}) => {
  const W = 340, H = height;
  const padL = 42, padR = 14, padT = 14, padB = 26;
  const pw = W - padL - padR, ph = H - padT - padB;

  const pts = curve.map((c) => ({
    x: c.disp * 1000, // mm
    y: c.load / loadDivisor,
  }));

  const maxX = Math.max(0.1, ...pts.map((p) => p.x)) * 1.08;
  const maxY = Math.max(1, refLoadKN ?? 0, ...pts.map((p) => p.y)) * 1.12;

  const sx = (x: number) => padL + (x / maxX) * pw;
  const sy = (y: number) => padT + ph - (y / maxY) * ph;

  const linePath = pts.map((p, i) => `${i === 0 ? "M" : "L"}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(" ");
  const areaPath = pts.length > 1
    ? `${linePath} L${sx(pts[pts.length - 1].x).toFixed(1)},${(padT + ph).toFixed(1)} L${sx(pts[0].x).toFixed(1)},${(padT + ph).toFixed(1)} Z`
    : "";

  const yTicks = [0, 0.5, 1].map((f) => f * maxY);
  const xTicks = [0, 0.5, 1].map((f) => f * maxX);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto select-none">
      {/* Grade horizontal */}
      {yTicks.map((v, i) => (
        <g key={`y${i}`}>
          <line x1={padL} y1={sy(v)} x2={W - padR} y2={sy(v)} stroke="#e2e8f0" strokeWidth={1} />
          <text x={padL - 5} y={sy(v) + 3} textAnchor="end" className="fill-slate-500 text-[9px] font-mono-tech">
            {v >= 100 ? v.toFixed(0) : v.toFixed(1)}
          </text>
        </g>
      ))}
      {/* Grade vertical */}
      {xTicks.map((v, i) => (
        <g key={`x${i}`}>
          <line x1={sx(v)} y1={padT} x2={sx(v)} y2={padT + ph} stroke="#f1f5f9" strokeWidth={1} />
          <text x={sx(v)} y={H - 8} textAnchor="middle" className="fill-slate-500 text-[9px] font-mono-tech">
            {v.toFixed(1)}
          </text>
        </g>
      ))}

      {/* Eixos */}
      <line x1={padL} y1={padT} x2={padL} y2={padT + ph} stroke="#94a3b8" strokeWidth={1} />
      <line x1={padL} y1={padT + ph} x2={W - padR} y2={padT + ph} stroke="#94a3b8" strokeWidth={1} />

      {/* Rótulos */}
      <text x={W / 2 + 12} y={H - 1} textAnchor="middle" className="fill-slate-500 text-[9px]">
        δ equivalente (mm)
      </text>
      <text x={11} y={padT + ph / 2} textAnchor="middle" transform={`rotate(-90, 11, ${padT + ph / 2})`} className="fill-slate-500 text-[9px]">
        {loadDivisor > 1 ? `P/${loadDivisor} (${unitLabel})` : `P (${unitLabel})`}
      </text>

      {/* Linha de referência do benchmark/ensaio */}
      {refLoadKN != null && refLoadKN > 0 && (
        <g>
          <line
            x1={padL}
            y1={sy(refLoadKN)}
            x2={W - padR}
            y2={sy(refLoadKN)}
            stroke="#0f766e"
            strokeWidth={1.3}
            strokeDasharray="4 3"
          />
          <text x={W - padR - 2} y={sy(refLoadKN) + 10} textAnchor="end" className="fill-teal-700 text-[8.5px] font-semibold">
            {refLabel ?? `Ref: ${refLoadKN.toFixed(0)} ${unitLabel}`}
          </text>
        </g>
      )}

      {/* Área + curva */}
      {areaPath && <path d={areaPath} fill="rgba(37,99,235,0.10)" />}
      {linePath && <path d={linePath} fill="none" stroke="#2563eb" strokeWidth={2} strokeLinejoin="round" />}

      {/* Pontos clicáveis (índice k>=1 corresponde ao frame k-1) */}
      {pts.map((p, k) => {
        const isCurrent = activeStepIndex !== undefined && k === activeStepIndex + 1;
        return (
          <circle
            key={k}
            cx={sx(p.x)}
            cy={sy(p.y)}
            r={isCurrent ? 4.2 : 2.4}
            className={`${isCurrent ? "fill-red-600 stroke-white" : "fill-blue-600"} ${k > 0 && onSelectStep ? "cursor-pointer" : ""}`}
            strokeWidth={isCurrent ? 1.5 : 0}
            onClick={() => {
              if (k > 0 && onSelectStep) onSelectStep(k - 1);
            }}
          >
            <title>
              Passo {k}: {p.y.toFixed(1)} {unitLabel} · δ = {p.x.toFixed(2)} mm
            </title>
          </circle>
        );
      })}
    </svg>
  );
};
