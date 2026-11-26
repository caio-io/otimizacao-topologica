import { barsFromScene, pierCapScene } from "../../src";
import type { Bar, Scene } from "../../src";

/** S1 do livro do CSFM — a definição vive em src/presets.ts (pierCapScene); aqui só os valores de comparação. */
export const S1 = { fc: 31.2e3, expPerSupport: 556, csfm: { M0: 629, M1: 610, M2: 609, M3: 568 } };
export const s1Scene = (h: number, bearing = 0.13): Scene => pierCapScene(h, bearing);
export const s1Bars = (): Bar[] => barsFromScene(pierCapScene());
