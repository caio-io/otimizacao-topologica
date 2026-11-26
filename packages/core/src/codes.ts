/**
 * Perfis normativos (a norma é um DADO, não código espalhado): cada perfil reúne os parâmetros de materiais, de bielas e de aço
 * que o programa usa. Trocar de norma = trocar de perfil; qualquer valor pode ser sobrescrito pelo usuário.
 *
 * VERIFICAÇÃO (por campo, em `fields`; o que for `false` é PROVISÓRIO e a interface deve sinalizar):
 *  - NBR 6118: γc = 1,4, αcc = 0,85 (Borges, 2022), γs = 1,15, εc2 = 2 ‰, εcu = 3,5 ‰ (fck ≤ 50 MPa), εud = 10 ‰, resistência de
 *    biela pela fórmula de Borges (1 − fck/250). Fatores fcd1/2/3 de nós da NBR NÃO estão aqui (conferir a ordem na norma).
 *  - EC2 e MC2010: εc2 = 2 ‰ e εcu2 = 3,5 ‰ (livro do CSFM, Tab. 6.15 e p. 104) e fatores de redução de bielas da Tab. 2.1 do livro
 *    (p. 12). γc, αcc, γs e εud são provisórios. Aço B500B: ft/fy = 1,08 e εu = 5 % (livro do CSFM, p. 22); γs e Es provisórios.
 *  - ACI 318: só εcu = 3,0 ‰ e φ = 0,75 para STM foram verificados; o resto é pendente.
 */
import { sigmaRdMax } from "./concrete";

export type DesignCodeId = "NBR6118" | "EC2" | "MC2010" | "ACI318";
export type SteelClassId = "CA50" | "CA60" | "B500B";

export interface DesignCode {
  id: DesignCodeId;
  name: string;
  /** nome curto para menus e cabeçalhos */
  short: string;
  /** fcd = alphaCc · fck / gammaC */
  gammaC: number;
  alphaCc: number;
  /** deformação ao início do patamar e deformação última de verificação do concreto (frações) */
  epsC0: number;
  epsCu: number;
  /** fragilidade de concretos de alta resistência (só MC2010/SIA a usam como ηfc) */
  etaFc: (fckMPa: number) => number;
  gammaS: number;
  /** deformação última de projeto do aço (fração); null = não conferida */
  epsUd: number | null;
  /** fatores que multiplicam fcd nas bielas (Tab. 2.1 do livro do CSFM), ou null se não conferidos */
  strut: { uniaxial: (fck: number) => number; tensionNormal: (fck: number) => number; tensionOblique: (fck: number) => number } | null;
  /** coeficiente de resistência do ACI para bielas e tirantes (STM), se aplicável */
  phi?: number;
  /** classes de aço passivo desta norma (as definidas em `STEEL_CLASSES`) */
  steelClasses: SteelClassId[];
  /** quais campos foram conferidos em fonte (false = provisório) */
  fields: { gammaC: boolean; alphaCc: boolean; epsC0: boolean; epsCu: boolean; gammaS: boolean; epsUd: boolean; strut: boolean; steel: boolean };
  status: { verificado: string[]; pendente: string[] };
}

const eta = (fck: number) => Math.min(1, Math.cbrt(30 / fck));

