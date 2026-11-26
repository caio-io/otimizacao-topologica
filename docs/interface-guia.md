# Guia da interface: tudo o que existe e a lógica de uso

Documento para quem vai redesenhar a UI/UX. Descreve **o que o programa faz, o que a tela mostra hoje, como o usuário caminha pelo sistema e o que a interface precisa comunicar com honestidade**. Não depende do código atual: o design pode mudar livremente, desde que preserve as funções e os avisos marcados como obrigatórios (seção 9).

Repositório: `caio-io/otimizacao-topologica` (branch `main`). Tecnologia atual: TypeScript + Vite, **sem framework** (DOM direto + `<canvas>` 2D), cálculo em Web Worker, núcleo em `packages/core` (`@stm/core`), interface em `apps/web`.

---

## 1. O que o programa é

Ferramenta web para **regiões de descontinuidade (regiões D)** de concreto armado: onde o fluxo de forças é complexo (vigas-parede, consolos, cabeças de pilar, nós de pórtico, aberturas). Ajuda a visualizar **bielas** (compressão) e **tirantes** (tração), e a estimar **armadura** e **capacidade**. Tudo em 2D, estado plano de tensões, espessura constante, concreto de malha regular.

Três camadas de cálculo, em ordem de profundidade:

| Camada | O que responde | Botão | Natureza |
|---|---|---|---|
| **Otimização topológica** (BESO ou SIMP) | Onde há material útil → "desenho" de bielas e tirantes | *Otimizar* | Sugestão visual, não dimensiona |
| **CSFM linear** | Onde o concreto fica tracionado no campo elástico → armadura sugerida As = T/fyd | *CSFM — armadura sugerida* | Estimativa linear |
| **Análise não linear (Nível 2)** | Carga última, modo de ruptura, fissuração, força nas barras | *Rodar análise não linear* | Concreto sem tração, fissura girante, barras com aderência perfeita |

Também há *Campo elástico (sem otimizar)*: tensões principais do domínio cheio.

O resultado **não substitui o projeto de um engenheiro responsável** (aviso fixo na tela).

---

## 2. Fluxos de uso (como o usuário caminha)

**Fluxo A: explorar (viga-parede, consolo)**
1. Escolher um exemplo no topo (ou desenhar a própria geometria).
2. Conferir/editar espessura, fck, cargas e apoios.
3. Aba *Otimização*: definir fração de volume e raio do filtro (ou "Ajustar filtro pela largura da biela") → *Otimizar*.
4. Acompanhar a evolução (controle de iteração), olhar a vista *Topologia + trajetórias*.

**Fluxo B: armadura sugerida (CSFM linear)**
1. Modelo pronto (geometria, cargas, apoios, fck).
2. Aba *Otimização* → *CSFM — armadura sugerida*. Vista *CSFM: zonas tracionadas* e lista de zonas com As.

**Fluxo C: verificar capacidade (Nível 2)**
1. Escolher um exemplo de análise não linear (abre direto na aba *Nível 2*) ou montar o modelo e definir armaduras.
2. Aba *Nível 2*: norma, tipo de resistência (médias × de projeto), εcu, comprimento de esmagamento, lista de barras.
3. *Rodar análise não linear* → a carga cresce passo a passo; a vista muda sozinha para a deformação do concreto.
4. Ler carga última, modo de ruptura, barras escoadas; alternar vistas de fissuração e tensões; passar o mouse para ver valores.

---

## 3. Mapa da tela (estado atual)

```
┌──────────────────────────────────────────────────────────────────┐
│ CABEÇALHO: título · subtítulo                 Exemplo [seletor ▾]│
├───────────────────────┬──────────────────────────────────────────┤
│ [Modelo|Otimização|Nível 2] │ BARRA DE FERRAMENTAS (desenho)      │
│                       │ BARRA DE VISTA: Vista ▾ · Malha · Iteração│
│  conteúdo da aba      ├──────────────────────────────────────────┤
│  (rolável)            │                                          │
│                       │           CANVAS (desenho)               │
│                       │  legenda (canto sup. dir.) · avisos (inf.)│
├───────────────────────┤                                          │
│ ESTADO E REAÇÕES      │                                          │
│ (fixo, rolável)       │                                          │
└───────────────────────┴──────────────────────────────────────────┘
```

### 3.1 Cabeçalho
- **Exemplo** (`#preset`): modelos prontos + "— minha geometria —". Trocar de exemplo substitui a cena.

### 3.2 Aba *Modelo*
- Nota do exemplo (`#presetNote`), p. ex. valores de referência do ensaio.
- **Malha e material:** tamanho do elemento (`#elemSize`, m; limite de 20 000 elementos), espessura *t* (`#thick`), fck (`#fck`, mín. 25 MPa), largura da placa de aplicação das forças (`#bearing`, igual para todas).
- **Apoios e cargas:** lista dos itens da cena (`#list`: material, apoios, forças), propriedades do item selecionado (`#props`), tipo de apoio ao desenhar (`#supKind`: fixo, móvel em x, móvel em y).

