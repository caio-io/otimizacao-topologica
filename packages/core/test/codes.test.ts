import { describe, expect, it } from "vitest";
import { DESIGN_CODES, STEEL_CLASSES, codeById, concreteFromScene, fcdOfCode, nbrConcrete, pierCapScene, sigmaRdMax, strutDesignStrength } from "../src";

describe("perfis normativos (a norma é um dado)", () => {
  it("o padrão NBR 6118 reproduz o concreto de projeto usado até aqui", () => {
    const sc = pierCapScene(0.1, 0.12);
    sc.fck = 30; sc.nl = { values: "design", epsCu: 0.0035, crushLength: 0 };
    const c = concreteFromScene(sc), ref = nbrConcrete(30);
    expect(c.fc).toBeCloseTo(ref.fc, 6);
    expect(c.eps0).toBe(ref.eps0);
  });
  it("trocar a norma muda fcd (EC2: fck/1,5; ACI: 0,85·f'c)", () => {
    expect(fcdOfCode(DESIGN_CODES.NBR6118, 30)).toBeCloseTo(0.85 * 30 / 1.4, 9);
    expect(fcdOfCode(DESIGN_CODES.EC2, 30)).toBeCloseTo(20, 9);
    expect(fcdOfCode(DESIGN_CODES.ACI318, 30)).toBeCloseTo(25.5, 9);
    expect(DESIGN_CODES.ACI318.epsCu).toBe(0.003);
    const sc = pierCapScene(0.1, 0.12);
    sc.fck = 30; sc.nl = { values: "design", epsCu: 0.0035, crushLength: 0, code: "EC2" };
    expect(concreteFromScene(sc).fc).toBeCloseTo(20000, 6);
  });
  it("fatores de redução de bielas conferem com a Tab. 2.1 do livro do CSFM (fck = 30 e 50 MPa)", () => {
    const ec2 = DESIGN_CODES.EC2.strut!, mc = DESIGN_CODES.MC2010.strut!;
    expect(ec2.tensionNormal(30)).toBeCloseTo(0.53, 2); expect(ec2.tensionNormal(50)).toBeCloseTo(0.48, 2);
    expect(mc.uniaxial(30)).toBeCloseTo(1.0, 2); expect(mc.uniaxial(50)).toBeCloseTo(0.84, 2);
    expect(mc.tensionNormal(30)).toBeCloseTo(0.75, 2); expect(mc.tensionNormal(50)).toBeCloseTo(0.63, 2);
    expect(mc.tensionOblique(30)).toBeCloseTo(0.55, 2); expect(mc.tensionOblique(50)).toBeCloseTo(0.46, 2);
  });
  it("norma desconhecida cai na NBR 6118 e todo perfil declara o que ainda está pendente", () => {
    expect(codeById("xyz").id).toBe("NBR6118");
    for (const c of Object.values(DESIGN_CODES)) expect(c.status.pendente.length).toBeGreaterThan(0);
  });
  it("resistência de biela por norma: NBR pela fórmula de Borges; EC2 e MC2010 pelo fator do livro × fcd; ACI cai na NBR com aviso", () => {
    expect(strutDesignStrength(DESIGN_CODES.NBR6118, 30).sigma).toBeCloseTo(sigmaRdMax(30), 9);
    expect(strutDesignStrength(DESIGN_CODES.EC2, 30).sigma).toBeCloseTo(20, 9); // 1,00·30/1,5
    expect(strutDesignStrength(DESIGN_CODES.MC2010, 50).sigma).toBeCloseTo(Math.cbrt(30 / 50) * 50 / 1.5, 9);
    const aci = strutDesignStrength(DESIGN_CODES.ACI318, 30);
    expect(aci.fallback).toBe(true); expect(aci.verified).toBe(false);
    expect(strutDesignStrength(DESIGN_CODES.EC2, 30).verified).toBe(false); // γc e αcc ainda provisórios
  });
  it("classes de aço por norma: B500B tem ft/fy = 1,08 e εu = 5 % (livro do CSFM, p. 22)", () => {
    expect(DESIGN_CODES.NBR6118.steelClasses).toEqual(["CA50", "CA60"]);
    expect(DESIGN_CODES.EC2.steelClasses).toEqual(["B500B"]);
    expect(DESIGN_CODES.ACI318.steelClasses).toEqual([]);
    const b = STEEL_CLASSES.B500B;
    expect(b.ft / b.fy).toBeCloseTo(1.08, 9); expect(b.epsU).toBe(0.05);
  });
});
