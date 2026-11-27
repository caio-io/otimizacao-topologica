# Regras de Geração de STM e Campo de Tensões — `stm-topopt`

> **Objetivo:** Centralizar em um único documento verificável as regras, equações, critérios de corte e limites aplicados no pipeline **Campo Elástico → Otimização Topológica → Extração STM → Verificação → Análise Não Linear (Nível 2)**.
> **Regra de ouro (ver `AGENTS.md`):** Nenhum coeficiente normativo ou equação empírica é marcado como `VERIFICADO` sem conferência direta em fonte primária local. Itens sem fonte primária local permanecem explicitamente marcados como **`SECUNDÁRIA`** ou **`PROVISÓRIO`**.

---

## 1. Fluxo do Pipeline e Contratos de Dados

```
Cena (m, kN, MPa)
  └─► buildProblem() [scene.ts] ──► Problem (Q4/QM6, mask 0/1/2, fixed, loads)
        ├─► Campo Elástico [fe.ts + stress.ts] ──► PrincipalField (σ1, σ2, θ)
        │     └─► tensionZones() [csfm.ts] ──► estimativa linear de tirantes (As = T/fyd)
        ├─► Otimização Topológica [beso.ts / simp.ts] ──► ρ(x) ∈ [0, 1]
        │     └─► xiaIndices() / steelVolume() [indices.ts] ──► TRS, SR, V_aço
        ├─► Extração & Verificação STM [stm/] ──► StmModel (nós, bielas, tirantes, STS)
        │     └─► stmTiesToBarSpecs() ──► BarSpec[] (para Nível 2)
        └─► Análise Não Linear (Nível 2) [nonlinear.ts] ──► NlResult (P–δ, fissuras, CC/FR)
```

- **Unidades no núcleo físico (`packages/core`):** `m`, `kN`, tensões em `kN/m²`.
- **Conversão explícita nas fronteiras:** `codes.ts` e `concrete.ts` operam em `MPa`; `BarSpec` usa `areaCm2` (`cm²`), `fy`/`ft` (`MPa`) e `Es` (`GPa`).

---

## 2. Regras de Campo de Tensões e Métricas de Topologia

| Regra | Expressão / Critério | Módulo | Fonte & Status |
| :--- | :--- | :--- | :--- |
| **Região tracionada crítica** | $\sigma_1 > 0 \;\land\; \sigma_1 > -5\,\sigma_2$ | `indices.ts` | Xia, Langelaar & Hendriks (2020), §3.2.2 (`src2/xia2020.pdf`, p. 7) — **VERIFICADO (primária)** |
| **Raio de média não local ($r_0$)** | $r_0 = \dfrac{V}{2\,L\,t} = \dfrac{A}{2\,L}$, filtro cônico $\max(0, r_0 - r_{ij})$ | `indices.ts` | Xia et al. (2020), Eqs. (2)–(4) (`src2/xia2020.pdf`, p. 7) — **VERIFICADO (primária)** |
| **Índice TRS** | $\text{SSIM}(\hat{\sigma}_{\text{ori}}, \hat{\sigma}_{\text{TO}})$ com $C_1 = C_2 = 10^{-6}$ | `indices.ts` | Xia et al. (2020), Eq. (6) (`src2/xia2020.pdf`, p. 8) — **VERIFICADO (primária)** |
| **Relação de aço (SR)** | $\text{SR} = \dfrac{1}{V_{\text{ori}}} \int_{\Omega_e} \dfrac{\max(\sigma_1, 0)}{f_y}\,d\Omega_e$ ($f_y = 450\text{ MPa}$) | `indices.ts` | Xia et al. (2020), Eq. (7) (`src2/xia2020.pdf`, p. 8) — **VERIFICADO (primária)** |
| **CSFM linear (`tensionZones`)** | $\sigma_1 > 0{,}05 \cdot \sigma_{1,p98}$; resultante $T = \max_{\text{fatia}} \sum \sigma_u\,h\,t$; $A_s = T / f_{yd}$; descarta zonas $< 0{,}05\,T_{\max}$ | `csfm.ts` | Heurística de pré-dimensionamento (`threshold = 0,05` não calibrado) — **PROVISÓRIO** |
| **Volume de aço (`steelVolume`)** | $\int_{\Omega_e} \frac{\sigma_1}{f_{yd}}\,dV$ por elemento sob critério de Xia | `indices.ts` | Aproximação contínua inspirada em Queiroz & Leonel (2025, Eq. 6); difere da soma $\sum A_s L_{\text{tirante}}$ — **PARCIAL / DOCUMENTADO** |

---

## 3. Regras de Geração de STM (*Ground Structure*)

1. **Nós essenciais obrigatórios:** todo ponto de aplicação de carga (`loads`, centróide de carga distribuída) e todo apoio (`supports`) geram nós fixos/carregados na *Ground Structure*, fundidos apenas dentro da tolerância `mergeDist = max(0.03·min(W, H), 1.5·h)`.
2. **Grade interna e projeções:** além da grade regular (`gridCols × gridRows` com *inset* de borda `eps`), projetam-se coordenadas `x` e `y` dos nós essenciais sobre a grade para permitir tirantes e bielas ortogonais limpos.
3. **Filtro de domínio e aberturas (`isSegmentInSolid`):**
   - Nenhum nó ou barra pode cruzar vazios ou aberturas (`mask === 0` / shapes `cut`).
   - Quando um campo de densidades `ρ(x)` é fornecido, o segmento precisa permanecer na região com `ρ ≥ rhoThreshold` (padrão `0,5`, com vizinhança `3×3` de tolerância em bordas serrilhadas).
   - Barras colineares sobrepostas (com nó intermediário no segmento) são descartadas.