### 3.3 Aba *Otimização*
- **Otimização topológica:** método (`#method`: BESO ou SIMP), fração de volume (`#vf`, 0,15–0,70), raio do filtro em elementos (`#rmin`, 1,5–12), *Ajustar filtro pela largura da biela* (`#biela`, texto em `#bielaInfo`), *Otimizar* (`#run`, vira *Parar* durante a execução), *Campo elástico* (`#elastic`).
- **CSFM linear:** *CSFM — armadura sugerida* (`#csfm`), resultado em `#csfmOut`.
- **Resultados:** *Limpar resultados* (`#clearRes`) e *Limpar tudo* (`#clearAll`).

### 3.4 Aba *Nível 2*
- Texto explicando o que o modelo é e o que **não** é (sem kc2, sem tension stiffening, sem ELS).
- **Materiais:** resistências (`#nlValues`: médias × de projeto), **norma** (`#nlCode`: NBR 6118, Eurocode 2, fib MC2010, ACI 318; só a NBR está conferida, as demais são provisórias), εcu em ‰ (`#nlEpsCu`), comprimento de esmagamento em m (`#nlCrush`).
- **Armadura** (`#barsList`): uma linha por barra com nome, classe do aço (CA-50, CA-60 ou "Ensaio" com valores medidos), área As (cm²), fy (MPa). Passar o mouse na linha realça a barra no desenho. **Hoje só se editam área e fy; não há como criar, desenhar ou apagar barras** (ver seção 10).
- **Análise:** *Rodar análise não linear* (`#nl`, vira *Parar*), resultado em `#nlOut` (carga aplicada, modo de ruptura, deformação de compressão, tabela de barras com N máx, ε e se escoou).

### 3.5 Barra de ferramentas (acima do canvas)
Selecionar/mover · Retângulo · Abertura · Polígono · Abertura poligonal · Força pontual · Carga distribuída · Apoio · **Travar geometria principal** (impede alterar o material; aberturas, forças e apoios continuam livres) · Ajustar vista · dica da ferramenta ativa (`hintEl`).

### 3.6 Barra de vista
- **Vista** (`#view`): ver seção 6.
- **Malha** (`#showMesh`): desenha os elementos finitos.
- **Iteração** (`#frame`): deslize pelo histórico (iterações da otimização ou passos de carga do Nível 2).

### 3.7 Cartão *Estado e reações*
Texto de estado (`#stats`: passo, λ, carga, "concluído") e reações de apoio (`#reactions`: Rx, Ry por apoio, resíduo de equilíbrio).

---

## 4. Interações no canvas

| Ação | Efeito |
|---|---|
| Clique (ferramenta *Selecionar*) | Seleciona material/apoio/força (destaca na lista) |
| Arrastar item | Move (material move junto cargas e apoios ligados) |
| Duplo clique numa força | Edita o valor |
| Botão direito + arrastar | Panorâmica |
| Roda do mouse | Zoom |
| Retângulo/Abertura | Arrastar para definir |
| Polígono/Abertura poligonal | Clicar vértices; duplo clique ou Enter fecha |
| Força pontual | Clicar num lado da geometria |
| Carga distribuída | Clicar num lado (placa da largura configurada) ou arrastar ao longo dele; depois digitar a resultante (kN); a intensidade em kN/m aparece |
| Apoio | Arrastar ao longo de um lado, ou clicar num ponto |
| Esc | Cancela o desenho e volta a *Selecionar* |
| Delete/Backspace | Remove o item selecionado |
| Passar o mouse (vistas do Nível 2) | Dica flutuante (`#tip`): ver seção 6 |

---

## 5. Modelo de dados e persistência

A **cena** (`Scene`) é a fonte de verdade, serializável em JSON, em metros e kN, origem no canto inferior esquerdo, y para cima:

- `shapes[]`: polígonos de material (`add`) e aberturas (`cut`).
- `loads[]`: força pontual ou carga distribuída (resultante em kN, `fy < 0` = para baixo).
- `supports[]`: segmento com `ux`/`uy` restringidos.
- `bars?[]`: barras (poligonal, `extra` para grupos iguais, área total em cm², classe de aço, fy/ft em MPa, Es em GPa, εu).
- `nl?`: `values` (mean/design), `epsCu`, `crushLength`, `code` (norma).
- `h` (tamanho do elemento), `bearing`, `t`, `E`, `nu`, `fck`.

Persistência no navegador (`localStorage`): `stm-scene` (cena atual, validada ao carregar; campos inválidos são descartados), `stm-lock` (geometria travada), `stm.tab` (aba escolhida).

