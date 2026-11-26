# STM-TopOpt — Estado do projeto (nov/2026)

Documento de passagem: o que existe, como foi feito, de onde vêm as fontes, o que **não** está pronto e o que depende de uma pessoa. Complementa `README.md` (uso), `ARCHITECTURE.md` (visão e roteiro) e `docs/csfm-guia.md` / `docs/referencias.md` (literatura).

> ⚠️ Protótipo para estudo. Os resultados **não** foram calibrados contra a literatura e não substituem o projeto de um engenheiro responsável.

---

## 1. Resumo

Ferramenta web que, dada uma região D de concreto (hoje: vigas-parede 2D), calcula pelo MEF em estado plano de tensão onde o material trabalha, otimiza a topologia (BESO ou SIMP) e mostra tensões principais, reações e deformada. Há ainda um ramo sem otimização (CSFM linear) que estima zonas tracionadas e armadura. **Não** há extração automática do modelo de bielas e tirantes nem verificações normativas completas.

Tudo roda no navegador (Web Worker); não há backend.

## 2. Stack

| Camada | Tecnologia | Observação |
|---|---|---|
| Linguagem | TypeScript 5.6 (`strict`) | núcleo sem DOM |
| Build/dev | Vite 6 (workers ES) | `npm run dev` / `npm run build` |
| Testes | Vitest 2.1 | `npm test` (≈ 2,5 min) |
| Monorepo | npm workspaces | `packages/core` (`@stm/core`), `apps/web` (`@stm/web`) |
| UI | TypeScript puro + Canvas 2D | sem framework; `main.ts` concentra a interface |
| Cálculo | Q4 plano de tensão, solver direto (Cholesky em banda) | PCG existe só para teste/comparação |
| Pré-requisito | Node.js ≥ 20 | para instalar e servir |

Unidades: m e kN. Origem no canto inferior esquerdo; carga para baixo = Fy negativo.

## 3. Estrutura do código

```
packages/core/src
  types.ts      Problem, opções, IterInfo, PrincipalField
  fe.ts         Q4, montagem, solveBanded (produção), solvePCG (teste), reações de apoio
  simp.ts       SIMP + filtro de sensibilidade + OC (gerador)
  beso.ts       BESO soft-kill + filtro + proteção de conectividade (gerador)
  stress.ts     tensões principais por elemento
  scene.ts      cena editável (formas, aberturas, apoios, forças) → rasterização em Problem + validações
  presets.ts    exemplos públicos (viga-parede, com abertura)
  concrete.ts   fck, γc, σRd,max e largura de biela (Borges 2022)
  csfm.ts       zonas tracionadas e armadura sugerida (linear)
apps/web/src
  worker.ts     execução em Web Worker (tokens de execução, cancelamento)
  main.ts       editor/visualizador (canvas), painéis, ferramentas
packages/core/test/simp.test.ts   28 testes
```

## 4. O que foi feito (histórico de trabalho)

### 4.1 Base anterior (commits 211798b → ed81fcc)
Núcleo Q4 + BESO/SIMP, cena editável, visualizador MEF (topologia, deformada, σ1/σ2, trajetórias, histórico por iteração), reações de apoio com resíduo de equilíbrio, catálogo de fontes de `src2/`, guia CSFM.

### 4.2 Revisão e correções (esta rodada)
- **Corrida no worker:** cada execução leva um *token*; mensagens de execuções antigas são descartadas; editar a cena para a otimização em andamento. O modelo FE é montado uma vez e reutilizado nas reações.
- **Conectividade (cena):** `buildProblem` rejeita ilhas de material e cargas sem caminho até um apoio. Limite de malha reduzido de 40 000 para **20 000** elementos (o solver em banda custa ≈ N·bw² por iteração).
- **Testes:** solver em banda vs PCG (ν = 0,3, módulos heterogêneos) e vs flecha de Timoshenko; conectividade; limite de malha. De 13 para **28** testes.
- **Interface:** percentis de escala em cache por quadro (o desenho roda a cada movimento do mouse); cena restaurada do `localStorage` (com validação); ids escapados em HTML.

