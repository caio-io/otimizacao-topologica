/**
 * Perfis normativos (a norma é um DADO, não código espalhado): cada perfil reúne os parâmetros de materiais, de bielas e de aço
 * que o programa usa. Trocar de norma = trocar de perfil; qualquer valor pode ser sobrescrito pelo usuário.
 *
 * VERIFICAÇÃO por campo (`fields`): true = conferido em FONTE PRIMÁRIA que temos aqui; "sec" = só em fonte secundária (a norma
 * em si não está disponível para nós); false = PROVISÓRIO. A interface sinaliza os três casos.
 *  - fib Model Code 2010 (fontes primárias: Boletim 65, versão final do vol. 1, e Boletim 56, primeira versão completa do vol. 2):
 *    γc = 1,5 e γs = 1,15 (Bol. 65, Tab. 4.5-8, p. 99; Bol. 56, Eq. 7.2-11, p. 19, e Eq. 7.2-25, p. 25); fcd = αcc·fck/γc com
 *    "limite inferior de αcc = 0,85" (Bol. 56, p. 19; a faixa 0,9–1,0 é citada para o efeito combinado); parábola-retângulo com
 *    εc2 = 2,0 ‰ e εcu2 = 3,5 ‰ para fck ≤ 50 MPa (Bol. 56, Tab. 7.2-1, p. 17, e Eq. 7.2-13/14); aço: Es = 200 GPa (Bol. 65, p. 186),
 *    classes de ductilidade A/B/C/D (Bol. 65, p. 183: ft/fy ≥ 1,05/1,08/1,15/1,25 e εuk ≥ 2,5/5/7,5/8 %) e εud = 0,9·εuk
 *    (Bol. 56, p. 25); fatores de bielas da Tab. 2.1 do livro do CSFM (p. 12).
 *  - EC2: εc2/εcu2 e fatores de bielas (livro do CSFM, p. 17/104 e Tab. 2.1); γc = 1,5, γs = 1,15 e αcc = 1,0 (valor recomendado,
 *    faixa 0,8–1,0 nos anexos nacionais) só em fonte secundária; εud não conferido. Aço B500B: ft/fy = 1,08 e εu = 5 % (livro, p. 22).
 *  - NBR 6118: γc = 1,4, αcc = 0,85 (Borges, 2022), γs = 1,15, εc2 = 2 ‰, εcu = 3,5 ‰ (fck ≤ 50 MPa), εud = 10 ‰, resistência de biela
 *    pela fórmula de Borges (1 − fck/250). Fatores fcd1/2/3 de nós da NBR NÃO estão aqui (conferir a ordem na norma).
 *  - ACI 318: só εcu = 3,0 ‰ e φ = 0,75 para STM; ângulo mínimo de 25° entre bielas e tirantes (ACI 318-14, citado no livro, p. 14).
 */
import { sigmaRdMax } from "./concrete";

export type DesignCodeId = "NBR6118" | "EC2" | "MC2010" | "ACI318";
export type Ver = boolean | "sec";
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
  /** verificação por campo: true = fonte primária, "sec" = só fonte secundária, false = provisório */
  fields: { gammaC: Ver; alphaCc: Ver; epsC0: Ver; epsCu: Ver; gammaS: Ver; epsUd: Ver; strut: Ver; steel: Ver };
  status: { verificado: string[]; pendente: string[] };
}

const eta = (fck: number) => Math.min(1, Math.cbrt(30 / fck));

