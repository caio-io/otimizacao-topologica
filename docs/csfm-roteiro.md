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
