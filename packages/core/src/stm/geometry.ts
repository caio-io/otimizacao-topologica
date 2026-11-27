import type { Pt } from "../rebar";
import type { StmGeometry, StmMember, StmNode, StmNodeContour, StmStrutContour } from "./types";

/**
 * Generates CAST-style strut and nodal zone contour polygons.
 * Bottle-shaped struts expand from nodal width `wEnd` to `wMid` using a provisional 1:2 spread (26.6°).
 */
export function buildStmGeometry(nodes: readonly StmNode[], members: readonly StmMember[]): StmGeometry {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const struts: StmStrutContour[] = [];

  for (const m of members) {
    if (m.kind !== "strut") continue;
    const p1 = nodeMap.get(m.n1), p2 = nodeMap.get(m.n2);
    if (!p1 || !p2) continue;
    const dx = p2.x - p1.x, dy = p2.y - p1.y, L = Math.hypot(dx, dy);
    if (L < 1e-6) continue;
    const ux = dx / L, uy = dy / L;
    const nx = -uy, ny = ux;

    const wEnd = Math.max(0.02, Math.min(m.wReqM, m.wAvailM || m.wReqM));
    // Provisional 1:2 bottle spread when available concrete width exceeds nodal width
    const bottle = m.wAvailM > wEnd * 1.18 && L > wEnd * 1.6;
    const maxSpread = 0.25 * L; // 1:2 spread over quarter-span each side
    const wMid = bottle ? Math.min(m.wAvailM, wEnd + maxSpread, wEnd * 2.2) : wEnd;

    const hw1 = 0.5 * wEnd, hwMid = 0.5 * wMid;
    const pt = (s: number, n: number): Pt => [p1.x + ux * s + nx * n, p1.y + uy * s + ny * n];

    const pts: Pt[] = bottle
      ? [
          pt(0, hw1),
          pt(0.28 * L, hwMid),
          pt(0.72 * L, hwMid),
          pt(L, hw1),
          pt(L, -hw1),
          pt(0.72 * L, -hwMid),
          pt(0.28 * L, -hwMid),
          pt(0, -hw1),
        ]
      : [pt(0, hw1), pt(L, hw1), pt(L, -hw1), pt(0, -hw1)];

    struts.push({
      memberId: m.id,
      pts,
      bottle,
      provisional: bottle,
      utilization: m.utilization,
      ok: m.ok,
    });
  }

  const nodeContours: StmNodeContour[] = nodes.map((nd) => {
    const incident = members.filter((m) => m.n1 === nd.id || m.n2 === nd.id);
    const hw = Math.max(0.025, 0.5 * nd.plateWidth);
    const rays: { ang: number; hw: number }[] = [];
    for (const m of incident) {
      const other = nodeMap.get(m.n1 === nd.id ? m.n2 : m.n1);
      if (!other) continue;
      const ang = Math.atan2(other.y - nd.y, other.x - nd.x);
      const mhw = m.kind === "strut" ? Math.max(0.018, 0.5 * Math.min(m.wReqM, m.wAvailM || m.wReqM)) : hw * 0.55;
      rays.push({ ang, hw: Math.min(hw * 1.15, mhw) });
    }
    if (rays.length < 2) {
      const pts: Pt[] = [
        [nd.x - hw, nd.y - hw * 0.6],
        [nd.x + hw, nd.y - hw * 0.6],
        [nd.x + hw, nd.y + hw * 0.6],
        [nd.x - hw, nd.y + hw * 0.6],
      ];
      return { nodeId: nd.id, kind: nd.kind, pts, utilization: nd.utilization, ok: nd.ok };
    }
    rays.sort((a, b) => a.ang - b.ang);
    const pts: Pt[] = [];
    for (const r of rays) {
      const dist = Math.max(hw * 0.7, r.hw * 1.1);
      pts.push([nd.x + Math.cos(r.ang) * dist, nd.y + Math.sin(r.ang) * dist]);
    }
    return { nodeId: nd.id, kind: nd.kind, pts, utilization: nd.utilization, ok: nd.ok };
  });

  return { struts, nodes: nodeContours };
}