export const DESIGN_CODES: Record<DesignCodeId, DesignCode> = {
  NBR6118: {
    id: "NBR6118", name: "ABNT NBR 6118", short: "NBR 6118",
    gammaC: 1.4, alphaCc: 0.85, epsC0: 0.002, epsCu: 0.0035, etaFc: () => 1, gammaS: 1.15, epsUd: 0.01, strut: null,
    steelClasses: ["CA50", "CA60"],
    fields: { gammaC: "sec", alphaCc: false, epsC0: false, epsCu: false, gammaS: "sec", epsUd: false, strut: "sec", steel: false },
    status: {
      verificado: [
        "fonte SECUNDÁRIA (Borges, 2022 — NBR 6118:2014, §2.4 e §7.1.5; texto integral da NBR 6118:2023 não está disponível localmente): γc = 1,4, γs = 1,15 e resistência de biela σRd,máx = (1 − fck/250)·0,85·fck/γc (Eqs. 7.27–7.28)",
      ],
      pendente: [
        "conferência direta no texto integral da ABNT NBR 6118:2023: αcc = 0,85, εc2 = 2 ‰, εcu = 3,5 ‰ (fck ≤ 50 MPa) e εud = 10 ‰ (não constam em Borges, 2022)",
        "fatores fcd1 = 0,85·αv2·fcd (CCC), fcd2 = 0,60·αv2·fcd (CTT/TTT), fcd3 = 0,72·αv2·fcd (CCT) e γn (item 22.3.2 da NBR 6118:2014 em Borges, 2022; confirmar na NBR 6118:2023 e implementar)",
        "limites para fck > 50 MPa",
        "ft/fy e εu das classes CA-50 e CA-60 (ABNT NBR 7480): os valores usados coincidem com os mínimos das classes B e A do MC2010 (Bol. 65, p. 183), mas a NBR 7480 não foi conferida",
      ],
    },
  },
  EC2: {
    id: "EC2", name: "Eurocode 2 (EN 1992-1-1)", short: "Eurocode 2",
    gammaC: 1.5, alphaCc: 1.0, epsC0: 0.002, epsCu: 0.0035, etaFc: () => 1, gammaS: 1.15, epsUd: null,
    strut: { uniaxial: () => 1.0, tensionNormal: (fck) => 0.6 * (1 - fck / 250), tensionOblique: (fck) => 0.6 * (1 - fck / 250) },
    steelClasses: ["B500B"],
    fields: { gammaC: "sec", alphaCc: "sec", epsC0: true, epsCu: true, gammaS: "sec", epsUd: false, strut: true, steel: true },
    status: {
      verificado: ["εc2 = 2 ‰ e εcu2 = 3,5 ‰ (livro do CSFM, p. 104 e Tab. 6.15)", "fatores de redução de bielas (livro do CSFM, Tab. 2.1, p. 12): 1,00 e 0,60·ν′ com ν′ = 1 − fck/250", "aço B500B: ft/fy = 1,08 e εu = 5 % (livro do CSFM, p. 22); Es = 200 GPa (MC2010, Bol. 65, p. 186)", "fonte SECUNDÁRIA (a norma não está disponível): γc = 1,5, γs = 1,15 e αcc = 1,0 recomendado, com faixa 0,8–1,0 nos anexos nacionais"],
      pendente: ["γc, γs e αcc na própria EN 1992-1-1 e no anexo nacional a usar", "εud (a regra do MC2010 é 0,9·εuk; no EC2 não conferido)", "εc2 e εcu2 para fck > 50 MPa"],
    },
  },
  MC2010: {
    id: "MC2010", name: "fib Model Code 2010", short: "fib MC2010",
    gammaC: 1.5, alphaCc: 0.85, epsC0: 0.002, epsCu: 0.0035, etaFc: eta, gammaS: 1.15, epsUd: 0.045,
    strut: { uniaxial: (fck) => eta(fck), tensionNormal: (fck) => 0.75 * eta(fck), tensionOblique: (fck) => 0.55 * eta(fck) },
    steelClasses: ["B500B"],
    fields: { gammaC: true, alphaCc: true, epsC0: true, epsCu: true, gammaS: true, epsUd: true, strut: true, steel: true },
    status: {
      verificado: [
        "γc = 1,5 e γs = 1,15 em situação persistente/transitória (Boletim 65, Tab. 4.5-8, p. 99; Boletim 56, Eq. 7.2-11, p. 19, e Eq. 7.2-25, p. 25)",
        "fcd = αcc·fck/γc, com limite inferior αcc = 0,85 (Boletim 56, p. 19); o programa usa 0,85 (lado seguro; a faixa 0,9–1,0 é citada para o efeito combinado)",
        "parábola-retângulo com εc2 = 2,0 ‰ e εcu2 = 3,5 ‰ para fck ≤ 50 MPa (Boletim 56, Tab. 7.2-1, p. 17, e Eq. 7.2-13/14)",
        "fatores 1,00·ηfc / 0,75·ηfc / 0,55·ηfc e ηfc = min[1, (30/fck)^(1/3)] (livro do CSFM, Tab. 2.1, p. 12)",
        "aço: Es = 200 GPa (Boletim 65, p. 186); classes de ductilidade A/B/C/D: ft/fy ≥ 1,05/1,08/1,15/1,25 e εuk ≥ 2,5/5/7,5/8 % (p. 183); εud = 0,9·εuk (Boletim 56, p. 25), ou seja, 4,5 % para o B500B",
      ],
      pendente: ["εc2/εcu2 para fck > 50 MPa (fórmulas existem na Tab. 7.2-1, ainda não implementadas)", "fatores de bielas do MC2010 final (versão com kε(ε1)); aqui só os da Tab. 2.1 do livro"],
    },
  },
  ACI318: {
    id: "ACI318", name: "ACI 318 (bielas e tirantes)", short: "ACI 318",
    gammaC: 1.0, alphaCc: 0.85, epsC0: 0.002, epsCu: 0.003, etaFc: () => 1, gammaS: 1.0, epsUd: null, strut: null, phi: 0.75,
    steelClasses: [],
    fields: { gammaC: false, alphaCc: false, epsC0: false, epsCu: "sec", gammaS: false, epsUd: false, strut: false, steel: false },
    status: {
      verificado: ["fonte SECUNDÁRIA (texto integral do ACI 318-14/19 não disponível localmente): εcu = 3,0 ‰, φ = 0,75 para bielas e tirantes (Borges, 2022 §2.6 / apresentação ACI 318-19) e ângulo mínimo de 25° entre bielas e tirantes (livro do CSFM, p. 14)"],
      pendente: ["conferência direta no texto integral do ACI 318-19 (Cap. 23)", "fatores βs e βn de bielas e nós (Cap. 23; fontes secundárias citam βs = 1,0/0,75 e βn = 0,80 CCT/0,60 CTT, ainda sem conferir)", "resistências a partir de f′c (fce = 0,85·βs·f′c) e aplicação de φ = 0,75", "classes de aço (Grade 60) e εud/ductilidade"],
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
export function strutDesignStrength(code: DesignCode, fckMPa: number): { sigma: number; formula: string; verified: Ver; fallback: boolean } {
  if (code.id === "NBR6118") return { sigma: sigmaRdMax(fckMPa), formula: "(1 − fck/250)·0,85·fck/γc (Borges, 2022)", verified: "sec", fallback: false };
  if (code.strut) {
    const k = code.strut.uniaxial(fckMPa);
    return { sigma: k * fcdOfCode(code, fckMPa), formula: `${k.toFixed(2).replace(".", ",")} · fcd (Tab. 2.1 do livro do CSFM)`, verified: combine(code.fields.gammaC, code.fields.alphaCc), fallback: false };
  }
  return { sigma: sigmaRdMax(fckMPa), formula: "fórmula da NBR (fatores do ACI ainda não conferidos)", verified: false, fallback: true };
}

/** combina verificações: qualquer provisório → false; senão qualquer secundário → "sec"; senão true */
export function combine(...v: Ver[]): Ver {
  if (v.some((x) => x === false)) return false;
  if (v.some((x) => x === "sec")) return "sec";
  return true;
}