### 4.3 Cargas
Cada força é **pontual** (um nó) ou **uniformemente distribuída** (resultante em kN; intensidade em kN/m exibida). Ferramentas "Força pontual" e "Carga distribuída" (clique = placa da largura configurada; arrastar = trecho livre); troca por item no painel. Os exemplos públicos usam placa distribuída.

### 4.4 Largura mínima de biela (Borges, 2022)
`σRd,max = k·(1 − fck/250)·0,85·fck/γc`, `a = F/(t·σRd,max)`, com **γc = 1,4 fixo**, **fck ≥ 25 MPa** (campo na interface) e k = 1,0 por padrão. O botão "Ajustar filtro pela largura da biela" converte `a` em raio do filtro (`rmin ≈ a/h`). Um teste reproduz o exemplo do Borges (C35, γc 1,5 → 17,1 MPa e 323,6 mm).

### 4.5 BESO mais robusto
Diagnóstico em viga-parede com carga longa e filtro grande: o BESO parava em 150 iterações acima do volume-alvo, porque a taxa de evolução, reduzida após cada reversão por desconexão, nunca se recuperava. Correções:
- taxa recupera após 6 passos aceitos; reversões não consomem o orçamento de iterações (teto de 100);
- **proteção de conectividade:** a remoção não pode isolar carga dos apoios (o menor número de elementos de maior α é devolvido); ligação só por **aresta** (contato por canto é rótula);
- material sem ligação com os apoios é tratado como vazio na análise;
- flexibilidade calculada como ½·fᵀu (imune a corpos rígidos flutuantes).

### 4.6 CSFM linear (primeira versão)
Campo elástico do domínio cheio → zonas tracionadas (σ1 acima de 5% da tração máxima robusta) → força do tirante pela resultante em cortes perpendiculares à tração → `As = T/fyd` (fyk 500 MPa, γs 1,15). Na viga-parede do exemplo: T ≈ 595 kN, As ≈ 13,7 cm² (ordem de grandeza compatível com M/z).

### 4.7 Documentação e repositório
Artigo Lu et al. (2025) registrado em `docs/referencias.md`; decisões do CSFM em `docs/csfm-guia.md`. Repositório privado `caio-io/otimizacao-topologica`, branches `dev` e `main` no mesmo commit.
Modelos adicionais em desenvolvimento interno ficam em arquivos `*.local.*` (ignorados pelo git; a interface os carrega se existirem).

### 4.8 Nível 2 (análise não linear estilo CSFM): o que foi tentado, inclusive o que não funcionou

Detalhes, tabelas e números em `docs/csfm-roteiro.md`. Resumo:

- **Funciona:** solver não linear (concreto sem tração, fissura girante, parábola-retângulo, barras embutidas, Newton com busca linear, passo adaptativo), critério de esmagamento por média numa janela física (lc = espessura, como o livro do CSFM, p. 18/104/137), aços CA-50/CA-60, interface (vistas de deformação, fissuração, tensões, barras e dica do mouse). S1 (cabeça de pilar): 539–615 kN por apoio contra 556 kN do ensaio e 568–629 kN do CSFM do livro.
- **Defeito corrigido:** o "não convergiu" do S1 alinhado em 20 mm (389 kN) era artefato do controle de passo (passo preso em 0,0002 + teto de 2000 passos), não divergência física. Agora o passo volta a crescer, o 1º passo tem 4× mais iterações e há aviso do teto de passos.
- **Problema em aberto:** a carga do S1 cai ≈ 12 % ao refinar de 40 para 20 mm (o livro relata < 5 %). Hipóteses **testadas e que NÃO explicam** a dependência: geometria alinhada ao elemento; janela de esmagamento (tamanho e normalização); placas de apoio elásticas (opção `plates`: elevam a carga 10–14 %, mas a queda 40→20 mm sobe para 16 %; a espessura da placa muda junto com a malha, ressalva); tension stiffening simplificado (opção `tensionStiffening`: < 2 %, em linha com o livro, p. 140); rigidez residual do concreto; tangente × secante.
- **Tentado e não funciona:** QM6 no solver não linear (opção `element: "qm6"`, experimental): passa na compressão uniaxial, mas diverge no S1 fissurado desde o 1º passo. Hipótese não testada: mecanismos sem energia dos modos incompatíveis com tração nula. Alternativas: EAS, limitar os modos nos elementos fissurados.
- **Ainda não testado:** equivalência entre a malha do livro (10 e 20 elementos na seção A-A; a legenda da Fig. 6.24 diz 4 e 8) e a nossa (40 e 20 mm).
- **Pendente:** nó de pórtico (não converge, fora da lista de exemplos); kc2 (fórmula não encontrada nas fontes lidas); εud = 10 ‰ da NBR como padrão de projeto; perfis normativos (NBR → EC2 → ACI → fib); módulo de bielas e tirantes manual (estilo CAST); extensão 3D (prompt de pesquisa em preparação, fora do repositório).

