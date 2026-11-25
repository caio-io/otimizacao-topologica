# STM-TopOpt — Arquitetura

> **Estado desta versão:** só viga-parede e viga-parede com abertura; a extração do STM (estágios 5–7) está em desenvolvimento e **não** está incluída. Veja o README para uso.

Ferramenta web de **otimização topológica para regiões D** de concreto armado: gera modelos de bielas e tirantes (STM), mostra campos de tensão e verifica nós/bielas/tirantes segundo normas. Pensada como **produto à parte** e, ao mesmo tempo, **feature-isca** (embed/widget) para atrair usuários a outros produtos.

## 1. Princípios

1. **Roda 100% no navegador** (Web Worker; WASM quando precisar). Custo de servidor ≈ 0, privacidade do projeto do usuário, demo instantânea sem cadastro → melhor funil de aquisição.
2. **Núcleo desacoplado da UI** (`@stm/core`, TypeScript puro, sem DOM). Serve ao app, ao widget embutível, a testes/CLI e a um futuro backend (Node/Rust) para 3D ou jobs pesados.
3. **Pipeline em estágios com contratos explícitos** — cada estágio pode ser trocado (BESO→SIMP, heurística→MILP) sem tocar nos outros.
4. **Transparência didática**: toda saída mostra "de onde veio" (campo elástico → topologia → treliça → verificação). É isso que diferencia de uma caixa-preta e rende conteúdo/SEO.
5. **Validação contra a literatura** (os artigos em `src/`) é requisito de aceite, não etapa final.

## 2. Pipeline

```
Geometria + apoios + cargas ──► [1] Modelo (Problem)
                                   │
                                   ▼
                     [2] Análise elástica (MEF Q4/T3)
                                   │
                                   ▼
        [3] Otimização topológica  (BESO padrão | SIMP | multi-caso de carga)
                                   │  densidades ρ(x)
                                   ▼
        [4] Campo de tensões (σ1, σ2, trajetórias) ──► visualização
                                   │
                                   ▼
        [5] Extração do STM: esqueletização → grafo → simplificação
                                   │  nós, bielas, tirantes
                                   ▼
        [6] Equilíbrio / forças nos elementos (método dos nós, hiperestática se houver)
                                   │
                                   ▼
        [7] Verificação: nós CCC/CCT/CTT, bielas (garrafa), tirantes → As, ancoragem
                                   │
                                   ▼
        [8] Campo de tensões refinado / verificação não linear (SFM, MCFT)
                                   │
                                   ▼
        [9] Relatório (PDF/DXF/JSON) + link compartilhável
```

| Estágio | Estado | Observação |
|---|---|---|
| 1–4 | **implementado (protótipo)**; cena editável (geometria poligonal, aberturas, apoios, forças com posição/direção/placa) → malha → campo elástico/BESO | `packages/core`: Q4 plano de tensão, **BESO soft-kill (padrão)** e SIMP, PCG matrix-free, tensões principais. 3 presets. App com visualizador MEF (ver §8). |
| 5 | próximo | Maior risco técnico: ver §5. |
| 6–7 | planejado | **Somente NBR 6118** no início (fatores de eficiência de bielas e nós CCC/CCT/CTT, ancoragem). A camada `codes` continua plugável, mas EC2/ACI ficam fora do escopo até haver demanda. |
| 8 | planejado | "Teoria do campo de tensão modificado": ver §6. |
| 9 | planejado | Parte do valor "pago". |

## 3. Estrutura do repositório (monorepo npm workspaces)

```
packages/
  core/          # @stm/core — TS puro: tipos, FE, solver, SIMP/BESO, tensões, (futuro) extração STM, normas
  codes/         # (futuro) @stm/codes — fatores de eficiência e checagens por norma, 1 arquivo por norma
  io/            # (futuro) DXF in/out, JSON do projeto, relatório PDF
apps/
  web/           # app (Vite). Hoje vanilla TS; migrar p/ React + Zustand quando a UI de edição crescer
  embed/         # (futuro) widget <script> / <iframe> p/ blogs, cursos, outros produtos
docs/            # referências, decisões (ADRs)
```

