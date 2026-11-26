# Prompt para uma IA de pesquisa: discretização e parâmetros em aberto

> Texto pensado para colar em uma IA com acesso a busca e leitura de documentos (por exemplo, uma ferramenta de pesquisa aprofundada). Ele pede **fonte, página e valor literal** de tudo, porque em rodadas anteriores uma IA devolveu fórmulas sem fonte e uma delas continha erro. Preencha os trechos entre `[colchetes]` antes de enviar.

---

## Papel e objetivo

Você é um(a) pesquisador(a) de engenharia estrutural computacional. Quero que você **reúna, de fontes primárias, o que a literatura recomenda — e onde ela discorda — sobre as decisões em aberto** de um programa que faz (a) análise por elementos finitos 2D (estado plano de tensões) de regiões de descontinuidade (regiões D) de concreto armado, (b) otimização topológica (BESO e SIMP) para sugerir bielas e tirantes e (c) análise não linear estilo CSFM (*Compatible Stress Field Method*: concreto sem resistência à tração, fissuras girantes, parábola-retângulo, barras de aço com aderência perfeita; ainda **sem** amolecimento por tração transversal kc2 e **sem** *tension stiffening*).

Quero um **catálogo de parâmetros**, não um texto corrido: para cada decisão, os valores usados na literatura, em que condições, e com que nível de confiança.

## Contexto do programa (para você saber o que importa)

- Malha regular de quadriláteros Q4 (também um Q4 com modos incompatíveis, QM6), lado `h` constante, até 20 000 elementos; espessura constante `t`.
- Otimização: BESO (taxa de evolução 0,02; razão máxima de reinserção 0,03; filtro de sensibilidade) e SIMP (penalização p = 3; critério de optimalidade; filtro de sensibilidade). Parâmetros do usuário: **fração de volume**, **raio do filtro** (em número de elementos) e **tamanho do elemento**.
- Análise não linear: solver Newton modificado com rigidez tangente, passo de carga adaptativo, resíduo relativo 1e-4, critério de esmagamento **ε3 ≥ εcu = 3,5 ‰ avaliado como média numa janela de comprimento `lc`** (o livro do CSFM recomenda um comprimento de esmagamento entre a profundidade da zona comprimida e a espessura).
- Casos que já rodei: viga-parede com e sem abertura (Xia et al., 2020; Queiroz e Leonel, 2025), pilar com consolo(s), cabeça de pilar (Geevar e Menon, 2018, como no livro do CSFM, cap. 6.5) e um canto de pórtico [ainda a validar].
- Observação concreta que motiva o pedido: na cabeça de pilar, a capacidade caiu cerca de 10 % ao refinar o elemento de 40 mm para 20 mm (o livro relata cerca de 3 %), e com malha grossa (≥ 60 mm) ela foi superestimada em até 50 %. Quero saber **o que a literatura diz sobre isso**.

## Decisões em aberto que quero catalogar

Para cada item, traga: valores usados, condição de validade, e se é **recomendação explícita** da fonte ou **prática observada** nos exemplos.

### A. Discretização dos elementos finitos
1. **Tamanho do elemento** em regiões D: relação com a altura da seção, a espessura, a largura mínima da biela e a largura das placas de apoio e de carga. Número mínimo de elementos na altura/largura (o livro do CSFM cita mínimo de 4 em partes finas, 5, 10, 15 e 20 elementos na altura em seus exemplos, e máximo de 5000 elementos de concreto).
2. **Convergência de malha**: quantas malhas, que variação aceitável da carga última (o livro e o Model Code citam sensibilidade de malha; busque os números exatos), e como lidar com **singularidades** (cantos de placas, cantos reentrantes).
3. **Tipo de elemento**: Q4, QM6/Wilson, Q8, T3; travamento por cisalhamento; efeito na otimização topológica (padrão de xadrez) e na análise não linear.
4. **Placas de apoio e de carga**: largura mínima, modelagem como carga distribuída ou nodal, placas elásticas de aço, refinamento local (o livro cita placas com 2/3 do elemento).
5. **Posição e malha da armadura** embutida/aderência perfeita: tamanho dos trechos de barra em relação a `h`, cobrimento, barras em contorno inclinado ("escada" da malha regular).

### B. Otimização topológica
6. **Fração de volume** final: valores usados em regiões D de concreto (a IDEA calcula 20, 40, 60 e 80 %; Xia usa 40 %; Queiroz e Leonel usam 30 % e 40 %; Amir limita o aço a 0,5 %). Existe critério para **escolher** a fração (por exemplo, o "joelho" da curva flexibilidade × volume)?
7. **Raio do filtro** (em elementos e em metros): relação com a largura mínima de biela, com o tamanho do elemento e com a dependência de malha; valores típicos por método (SIMP com filtro de sensibilidade, BESO, projeção de Heaviside).
8. **Penalização, passo máximo, taxa de evolução, limiar de binarização, número de iterações e critério de parada** (SIMP e BESO). Onde a literatura reporta resultados sensíveis a isso.
9. **Critérios para validar o resultado** de otimização como modelo de bielas e tirantes (índices STS/TRS/SR de Xia et al., 2020; equilíbrio axial da treliça extraída; *ground structure* de Brito, 2026).