## 5. Fontes (`src/` e `src2/`)

| Fonte | Uso no projeto | Lida a fundo? |
|---|---|---|
| Borges (2022, UFRGS) — BESO para STM (`src/001143839.pdf`; cópia idêntica em `src2/`) | BESO, largura de biela, exemplos (viga alta de Goodchild) | sim, trechos de método e exemplos |
| Xia, Langelaar & Hendriks (2020) | avaliação de TO para STM; extração de treliça; índices STS/TRS/SR | trechos |
| Pantoja et al. (CBC 2010; CILAMCE 2010) | viga-parede do ACI 318; confiabilidade | parcial (geometria ilegível na extração) |
| Queiroz & Leonel (Téchne 119, 2025) | SIMP/T3; exemplos de viga com abertura e pilar com consolo | sim |
| Bruggi (2009); Liang, Xie & Steven (2000); Amir (2013); Guest & Moen (2010); Jewett & Carstensen (2019); Luo (2012); Pastore (2019); Brito (UFS 2026, *ground structure*) | contexto e benchmarks de TO para concreto | **não** (só resumo/primeira página; 8 de 12 de `src2/`) |
| Almeida (USP 2015); cap. Atena (2019) | didático | parcial |
| Lu, Fairclough, He & Gilbert (2025), SMO 68:142 | treliça + contínuo por análise limite (família do CSFM) | resumo e introdução |
| IDEA StatiCa, *CSFM explained* | guia conceitual do CSFM | resumo da página |

Referências citadas de memória em `docs/referencias.md` (Schlaich, Vecchio & Collins, Kaufmann/Mata-Falcón etc.) **precisam ser confirmadas** antes de uso em material público.

## 6. Limitações conhecidas

**Escopo e validade**
- Só 2D, estado plano de tensão, material elástico linear; só vigas-parede (preset). Sem extração de STM, sem verificação de nós/bielas/tirantes, sem ELS.
- **Nenhum resultado foi comparado com a literatura.** Os exemplos públicos não reproduzem os dos artigos (geometrias, cargas, volumes e espessuras diferentes).
- **CSFM linear não é CSFM:** sem concreto sem tração com redução de resistência por deformação transversal, sem enrijecimento à tração, sem armadura 1D, sem fissuração. É estimativa para orientar.
- **Largura de biela:** usa a maior **reação de apoio** como proxy de `F`; Borges usa a força na biela do STM, maior que a reação (2484 kN vs 1794 kN no exemplo dele), logo a largura é subestimada. k = 1,0 é o caso menos conservador (0,6 para biela sem armadura transversal daria ~1,7× mais). A calibração `rmin ≈ a/h` foi medida em 3 raios no BESO da viga-parede a 35% e é empírica.
- Limiar de zona tracionada (5%) e γs/fyk são padrões não calibrados.

**Numéricos**
- Malha regular com máscara: geometria inclinada/curva fica serrilhada; o tamanho do elemento deve dividir bem as dimensões (a malha usa `round`).
- Solver em banda: custo ∝ N·bw², com numeração pela altura (`bw = 2·nely+5`); malhas com `nely` grande ficam lentas, mesmo abaixo de 20 000 elementos. Cada solve aloca N·bw doubles.
- BESO ainda apresenta **picos isolados de flexibilidade** (trechos esbeltos de um elemento de largura); a heurística de reversão (`c > 1,5·c_bom`) é empírica.
- Cargas pontuais geram pico de tensão no nó (singularidade); o campo de tensões perto de cargas e apoios é pouco confiável.
- Distribuição da carga em nós: pontas com meio peso (consistente), mas a seleção usa distância ao segmento, não integração de forma.

