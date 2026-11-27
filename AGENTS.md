# AGENTS.md — Regras e Contexto do Projeto `otimizacao-topologica` (STM-TopOpt)

> Fonte única de instruções para **Antigravity** e **Claude Code** (`CLAUDE.md` aponta diretamente para `@AGENTS.md`).

---

## 1. Visão Geral e Arquitetura

Ferramenta web 100% client-side (sem backend) para **otimização topológica (BESO / SIMP)**, **campo elástico / CSFM linear** e **análise não linear 2D estilo CSFM (Nível 2)** de regiões D de concreto armado.

- **Monorepo (npm workspaces):**
  - `packages/core` (`@stm/core`): TypeScript `strict` puro, **sem DOM e sem Worker**.
  - `apps/web` (`@stm/web`): Vite 6 + TypeScript puro + Canvas 2D + Web Worker (`worker.ts`).
- **Testes:** Vitest 2.1 (`packages/core/test`).

### Mapa de módulos principais

- `packages/core/src/`:
  - `types.ts` — contratos `Problem`, `SimpOptions`, `BesoOptions`, `IterInfo`, `PrincipalField`.
  - `fe.ts` — elementos Q4 e QM6 (padrão linear), montagem, solver direto Cholesky em banda (`solveBanded` / `solveBandedAssembled`), `solvePCG` (comparação/teste), `supportReactions`.
  - `simp.ts` / `beso.ts` — otimizadores como geradores (BESO soft-kill com proteção de conectividade por aresta).
  - `stress.ts` — tensões principais no centro de cada elemento.
  - `concrete.ts` — `fck`, `GAMMA_C`, `sigmaRdMax`, `strutWidth`, `filterRadiusForWidth` (Borges, 2022).
  - `codes.ts` — perfis normativos como dados (`NBR6118`, `EC2`, `MC2010`, `ACI318`), rastreabilidade de fonte (`true` = primária, `"sec"` = secundária, `false` = provisório), `fcdOfCode`, `strutDesignStrength`.
  - `csfm.ts` — estimativa linear de zonas tracionadas (`tensionZones`).
  - `indices.ts` — índices `TRS` e `SR` (Xia et al., 2020) e estimativa `steelVolume` (Queiroz & Leonel, 2025).
  - `nonlinear.ts` — solver não linear Nível 2 (concreto sem tração com fissura girante, parábola-retângulo, barras embutidas ou de treliça com aderência perfeita, critério de esmagamento por janela física `crushLength`, `STEEL_CLASSES`, `kc2Provisional`, `withTensionStiffening`).
  - `scene.ts` — cena editável (`Scene`, `BarSpec`, `NlParams`) → rasterização `buildProblem` + validações de equilíbrio/conectividade (`MAX_ELEMENTS = 20000`).
  - `rebar.ts` — armadura inteligente acompanhando faces da geometria (reta, L, U).
  - `presets.ts` — presets públicos (viga-parede, viga-parede com abertura, cabeça de pilar S1, nó de pórtico ilustrativo).
- `apps/web/src/`:
  - `main.ts` — editor, canvas, abas (`Modelo`, `Otimização`, `Nível 2`, `Normas`), persistência em `localStorage`.
  - `worker.ts` — execução assíncrona com tokens de cancelamento (`elastic`, `opt`, `nl`).

---

## 2. Convenções de Unidades, Eixos e Contratos

- **Core físico (`Problem`, `fe.ts`, `stress.ts`, `nonlinear.ts`):** **SI (`m` e `kN`; tensões em `kN/m²`)**.
  - Origem da cena no canto inferior esquerdo, `y` para cima; na malha regular, coluna `i` cresce para a direita e linha `j` cresce **para baixo**.
  - GDLs do nó `id = i*(nely+1)+j`: `2*id` (`ux`, positivo para a direita) e `2*id+1` (`uy`, positivo para cima ⇒ carga gravitacional tem `fy < 0`).
  - `mask`: `0` = vazio, `1` = domínio de projeto, `2` = sólido passivo.
- **Fronteiras de unidades (ATENÇÃO em qualquer edição):**
  - `concrete.ts` e `codes.ts`: resistências `fck`, `fcd`, `sigmaRdMax` em **MPa** (conversão `× 1000` para `kN/m²` onde entra em forças/tensões).
  - `STEEL_CLASSES` (`nonlinear.ts`) e `BarSpec` (`scene.ts`): `fy` e `ft` em **MPa**, `Es` em **GPa**, `areaCm2` em **cm²**, `epsU` adimensional (fração).
  - `barsFromScene()` (`nonlinear.ts`): converte para o solver com `area = areaCm2 * 1e-4` (`m²`), `fy * 1e3` (`kN/m²`), `ft * 1e3` (`kN/m²`) e `Es * 1e6` (`kN/m²`).
  - `indices.ts` (`steelVolume`): retorna volume em **cm³** (`m³ × 1e6`) com `fyd` em `kN/m²`.

---

## 3. Regras Inegociáveis de Engenharia e Fluxo de Trabalho

