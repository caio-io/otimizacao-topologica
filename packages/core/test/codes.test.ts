import { describe, expect, it } from "vitest";
import { DESIGN_CODES, codeById, concreteFromScene, fcdOfCode, nbrConcrete, pierCapScene } from "../src";

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
});