export const DESIGN_CODES: Record<DesignCodeId, DesignCode> = {
  NBR6118: {
    id: "NBR6118", name: "ABNT NBR 6118", short: "NBR 6118",
    gammaC: 1.4, alphaCc: 0.85, epsC0: 0.002, epsCu: 0.0035, etaFc: () => 1, gammaS: 1.15, epsUd: 0.01, strut: null,
    steelClasses: ["CA50", "CA60"],
    fields: { gammaC: true, alphaCc: true, epsC0: true, epsCu: true, gammaS: true, epsUd: true, strut: true, steel: false },
    status: {
      verificado: ["γc = 1,4 e αcc = 0,85 (Borges, 2022)", "εc2 = 2 ‰ e εcu = 3,5 ‰ (fck ≤ 50 MPa)", "γs = 1,15", "εud = 10 ‰", "resistência de biela σRd,máx = (1 − fck/250)·fcd (Borges, 2022)"],
      pendente: ["fatores fcd1/fcd2/fcd3 de bielas e nós (conferir a ordem na norma)", "limites para fck > 50 MPa", "ft/fy e εu das classes CA-50 e CA-60 (NBR 7480)"],
    },
  },
  EC2: {
    id: "EC2", name: "Eurocode 2 (EN 1992-1-1)", short: "Eurocode 2",
    gammaC: 1.5, alphaCc: 1.0, epsC0: 0.002, epsCu: 0.0035, etaFc: () => 1, gammaS: 1.15, epsUd: null,
    strut: { uniaxial: () => 1.0, tensionNormal: (fck) => 0.6 * (1 - fck / 250), tensionOblique: (fck) => 0.6 * (1 - fck / 250) },
    steelClasses: ["B500B"],
    fields: { gammaC: false, alphaCc: false, epsC0: true, epsCu: true, gammaS: false, epsUd: false, strut: true, steel: true },
    status: {
      verificado: ["εc2 = 2 ‰ e εcu2 = 3,5 ‰ (livro do CSFM, p. 104 e Tab. 6.15)", "fatores de redução de bielas (livro do CSFM, Tab. 2.1, p. 12): 1,00 e 0,60·ν′ com ν′ = 1 − fck/250", "aço B500B: ft/fy = 1,08 e εu = 5 % (livro do CSFM, p. 22)"],
      pendente: ["γc, αcc, γs e εud (valores provisórios)", "módulo Es do B500B (200 GPa, provisório)", "εc2 e εcu2 para fck > 50 MPa"],
    },
  },
  MC2010: {
    id: "MC2010", name: "fib Model Code 2010", short: "fib MC2010",
    gammaC: 1.5, alphaCc: 1.0, epsC0: 0.002, epsCu: 0.0035, etaFc: eta, gammaS: 1.15, epsUd: null,
    strut: { uniaxial: (fck) => eta(fck), tensionNormal: (fck) => 0.75 * eta(fck), tensionOblique: (fck) => 0.55 * eta(fck) },
    steelClasses: ["B500B"],
    fields: { gammaC: false, alphaCc: false, epsC0: true, epsCu: true, gammaS: false, epsUd: false, strut: true, steel: true },
    status: {
      verificado: ["εc2 = 2 ‰ e εcu2 = 3,5 ‰ (livro do CSFM, p. 104 e Tab. 6.15)", "fatores 1,00·ηfc / 0,75·ηfc / 0,55·ηfc e ηfc = min[1, (30/fck)^(1/3)] (livro do CSFM, Tab. 2.1, p. 12)", "aço B500B: ft/fy = 1,08 e εu = 5 % (livro do CSFM, p. 22)"],
      pendente: ["γc, αcc, γs (valores provisórios)", "εud por classe de ductilidade", "relações constitutivas de projeto para fck > 50 MPa"],
    },
  },
  ACI318: {
    id: "ACI318", name: "ACI 318 (bielas e tirantes)", short: "ACI 318",
    gammaC: 1.0, alphaCc: 0.85, epsC0: 0.002, epsCu: 0.003, etaFc: () => 1, gammaS: 1.0, epsUd: null, strut: null, phi: 0.75,
    steelClasses: [],
    fields: { gammaC: false, alphaCc: false, epsC0: false, epsCu: true, gammaS: false, epsUd: false, strut: false, steel: false },
    status: {
      verificado: ["εcu = 3,0 ‰", "φ = 0,75 para bielas e tirantes"],
      pendente: ["fatores βs e βn de bielas e nós (Cap. 23)", "resistências a partir de f′c", "classes de aço (Grade 60) e εud/ductilidade"],
    },
  },
};

export const CODE_ORDER: DesignCodeId[] = ["NBR6118", "EC2", "MC2010", "ACI318"];

export const codeById = (id: DesignCodeId | string | undefined): DesignCode => DESIGN_CODES[(id as DesignCodeId) in DESIGN_CODES ? (id as DesignCodeId) : "NBR6118"];

/** resistência de projeto do concreto [MPa] pela norma */
export const fcdOfCode = (code: DesignCode, fckMPa: number) => (code.alphaCc * fckMPa) / code.gammaC;

/**
 * Resistência de projeto de uma biela comum (compressão uniaxial) [MPa] pela norma.
 * NBR: fórmula de Borges (2022). EC2 e MC2010: fator da Tab. 2.1 do livro × fcd. ACI: ainda sem fator conferido, usa a fórmula da NBR
 * e avisa (`fallback`).
 */
export function strutDesignStrength(code: DesignCode, fckMPa: number): { sigma: number; formula: string; verified: boolean; fallback: boolean } {
  if (code.id === "NBR6118") return { sigma: sigmaRdMax(fckMPa), formula: "(1 − fck/250)·0,85·fck/γc (Borges, 2022)", verified: true, fallback: false };
  if (code.strut) {
    const k = code.strut.uniaxial(fckMPa);
    return { sigma: k * fcdOfCode(code, fckMPa), formula: `${k.toFixed(2).replace(".", ",")} · fcd (Tab. 2.1 do livro do CSFM)`, verified: code.fields.gammaC && code.fields.alphaCc, fallback: false };
  }
  return { sigma: sigmaRdMax(fckMPa), formula: "fórmula da NBR (fatores do ACI ainda não conferidos)", verified: false, fallback: true };
}
