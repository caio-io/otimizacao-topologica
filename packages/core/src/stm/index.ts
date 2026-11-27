import type { DesignCodeId, Ver } from "../codes";
import { codeById, fcdOfCode, strutDesignStrength } from "../codes";
import { clampFck } from "../concrete";
import { STEEL_CLASSES } from "../nonlinear";
import type { BarSpec, Scene } from "../scene";
import { buildVerifiedMembers, buildVerifiedNodes } from "./checks";
import { buildStmGeometry } from "./geometry";
import { buildGroundStructure, createSolidTester } from "./groundStructure";
import { computeStmSts, optimizeGroundStructure } from "./solve";
import type { StmModel, StmOptions, StmSteelClass } from "./types";

export * from "./types";
export { computeStmSts } from "./solve";
export { buildStmGeometry } from "./geometry";

/**
 * Extracts and verifies a discrete Strut-and-Tie Model (STM) in axial equilibrium
 * from a `Scene` (and optional topology density `rho`) via the Ground Structure method.
 */
export function extractStm(scene: Scene, opts: StmOptions = {}): StmModel {
  const codeId: DesignCodeId = opts.codeId ?? scene.nl?.code ?? "NBR6118";
  const code = codeById(codeId);
  const defaultSteel: StmSteelClass = code.steelClasses.includes("CA50") ? "CA50" : "B500B";
  const steelClass: StmSteelClass = opts.steelClass ?? defaultSteel;
  const fckMPa = clampFck(scene.fck ?? 30);
  const fcdMPa = fcdOfCode(code, fckMPa);
  const alphaV2 = 1 - fckMPa / 250;
  // Borges (2022) / NBR 6118:2014 item 22.3.2 (Eqs. 2.4-2.7)
  const fcd1MPa = 0.85 * alphaV2 * fcdMPa;
  const fcd2MPa = 0.60 * alphaV2 * fcdMPa;
  const fcd3MPa = 0.72 * alphaV2 * fcdMPa;
  const strutRes = strutDesignStrength(code, fckMPa);
  const sigmaRdMaxMPa = strutRes.sigma;
  const fykMPa = steelClass === "CA60" ? 600 : 500;
  const fydMPa = (code.phi ?? 1) * (fykMPa / code.gammaS);
  const minAngleLimitDeg = codeId === "ACI318" ? 25.0 : 29.7;
  const nodeLimitsVerified: Ver = codeId === "NBR6118" ? "sec" : strutRes.verified;

  const warnings: string[] = [];
  const isSolid = createSolidTester(scene, opts.rho, opts.rhoThreshold ?? 0.5);
  const { rawNodes, bars } = buildGroundStructure(scene, isSolid, opts);
  const { finalRawNodes, finalRawBars, forces } = optimizeGroundStructure(rawNodes, bars, scene.E, opts.maxIterations ?? 120);

  const nNodes = finalRawNodes.length;
  const sumBarFx = new Float64Array(nNodes);
  const sumBarFy = new Float64Array(nNodes);
  for (let e = 0; e < finalRawBars.length; e++) {
    const b = finalRawBars[e], N = forces[e];
    sumBarFx[b.n1] -= N * b.c; sumBarFy[b.n1] -= N * b.s;
    sumBarFx[b.n2] += N * b.c; sumBarFy[b.n2] += N * b.s;
  }

  let residual = 0;
  for (let i = 0; i < nNodes; i++) {
    const nd = finalRawNodes[i];
    if (!nd.uxFixed) residual = Math.max(residual, Math.abs(nd.fx - sumBarFx[i]));
    if (!nd.uyFixed) residual = Math.max(residual, Math.abs(nd.fy - sumBarFy[i]));
  }

  const members = buildVerifiedMembers(scene, finalRawNodes, finalRawBars, forces, fydMPa, sigmaRdMaxMPa);
  const nodes = buildVerifiedNodes(scene, finalRawNodes, members, sumBarFx, sumBarFy, {
    fcd1MPa, fcd2MPa, fcd3MPa, minAngleLimitDeg,
  }, warnings);
  const geometry = buildStmGeometry(nodes, members);

  const stsLoads = nodes
    .filter((n) => Math.abs(n.fx) > 1e-12 || Math.abs(n.fy) > 1e-12)
    .map((n) => ({ node: n.id, fx: n.fx, fy: n.fy }));
  const sts = computeStmSts(nodes, members, stsLoads, scene.t, scene.E);

  let totalAsReqCm2 = 0, totalSteelVolumeCm3 = 0, maxStrutUtil = 0;
  for (const m of members) {
    if (m.kind === "tie") {
      totalAsReqCm2 += m.AsReqCm2;
      totalSteelVolumeCm3 += m.AsReqCm2 * m.length * 100;
    } else if (m.utilization > maxStrutUtil) {
      maxStrutUtil = m.utilization;
    }
  }
  const maxNodeUtil = nodes.reduce((acc, n) => Math.max(acc, n.utilization), 0);
  const ok = residual < 1e-6 && nodes.every((n) => n.ok) && members.every((m) => m.ok);
  if (residual >= 1e-6) warnings.push(`Resíduo de equilíbrio nodal elevado: ${residual.toExponential(2)} kN.`);

  return {
    nodes, members, geometry, residual, sts, codeId, steelClass,
    fckMPa, fydMPa, fcdMPa, fcd1MPa, fcd2MPa, fcd3MPa, sigmaRdMaxMPa, minAngleLimitDeg, nodeLimitsVerified,
    totalAsReqCm2, totalSteelVolumeCm3, maxNodeUtil, maxStrutUtil, ok, warnings,
  };
}

/** Converts STM ties into embedded `BarSpec[]` reinforcement bars for Level 2 nonlinear analysis. */
export function stmTiesToBarSpecs(model: StmModel, steelClass: StmSteelClass = model.steelClass): BarSpec[] {
  const cls = STEEL_CLASSES[steelClass];
  const nodeMap = new Map(model.nodes.map((n) => [n.id, n]));
  return model.members
    .filter((m) => m.kind === "tie" && m.AsReqCm2 > 0)
    .map((m, idx) => {
      const p1 = nodeMap.get(m.n1)!, p2 = nodeMap.get(m.n2)!;
      return {
        id: `STM_T${idx + 1}`,
        label: `Tirante T${idx + 1} (${m.AsReqCm2.toFixed(2)} cm²)`,
        path: [
          [Math.round(p1.x * 1e4) / 1e4, Math.round(p1.y * 1e4) / 1e4],
          [Math.round(p2.x * 1e4) / 1e4, Math.round(p2.y * 1e4) / 1e4],
        ],
        areaCm2: Math.round(m.AsReqCm2 * 100) / 100,
        steelClass,
        fy: cls.fy, ft: cls.ft, Es: cls.Es, epsU: cls.epsU,
      };
    });
}