Regras: `core` não importa nada de DOM/Worker; `apps/*` dependem de `core`; `codes` depende só de tipos do `core`.

## 4. Decisões técnicas

- **Linguagem**: TypeScript. Hot path (solver) migra para **Rust→WASM** só após benchmark; o contrato (`Problem`, `IterInfo`) não muda. Medido: PCG-Jacobi precisava de 700–4000 iterações por solve (≈1 ms cada) → ~1,5 s/iteração em 120×60; trocado por **Cholesky em banda** (0,23 s/solve, mesma solução a 1e-15) → BESO completo em ~20 s. Insuficiente ainda para malhas ≥300×200 e 3D. Alavancas, em ordem de custo: (a) multigrid geométrico como pré-condicionador (malha regular favorece), (b) WASM + SIMD, (c) WebGPU (SpMV).
- **Malha regular + máscara** (não malha não estruturada): simples, rápida, filtro trivial, aberturas/chanfros via máscara. Limite: geometria curva/inclinada fica serrilhada → aceitável em regiões D típicas; T3 não estruturado entra se necessário (o artigo de Queiroz & Leonel usa T3).
- **Concorrência**: um Worker por otimização; `simp` é gerador (progresso incremental, cancelamento, retomada). Para multi-caso/estudos paramétricos, pool de workers.
- **Estado do projeto = JSON versionado** (`Problem` + opções). Compartilhar = codificar na URL (hash) ou salvar em storage leve. Habilita permalinks, galeria e SEO.
- **Sem backend no MVP.** Backend só para: contas, salvar projetos, relatórios, 3D/jobs longos, billing.
- **Qualidade**: Vitest no core (patch tests, viga em balanço vs. Euler-Bernoulli, volume/flexibilidade) e testes de regressão com os exemplos dos artigos (§7).
- **Unidades**: SI no core (kN, m); conversão apenas na UI.

## 5. Risco principal: da topologia ao STM

Densidades ρ(x) ≠ treliça. Opções para o estágio 5 (implementar em `core/src/stm/`):

1. **Esqueletização + grafo** (morfologia → afinamento → nós onde grau ≠ 2 → simplificação Douglas-Peucker). Rápido, robusto o bastante p/ 2D. *Recomendado para MVP.*
2. **BESO/ESO com restrição de esbeltez / comprimento mínimo de membro** (Borges 2022; Pantoja et al. 2010 usam variantes com ground-structure/filtros). Gera já algo próximo de uma treliça.
3. **Ground structure + otimização de treliça** (LP/MILP, estilo Michell) alimentada pelo campo elástico. Mais "limpo", mais caro; bom para o modo avançado.
4. **Classificação por sinal** de σ1/σ2: biela onde σ2<0 domina, tirante onde σ1>0; pós-processamento sobre qualquer das opções.

O usuário deve poder **editar o STM resultante** (mover nós, trocar topologia) — o otimizador sugere, o engenheiro decide.

## 6. Teoria de campos de tensão (diferencial técnico)

"Teoria do campo de tensão modificado" pode significar duas coisas; o plano cobre ambas, em fases:

- **Fase A — Campo elástico + STM clássico** (Schlaich/Schäfer, Ritter-Mörsch): o que o protótipo já faz.
- **Fase B — Stress Field Method / CSFM** (campos de tensão estaticamente admissíveis, teorema do limite inferior, com compatibilidade de deformações — linha Muttoni, Fernández Ruiz, Kaufmann, Mata-Falcón): verificação de resistência e ductilidade sobre o STM extraído. Implementação: painéis/elementos de campo de tensão com armadura distribuída, otimização de LP para a carga de colapso.
- **Fase C — MCFT (Vecchio & Collins)**: análise não linear de painel fissurado (equilíbrio + compatibilidade + relações tensão-deformação do concreto fissurado com *tension stiffening* e amolecimento por compressão). Entra como motor de **verificação** de serviço/ruptura sobre a malha — não como otimizador.