1. **Conferência obrigatória em fonte primária:**
   - **Nunca** validar, alterar ou gravar coeficientes normativos, equações empíricas ou citações bibliográficas pela memória.
   - Sempre consultar o PDF/documento original antes de registrar como verificado (`fields[k] = true`). Se não houver fonte primária local, manter explicitamente marcado como `"sec"` (fonte secundária) ou `false` (PROVISÓRIO) no código e na interface.
2. **Regra do livro do CSFM (Kaufmann et al., 2020):**
   - Arquivo local (fora do repositório): `C:\Users\caioa\.claude\uploads\2af4e3e0-c4fe-41d1-b84d-6a3159dbc1d3\a8cd592d-CSFM_book_2020.pdf`.
   - **Paginação:** `página impressa = página do PDF − 8` (ex.: Caso S1, Seção 6.5 = p. 135–141 impressas = p. 143–149 do PDF).
3. **Revisão crítica de pareceres e auditorias externas:**
   - Toda auditoria, sugestão ou relatório externo **deve ser conferido linha a linha contra o código-fonte real e testes/medições** antes de aplicar mudanças. Separar bugs reais de falsos positivos, desatualizações de versão ou divergências de escopo.
4. **Separação entre núcleo e interface:**
   - Nunca importar APIs de navegador/DOM/Worker em `packages/core`.
5. **Higiene do repositório e arquivos locais:**
   - Arquivos `*.local.*` (`presets.local.ts`, `consolos.local.test.ts`), PDFs (`src/*.pdf`, `src2/*.pdf`, `src-fib/*.pdf`), `.claude/` e material de planejamento externo (`planejamento-gemini/`) **não devem ser commitados** ao repositório público/privado no GitHub.
6. **Transparência sobre limitações:**
   - Manter explícito na UI e na documentação o caráter de protótipo de estudo e os limites de validade (ex.: Nível 2 sem `kc2` nem tension stiffening ativos por padrão; faixa de incerteza de malha do S1 em Q4 = `539–615 kN` vs. ensaio `556 kN` e CSFM do livro `568–629 kN`).

---

## 4. Fontes Locais Disponíveis vs. Pendentes

| Fonte | Disponibilidade local |
| :--- | :--- |
| Borges (2022, UFRGS) — BESO para STM | Local: `src/001143839.pdf` |
| Queiroz & Leonel (2025, Ed. 119) — SIMP / aberturas | Local: `src/Pesquisa e Desenvolvimento_estruturas_119.pdf` |
| Xia, Langelaar & Hendriks (2020) — TRS/SR/STS | Local: `src2/xia2020.pdf` |
| *fib* Model Code 2010 — Bulletins 56 e 65 | Local: `src-fib/FIBBUL-0056-...pdf` e `src-fib/fib_Bull65_NMG.pdf` |
| Kaufmann et al. (2020) — *CSFM Book* | Local (fora do repo): `C:\Users\caioa\.claude\uploads\...\a8cd592d-CSFM_book_2020.pdf` |
| ABNT NBR 6118:2023, ABNT NBR 7480:2007, EN 1992-1-1 (EC2), ACI 318-14/19 | **Não disponíveis localmente** (manter pendências explícitas em `codes.ts`) |

---

## 5. Decisões Técnicas Consolidadas

- **Comprimento de esmagamento (`crushLength`):** automático = espessura `t` da peça (livro do CSFM, cap. 6, p. 18, 104 e 137), controlável pelo checkbox `"Automático"`.
- **Raio do filtro (`rmin`):** modo automático calcula pela largura mínima da biela da norma ativa (`strutDesignStrength`), recalculado ao alterar modelo, malha, `fck`, espessura ou norma.
- **Fração de volume:** livre para o usuário (nota na UI com faixas da literatura: 40 % Xia, 30–40 % Queiroz & Leonel, 20–80 % IDEA).
- **QM6 no solver não linear:** experimental (`element: "qm6"` diverge no S1 fissurado); o padrão do Nível 2 é `"q4"`.
- **Fora de escopo:** classificação automática de pilar e viga a partir da geometria/apoios (o usuário desenha as barras e escolhe a forma reta/L/U no editor).

---

## 6. Comandos de Desenvolvimento, Build e Testes

```powershell
# Servidor dev (evitar porta 5173, frequentemente ocupada pelo projeto mef-web)
npm run dev -w @stm/web -- --port 5180 --strictPort

# Verificação de tipos (core + web)
npm run typecheck

# Suíte de testes unitários do core (≈ 2 a 2,5 min)
npm test

# Build de produção do app web
npm run build

# Testes de calibração lentos (opt-in, rodar em packages/core)
$env:CALIBRACAO="1"; npx vitest run test/calibracao.s1.test.ts
```

---

## 7. Fluxo de Branches e Colaboração entre Agentes

- Branch principal de desenvolvimento atual: `csfm` (sincronizada com `origin/csfm` e `origin/main`).
- Trabalhos do Antigravity devem ocorrer em branches dedicadas `agy/<escopo>` criadas a partir de `csfm` (ex.: `agy/auditoria`), sem alterar `csfm` diretamente até revisão e merge explícitos.
- Antes de concluir qualquer alteração de código: rodar `npm run typecheck` e `npm test`.