### C. Análise não linear (CSFM)
10. **Comprimento de esmagamento `lc`** e **deformação última εcu**: valores e justificativas (o livro cita 3,5 ‰ sobre um comprimento igual à espessura da região; 2,0 ‰ como variação; 5 % como parada padrão do software). O que a literatura de **regularização** (banda de fissuração, energia de fratura, modelos não locais) recomenda para o concreto em compressão.
11. **Passo de carga, tolerâncias, método** (Newton completo, modificado, secante, busca linear, controle por comprimento de arco): valores usados por softwares e artigos (o livro cita Newton-Raphson com divisão do incremento e parada por bissecção).
12. **Rigidez residual** do concreto fissurado (E_min como fração de Ec) e seu efeito na convergência.
13. **Critérios de parada de estado limite último**: deformações limite do concreto e do aço (εud) por norma e por classe de ductilidade; o que muda entre NBR 6118, Eurocode 2, fib Model Code 2010 e ACI 318.
14. **Valores médios × de projeto**: quando usar resistências médias (comparação com ensaio) e quando as de projeto; coeficientes (γc, γs, αcc, ηfc) por norma.
15. **Aço passivo**: propriedades de **CA-50 e CA-60** (fyk, ftk/fyk, módulo, deformação na ruptura, classe de ductilidade) segundo a NBR 7480 e a NBR 6118; diferenças para os aços do Eurocode (B500B) e do ACI (Grade 60).
16. **Aderência**: parâmetros (kG, fbd, τb0, τb1, comprimento de ancoragem) para quando o programa evoluir de aderência perfeita para modelo com escorregamento.

### D. Casos de referência (benchmarks) para validar
17. Liste **ensaios e exemplos numéricos** com geometria, armadura, materiais e **resultado publicado** (carga última, modo de ruptura, flecha), preferencialmente de **regiões D**: cabeças de pilar (Geevar e Menon, 2018), vigas-parede com abertura, consolos, dentes Gerber, **cantos de pórtico com momento de fechamento e de abertura**, nós de pórtico de extremidade. Para cada um: fonte, página/figura/tabela, e se os dados estão completos o suficiente para reproduzir.

## Fontes que quero que você priorize (nesta ordem)

1. Kaufmann et al. (2020), *Compatible Stress Field Design of Structural Concrete: Principles and Validation* (ETH Zürich / IDEA StatiCa) — capítulos 3 a 6.
2. fib Model Code 2010 (Boletins 55, 56, 65 e 66): materiais, cisalhamento, bielas e tirantes, estados limites de serviço, **simulação numérica (item 7.11: malha, regularização, formatos de segurança)**.
3. ABNT NBR 6118 (seção de bielas e tirantes, ELU/ELS) e NBR 7480 (aço).
4. Eurocode 2 e ACI 318 (bielas e tirantes; nós; fatores de redução).
5. Artigos de otimização topológica para concreto: Liang, Xie e Steven (2000); Bruggi (2009); Amir (2013); Guest e Moen (2010); Xia, Langelaar e Hendriks (2020); Queiroz e Leonel (2025); Borges (2022); Brito (2026).
6. Fundamentos de otimização topológica: Bendsøe e Sigmund; Sigmund (2001, código de 99 linhas); Andreassen et al. (2011, código de 88 linhas); Huang e Xie (2010, BESO); Guest et al. (2004, projeção de Heaviside); Sigmund e Petersson (1998, dependência de malha).
7. Livros e normas de análise não linear de concreto: Crisfield; Vecchio e Collins (MCFT); Bažant e Oh (banda de fissuração); Model Code 2010 sobre regularização.

Se uma fonte **não estiver acessível** a você, diga isso explicitamente em vez de reconstruí-la de memória.

## Regras de honestidade (importantes)

- **Cada número** precisa vir com: fonte completa, **página, figura, tabela ou equação**, e **o trecho literal** (curto) de onde ele saiu. Se não tiver isso, marque como **"não verificado"**.
- Separe sempre: **(a) recomendação explícita da fonte**, **(b) valor usado num exemplo** e **(c) sua própria inferência**. Não misture.
- **Não complete fórmulas de memória.** Se a expressão não estiver na fonte que você leu, diga "a fonte mostra apenas um gráfico/valor tabelado".
- Onde as fontes **discordam**, mostre os dois lados lado a lado, em vez de escolher um.
- Não cite números de página que você não viu. Se estiver estimando, escreva "página aproximada".
- Texto em português do Brasil; símbolos e unidades no padrão da engenharia civil (m, kN, MPa, ‰).

## Formato da resposta

1. **Tabela principal**, uma linha por decisão (itens 1 a 16), com as colunas: *Decisão · Valores/faixas na literatura · Condição de validade · Tipo (recomendação, exemplo, inferência) · Fonte + página/tabela/equação · Trecho literal · Confiança (alta/média/baixa/não verificado)*.
2. **Tabela de benchmarks** (item 17): *Caso · Geometria e armadura · Materiais · Resultado publicado · Fonte e figura/tabela · Dados completos? (sim/não/parcial)*.
3. **Lista de conflitos**: pares de fontes que discordam, com o número de cada uma.
4. **Lista de lacunas**: o que você procurou e **não encontrou**, e onde mais procurar.
5. **Padrões sugeridos** para o meu programa, com **uma linha de justificativa e a fonte** de cada, e a faixa que eu deveria expor ao usuário como "avançado". Marque o que é inferência sua.
6. **Perguntas** para mim, no fim, se alguma decisão depender de uma escolha que é minha (por exemplo, "quero reproduzir ensaios ou projetar?").

## O que não fazer

- Não reescreva o texto das fontes além de trechos curtos entre aspas (direitos autorais).
- Não invente referências, páginas ou valores para preencher a tabela; células vazias com "não encontrado" são melhores que células plausíveis e erradas.
- Não resuma o CSFM em geral: quero **os números e as condições**.