4. **Otimização da treliça (*Fully Stressed Design* — FSD):**
   - Atualização iterativa de áreas $A_e^{(k+1)} = 0{,}3\,A_e^{(k)} + 0{,}7\,|N_e^{(k)}|/\sigma_{\text{ref}}$ com piso $10^{-8} A_{\max}$, equivalente à minimização de $\sum |N_e|\,L_e$ (base conceitual de *Ground Structure* em Brito, 2026, `src/THALYSON_ISSAC_JESUS_BRITO_md/`).
5. **Poda segura e compactação (`compactTruss`):**
   - Testa cortes progressivos `[1e-2, 5e-3, 1e-3, 1e-4, 1e-6, 0] · maxForce`;
   - Remove nós internos de grau 1 e funde nós internos colineares de grau 2;
   - Só aceita a treliça podada cujo resíduo de equilíbrio nodal livre satisfizer **`residual < 1e-6 kN`**.
6. **Índice STS (*Suitable Truss Structure*):**
   - Calculado pelo modelo de viga esbelta de Euler-Bernoulli 2D com seção retangular ($b = t$, $h_{\text{viga}} = 0{,}01\,t$):
     $$\text{STS} = \frac{1}{n} \sum_{e=1}^{n} \frac{|N_e|}{|N_e| + |V_e|}$$
   - **Fonte:** Xia, Langelaar & Hendriks (2020), §3.2.1, Eq. (1) (`src2/xia2020.pdf`, pp. 6–7) — **VERIFICADO (primária)**.

---

## 4. Regras de Verificação Normativa de Bielas, Tirantes e Nós

| Item | Regra Implementada | Fonte & Status |
| :--- | :--- | :--- |
| **Resistência de biela comum ($\sigma_{Rd,\max}$)** | NBR: $(1 - f_{ck}/250)\cdot 0{,}85\,f_{ck}/\gamma_c$; EC2 / MC2010: Tab. 2.1 do CSFM Book; ACI: fallback NBR com aviso | Borges (2022, Eqs. 7.27–7.28) — **SECUNDÁRIA (NBR)** / CSFM Book Tab. 2.1 — **VERIFICADO (EC2/MC2010)** |
| **Fatores nodais (NBR 6118:2014 item 22.3.2)** | $f_{cd1} = 0{,}85\,\alpha_{v2}\,f_{cd}$ (CCC), $f_{cd2} = 0{,}60\,\alpha_{v2}\,f_{cd}$ (CTT/TTT), $f_{cd3} = 0{,}72\,\alpha_{v2}\,f_{cd}$ (CCT), $\alpha_{v2} = 1 - f_{ck}/250$ | Borges (2022, §2.4, Eqs. 2.4–2.7) — **SECUNDÁRIA** (texto da NBR 6118:2023 não disponível localmente) |
| **Ângulo mínimo biela–tirante** | NBR 6118: $29{,}7^\circ$ ($\tan\theta \in [0{,}57; 2{,}0]$); ACI 318: $25^\circ$ | Borges (2022, §2.4) — **SECUNDÁRIA**; CSFM Book p. 14 — **SECUNDÁRIA** |
| **Armadura do tirante ($A_{s,\text{req}}$)** | $A_{s,\text{req}} = N / f_{yd}$ com $f_{yd} = \phi \cdot f_{yk}/\gamma_s$ | Queiroz & Leonel (2025, Eq. 6); Borges (2022, Eq. 2.9) — **VERIFICADO** |
| **Contorno de biela em garrafa (`geometry.ts`)** | Largura no nó $w_{\text{req}}$; no trecho central espraia até $\min(w_{\text{avail}}, w_{\text{req}} + 2\,d_{\text{bottle}})$ limitada a espraiamento $1:2$ ($26{,}6^\circ$) | Espraiamento $1:2$ para visualização estilo CAST — **PROVISÓRIO** (aguarda conferência literal em Schlaich / MC2010) |
| **Camadas paralelas de armadura** | Afastamento eixo-a-eixo padrão $\Delta = \max(\varnothing, 0{,}02\text{ m}) + \varnothing$ (equivalente a vão livre $\max(\varnothing, 20\text{ mm})$) | Critério construtivo usual — **PROVISÓRIO** (aguarda conferência literal na NBR 6118 §18.3.2.2) |
| **Raio mínimo de dobramento** | Valor padrão editável ($5\varnothing$ ou $7\varnothing$ conforme bitola) | **PROVISÓRIO** (aguarda conferência na NBR 6118) |
| **Cordoalha não aderente (Fase B1)** | Cabo sem aderência local: deformação média $\bar{\varepsilon}_p = \Delta L / L_0$, pré-deformação inicial $\varepsilon_{p0} = P_0/(A_p E_p)$, sem perdas por atrito/cunha/relaxação | Formulação cinemática de cabo não aderente — **PROVISÓRIO (Fase B1)** |