Limites: **20 000 elementos** por malha; abaixo de h = 0,05 m a malha é considerada fina o bastante, acima disso aparece **aviso de malha grossa** (resultados superestimam a capacidade).

---

## 6. Vistas (o que cada uma mostra)

| Vista (`#view`) | Mostra |
|---|---|
| Topologia + trajetórias | Resultado da otimização (material preto-e-branco) com trajetórias de tensão |
| Deformada (MEF) | Forma deformada, ampliada |
| CSFM: zonas tracionadas | Zonas de tração do campo elástico e armadura sugerida |
| Mapa σ1 / σ2 | Tração / compressão principal (campo elástico) |
| **Nível 2: deformação do concreto** | Compressão principal média / εcu: cinza → vermelho; marrom = esmagado; barras coloridas pela força |
| **Nível 2: fissuração e armadura** | Concreto fissurado (tração principal > 0) em azul; barras de verde (0 % de fy) a vermelho (100 %); barras comprimidas em azul |
| Nível 2: tensões do concreto | σ3/fc, cinza → vermelho |

**Dicas ao passar o mouse (Nível 2):** na vista de fissuração, ε1 (tração) e se está fissurado; na de tensões, σ1, σ3 e cisalhamento; sobre uma barra, a força e o percentual de fy. Na lista de barras, passar o mouse realça a barra no desenho (e vice-versa).

A **legenda** (canto superior direito do canvas) hoje é fixa (tração vermelha, compressão azul) e não muda por vista. Rótulos das barras (nome) são desenhados sobre o canvas.

---

## 7. Resultados que a análise não linear produz

- **Carga aplicada** e fator λ (sobre a carga de referência), carga por apoio.
- **Modo de ruptura:** `CC` (esmagamento do concreto, ou perda de equilíbrio com o concreto no patamar), `FR` (ruptura de uma barra), `divergência` (o Newton não convergiu; *o rótulo pode ser impreciso*, a carga alcançada é o dado confiável), `λ máximo`.
- Deformação de compressão: média na janela de esmagamento × εcu, e máximo pontual.
- Tabela de barras: força axial máxima, deformação, se escoou **e em que carga P escoou**; posição do trecho mais solicitado.
- **Dados de falha (novos):** `failure` (modo, λ, janela crítica de esmagamento com centro, retângulo, ε médio × limite e pico pontual; barra que rompeu e onde), `crush` (a mesma janela em cada passo, para acompanhar a compressão crescer) e `firstPlateau` (primeiro passo com compressão ≥ 95 % de ε0). Hoje a tela desenha a janela crítica como contorno tracejado com rótulo "CC: falha por compressão" (vermelho forte na falha) e escreve a região no resumo.
- Evolução: histórico de passos (λ, iterações), com o controle de iteração.
- Reações de apoio e resíduo de equilíbrio.
- Campos por elemento: deformação de compressão, tração principal, tensões.
- Avisos do solver: p. ex. trechos de barra ligados ao elemento vizinho por malha grossa; limite de passos atingido.

**Tempos típicos (computador comum):** viga-parede e cabeça de pilar em malha de 40–50 mm, de segundos a ~1 min; malha de 20 mm no S1, ~1 min; o solver roda em segundo plano (Web Worker), mostra os passos e pode ser interrompido.

---

## 8. Exemplos prontos

| Exemplo | Para que serve |
|---|---|
| Viga-parede | Otimização/CSFM linear: arco-tirante clássico |
| Viga-parede com abertura | Fluxo de forças em torno de abertura |
| Cabeça de pilar S1 (CSFM, livro): análise não linear | Reprodução de ensaio (Geevar e Menon, 2018): 556 kN por apoio no ensaio, 568–629 kN no CSFM do livro; nosso modelo dá 539–615 kN conforme a malha |
| Nó de pórtico (exemplo ilustrativo): análise não linear | Canto com momento de fechamento; **sem ensaio de referência; o modelo atual é longo demais para ser uma região D (a ser recortado)** |

Exemplos de análise não linear já trazem armadura e parâmetros preenchidos.

---

## 9. O que a interface PRECISA comunicar (não negociável)

Cada item existe porque o resultado numérico, sozinho, pode enganar:

