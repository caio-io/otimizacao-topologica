import { describe, expect, it } from "vitest";
import { barAreaCm2, base, faceEdges, nearestFace, smartBarPath } from "../src";
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
});