> ⚠️ Referências além dos 5 PDFs são citadas de memória; confirmar título/ano antes de citar em material público (ver `docs/referencias.md`).

## 7. Validação (aceite)

Reproduzir e comparar com os PDFs em `src/`:
- Viga-parede e consolo — Borges (2022, UFRGS, BESO) e Pantoja et al. (CBC 2010).
- Viga-parede / pilar com consolo / abertura — Queiroz & Leonel (Téchne 119, 2025, SIMP).
- Fundamentos e exemplos — Almeida (USP, 2015) e capítulo Atena (2019).
Critérios: topologia qualitativamente equivalente, razão de volume e flexibilidade na mesma ordem, e o STM extraído em equilíbrio (resíduo < 1e-6).

## 8. Produto e crescimento

**Decisões tomadas:** só norma brasileira (NBR 6118) no início · BESO como método padrão · camada gratuita centrada no **visualizador MEF**.

- **Gancho**: "desenhe sua região D → veja as bielas e tirantes em 30 s". Sem login.
- **Visualizador (gratuito, o coração do funil)**: mostra o cálculo *rodando*, como um pós-processador de MEF — topologia por iteração, **malha de elementos finitos**, **deformada**, mapas de σ1 (tração) e σ2 (compressão), trajetórias de tensão e **histórico navegável por iteração** (slider). Já implementado no protótipo. Transparência = confiança + conteúdo didático.
- **Galeria de exemplos canônicos** (consolo, viga-parede, dente Gerber, bloco sobre estacas, viga com abertura, nó de pórtico) com URL própria → SEO.
- **Modo aula**: reprodução da evolução, passo-a-passo do STM. Público: estudantes e professores.
- **Embed/widget**: o mesmo core em `<iframe>` para blogs, cursos e outros produtos.
- **Gratuito vs. pago**: gratuito = 2D, visualizador completo, exemplos, exportar imagem, link. Pago (a definir, não decidido) = memória de cálculo NBR em PDF, DXF, múltiplos casos de carga, salvar projetos, 3D.
- **Núcleo aberto (MIT)** como credibilidade acadêmica; produto = UX, normas, relatórios.
- **Aviso legal** visível: ferramenta de apoio; responsabilidade técnica do engenheiro.

## 9. Roadmap

| Marco | Entrega |
|---|---|
| M0 ✔ | Core BESO/SIMP 2D + app com presets, visualizador MEF e histórico |
| M1 | Editor de geometria (retângulos/polígonos/aberturas), apoios e cargas desenhados; permalink; exportar PNG/JSON |
| M2 | Extração STM (esqueleto→grafo), forças nos membros, classificação biela/tirante |
| M3 | Verificação NBR 6118 (bielas, nós, tirantes), cálculo de As, memória em PDF |
| M4 | BESO refinado (ER/AR adaptativos, filtro nodal), multi-caso de carga, benchmarks vs. Borges 2022 |
| M5 | Performance: multigrid / WASM; malhas 300×200 em tempo interativo |
| M6 | Campo de tensão compatível (CSFM) / MCFT como verificação |
| M7 | 3D (blocos sobre estacas) — provavelmente backend |

## 10. Decisões em aberto

1. Quais itens pagos entram primeiro (memória PDF vs. DXF vs. salvar projetos)?
2. Idioma: pt-BR fixo por ora; i18n só se houver demanda.
3. Licença do núcleo (MIT proposta).
4. Performance: banda Cholesky escala como N·bw² (≈ nely³·nelx). Para malhas maiores: multigrid geométrico (PCG precondicionado) ou WASM.