1. **O que o Nível 2 não é:** não é a verificação CSFM completa (sem kc2, sem tension stiffening, sem ELS). Deve estar visível perto do botão.
2. **Incerteza de malha:** a carga do S1 varia de 539 a 615 kN com a malha (cai ~12 % de 40 para 20 mm). Resultado do Nível 2 deve ser lido como faixa, não valor exato. Aviso de **malha grossa** é obrigatório.
3. **Valores médios × de projeto:** médias servem para comparar com ensaios; de projeto (fcd da norma) para dimensionar. Deixar claro qual está ativo.
4. **Norma:** só a NBR 6118 está conferida; EC2, MC2010 e ACI são **provisórios**. A interface deve sinalizar isso quando outra norma for escolhida.
5. **Modo "divergência":** significa que o solver parou; o λ atingido é um limite inferior, não a capacidade.
6. **Exemplos ilustrativos** (nó de pórtico) não têm referência experimental.
7. **Aviso fixo:** protótipo educacional; não substitui o projeto de um engenheiro responsável.
8. **Unidades:** m, kN, kN/m, MPa, ‰, cm² (barras). Resultados sempre com unidade visível.

---

## 10. Lacunas e funcionalidades planejadas

**Armadura (maior lacuna de UX):**
- Hoje: lista só de edição de As e fy, sem criar, apagar ou desenhar barras; barras só vêm nos exemplos.
- Planejado: desenhar barras no canvas clicando pontos; **formas prontas** (reta, L com gancho, U, estribo retangular) com comprimento de ancoragem; entrada **n barras × diâmetro** com As calculado; classes CA-50/CA-60; duplicar, apagar, renomear.
- Regra de detalhamento relevante ao nó de pórtico: **barras do pilar são retas; as que dobram são as da viga** (barras do topo da viga dobram para baixo dentro do pilar; as de baixo se ancoram no nó).

**Fissuração (visualização):**
- Hoje: concreto fissurado pintado de azul.
- Planejado: **traços de fissura perpendiculares à tração principal**, com cor e espessura proporcionais a ε1 (estimativa de abertura), junto com as barras. Exige expor a direção principal por elemento (hoje só a magnitude).

**Nó de pórtico como região D de verdade:**
- Recortar o L a ~1× a altura da seção em cada braço; aplicar **N, V e M nas seções de corte** (tensão linear, estaticamente equivalente). Hoje só existem cargas uniformes ou pontuais.

**Outros:**
- Gráfico carga × deslocamento (hoje só carga e λ).
- Exportar (PNG/JSON/relatório) e permalink.
- Unidades selecionáveis (kN/m, kN/cm, tf) e planta de cabos de protensão (ideias pendentes, fora do escopo atual).
- Módulo de bielas e tirantes manual (estilo CAST): traçar o modelo, calcular forças e verificar bielas e nós pela norma escolhida. Os perfis de norma (`packages/core/src/codes.ts`) já existem para isso.
- Normas selecionáveis completas (EC2, MC2010, ACI com fatores de bielas e nós) depois de conferidas nas fontes.
- Versão 3D (planejada, depois de tudo no 2D estar resolvido).

---

## 11. Vocabulário (para textos e rótulos)

- **Região D:** parte da estrutura onde a distribuição de deformações não é linear (descontinuidade geométrica ou de carga). Contraponto: região B.
- **Biela:** campo de compressão no concreto. **Tirante:** esforço de tração, normalmente absorvido pela armadura.
- **Nó (STM):** encontro de bielas e tirantes; no pórtico, o **nó** é também o canto entre pilar e viga.
- **Momento de fechamento/abertura:** o canto se fecha ou se abre (tração na face externa ou interna).
- **λ:** fator de carga sobre a carga de referência.
- **CC / FR:** esmagamento do concreto / ruptura da armadura.
- **εcu:** deformação última do concreto em compressão (3,5 ‰ na NBR 6118).
- **Comprimento de esmagamento:** janela sobre a qual a deformação de compressão é calculada em média para decidir o esmagamento.
- **fcd, fck, fyd, CA-50, CA-60:** resistência de cálculo e característica do concreto, escoamento de cálculo do aço, classes de aço brasileiras.

---

## 12. Restrições técnicas para o redesenho

- O cálculo roda em **Web Worker**; a interface recebe quadros (frames) com campos por elemento e estado. Qualquer UI nova deve continuar não bloqueando a página e permitir *Parar*.
- O desenho é em `<canvas>` 2D, com conversão mundo (m) ↔ tela (zoom e pan); as dicas ao passar o mouse dependem da vista ativa.
- O núcleo (`@stm/core`) é independente da UI: pode ser reaproveitado com outro framework.
- Para rodar: `npm install`, `npm run dev` (http://localhost:5173), `npm run typecheck`, `npm test`, `npm run build`.
- Arquivos centrais: `apps/web/index.html` (estrutura e estilos), `apps/web/src/main.ts` (estado, desenho, eventos), `apps/web/src/worker.ts` (mensagens de cálculo), `packages/core/src/scene.ts` (modelo de dados), `packages/core/src/presets.ts` (exemplos).
- Documentação técnica de fundo: `docs/csfm-roteiro.md` (decisões, tabelas, testes e o que não funcionou), `docs/estado-do-projeto.md`.
