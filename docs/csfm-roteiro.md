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
