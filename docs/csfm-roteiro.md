# Branch `csfm` — roteiro e decisões

Fonte principal: Kaufmann et al., *Compatible Stress Field Design of Structural Concrete: Principles and Validation* (ETH/IDEA, 2020). Páginas citadas = numeração do livro. Lido até agora: cap. 2.5, 3.1–3.4.3 e partes do cap. 5 (exemplos EC2 e ACI). **Não lido:** 3.5–3.6 (verificações e implementação), cap. 4 e 6.

## Decisões
- **Norma:** perfil EC2/NBR 6118 primeiro (γc, γs, ν' = 1 − fck/250). ACI fica como perfil futuro (φ em vez de γ; combinações 1,2 DL + 1,6 LL; sem fórmula de abertura de fissura no ACI 318-14, livro p. 90). O ACI existe em unidades SI (318M); a unidade não é o obstáculo, a filosofia de segurança é. O núcleo já é m/kN.
- **Branch, não cópia:** código novo em pacote próprio; `@stm/core` só recebe melhorias gerais (como o QM6). `main`/`dev`/`experimental` ficam como estão.
- **Otimização topológica como guia visual:** o CSFM da IDEA roda a TO para 20/40/60/80% de volume e o usuário escolhe (p. 24–25). Não exige convergir um único volume.

## Fórmulas confirmadas no livro
- `fcd = kc2·ηfc·fck/γc`, `ηfc = (30/fck)^(1/3) ≤ 1` (eq. 3.1, p. 17); `kc2` depende de ε1 e generaliza a proposta da fib MC2010 para cisalhamento (que tem teto 0,65) sem esse teto — **fórmula exata ainda não vista**.
- Concreto: parábola-retângulo do EC2; sem tração; sem critério de ruptura por deformação no uso normal (patamar quase infinitamente plástico). Nas validações: εcu2 = 3,5‰ sobre comprimento de esmagamento = espessura.
- Tension stiffening (TCM), estabilizada: `sr0 = Ø·fct·(1−ρeff)/(2·τb0·ρeff)`, τb0 = 2·fctm, τb1 = fctm, λ = 0,67 (médio) e 1,0 (abertura de fissura); εm em eq. 3.3.
- Não estabilizada (ρ < ρcr = fct/(fy − (n−1)·fct) ≈ 0,6%): modelo de arrancamento, eq. 3.6.
- Armadura: otimização de área por programação linear (min Σ l·A, σs ≤ ft), p. 26–27.

## Casos de validação (números do livro)
| Caso | Analítico | CSFM do livro |
|---|---|---|
| Viga T (EC2), M_Rd | 218,2 kN·m (seção cheia, bloco retangular) | 233,0 kN·m |
| Viga retangular (ACI), M_Rd | 215,4 kip·ft | 228,8 kip·ft (+6%) |
| Flecha ACI curto prazo (comb. C2) | 0,987 in | 0,920 in (−7%) |

## Ordem de trabalho
1. [feito] Elemento QM6 no núcleo (flecha/Timoshenko em viga esbelta com 2 elementos na altura: Q4 0,889 → QM6 0,996).
2. Calibrar contra Xia, Langelaar & Hendriks (2020): viga-parede com abertura, consolo, dente Gerber.
3. Nível 2: concreto sem tração + barras 1D (aderência perfeita, rotulada como teste de equilíbrio) + solver secante.
4. Ler 3.5–3.6 do livro e implementar compression softening (kc2) e TCM.
5. Substituir a extração de bielas e tirantes pela *ground structure* (Brito, 2026), se confirmado.

## Seções 3.5–3.6 do livro (lidas depois)
- **Abertura de fissura (p. 31–33):** cinemática de abertura pura, sem escorregamento; direção da fissura = direção principal das tensões/deformações (θr = θσ = θε). Projetada na barra: `w = wb / cos(θr + θb − π/2)` (3.10). Estabilizada: `wb = ∫(εm − εcm)dx` sobre sr, `εcm = λ·fctm/(2Es)` (3.11), com **λ = 1,0** (εm calculado com λ = 0,67 é multiplicado por 1,5). Não estabilizada (estribos com ρ < ρcr; cantos reentrantes): `wb = ∫ εs dx` pelo modelo de arrancamento, com σsr. Só para cargas **permanentes**, curto ou longo prazo; limite wlim definido pelo usuário.
- **ELU × ELS (p. 29–30):** dois cálculos. ELS: aderência perfeita (barras ligadas direto por MPC, sem elementos de aderência), sem ramo plástico do concreto; `Ec,eff = Ecm/(1+φ)`, φ = 2,5 padrão; cargas permanentes primeiro com Ec,eff, depois as demais com Ecm; cálculo de curto prazo separado.
- **Segurança (p. 29):** formato de coeficientes parciais direto (cargas majoradas, resistências reduzidas por γ); sem adaptação.
- **Concreto (p. 38):** elementos CQUAD4/CTRIA3 em estado plano, 4 pontos de integração; em cada ponto, direções principais ε1/ε3 e `[σc1; σc3] = diag(E1(ε1,ε3), E3(ε1,ε3))·[ε1; ε3]` (3.12), acoplando as direções pelo softening.
- **Armadura e aderência (p. 38–40):** barras 1D (CROD) ligadas ao concreto por MPC; no ELU, elemento de aderência com `Gb = kG·Ec/Ø` (kG = 0,2), ramo plástico `Gb·Rf` (Rf = 1e-5), τb = fbd; mola de ancoragem `Fau = β·As·fyd`, `Ku = β·lb,net·Ø·Gb`, KSN = 1e-2; β = 0 reta, 0,3 gancho/curva/laço/barra soldada, 1,0 aderência perfeita/barra contínua (estribos: 1,0). Aderência e ancoragem **não** servem para tension stiffening nem abertura de fissura.
- **Malha (p. 41–42):** mínimo de 4 elementos em partes finas; máx. 5000 elementos de concreto no programa deles; armadura com elementos do tamanho do elemento de concreto; placas de apoio com 2/3 do elemento; cargas e apoios de área ligados por elementos rígidos.
- **Solver (p. 43–44):** Newton-Raphson completo (Crisfield 1997) com controle de carga: incremento reduzido à metade se não convergir; carga crítica por bisseção. Critérios de parada: deformação 5% no concreto comprimido e 7% na tração, σ do aço = ft (com γ), escorregamento α·δumax (α = 10). A divergência costuma vir de softening de compressão alto; o programa mostra o último nível convergido.
- **Resultados (p. 45–46):** utilização = valor/limite: σc3/σc3,lim (3.17), σsr/σsr,lim (3.18), τb/fbd (3.19), flecha (3.20), w/wlim (3.21).

## Calibração — Xia et al. (2020), Caso I (viga-parede 7,5 × 4,7 m, abertura 1,5 × 1,5 m, 3000 kN no topo, malha 50 mm)
Geometria lida da Fig. 15a (abertura em x 0,5–2,0 m, y 0,5–2,0 m; carga em x = 4,7 m; apoio fixo no canto esquerdo, móvel no direito). Placas de 0,15 m no lugar de cargas/apoios pontuais (limitação do editor). Código: `src/indices.ts` (TRS e SR) e `test/calibracao.xia.test.ts` (`CALIBRACAO=1`).

| Resultado | TRS | SR |
|---|---|---|
| Xia, SIMP malha grossa (I-10) | 77,8 % | 0,717 % |
| Xia, SIMP malha fina (I-11) | 81,4 % | 0,717 % |
| Xia, todos os resultados (média ± desvio) | 72,3 ± 8,1 % | 0,839 ± 0,129 % |
| **Aqui, SIMP 40 %, filtro 2 / 3 / 4 elementos** | 83,1 / 83,6 / 82,2 % | 0,176 / 0,175 / 0,181 % |
| **Aqui, BESO 40 %, filtro 3** | 66,0 % | 0,195 % |
| Aqui, peça cheia (referência) | 100 % | 0,115 % |

- **TRS:** na faixa publicada (61–83 %); pouco sensível ao raio do filtro (±1 ponto). Mas r0 sai do esqueleto próprio (0,48–0,55 m) e o artigo não dá r0 deste caso: comparação aproximada.
- **SR:** **não reproduzido** — fica ≈ 4 vezes abaixo do publicado (0,18 contra 0,72 %). A definição (eq. 7) pode usar outra base (p. ex. barras da treliça extraída) ou cargas pontuais; não resolvido. Não usar o SR desta implementação como calibração.
- **STS** (equilíbrio da treliça extraída) não implementado.
- Tempo: SIMP 37–91 s, BESO 51 s (14 100 elementos).

## Capítulos 4, 6, 7 e Apêndice A do livro (lidos)
**Cap. 4 — validações básicas (CSFM contra os próprios modelos teóricos).**
- Tração uniforme (TCM/POM): curvas σsr–εm praticamente coincidentes acima da fissuração; espaçamento médio CSFM 262/233/190 mm contra TCM 260/233/189 mm (ρeff 0,88/1,28/1,91 %); sem dependência de malha. O CSFM considera a peça **já fissurada** desde o início ⇒ abertura de fissura pequena mesmo antes de fissurar (conservador para ρ baixo). Parâmetros: Es 200 GPa, fyk 500, ft 540, εuk 50 ‰, Ec 32,8 GPa, fctk 2,9, τb0 2,9, τb1 5,8 MPa, λ 0,67.
- Compressão uniforme: qu = 9939 kN/m contra 10 000 (EC2); com malha 2× mais grossa (elemento 77 mm → 154 mm), **−10 %** por softening local nas bordas.
- Arrancamento: Ø8 mm — 24,5 kN (ruptura do aço) contra 23,6; Ø16 mm — 78,1 kN (aderência) contra 75,4; malha padrão 25 mm; sensibilidade marginal.

**Cap. 6 — 29 ensaios (cargas últimas, modos de ruptura, flechas, fissuras).** Modos: F (CC, CC+FY, FR), S (CC, CC+SY, SR); CC = |εc3| ≥ εcu2 = 3,5 ‰ sobre comprimento = espessura.
| Grupo | Parâmetro de controle | Pu,exp/Pu,calc (média; CoV) |
|---|---|---|
| Vigas T TA9–TA12 (4) | largura efetiva da mesa (padrão: 350 mm; fib MC2010: 670 mm) | M0 1,12 (0,03); M1 com 670 mm 1,01 (0,08) |
| Pilares-parede VK1/3/6 (3) | malha 5/15/25 elementos na largura | M0 0,95 (0,03); varia até 12 % com a malha |
| Vigas com pouco estribo (17) | ≥ 10 elementos na altura; **sem** TS superestima ≈ 22 %; TCM nos estribos 0,85 | M0 (5 el.) 0,94 (0,13); M1 (10) 1,03 (0,09); M2 (20) 1,08 (0,10) |
| Cabeças de pilar S1–S5 (5, região D) | εcu2 3,5 ‰ (M0) × 2,0 ‰ (M3) | M0 0,96 (0,13); S5 contra a segurança (866 contra 1085 kN previstos); M3 −10 % |
- Efeitos: tension stiffening **não muda** a carga última (exceto pouca armadura transversal), mas é essencial para flechas e para o modo de ruptura (ruptura de estribo captura-se com POM, não com TCM). Malha e λ pouco influem; λ só altera aberturas calculadas pelo TCM. Lei refinada do aço melhora flechas, mas o padrão bilinear é recomendado para projeto (lado seguro). Ramo pós-pico do concreto não é modelado: a ruptura é um limite, não uma curva.
- **Recomendação do livro:** começar com a malha padrão (ou mais grossa) e repetir com malha mais fina na verificação final para confirmar a sensibilidade.

**Cap. 7 — conclusões:** campos de tensão do CSFM satisfazem equilíbrio e condições de contorno estáticas e não violam as "condições de escoamento" (teorema do limite inferior). Em região D (viga-parede com abertura), concorda com bielas e tirantes no ELU e prevê cargas um pouco maiores, além de verificar serviço.

**Apêndice A (IDEA Beam/RCS, 1D):** ELU sem tração do concreto, εcu2 (parábola-retângulo) ou εcu3 (bilinear); ELS: ζ = 1 − β(σsr/σs)², β = 1,0 (curto prazo) e 0,5 (longo prazo); EI = EIcr·ζ + EIun·(1 − ζ); Ec,eff = Ecm/(1+φ).

**Ainda não encontrado:** a expressão analítica de kc2(ε1) (só aparece como curva na Fig. 3.1e e como generalização da fib MC2010); precisa da fib MC2010 ou da página Theoretical Background da IDEA.

## Theoretical Background (IDEA) e pasta `src-fib/`
**Página IDEA "Theoretical background for IDEA StatiCa Detail"** (acessível; lida por subagente — relato de segunda mão, ~2/3 da página literal, o resto resumido). Confirma: `fcd = αcc·ηfc·kc2·fck/γc`, `ηfc = (30/fck)^(1/3) ≤ 1`; parábola-retângulo do EC2 por padrão, com ramo plástico até εcu2 = 5 %; sem softening no ELS; TCM/POM, λ, `w = wb/cos(θr+θb−π/2)`, `Gb = kG·Ec/Ø` (kG = 0,2), ancoragem `Fau = β·As·fyd`, Newton-Raphson com incremento reduzido à metade e paradas de 5 % (compressão) e 7 % (tração). **kc2 só aparece como gráfico** (Fig. 2e, "generalização da proposta da fib MC2010 para cisalhamento", teto 0,65 não aplicável a outros casos); texto cita corte por tensão: σc2r < 0,11·fcd ⇒ kc2 = 1; 0,11–0,37·fcd interpolação linear; > 0,37·fcd valor do gráfico (declarado como regra de estabilidade). **Sem fórmula fechada de kc2(ε1).**

**`src-fib/`** contém `FIBBUL-0056-2010...vol2.pdf` (fib Bulletin 56, MC2010 *first complete draft*, vol. 2) e `fib_Bull65_NMG.pdf` (Bulletin 65, vol. 1: materiais). Do Bull. 56 vol. 2, seção 7.3.6 (bielas e tirantes), eqs. 7.3-49 a 7.3-51 (símbolos de ≤ lidos do texto extraído; conferir no PDF): `kc = 1,0·(30/fck)^(1/3) ≤ 1,0` (compressão uniaxial), `0,75·(30/fck)^(1/3) ≤ 0,8` (tração normal), `0,55·(30/fck)^(1/3) ≤ 0,55` (tração oblíqua) — mesmos valores da Tabela 2.1 do livro do CSFM. O cisalhamento do rascunho usa MCFT (nível III, `θ = 29° + 7000·εx`, `kv`), **sem** a expressão `kε = 1/(1,2+55ε1) ≤ 0,65`, que pertence à versão final do MC2010 (Bulletin 66, vol. 2) — **não está nesta pasta**. Portanto a fórmula de kc2 segue **não verificada**.

## Leitura direta dos dois PDFs de `src-fib/` (páginas vistas como imagem, não só texto extraído)
Lido: **Bulletin 56 vol. 2** (rascunho do MC2010) — cisalhamento 7.3.3 (PDF 49–58), bielas e tirantes 7.3.6 (72–79), fissuração 7.6.4 a partir da p. 143 e deformações 7.6.5 (162–170), simulação numérica 7.11 (212–219); **Bulletin 65 vol. 1** — concreto 5.1.4–5.1.8 (PDF 155–172), aço 5.2.5–5.2.8 (219–226), aderência 6.1.1 (286–293) e resistência de aderência 6.1.3 (298–301). **Não lido:** o restante dos dois (≈ 250 páginas do Bull. 56 e ≈ 300 do Bull. 65), incluindo a primeira parte de 7.6.4 (fórmulas básicas wk, sr), 7.2.2 (modelagem/análise não linear) e 7.13 (detalhamento, armadura mínima de vigas-parede).

**Conclusão sobre kc2:** nenhum dos dois traz kc2 como função de ε1. No Bull. 56 o cisalhamento é MCFT (nível III: `θ = 29° + 7000·εx`, `kv = 0,4/(1+1500εx) · 1300/(1000+0,7·kdg·z)`, `kc = 0,55·(30/fck)^(1/3) ≤ 0,55`, `VRd,max = kc·fck/γc·bw·z·(cotθ+cotα)/(1+cot²θ)`); a expressão `kε = 1/(1,2+55ε1) ≤ 0,65` **não aparece**. Bielas (7.3-49 a 7.3-51, conferido na imagem): `kc = 1,0·ηfc ≤ 1,0`, `0,75·ηfc ≤ 0,8`, `0,55·ηfc ≤ 0,55`; nós (7.3-55/56): `1,0·ηfc ≤ 1,0` (sem tirante) e `0,75·ηfc ≤ 1,0` (com tirante), com acréscimo de até 10 % sob condições (compressão triaxial, ângulos ≥ 55°, apoio uniforme confinado por estribos, armadura em camadas ou confinamento por placa).

**Útil para o projeto, do Bull. 56 v2:**
- Armadura transversal mínima de almas: `ρw ≥ 0,08·√fck/fyk` (7.3-11); tirante `fyd = fyk/γs`.
- Abertura de fissura com armadura em duas direções: `wd = 2·ls,max,θ·(ε⊥ − εc,⊥)` (7.6-9), `ls,max,θ = (cosθ/lsx + sinθ/lsy)⁻¹` (7.6-8) — mesma ideia da projeção do livro do CSFM; limites usuais 0,30 mm (armado) e 0,20 mm (protendido); tabelas 7.6-4/7.6-5 de diâmetro/espaçamento sem cálculo.
- Flecha: `a = ζ·aII + (1−ζ)·aI`, `ζ = 1 − β·(σsr/σs)²`, β = 1,0 curto prazo e 0,5 sustentado (7.6-16/17) — igual ao Apêndice A do livro.
- 7.11 (simulação numérica): validar com ensaios de materiais, ensaios estruturais e **sensibilidade de malha com ≥ 3 malhas**; materiais com amolecimento exigem regularização; formato global de segurança `Rd = Rm/(γR·γRd)` com γR = 1,2, γRd = 1,06; fcm reduzido 0,85·fck e γ globais 1,27 (aço) e 1,65 (concreto); alternativa: coeficientes parciais com as resistências de projeto.

**Útil para o projeto, do Bull. 65 v1:**
- Concreto: `fcm = fck + 8`; `fctm = 0,3·fck^(2/3)` (≤ C50), `fctk,min = 0,7·fctm`, `fctk,max = 1,3·fctm`; `GF = 73·fcm^0,18` N/m; `Eci = 21,5·10³·αE·((fck+8)/10)^(1/3)` MPa; `Ec = αi·Eci`, `αi = 0,8 + 0,2·fcm/88 ≤ 1`; ν = 0,2; compressão `σc/fcm = −(k·η − η²)/(1 + (k−2)·η)` com `k = Eci/Ec1` (C30: Ec1 = 16,5 GPa, εc1 = −2,3 ‰, εc,lim = −3,5 ‰, k = 2,04); tração linear até 0,9·fctm e abertura de fissura bilinear (`w1 = GF/fctm`, `wc = 5·GF/fctm`).
- Aço: Es = 200 GPa; diagrama bilinear idealizado (fyk, ftk, εuk); classes de ductilidade A (ft/fy ≥ 1,05; εuk ≥ 2,5 %), B (1,08; 5 %), C (1,15–1,35; 7,5 %), D (1,25–1,45; 8 %); Menegotto-Pinto para curvas reais.
- Aderência (modelo local, 6.1-1 a 6.1-4): arrancamento `τbmax = 2,5·√fcm` (boa aderência) ou `1,25·√fcm`; s1 = 1,0 mm (2,0 / 3,6 mm), α = 0,4, τbf = 0,40·τbmax; trinca transversal reduz τ por `λ = 0,5·x/Ø ≤ 1` (6.1-7); escoamento do aço reduz por Ωy. Resistência de projeto: `fbd,0 = η1·η2·η3·η4·(fck/25)^0,5/γcb` com γcb = 1,5, η1 = 1,75 (nervurada), η2 = 1,0 (boa) ou 0,7, η3 = 1 (Ø ≤ 25 mm) ou (25/Ø)^0,3, η4 = 1,0 (fyk 500), 1,2 (400), 0,85 (600); `fbd = (α2+α3)·fbd,0 − 2·ptr` (6.1-21).
- Não é o mesmo modelo de aderência do TCM do CSFM (τb0 = 2·fctm, τb1 = fctm); o livro do CSFM diz que o modelo τb–δ serve só à ancoragem no ELU.

## Calibração — Queiroz & Leonel (2025): viga-parede 10 × 7 m com abertura em 9 posições
Geometria lida da Fig. 6 (viga 10 × 7 m, t = 0,20 m, E = 28,567 GPa, ν = 0,15; 2 × 100 kN no topo em x = 3,5 e 6,5 m; apoios em x = 0,5 m (fixo) e 9,5 m (móvel); aberturas de 1,5 m em colunas x0 = 1,0 / 2,625 / 4,25 m e linhas y0 = 1,0 / 2,75 / 4,5 m; posições 1–3 na 1ª coluna de baixo para cima, 4–6 na 2ª, 7–9 na 3ª). SIMP a 30 %, malha 125 mm (4480 elementos Q4; o artigo usa 8672 T3), placas de 0,25 m no lugar de forças/apoios pontuais, rmin desconhecido no artigo (testados 2 e 3 elementos). Volume de aço: `∫σ1 dV / fyd` nas regiões tracionadas, fyd = 43,5 kN/cm² (`steelVolume` em `src/indices.ts`) — o artigo soma As·L dos tirantes de um modelo simplificado, então a comparação é de **variação relativa**, não do valor absoluto. Código: `test/calibracao.queiroz.test.ts` (`CALIBRACAO=1`).

| Posição | Artigo | Aqui, rmin = 2 | Aqui, rmin = 3 |
|---|---|---|---|
| maciça (aço, cm³) | 888 | 814 | 814 |
| 1 | +11,0 % | +3,7 % | +6,7 % |
| 2 | +23,5 % | +10,4 % | +12,6 % |
| 3 | +14,8 % | +7,2 % | +5,8 % |
| 4 | 0 % | −0,1 % | −0,4 % |
| 5 | +0,3 % | +0,4 % | −0,1 % |
| 6 | +26,8 % | +10,2 % | +18,1 % |
| 7, 8, 9 | 0 % | −0,1 % | −0,4 % |

- **Conferem:** o conjunto de posições que não altera o aço (4, 5, 7, 8, 9, com variação < 0,5 %) e o conjunto das que alteram (1, 2, 3, 6). Com rmin = 3 as duas piores são as mesmas do artigo (6 e 2).
- **Não conferem:** a magnitude é ≈ 40 % (rmin = 2) a 70 % (rmin = 3) da publicada; a ordem entre 1 e 3 troca com rmin = 3 (artigo: 3 > 1); com rmin = 2, 2 e 6 ficam empatadas (artigo: 6 > 2). O aço da peça maciça fica 8 % abaixo.
- **Limites desta comparação:** o SIMP parou em 10–13 iterações para a peça maciça e nas posições sem efeito (tolerância 0,01), podendo estar pouco convergido; a métrica de aço é diferente da do artigo; placas no lugar de cargas pontuais; malha e filtro diferentes. Não varri a tolerância nem a malha.

### Refinamento da calibração do Queiroz & Leonel (convergência, filtro, malha, métrica)
Código: `test/calibracao.queiroz2.test.ts` (`CALIBRACAO2=a` ou `b`) e `test/helpers/queiroz.ts` (cena). Variação do aço (critério de Xia, σ1 > −5·σ2) em relação à viga maciça; artigo entre parênteses.

**A — h = 0,125 m (4480 el.), tolerância 0,001 e até 300 iterações:**
| Pos. | Artigo | filtro 2 el. (0,25 m) | filtro 3 el. (0,375 m) | filtro 4 el. (0,5 m) |
|---|---|---|---|---|
| 6 | +26,8 % | +10,1 % | +20,3 % | +18,7 % |
| 2 | +23,5 % | +11,1 % | +12,8 % | +12,2 % |
| 3 | +14,8 % | +7,3 % | +6,3 % | +5,2 % |
| 1 | +11,0 % | +2,5 % | +4,1 % | +4,3 % |
| 4, 5, 7, 8, 9 | 0 a +0,3 % | −0,1 a +0,4 % | −0,5 a −0,1 % | −0,4 a 0 % |

**B — h = 0,0625 m (17 920 el.), filtro 6 el. (0,375 m), tolerância 0,002:** pos. 6 +22,8 %, pos. 2 +13,9 %, pos. 1 +7,6 %, pos. 3 +7,1 %.

- **Ordem:** com filtro de 3 e 4 elementos (malha grossa) sai 6 > 2 > 3 > 1, igual ao artigo; com malha fina, 6 > 2 > 1 ≈ 3 (empate). Com filtro de 2, 2 passa à frente de 6.
- **Magnitude:** melhora com filtro maior e com malha fina — pos. 6 chega a 76–85 % do publicado, pos. 2 a 52–59 %, pos. 1 a 37–69 %, pos. 3 a 35–48 %. Segue **abaixo** do artigo.
- **Aço da maciça:** 811–814 cm³ em todas as malhas, contra 888 do artigo (−8 %): independente da malha, logo é diferença de métrica/modelo, não de discretização.
- **Métrica:** contar toda tração (σ1 > 0) não serve — dá −12,7 % a +10,4 % nas posições que o artigo diz inalteradas (4, 5, 7, 8, 9) e +51 % na pos. 6 em malha fina. O critério de Xia (σ1 > −5σ2) dá ±0,5 % nessas posições e é o adotado.
- **Alerta:** a fração de elementos cinza (0,1 < ρ < 0,9) cresce de 9 % (filtro 2) para 20–31 % (filtros 3–4) e 15–24 % em malha fina; a binarização em 0,5 passa a influenciar o resultado. Convergência exigiu 14–180 iterações.
- **Ainda não explicado:** por que a magnitude fica abaixo do artigo. Candidatos: o artigo soma As·L de um modelo de bielas e tirantes simplificado (tirantes esbeltos e concentrados) em vez de integrar a tensão no contínuo; elementos T3 e cargas pontuais; filtro e threshold desconhecidos.

## Nível 2 implementado — `packages/core/src/nonlinear.ts`
**O que é:** análise não linear de peças planas, para **teste de equilíbrio e capacidade** (não é modelo de projeto).
- Concreto: sem tração (σ1 = 0 se ε1 > 0; rigidez residual 1e-4·E0 só na matriz, nunca na tensão), fissuras girantes (direções principais de deformação = de tensão), lei uniaxial parábola-retângulo em cada direção principal (`fc = 0,85·fck/γc`, ε0 = 2 ‰, εcu = 3,5 ‰), D secante `Tεᵀ·diag(E1, E3, G)·Tε` com `G = (σ1−σ3)/(2(ε1−ε3))` (eq. 3.12 do livro). **Sem amolecimento por tração transversal (kc2 = 1): isso é o Nível 3.**
- Armadura: barras de treliça sobre arestas da malha, lei bilinear com encruamento (CA-50: fyd = 500/1,15, ft = 1,08·fy, εu = 5 %), **aderência perfeita**.
- Solver: Q4 padrão (2×2 Gauss) + correção pelo resíduo com rigidez secante, controle de carga com passo adaptativo e bissecção até o limite; parada por esmagamento (|ε3| ≥ 3,5 ‰ ou divergência com o concreto no patamar), ruptura da barra (ε ≥ εu) ou divergência pura. Reusa o Cholesky em banda (`solveBandedAssembled`, extraído de `solveBanded`).
- Saídas: fator de carga último, modo (CC/FR/divergência), deslocamentos, forças nas barras, reações por GDL, resíduo de equilíbrio global.

**Testes (`test/nonlinear.test.ts`):**
| Teste | Esperado | Obtido |
|---|---|---|
| T1 compressão uniaxial 0,2 × 0,4 m, C30 | fc·A = 1092,9 kN | 1092,7 kN (CC) |
| T2 tirante As = 10 cm², concreto sem tração | As·ft = 469,6 kN | 469,5 kN (FR, ε = 4,99 %) |
| T3 viga-parede 2,4 × 1,5 m, C50, 4Ø20 a 0,1 m, placas de 0,4 m | tirante escoa; equilíbrio de seção coerente | Pu = 1986 kN; N = 548 kN (As·fy = 546,8); reação esq. 995 kN em x̄ = 0,371 m; braço implícito M/T = 1,32 m (≤ 1,4 m) |

**Sobre o T3:** o MBT com braço entre eixos das placas (1,0 m) dá 1505 kN; o FE dá 1986 kN (+32 %). Diagnóstico pelas reações do próprio FE: o centroide da reação vai para a borda interna da placa (0,371 m, não 0,2 m), encurtando o braço para ≈ 0,83 m. O braço de alavanca implícito (1,32 m) cabe na altura útil, então o resultado é fisicamente consistente; a estimativa do MBT é que estava geometricamente grosseira. A reação esquerda (995 kN) difere 0,2 % de P/2 (apoio direito móvel); o equilíbrio vertical global fecha em 1e-6. O T3 leva ≈ 65 s.

**Limitações conhecidas:** aderência perfeita; sem kc2; sem tension stiffening; sem elementos de aderência/ancoragem; a rigidez inicial do concreto é a da parábola (2·fc/ε0), não o Ec; ν = 0 nas direções principais; a convergência perto do patamar do concreto é lenta e o fim por "divergência" é tratado como CC quando ε ≥ 0,95·ε0; não validado ainda contra os ensaios do capítulo 6 do livro nem contra o Queiroz & Leonel.

## Nível 2 — extensões e a cabeça de pilar S1 (livro do CSFM, cap. 6.5)
**Extensões do solver (`nonlinear.ts`):**
- **Barras embutidas** (`Bar.path`): poligonal em qualquer direção, aderência perfeita, sem GDLs próprios; a deformação axial da barra é a do concreto na direção dela (`ε = g·u_e`), avaliada em trechos de h/4. Teste: força axial elástica de uma barra a 60° dentro de 3,4 % da teoria; mesma carga última do tirante sobre linha da malha.
- **Rigidez tangente** (padrão; `tangent: false` volta à secante): módulos tangentes nas direções principais com piso de 1e-3·E0, cisalhamento secante, barras com encruamento; resíduo final ≈ 1e-8 contra 1e-4.
- **Comprimento de esmagamento** (`crushLength`): o critério `|ε3| ≥ εcu` passa a usar a deformação de compressão **média** numa janela desse comprimento, como pede o livro, em vez do valor pontual.
- Resultados T1–T3 mantidos (T3: Pu = 2086 kN, ruptura do aço, braço implícito M/T = 1,35 m).

**Modelo da S1** (`test/helpers/s1.ts`, `test/calibracao.s1.test.ts`, `CALIBRACAO=1`): largura 1,20 m, altura 0,98 m (base 0,16 + flare 0,32 + pilar 0,50), espessura 2·lb = 0,26 m, 4 apoios (2 no plano) de 0,13 m em x = 0,14 e 1,06 m fixos nas duas direções, carga distribuída no topo em 0,48 m (largura lida da Fig. 6.23), concreto `fc = 31,2 MPa` sem coeficientes (valores médios), As1 = 9Ø10 em U com pernas a 0,16–0,60 m (fy 620, ft 670 MPa), 6 camadas Ah = 4Ø4 a cada 75 mm (fy 605, ft 653 MPa), Es = 200 GPa, εu = 5 %. **Geometria da armadura lida das figuras (aproximada).** Carga por apoio = P/4. Ensaio: 556 kN; CSFM do livro: M0 629, M1 (malha 20) 610, M2 (sem TS) 609, M3 (εcu 2 ‰) 568.

| Critério de esmagamento | malha 40 mm | malha 20 mm | malha 10 mm |
|---|---|---|---|
| pontual, 3,5 ‰ | — | 277 kN | — |
| pontual, 2,0 ‰ | — | 200 kN | — |
| pontual, 5 % (parada padrão do CSFM) | 608 | 512 | 497 |
| média em 0,13 m, 3,5 ‰ | 591 | 488 | — |
| média em 0,13 m, 2,0 ‰ | 554 | 457 | — |
| **média em 0,26 m (= espessura), 3,5 ‰** | **608** | **550** | — |
| média em 0,26 m, 2,0 ‰ | 588 | 525 | — |
| sem critério (só divergência) | — | 579 (εc,máx = 610 ‰, 424 s) | — |

- **Critério pontual não serve:** para na carga de 277 kN (3,5 ‰) ou 200 kN (2,0 ‰) por picos nos cantos das placas, com o aço quase sem tensão.
- **Média sobre o comprimento = espessura (0,26 m, a recomendação do livro) dá 550–608 kN**, no intervalo do ensaio (556) e do CSFM (568–629), mas **cai ≈ 10 % ao refinar de 40 para 20 mm** (o livro relata ≈ 3 % entre as suas malhas). O resultado ainda depende da malha e do comprimento de esmagamento.
- O aço principal **não chega a escoar** no nosso modelo (373 kN contra 438 kN de escoamento na melhor corrida); no ensaio o modo foi CC + FY.
- **Limites:** sem kc2 nem tension stiffening; geometria e posição das barras lidas de figuras; placa de carga de 0,48 m e espessura 2·lb assumidas; só S1 (S2–S5 não rodadas); malha de 10 mm só com o critério pontual (45 min).

## Nível 2 no editor (interface)
- `Scene` ganhou `bars?: BarSpec[]` (poligonal, As em cm², fy/ft em MPa, Es em GPa, εu) e `nl?: NlParams` (valores médios × de projeto, εcu, comprimento de esmagamento); `loadSaved` valida e descarta o que vier malformado.
- `pierCapScene()` em `src/presets.ts` (S1 do livro) vira o exemplo **"Cabeça de pilar S1 (CSFM, livro) — análise não linear"** (malha de 40 mm, ≈ 10 s). `barsFromScene`/`concreteFromScene` convertem as unidades para o solver.
- `solveNonlinearSteps` é um gerador (`stepwise: true` emite λ, deslocamentos, mapas de deformação e forças nas barras a cada passo); o worker (`mode: "nl"`) o executa em fatias, permite parar e envia quadros ao editor; `solveNonlinear` continua síncrono.
- Painel: resistências, εcu, comprimento de esmagamento, lista de barras (As e fy editáveis), botão rodar/parar, resultado (carga, modo, barras, reações) e as vistas *Deformação do concreto* e *Fissuração e armadura*. As barras aparecem desenhadas em qualquer exemplo que as tenha.
- **Verificado no navegador:** S1 a 40 mm → P = 2466 kN (616 kN por apoio real), modo CC, As1 a 420 kN (não escoou), camadas Ah escoadas; as duas bielas aparecem no mapa de compressão. **Não está pronto:** desenhar barras na tela, outros exemplos com armadura, escolha de unidades.

### Malha grossa e barras embutidas (correção)
Com elemento ≥ 0,06 m na S1, o contorno inclinado do flare vira "escada" e o elemento natural de alguns trechos da armadura é vazio; o solver recusava ("trecho fora da geometria"). Agora o trecho é ligado ao elemento de concreto mais próximo (até 3 elementos, coordenadas locais presas ao elemento) e o programa avisa quantos trechos foram projetados. **O resultado em malha grossa superestima a capacidade:** S1 por apoio real — 0,04 m: 616 kN; 0,06 m: 781; 0,08 m: 831; 0,10 m: 710 (ensaio 556). A interface avisa quando o elemento passa de 0,05 m e há armadura.

## Busca linear, classes de aço, dica do mouse e nó de pórtico (estado)
**Busca linear (implementada, padrão):** quando o passo completo de correção não reduz o resíduo, o solver testa frações (1/2, 1/4, 1/8, 1/16) e fica com a melhor, sem montar a matriz nas tentativas. Medições (`work.iterations`, `work.lineSearchTrials`):
| Caso | sem busca linear | com busca linear |
|---|---|---|
| S1, elemento 30 mm | 64 passos, 830 iterações, 35 s, λ = 0,6633 | **9 passos, 237 iterações, 8 s**, λ = 0,6633 |
| S1, elemento 40 mm | 12 passos, 222 iterações | 9 passos, 203 iterações, λ = 0,616 |
| viga-parede com tirante (T3) | 35 passos, Pu = 2086 kN, barra parou em 554 kN | 19 passos, **Pu = 2252 kN, barra em 590 kN = As·ft** (limite físico), tempo parecido |
O T3 mudou porque, sem busca linear, o solver desistia antes de a barra chegar à ruptura. O rótulo do modo de ruptura (CC × FR) em passos que não convergem é classificado pelo estado da última iteração e pode oscilar; a carga é o dado confiável.

**Aço passivo:** `STEEL_CLASSES` (CA-50 e CA-60, valores de projeto fyk/1,15; ft = 1,08·fy e εu = 5 % para o CA-50, ft = 1,05·fy e εu = 2,5 % para o CA-60 — **valores assumidos, a confirmar na NBR 7480**). `BarSpec.steelClass` ("CA50" | "CA60" | "custom"); a S1 usa "custom" (valores do ensaio). `BarSpec.extra` agrupa polilinhas iguais (estribos).
**Interface:** cada barra tem rótulo desenhado na tela e linha na lista com classe de aço, As e fy; passar o mouse na lista destaca a barra. Dica ao passar o mouse (vista **Nível 2: fissuração**: fissurado sim/não e ε1; **Nível 2: tensões do concreto**: σ1, σ3, cisalhamento máximo τ, σx, σy, τxy; **deformação do concreto**: ε3 e % de εcu; vistas elásticas: σ1, σ2 e τ; **deformada**: ux, uy; **sobre uma barra**: identificação, aço, As, força axial, σ e % de fy).
**Prompt de pesquisa:** `docs/prompt-pesquisa-discretizacao.md` — texto para pedir a uma IA que reúna, com fonte, página e trecho literal, os valores de discretização, fração de volume, raio do filtro, comprimento de esmagamento e demais decisões em aberto.

**Nó de pórtico — NÃO FUNCIONA ainda.** `frameCornerScene()` (canto superior de um pórtico em L: pilar 0,40 m, viga 0,40 × 0,50 m, vão 3,0 m, 600 kN de referência, momento de fechamento; barra externa contínua 4Ø20 CA-50, face interna do pilar, face inferior da viga e estribos CA-60) está no código mas **fora da lista de exemplos**: com elemento de 0,05 m (3360 elementos) a análise não converge nem no primeiro passo (λ = 0, divergência após 370 s). Geometria e armadura são genéricas, sem ensaio de referência. Causas a investigar: apoio direito móvel combinado com o engaste fixo (hiperestático) e concreto sem tração fissurando de uma vez; carga de 600 kN de referência e passo inicial de 0,1 talvez já grandes demais; ausência de armadura de tração onde o concreto fissura. Primeiros passos: reduzir o passo inicial de λ, rodar com carga bem menor, simplificar para viga em balanço e só depois montar o canto.

## Resposta do Gemini ao prompt de discretização — conferência e teste da hipótese da janela
Arquivo recebido: "Catálogo Computacional de Concreto Armado" (resposta ao `docs/prompt-pesquisa-discretizacao.md`). A própria resposta declara que **não leu os PDFs**: todos os números de página e trechos literais estão "não verificados". Conferência contra o que li:
- **Confere com as fontes lidas:** εcu = 3,5 ‰ (NBR/EC2/MC2010) e 3,0 ‰ (ACI); εud = 10 ‰ na NBR 6118; classes de ductilidade 2,5/5/7,5 % × 0,9 (EC2/MC2010); τb,max = 2,5·√fcm e s1 = 1,0 mm (boa aderência) do MC2010; ηfc = (30/fck)^(1/3); parada padrão de 5 % do CSFM; φ = 0,75 para bielas e tirantes (ACI); formato global γR = 1,2 · γRd = 1,06 ≈ 1,27, fcmd ≈ 0,85·fck, fym = 1,1·fyk e o ECOV exigir duas rodadas (Bull. 56, 7.11).
- **Não verificado, plausível:** CA-60 com ft/fy ≥ 1,05 e CA-50 com alongamento ≥ 8 % (NBR 7480); αcc do EC2; "h ≤ bplaca/2 a /3" sob placas; energia de fratura em compressão Gfc ≈ 10–25 N/mm (baixa confiança).
- **Contradiz o livro:** a afirmação de que "sem kc2 as bielas superestimam a carga independentemente da malha" — para a cabeça de pilar o livro diz que kc2 e tension stiffening pouco influem (deformações transversais pequenas).
- **Diagnóstico proposto para a queda de ≈ 10 % da S1 (4 suspeitos), contra o nosso código:** (1) janela em metros × em elementos — o raio era `round(lc/2h)`, isto é, janela de ≈ lc + h; (2) normalização — a média dividia pela área total da janela, vazios contando zero. **Corrigi os dois** (janela de n = 2R+1 elementos com n·h ≈ lc; divisão pelo número de elementos de concreto) e **o resultado quase não mudou**: lc = 0,26 m, por apoio real — 40 mm: 616 → 615 kN; 30 mm: 663 → 661; 20 mm: 550 → 539; lc = 0,13 m — 40 mm: 591 → 554; 30 mm: 606; 20 mm: 488 (igual). Logo (1) e (2) **não explicam** a dependência de malha. (3) placa de carga: nossas cargas e apoios são nodais, não placas elásticas — ainda a testar. (4) Q4 × QM6: o solver não linear usa **Q4 puro** (o QM6 só existe no linear) — ainda a testar.
- **Observação nova:** a carga é **não monotônica** com a malha (40 mm: 615; 30 mm: 661; 20 mm: 539 kN). Hipótese: a largura efetiva dos apoios e da placa de carga muda com h porque 0,13 m e 0,48 m não são múltiplos de h (em 40 mm os nós de apoio cobrem 0,12 m; em 30 mm, 0,09 m), e a capacidade depende da largura da biela. Próximo teste: usar placas múltiplas de h.
- **Perfis normativos (sugestão do Gemini):** desacoplar um objeto de perfil (γc, γs, αcc, εcu, εud, Es, catálogo de aços, formato de segurança: parcial / nominal com φ / global com 1,27) do solver, na ordem NBR → EC2 → ACI → fib. Coerente com as fontes lidas; EC2 muda γc (1,5), Es (200 GPa), aços B500 e εud. Pendente de implementação; o limite εud = 10 ‰ da NBR também ainda não é o padrão do modo de projeto.

## Teste da geometria alinhada ao elemento (S1) e proposta CAST/STM
**Teste:** S1 com topo em 1,00 m (em vez de 0,98) e apoios de 0,12 m (bordas em 0,08–0,20 e 1,00–1,12 m), tudo múltiplo do elemento; lc = 0,26 m; carga por apoio real. 40 mm: original 615 kN, **alinhada 610 kN**; 20 mm: original 539 kN, **alinhada 389 kN com modo "divergência" após 358 s**. Conclusão: **a hipótese das larguras não múltiplas de h não se confirmou** (a 40 mm quase não mudou) e a corrida alinhada a 20 mm **não convergiu** (λ = 0,389 é falha numérica, não capacidade). Ficam os suspeitos de placas elásticas de carga/apoio (hoje as forças e apoios são nodais) e do Q4 puro no solver não linear.

**Módulo STM estilo CAST (proposta do Gemini, com mockup em HTML):** avaliação em `docs/` não é código nosso. O mockup é uma maquete de interface: TO, STS e CSFM são desenhos e fórmulas fechadas inventadas (λult, wk, σc3/fcd,ef saem de expressões ad hoc, sem solver), **não** resultados. Aproveitável: geometria de zona nodal `ws = wt·cosθ + lb·senθ`, classificação CCC/CCT/CTT, tabela de verificação face a face com taxa de utilização (SR), padrão de normas plugáveis, zona nodal estendida, inspetor de nó. Limites NBR 6118 22.3.2 (conferidos na reprodução do Borges): fcd1 = 0,85·αv2·fcd (CCC e regiões sem tração transversal), fcd2 = 0,60·αv2·fcd (tração transversal, CTT/TTT), fcd3 = 0,72·αv2·fcd (CCT), com **inclinação das bielas entre 29,7° e 63,4°** (tg entre 0,57 e 2) — o mockup usa 25° (ACI). Encaixe no roteiro: ver a resposta no chat (trilha paralela, STM manual primeiro; TO→STM por ground structure depois).

## Correção do controle de passo e teste de placas elásticas (S1)

- **Os 389 kN do S1 alinhado em 20 mm eram artefato.** O passo de carga, cortado de 0,1 para ~0,0002 no 1º passo (195 iterações), nunca voltava a crescer (`everFailed`) e o laço parou no teto de 2000 passos. Correção: o passo volta a crescer, o 1º passo tem 4× mais iterações e há aviso quando o teto de passos é atingido. Com isso o 20 mm alinhado dá 539 kN (CC), igual à geometria original; 40 mm alinhado dá 610 kN.
- **1º passo (40 mm):** ~45–50 iterações com Δλ0 = 0,1, 0,01 ou 0,001 (ft = 0: o padrão de fissuras não depende da escala da carga); tangente e secante equivalentes. Rigidez residual **maior** piora (1e-3: 100 it; ≥1e-2: não converge); menor ajuda pouco (1e-5: 44 it). O solver é Newton completo (matriz remontada a cada iteração), não modificado.
- **Placas de aço elásticas** (opção `plates`, E = 210 GPa; fileira de elementos com ≥ 2 nós carregados/apoiados vira aço linear): S1 com apoio 0,12 m, comprimento de esmagamento 0,26 m.

| Malha | sem placas | com placas |
|---|---|---|
| 40 mm | 615 kN | 702 kN |
| 30 mm | 583 kN | 671 kN |
| 20 mm | 539 kN | 593 kN |

  As placas elevam a capacidade (+10 a +14 %) e **não reduzem a dependência de malha** (queda 40→20 mm: 12 % sem, 16 % com). Ressalva: a espessura da placa é igual a h (uma fileira), então ela muda junto com a malha; o teste não isola a espessura. Hipótese "singularidade nodal explica a dependência": **não sustentada**. Próximos suspeitos: Q4 puro (QM6 no solver não linear), aderência perfeita e a própria lei sem tração.

## Comprimento de esmagamento: conferido no livro (Kaufmann et al., 2020)

Verificado no PDF (páginas impressas; o PDF tem 8 páginas a mais que a numeração impressa):
- **p. 18 (Seção 3.3.1):** o critério explícito εcu2 "deve ser imposto sobre uma deformação média calculada sobre um comprimento característico de banda de esmagamento", para evitar dependência da malha; o usuário define o comprimento, e "um valor pequeno entre a profundidade da zona comprimida e a espessura da seção é recomendado". As verificações dos Caps. 4 e 5 usaram patamar plástico infinito; **todas as do Cap. 6 usaram εcu2 = 3,5 ‰ sobre um comprimento igual à espessura da região**. O ηfc não é necessário com esse critério.
- **p. 104 (Tab. 6.1):** CC = |εc3| ≥ |εcu2| = 3,5 ‰ "sobre um comprimento igual à espessura da região" ou divergência por amolecimento.
- **p. 137 (6.5.3):** na S1 a espessura do modelo é a soma das espessuras das placas de carga, **2·lb = 0,26 m**. Portanto lc = 0,26 m é o que o livro faz (não foi calibração nossa). Apoios de neoprene tratados como fixos nas duas direções (igual ao nosso).
- **Geometria da média não é definida** (janela, círculo, banda): a janela quadrada de lado lc é interpretação nossa.
- **Malha na S1 (p. 138–140):** 10 vs 20 elementos na seção A-A (a legenda da Fig. 6.24a diz 4 vs 8 FE; o livro é inconsistente). Pu: M0 629, M1 610, M2 609 (sem TS), M3 568 (εcu 2 ‰); ensaio 556. Variação de malha < 5 % ("o resultado é um pouco sensível"; recomenda estudar a malha). O M0 usa tension stiffening (TCM) em todas as barras; o nosso modelo não tem TS.

## Tension stiffening simplificado e QM6 não linear (S1)

- **Tension stiffening simplificado** (opção `tensionStiffening`: fct, ρeff; modelo da corda tracionada, Kaufmann et al., 2020, p. 20, só até o escoamento; depois, deslocamento de Δ/Es, aproximação nossa). S1, ρeff = 0,5 / 1 / 2 %: 40 mm 624/622/618 kN (sem TS: 615), 30 mm 593/590/587 (583), 20 mm 549/546/543 (539). Efeito < 2 %, queda 40→20 mm continua ≈ 12 %: **o TS não explica a dependência de malha**, como o livro (p. 140) já indicava (610 com TS, 609 sem).
- **QM6 no solver não linear** (opção `element: "qm6"`, 4 modos incompatíveis por elemento, Newton local + condensação): **experimental, não funciona no S1.** Passa na compressão uniaxial (T1: mesmos passos do Q4), mas no S1 fissurado o Newton global diverge já no 1º passo (resíduo cai a 6 % e depois explode), mesmo com laço local secante e λ minúsculo; com malha fina o tempo chega a 50 min sem passo algum. Hipóteses não testadas: modos incompatíveis com tração nula criam mecanismos sem energia nos elementos fissurados; rigidez tangente inconsistente com a lei; necessidade de limitar α. Padrão continua Q4. Barras embutidas usam só a parte compatível do campo.

## Comparação de malha com o livro (S1, Q4, lc = 0,26 m)

O livro varia "o número de elementos ao longo da seção A-A" (Tab. 6.16: 10 → 20; legenda da Fig. 6.24a: 4 → 8) e obtém 629 → 610 kN (−3 %). Como não está claro qual comprimento é a seção A-A, rodamos as interpretações plausíveis:

| Interpretação | malha grossa | malha fina | queda |
|---|---|---|---|
| A: largura do pilar 0,64 m, 10 → 20 elementos (64 → 32 mm) | 677 kN | 580 kN | −14 % |
| A: 0,64 m, 4 → 8 elementos (160 → 80 mm) | 856 kN | 803 kN | −6 % |
| B: largura total 1,2 m, 10 → 20 elementos (120 → 60 mm) | 1027 kN | 601 kN | −41 % |

Nenhuma interpretação reproduz os −3 % do livro; a mais plausível (A, 10 → 20) dá −14 %, perto do nosso 40 → 20 mm (−12 %). A comparação **não dissolve** a diferença: a dependência de malha do nosso solver é maior que a do livro. Observação: as cargas do livro (610–629 kN) coincidem com as nossas em h ≈ 40–60 mm (601–615 kN), mas o livro usa malha não estruturada e (no M0) tension stiffening. Seção A-A e tipo de malha do livro continuam não verificados.

## Hipótese testada: a "escada" do flare inclinado causa a dependência de malha? Não.

S1 com o flare removido (corpo retangular 1,2 × 0,48 m + pilar 0,64 m; topo em 1,00 m, alinhado; sem contorno inclinado, portanto sem escada): **40 mm 616 kN, 20 mm 541 kN (−12 %)**, praticamente idêntico à geometria original (615 → 539 kN). O contorno inclinado não influencia o resultado nem a dependência de malha. Hipóteses já refutadas para os −12 %: geometria alinhada, flare inclinado, janela de esmagamento, placas elásticas, tension stiffening, rigidez residual, tangente × secante. Sobram: elemento (QM6 não funcionou), o modo de ruptura localizado no canto do apoio (apoio rígido com ux e uy fixos) e o próprio modelo constitutivo sem tração.

## Hipótese testada: a restrição horizontal dos apoios explica a dependência de malha? Em parte.

S1 (Q4, lc = 0,26 m, apoio 0,12 m) com os apoios restringidos **só na vertical** (ux livre, exceto um nó que impede o corpo rígido), contra o apoio fixo em ux e uy do livro (neoprene de 10 mm tratado como fixo, p. 137):

| Malha | apoio fixo (ux, uy) | só vertical |
|---|---|---|
| 40 mm | 615 kN (CC) | 615 kN (FR) |
| 30 mm | 583 kN (CC) | 615 kN (FR) |
| 20 mm | 539 kN (CC) | 576 kN (FR) |

Com ux livre o apoio deixa de ser o ponto crítico: o tirante As1 recebe o empuxo horizontal (450–459 kN, perto de ft·As = 474 kN) e a ruptura passa a ser da **barra (FR)**, não do concreto (no ensaio: CC + FY). A queda de 40 → 20 mm cai de 12 % para 6 %. Conclusão: a restrição horizontal rígida no canto do apoio contribui para a dependência de malha, mas o modelo só vertical não é fiel ao ensaio (modo de ruptura e carga acima de 556 kN). Teste de apoio intermediário (neoprene com rigidez horizontal finita) ainda não feito; o solver não tem molas de apoio.

## Normas como dado (perfis normativos)

`packages/core/src/codes.ts`: cada norma é um perfil (`DesignCode`) com γc, αcc, εc2, εcu, ηfc, γs, εud e, quando conferidos, os fatores de redução de bielas. A cena guarda `nl.code` (padrão NBR 6118) e `concreteFromScene` usa o perfil; a interface tem o seletor "Norma" (trocar atualiza o εcu, que continua editável). **Verificado:** NBR 6118 (γc 1,4, αcc 0,85, εc2 2 ‰, εcu 3,5 ‰, γs 1,15, εud 10 ‰); fatores de bielas de EC2, MC2010 e SIA (livro do CSFM, Tab. 2.1, p. 12; teste confere fck = 30 e 50 MPa); ACI: εcu 3,0 ‰ e φ 0,75. **Pendente (cada perfil declara em `status.pendente`):** fatores fcd1/2/3 da NBR (conferir a ordem), γc/αcc/γs/εud de EC2, MC2010 e ACI (provisórios), εud por classe de ductilidade, ACI βs/βn. Os fatores de biela ainda não alimentam o solver nem o módulo de bielas (hoje só o concreto do Nível 2 usa o perfil).

**kc2:** a fórmula continua ausente (a resposta do Gemini sobre "CSFM sem kc2" apenas fixa kc2 = 1). Postergado até haver fonte.

## kc2: o que o livro do CSFM realmente diz (conferido no PDF)

- **Eq. (3.1), p. 17:** fcd = fck,red/γc = kc·fck/γc = ηfc·kc2·fck/γc, com ηfc = min[1, (30/fck)^(1/3)] (MC2010). O kc2 é o fator de redução por **fissuração transversal**, função da deformação principal de tração ε1 (Fig. 3.1c–e, p. 16).
- **A relação kc2(ε1) só aparece como GRÁFICO (Fig. 3.1e)**, curva que parte de 1,0 em ε1 = 0 e decresce, comparada com a do MCFT (Vecchio e Collins) e a do fib MC2010. O texto (p. 17) diz que ela é "uma generalização da proposta do fib MC2010 para verificações de cisalhamento, que tem valor limite de 0,65" e que a redução do MCFT, derivada em tensões médias, "pode ser excessiva" para o CSFM, que trabalha com tensões máximas nas fissuras. **Não há expressão analítica no livro.**
- **O fib Model Code 2010 "First complete draft" (Boletim 56, Vol. 2, local em `src-fib`) NÃO traz kε(ε1):** só kc constante, 0,55·(30/fck)^(1/3) ≤ 0,55 (Eq. 7.3-21/24, p. 35–36) e 0,5·(30/fck)^(1/3) ≤ 0,5 (Eq. 7.3-17, p. 34). A forma kε = 1/(1,2 + 55·ε1) ≤ 0,65, de memória, seria da versão final do MC2010 e **não foi verificada** aqui.
- **Relevância:** no S1, o livro (p. 140) diz que o kc2 "quase não afeta" a resistência de compressão porque as deformações transversais são muito pequenas. Para reproduzir o S1 o kc2 é dispensável; importa em vigas-parede e almas com tração transversal relevante (estribos). Continua postergado até haver a expressão numa fonte conferida; alternativa provisória: digitalizar a Fig. 3.1e como tabela (aproximada e marcada como tal).

## kc2 provisório e diagnóstico do 1º passo (opções `kc2` e `trace`, desligadas por padrão)

**kc2 provisório** (`kc2: true`): leitura aproximada da Fig. 3.1e do livro (kc2 = 1 até ε1 = 1 ‰, reta até 0,65 em 6 ‰, depois 1/(1,2 + 55·ε1), forma do MC2010 final que coincide visualmente com a curva; **fonte não verificada**); multiplica fc e ε0 do pico da parábola; a tangente não inclui ∂kc2/∂ε1.

| Caso | sem kc2 | com kc2 provisório |
|---|---|---|
| S1 40 mm | 615 kN | 503 kN |
| S1 30 mm | 583 kN | 468 kN |
| S1 20 mm | 539 kN | 423 kN (FR) |
| T3 viga-parede com tirante | 2252 kN (FR) | 2014 kN (CC) |

No S1 o kc2 provisório derruba a carga 18–22 % e agrava a dependência de malha (−16 % de 40 a 20 mm); o livro, com kc2 ligado por padrão no M0, obtém 610–629 kN e diz (p. 140) que o kc2 quase não afeta a S1 (deformações transversais pequenas, com tension stiffening). Nosso ε1 é o da barra nua e pontual (maior). Hipótese a testar: kc2 + tension stiffening simplificado.

**1º passo do Newton (S1, traço por iteração):** 48 iterações em 40 mm, 175 em 20 mm. O padrão de fissuras estabiliza em ≈ 12 iterações (trocas de estado ≈ 0), e a busca linear corta o passo (α < 1) em 172 das 175 iterações: convergência linear lenta com o padrão fixo, **não** oscilação de fissuras nem propagação. Cerca de 60 % da malha já está "fissurada" (rigidez 1e-4·E0) com a carga mínima, o que deixa o sistema mal condicionado (hipótese, coerente com os testes de rigidez residual). Custo de tempo, sem efeito na carga final.

**kc2 + tension stiffening simplificado (S1, ρeff = 0,5 / 1 / 2 %):** 40 mm 511 / 510 / 508 kN; 20 mm 433 / 432 / 430 kN. O tension stiffening **não** recupera a carga (sem TS: 503 e 423 kN): a hipótese de que ele explicaria a diferença para o livro (610–629 kN com kc2 + TS) **fica refutada** no nosso modelo. Seguem as diferenças possíveis: forma real da curva kc2(ε1) em 0–6 ‰ (só há gráfico), uso de ε1 pontual × médio, TS completo do livro (só a 1ª linha da Eq. 3.3 foi implementada) e o modelo de arrancamento para estribos. Com o kc2 provisório ligado, o S1 fica **abaixo** do ensaio (423–503 kN contra 556 kN): manter `kc2` desligado por padrão.

## Nó de pórtico: nova investigação (não resolvido)

Reexecutado com o controle de passo corrigido (exemplo `frameCornerScene`, 600 kN de referência): **continua sem convergir** (0 passos em 100 mm, 88 s; 0 passos em 50 mm, 1071 s). Traço do 1º passo (100 mm, 840 elementos): o padrão de fissuras estabiliza em ≈ 20 iterações (239 elementos fissurados), e a partir da iteração ≈ 50 o resíduo cai com α = 1 mas **quase estagna** (8,8e-4 → 3,1e-4 na iteração 149 → 1,2e-4 na 599; taxa ≈ 0,998 por iteração), a um passo de atingir a tolerância de 1e-4: convergência linear extremamente lenta, sugerindo quase-mecanismo (regiões sustentadas só por concreto fissurado a 1e-4·E0 e barras). Com a nova opção `firstStepTolFactor: 10` o 1º passo fecha (47 iterações, λ = 0,10, 60 kN), mas **o 2º passo não converge** nem com incrementos mínimos: a divergência real aparece a ≈ 10 % da carga de referência (barras com 33 kN no máximo, ainda elásticas). Causa não identificada. Hipóteses: caminho de forças incompleto no canto (armadura/estribos ou geometria do apoio Ap2 na face inferior da viga, só uy), o exemplo ser genérico e talvez mal posto (sem ensaio de referência), ou instabilidade da lei sem tração em região de cisalhamento puro. Próximos testes baratos: carga menor ou apoio duplo na viga; viga em balanço simples; trocar o apoio Ap2.

## Nó de pórtico: resolvido com o apoio travado em x

Variantes (100 mm, tolerância do 1º passo ×10): original (Ap2 só uy) **diverge a 60 kN**; **Ap2 em ux e uy converge: 1089 kN, 20 passos, modo CC, barra externa 550 kN (escoou), pilar 358 kN, viga 184 kN**; sem Ap2 (balanço) não converge (0 passos). Com Ap2 duplo: 100 mm → 1089 kN (20 passos); 50 mm → 850 kN (17 passos, 46 s; barra externa 448 kN sem escoar). Fator de tolerância do 1º passo (1 ou 10) não altera o resultado. O exemplo (`frameCornerScene`, ilustrativo, sem ensaio) está na lista de modelos e tem teste automático (100 mm). A causa da divergência com o apoio livre em x não foi investigada (hipótese: falta de estabilidade horizontal do conjunto).