**Interface/engenharia**
- `main.ts` (≈ 820 linhas) concentra tudo; sem testes de UI nem do worker.
- Cada quadro do histórico guarda ρ, u e três campos; ~150 quadros de malhas de 20 000 elementos podem passar de centenas de MB.
- Verificação visual feita só no navegador embutido, em fluxos básicos (elástico, CSFM, troca pontual/distribuída); não há teste em outros navegadores nem em telas pequenas.
- Mover cargas distribuídas funciona ao longo de um lado; vértices e geometria complexa pouco testados.

## 7. Intervenções necessárias (dependem de uma pessoa)

1. **Decisões de produto/engenharia**
   - Adotar **uma** abordagem de biela: (a) largura mínima de projeto [implementada, parcial], (b) BESO em duas fases como Borges (concreto + aço, critério de Ottosen, fração só do concreto), (c) apenas verificações de nó CCC/CCT/CTT.
   - Definir k padrão da biela e o tratamento de `F` (reação vs força do STM).
   - Itens pagos, licença do núcleo (MIT proposta), idioma — ver `ARCHITECTURE.md` §10.
2. **Validação técnica (engenheiro responsável):** reproduzir os exemplos de Borges (viga alta de Goodchild, 7.1), Xia (viga 2 × 2 m, 1000 kN, E = 30 GPa, t = 0,1 m) e Téchne; revisar a conta de T/As do CSFM linear contra um modelo de bielas e tirantes.
3. **Leitura de fontes:** livro ETH 2020 (*Compatible Stress Field Design of Structural Concrete*) e a página "Theoretical Background" da IDEA para o CSFM completo; formulações do artigo de Lu et al.; os 8 artigos de `src2/` só catalogados; confirmar as referências "de memória".
4. **Dados faltantes:** geometria exata do exemplo de Pantoja (texto ilegível na extração, verificar o PDF); parâmetros ER/AR dos exemplos de Borges para comparação.
5. **Repositório:** é **privado**; o histórico de `dev`/`main` contém commits de modelos internos (decisão: deixar como está). Arquivos `*.local.*` existem só na máquina de origem — fazer backup se importarem.
6. **Ambiente:** ter Node ≥ 20; `npm install` na raiz; testes levam ~2,5 min.

## 8. Próximos passos sugeridos (ordem)

1. **Benchmarks de aceite** como testes de regressão automáticos (Xia, Borges 7.1, Téchne): topologia qualitativa, volume e flexibilidade na mesma ordem.
2. **Verificação de nós e bielas** (CCC/CCT/CTT, `0,85·(1−fck/250)`, `0,75·…`, `0,60·…`) sobre o resultado, e tomar a decisão de biela acima.
3. **Proteção de conectividade de segunda ordem no BESO:** evitar trechos esbeltos de um elemento (largura mínima morfológica) e eliminar os picos restantes; medir largura real das barras e substituir a calibração empírica.
4. **Extração do STM** (estágio 5): esqueletização → grafo → forças nos membros (STS/TRS/SR de Xia); alternativa: *ground structure* / combinação truss+contínuo (Brito 2026; Lu et al. 2025).
5. **CSFM completo:** concreto sem tração com redução por deformação transversal, enrijecimento à tração, armadura como elementos 1D, ELS (w ≤ wlim). Depende da leitura do livro ETH.
6. **Desempenho:** numeração pela menor dimensão, reaproveitar memória do solver, depois multigrid/WASM; limitar histórico de quadros.
7. **Qualidade:** dividir `main.ts`, testes do worker e de UI, permalink e exportação (PNG/JSON), relatório.

## 9. Como rodar

```powershell
npm install
npm run dev        # http://localhost:5173
npm run typecheck
npm test           # ≈ 2,5 min
npm run build      # apps/web/dist
```
