import type { Scene } from "../scene";
import { pointInScene } from "./groundStructure";
import type { RawBar, RawNode, StmMember, StmMemberKind, StmNode, StmNodeKind } from "./types";

/** Estimate available perpendicular width [m] around segment midpoint inside the solid domain. */
export function estimateAvailableWidth(
  s: Scene,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  plate1: number,
  plate2: number,
): number {
  const L = Math.hypot(x2 - x1, y2 - y1);
  if (L < 1e-9) return 0;
  const nx = -(y2 - y1) / L, ny = (x2 - x1) / L;
  const mx = 0.5 * (x1 + x2), my = 0.5 * (y1 + y2);
  const step = Math.max(s.h * 0.5, 0.005);
  const maxReach = Math.max(plate1, plate2, s.bearing, 0.5 * L);

  let dPos = 0;
  while (dPos + step <= maxReach && pointInScene(s, mx + (dPos + step) * nx, my + (dPos + step) * ny)) dPos += step;
  let dNeg = 0;
  while (dNeg + step <= maxReach && pointInScene(s, mx - (dNeg + step) * nx, my - (dNeg + step) * ny)) dNeg += step;

  const geomW = dPos + dNeg;
  const minPlate = Math.min(plate1, plate2);
  return Math.max(geomW > 1e-4 ? Math.min(geomW, Math.max(minPlate, 0.25 * L)) : minPlate, s.h);
}

export function buildVerifiedMembers(
  scene: Scene,
  finalRawNodes: readonly RawNode[],
  finalRawBars: readonly RawBar[],
  forces: Float64Array,
  fydMPa: number,
  sigmaRdMaxMPa: number,
): StmMember[] {
  return finalRawBars.map((b, id) => {
    const N = forces[id];
    const kind: StmMemberKind = N >= 0 ? "tie" : "strut";
    let angleDeg = (Math.atan2(b.s, b.c) * 180) / Math.PI;
    if (angleDeg < 0) angleDeg += 180;
    if (angleDeg >= 180) angleDeg -= 180;

    if (kind === "tie") {
      const AsReqCm2 = N / (fydMPa * 0.1);
      return {
        id, n1: b.n1, n2: b.n2, kind, N, length: b.L, angleDeg, AsReqCm2,
        wReqM: 0, wAvailM: 0, sigmaMPa: 0, sigmaLimitMPa: fydMPa, utilization: 0, ok: true,
      };
    }

    const absN = Math.abs(N);
    const wReqM = absN / (scene.t * sigmaRdMaxMPa * 1000);
    const p1 = finalRawNodes[b.n1], p2 = finalRawNodes[b.n2];
    const wAvailM = estimateAvailableWidth(scene, p1.x, p1.y, p2.x, p2.y, p1.plateWidth, p2.plateWidth);
    const sigmaMPa = absN / (scene.t * wAvailM * 1000);
    const utilization = sigmaMPa / sigmaRdMaxMPa;
    return {
      id, n1: b.n1, n2: b.n2, kind, N, length: b.L, angleDeg, AsReqCm2: 0,
      wReqM, wAvailM, sigmaMPa, sigmaLimitMPa: sigmaRdMaxMPa, utilization, ok: utilization <= 1.0 + 1e-9,
    };
  });
}

export function buildVerifiedNodes(
  scene: Scene,
  finalRawNodes: readonly RawNode[],
  members: readonly StmMember[],
  sumBarFx: Float64Array,
  sumBarFy: Float64Array,
  limits: { fcd1MPa: number; fcd2MPa: number; fcd3MPa: number; minAngleLimitDeg: number },
  warnings: string[],
): StmNode[] {
  return finalRawNodes.map((nd, id) => {
    const rx = nd.uxFixed ? sumBarFx[id] - nd.fx : 0;
    const ry = nd.uyFixed ? sumBarFy[id] - nd.fy : 0;

    const incident = members.filter((m) => m.n1 === id || m.n2 === id);
    const nTies = incident.filter((m) => m.kind === "tie").length;
    const kind: StmNodeKind = nTies === 0 ? "CCC" : nTies === 1 ? "CCT" : "CTT";
    const sigmaLimitMPa = kind === "CCC" ? limits.fcd1MPa : kind === "CCT" ? limits.fcd3MPa : limits.fcd2MPa;

    const extForce = Math.hypot(nd.fx + rx, nd.fy + ry);
    const maxStrut = incident.filter((m) => m.kind === "strut").reduce((acc, m) => Math.max(acc, Math.abs(m.N)), 0);
    const nodalForce = nd.role === "interior" ? maxStrut : Math.max(extForce, maxStrut);
    const sigmaMPa = nodalForce / (scene.t * nd.plateWidth * 1000);
    const utilization = sigmaMPa / sigmaLimitMPa;

    let minAngleDeg: number | null = null;
    const outwardVec = (m: StmMember): [number, number] => {
      const other = m.n1 === id ? finalRawNodes[m.n2] : finalRawNodes[m.n1];
      const dx = other.x - nd.x, dy = other.y - nd.y, len = Math.hypot(dx, dy) || 1;
      return [dx / len, dy / len];
    };
    const struts = incident.filter((m) => m.kind === "strut");
    const ties = incident.filter((m) => m.kind === "tie");
    for (const st of struts) {
      const [sx, sy] = outwardVec(st);
      for (const ti of ties) {
        const [tx, ty] = outwardVec(ti);
        const dot = Math.max(-1, Math.min(1, sx * tx + sy * ty));
        let ang = (Math.acos(dot) * 180) / Math.PI;
        if (ang > 90) ang = 180 - ang;
        if (minAngleDeg === null || ang < minAngleDeg) minAngleDeg = ang;
      }
    }
    const angleOk = minAngleDeg === null || minAngleDeg >= limits.minAngleLimitDeg - 1e-6;
    if (!angleOk && minAngleDeg !== null) {
      warnings.push(`Nó ${id} (${kind}): ângulo mínimo biela-tirante ${minAngleDeg.toFixed(1)}° < ${limits.minAngleLimitDeg.toFixed(1)}°.`);
    }

    const ok = utilization <= 1.0 + 1e-9 && angleOk;
    return {
      id, x: nd.x, y: nd.y, role: nd.role, kind, fx: nd.fx, fy: nd.fy, rx, ry,
      uxFixed: nd.uxFixed, uyFixed: nd.uyFixed, plateWidth: nd.plateWidth,
      sigmaMPa, sigmaLimitMPa, utilization, ok, minAngleDeg, angleOk,
    };
  });
}
