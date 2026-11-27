import { describe, expect, it } from "vitest";
import { arcFrom3Points, barAreaCm2, base, clipPolylineToSolid, discretizeBarPath, faceEdges, filletPolyline, generateStirrupGroup, nearestFace, parallelLayerOffset, smartBarPath, smartBarPaths } from "../src";
import type { Scene } from "../src";

const rect = (ccw = true): Scene => {
  const s = base(0.05, 0.1);
  const pts: [number, number][] = [[0, 0], [0.4, 0], [0.4, 1], [0, 1]];
  s.shapes.push({ id: "S1", mode: "add", pts: ccw ? pts : [...pts].reverse() });
  return s;
};
const o = { cover: 0.03, dia: 10, end: 1 as const, legLen: 0.5 };
const close = (p: [number, number], x: number, y: number) => { expect(p[0]).toBeCloseTo(x, 4); expect(p[1]).toBeCloseTo(y, 4); };

describe("armadura inteligente (offset do contorno)", () => {
  it("barra reta numa face fica a cobrimento + Ø/2 da face, e vai de canto a canto", () => {
    const d = 0.03 + 0.005;
    const p = smartBarPath(rect(), { shape: 0, i: 0 }, { ...o, form: "reta" })!; // face de baixo
    expect(p).toHaveLength(2);
    close(p[0], d, d); close(p[1], 0.4 - d, d);
    const q = smartBarPath(rect(), { shape: 0, i: 1 }, { ...o, form: "reta" })!; // face direita
    close(q[0], 0.4 - d, d); close(q[1], 0.4 - d, 1 - d);
  });
  it("não depende do sentido de percurso do polígono (horário ou anti-horário)", () => {
    const a = smartBarPath(rect(true), { shape: 0, i: 0 }, { ...o, form: "reta" })!;
    // no polígono invertido a face de baixo é a aresta 2→3... procura a aresta de baixo
    const E = faceEdges(rect(false))[0];
    const iBottom = E.findIndex((e) => Math.abs(e.a[1]) < 1e-9 && Math.abs(e.b[1]) < 1e-9);
    const b = smartBarPath(rect(false), { shape: 0, i: iBottom }, { ...o, form: "reta" })!;
    const norm = (p: [number, number][]) => p.map((q) => q.map((v) => v.toFixed(4)).join(",")).sort().join("|");
    expect(norm(b)).toBe(norm(a));
  });
  it("forma L: segue a face e dobra no canto, com perna limitada ao comprimento disponível", () => {
    const d = 0.035;
    const p = smartBarPath(rect(), { shape: 0, i: 0 }, { ...o, form: "L", end: 1 })!;
    expect(p).toHaveLength(3);
    close(p[0], d, d); close(p[1], 0.4 - d, d); close(p[2], 0.4 - d, d + 0.5);
    const curto = smartBarPath(rect(), { shape: 0, i: 0 }, { ...o, form: "L", end: 1, legLen: 5 })!;
    close(curto[2], 0.4 - d, 1 - d); // limitada à face (altura útil)
    const iniAbaixo = smartBarPath(rect(), { shape: 0, i: 0 }, { ...o, form: "L", end: 0 })!;
    close(iniAbaixo[0], d, d + 0.5); close(iniAbaixo[1], d, d);
  });
  it("forma U tem as duas pernas", () => {
    const p = smartBarPath(rect(), { shape: 0, i: 0 }, { ...o, form: "U" })!;
    expect(p).toHaveLength(4);
    close(p[0], 0.035, 0.535); close(p[3], 0.365, 0.535);
  });
  it("em abertura (cut) a barra fica FORA do vazio, a cobrimento + Ø/2 da borda", () => {
    const s = rect();
    s.shapes.push({ id: "A1", mode: "cut", pts: [[0.1, 0.4], [0.3, 0.4], [0.3, 0.6], [0.1, 0.6]] });
    const d = 0.035;
    const p = smartBarPath(s, { shape: 1, i: 0 }, { ...o, form: "reta" })!; // borda de baixo da abertura
    close(p[0], 0.1 - d, 0.4 - d); close(p[1], 0.3 + d, 0.4 - d);
  });
  it("nearestFace encontra a face sob o cursor e a posição ao longo dela", () => {
    const f = nearestFace(rect(), 0.3, 0.01, 0.05)!;
    expect(f.i).toBe(0); expect(f.t).toBeCloseTo(0.75, 2);
    expect(nearestFace(rect(), 0.2, 0.5, 0.05)).toBeNull();
  });
  it("área total: n barras × π·Ø²/4", () => {
    expect(barAreaCm2(9, 10)).toBeCloseTo(7.0686, 3);
    expect(barAreaCm2(4, 20)).toBeCloseTo(12.566, 3);
  });
  it("vértices colineares (p. ex. marcas de apoio) não partem a face: a barra vai de canto a canto", () => {
    const sc = base(0.05, 0.1);
    sc.shapes.push({ id: "S1", mode: "add", pts: [[0, 0], [0.1, 0], [0.3, 0], [0.4, 0], [0.4, 1], [0, 1]] });
    const E = faceEdges(sc)[0];
    expect(E).toHaveLength(4);
    const f = nearestFace(sc, 0.2, 0.01, 0.05)!;
    const p = smartBarPath(sc, { shape: 0, i: f.i }, { form: "reta", cover: 0.03, dia: 10, end: 0, legLen: 0.5 })!;
    close(p[0], 0.035, 0.035); close(p[1], 0.365, 0.035);
    expect(f.a[0]).toBeCloseTo(0, 6); expect(f.b[0]).toBeCloseTo(0.4, 6);
  });

  it("clipPolylineToSolid e generateStirrupGroup interrompem barras ao atravessar aberturas (cut)", () => {
    const sc = base(0.05, 0.25);
    sc.shapes.push({ id: "S1", mode: "add", pts: [[0, 0], [2, 0], [2, 1], [0, 1]] });
    sc.shapes.push({ id: "A1", mode: "cut", pts: [[0.7, 0.3], [1.3, 0.3], [1.3, 0.7], [0.7, 0.7]] });

    const clipped = clipPolylineToSolid(sc, [[0.05, 0.5], [1.95, 0.5]]);
    expect(clipped).toHaveLength(2);
    close(clipped[0][0], 0.05, 0.5); close(clipped[0][1], 0.7, 0.5);
    close(clipped[1][0], 1.3, 0.5); close(clipped[1][1], 1.95, 0.5);

    const grp = generateStirrupGroup({
      id: "ST1",
      x0: 0, y0: 0, x1: 2, y1: 1,
      orientation: "vertical",
      cover: 0.05,
      spacing: 0.3,
      legs: 2,
      diaMm: 8,
      steelClass: "CA50",
      scene: sc,
    })!;
    expect(grp).not.toBeNull();
    const allSegs = [grp.path, ...(grp.extra ?? [])];
    // Estribo em x≈1.0 corta a abertura em y=[0.3, 0.7], gerando 2 trechos
    const midSegs = allSegs.filter((seg) => Math.abs(seg[0][0] - 1.0) < 0.15);
    expect(midSegs.length).toBeGreaterThanOrEqual(2);
    for (const seg of allSegs) {
      const ym = 0.5 * (seg[0][1] + seg[1][1]);
      const xm = 0.5 * (seg[0][0] + seg[1][0]);
      const insideHole = xm > 0.701 && xm < 1.299 && ym > 0.301 && ym < 0.699;
      expect(insideHole).toBe(false);
    }

    const smartClip = smartBarPaths(sc, { shape: 0, i: 0 }, { form: "reta", cover: 0.03, dia: 10, end: 0, legLen: 0.4 });
    expect(smartClip).toHaveLength(1);
  });

  it("parallelLayerOffset detecta barra paralela existente e propõe 2ª camada acima ou abaixo", () => {
    const sc = rect();
    const p1 = smartBarPath(sc, { shape: 0, i: 0 }, { ...o, form: "reta" })!;
    sc.bars = [{ id: "B1", label: "Camada 1", path: p1, areaCm2: 1.57, fy: 435, ft: 470, Es: 210, epsU: 0.01 }];
    const up = parallelLayerOffset(sc, { shape: 0, i: 0 }, { ...o, form: "reta" }, 1);
    expect(up.layerIndex).toBe(1);
    expect(up.provisional).toBe(true);
    expect(up.effectiveCover).toBeCloseTo(0.03 + 0.02 + 0.01, 4); // cover + max(Ø, 20mm) + Ø
    const down = parallelLayerOffset(sc, { shape: 0, i: 0 }, { ...o, form: "reta" }, -1);
    expect(down.effectiveCover).toBeCloseTo(0.01, 4); // limitado ao mínimo 10 mm
  });

  it("arcFrom3Points e filletPolyline discretizam barras curvas respeitando flecha máxima", () => {
    const arc = arcFrom3Points([0, 0], [0.5, 0.25], [1, 0], 0.005);
    expect(arc.length).toBeGreaterThanOrEqual(5);
    close(arc[0], 0, 0);
    close(arc[arc.length - 1], 1, 0);
    const mid = arc[Math.floor(arc.length / 2)];
    expect(mid[1]).toBeGreaterThan(0.2);

    const fil = filletPolyline([[0, 0], [1, 0], [1, 1]], 0.2, 0.01);
    expect(fil.length).toBeGreaterThan(4);

    const dPath = discretizeBarPath({ path: [[0, 0], [1, 0]], curve: { type: "arc", p1: [0, 0], p2: [0.5, 0.2], p3: [1, 0] } }, 0.08);
    expect(dPath.length).toBeGreaterThanOrEqual(5);
  });
});
