# Referências

## Já no repositório (`src/`) — lidas
| Arquivo | Conteúdo | Uso no projeto |
|---|---|---|
| `001143839.pdf` | Borges (2022), UFRGS — Otimização topológica para STM em concreto armado, **BESO** (135 p.) | Método alternativo (M4), benchmarks |
| `Pantoja-CBC-2010.pdf` | Pantoja, Vaz, Martha, Santos — STM via otimização topológica + **confiabilidade** (CBC 2010) | Viga-parede de referência; ideia de análise de confiabilidade (futuro) |
| `Pesquisa e Desenvolvimento_estruturas_119.pdf` | Queiroz & Leonel (Téchne 119, 2025) — **SIMP**, T3, pilar com consolo e viga-parede com abertura | Benchmarks do M0/M1; redução de consumo de aço |
| `Otimizacao_Topologica_2015.pdf` | Almeida (USP, 2015) — slides: otimização, TO, aplicação a STM | Didático / modo aula |
| `cap11_…pdf` | Cap. Atena Editora (2019) — regiões D, STM e TO, MEF, normas | Contexto normativo; topologias simplificadas (≈20% do volume) |

## A buscar (citadas de memória — **confirmar** antes de usar)
- Bendsøe & Sigmund, *Topology Optimization: Theory, Methods and Applications* (Springer).
- Sigmund (2001), "A 99 line topology optimization code written in Matlab"; Andreassen et al. (2011), "Efficient topology optimization in MATLAB using 88 lines" — base do núcleo atual (Q4, filtro, OC).
- Schlaich, Schäfer & Jennewein (1987), "Toward a consistent design of structural concrete" (PCI J.).
- Liang, Xie & Steven (2000), ESO/BESO para STM.
- Vecchio & Collins (1986), Modified Compression Field Theory.
- Muttoni, Schwartz & Thürlimann, *Design of Concrete Structures with Stress Fields*; Fernández Ruiz & Muttoni — stress fields e eficiência de bielas.
- Kaufmann, Mata-Falcón et al. — Compatible Stress Field Method (ETH Zürich).
- Stoiber & Kromoser (2021) — revisão de TO em concreto (citada em Queiroz & Leonel).
- Normas: ABNT NBR 6118 (item de regiões D / modelos de bielas e tirantes), Eurocode 2 §6.5, ACI 318 (Cap. 23).

## Teoria de campos de tensão — fontes localizadas (busca na web, nov/2026)
- **CSFM** — *Compatible Stress Field Design of Structural Concrete* (ETH Zürich, 2020, 158 p.; Kaufmann, Mata-Falcón et al.). Descrição do livro: https://www.ideastatica.com/support-center/support-center-knowledge-base/csfm-book-compatible-stress-field-design-of-structural-concrete (página promocional; validação é autodeclarada).
- **MCFT** — Vecchio & Collins (1986), ACI Journal 83(2), 219–231. Cópia hospedada pela U. Toronto, citada na Wikipédia: civ.utoronto.ca/vector/journal_publications/jp2.pdf (disponibilidade não confirmada). Versão simplificada: Bentz, Vecchio & Collins (2006).
- **Limit analysis** — Nielsen & Hoang, *Limit Analysis and Concrete Plasticity* (livro; **não** localizado na busca — conferir edição).

## Benchmarks experimentais (vigas-parede, STM)
- **Tuchscherer, Birrcher & Bayrak** — banco de 868 ensaios de vigas altas (filtrado a 144; +34 ensaios próprios = 178). Relatório TxDOT 0-5253-1: https://utw10109.utweb.utexas.edu/pdfs/0_5253_1.pdf · artigo PCI: https://www.pci.org/PCI_Docs/Publications/PCI%20Journal/2011/Winter/Strut-and-tie%20model%20design%20provisions.pdf
- **ACI-DAfStb** (Todisco, Bayrak, Reineck) — banco para vigas altas com estribos e armadura de alma, comparado a normas.
- **Brown & Bayrak** — 596 ensaios com a/d < 2.
Uso: comparar a força/armadura do STM extraído com a carga de ruptura medida (benchmark *de verificação*, M3).

## Benchmarks de otimização topológica para STM
- **Bruggi (2009)**, "Generating strut-and-tie patterns for reinforced concrete structures using topology optimization", *Computers & Structures* 87, p. 1483 — SIMP; inclui 3D. Texto completo é restrito (polimi.it/handle/11311/982211 → só metadados).
- Os exemplos dos próprios PDFs em `src/` (Borges 2022; Pantoja 2010; Queiroz & Leonel 2025) são o benchmark inicial: viga-parede, consolo, viga com abertura.
- Benchmarks de **coerência interna** já automatizados em `packages/core/test`: viga em balanço vs. Euler-Bernoulli; reações = cargas; momento da seção central = ∫σx·y dA; ordem de grandeza das tensões.
