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

## Fontes adicionadas em `src2/` (nov/2026)
| Arquivo | Conteúdo (conferido pela primeira página/resumo) |
|---|---|
| `xia2020.pdf` | Xia, Langelaar & Hendriks (2020), *Comput.-Aided Civ. Infrastruct. Eng.* — **avaliação crítica de resultados de TO para STM**; propõe extração de treliça (afinamento → nós candidatos → redução → conexões) e 3 índices: **STS** (treliça analisável, equilíbrio axial), **TRS** (cobertura das regiões tracionadas), **SR** (economia de aço). Casos: viga-parede com abertura, consolo, dente Gerber com abertura. |
| `bruggi2009.pdf` | Bruggi (2009), *Comput. Struct.* 87 — SIMP de mínima flexibilidade para STM, 2D e 3D. |
| `amir2013.pdf` | Amir (2013), procedimento de TO para estruturas de concreto armado (material não linear). |
| `Liang_Xie_Steven_ACI_...pdf` | Liang, Xie & Steven (2000), *ACI Struct. J.* 97-S36 — TO evolucionária baseada em desempenho (PBO) para STM. |
| `guest2010.pdf` / `Reinforced_Concrete_Design_with_Topology_Optimizat.pdf` | Guest & Moen (2010) — projeto de concreto armado com TO (mesmo trabalho, duas cópias). |
| `jewett2019.pdf` | Jewett & Carstensen (2019), *Autom. Constr.* 102 — vigas de concreto otimizadas, construção e ensaio. |
| `luo2012.pdf` | Luo et al. (2012), *Engineering Optimization* (conferir título exato). |
| `pastore2019.pdf` | Pastore et al. (2019) — TO com restrição de tensão (fator de risco). |
| `THALYSON_ISSAC_JESUS_BRITO.pdf` | Brito (UFS, fev/2026), dissertação: STM por TO discreta, **ground structure** (95 p.). |
| `Cilamce2010-paper-1332.pdf` | Pantoja, Vaz & Martha (CILAMCE 2010) — critério de confiabilidade para STM. |
| `001143839.pdf` | Borges (2022) — repetido de `src/`. |

### O que a leitura de Xia et al. (2020) já ensina para este projeto
- Eles dizem explicitamente que **a treliça extraída de um resultado de TO contínua normalmente não está em equilíbrio axial puro** e que gerar, no próprio processo de TO, treliças que cumpram o STM é um **problema em aberto**. Isso é o que observamos na extração experimental (resíduo de equilíbrio).
- Ajuste manual dos nós (alinhar às cargas e reações) melhora o índice STS (ex.: 96,8% → 99,8%).
- Recomendam **filtro** contra dependência de malha; critérios por energia de deformação e tensão de von Mises dão resultados parecidos, o de **1ª tensão principal é pior**; ESO, SIMP, isolinhas e homogêneo têm desempenho geral semelhante para STM.
- Casos de teste a reproduzir: viga-parede com abertura (malha 50 mm, SIMP 40% de volume com filtro de sensibilidade), consolo (malha 10 mm) e dente Gerber com abertura.
- Caminho alternativo: **ground structure** (Brito 2026) produz treliças diretamente — candidato a substituir o esqueleto morfológico.

## Adicionado em nov/2026 (fora de `src/` e `src2/`)
- **Lu, Fairclough, He & Gilbert (2025)** — *Combined truss and continuum topology optimization of structures*, Struct. Multidisc. Optim. 68:142, https://doi.org/10.1007/s00158-025-04063-2 (arquivo local: Downloads/s00158-025-04063-2.pdf, 21 p.). Dois passos: identifica regiões de baixa e alta fração de volume; as de baixa recebem **treliça (ground structure)** e as de alta, **elementos contínuos**, ligados por interfaces (um-para-muitos e muitos-para-muitos). Formulação de **análise limite** (cônica, pontos interiores), critério de von Mises, que produz resultados com escalas mistas de comprimento. Cita a linha concreto+armadura (Amir 2013, Gaynor 2013, Jewett & Carstensen 2019) e Xia et al. 2020. Lido: resumo, introdução e estrutura; formulações ainda não lidas em detalhe.
  Relevância: mesma família do CSFM (campos de tensão estaticamente admissíveis); alternativa ao esqueleto morfológico para o estágio 5. Limitação: exige solver de programação cônica, ainda não disponível no navegador. Valida contra: MBB e exemplos clássicos, não vigas-parede de concreto.

## Resumo das 11 fontes (gerado por IA externa) — conferido contra os PDFs
Um resumo das fontes de `src/`, `src2/` e `src-fib/` foi colado pelo usuário (gerado pelo Gemini). Conferi o **conteúdo** das afirmações numéricas contra o texto extraído dos PDFs; **os números de página citados no resumo não foram conferidos**. Use o resumo só como mapa; para implementar, ler a página.

| Fonte | Afirmação conferida | Resultado |
|---|---|---|
| Amir (2013) | cimento ≈ 5 % do CO₂, 900 kg/t; ganho de 22 % (viga-parede), ≈ 32 % (consolo), 20–30 % em geral | ✔ |
| Borges (2022), `001143839.pdf` | EC2: −40 % volume, −41,8 % massa, −72,6 % custo; ACI com abertura: −20 %, −21,5 %, −55,6 % | ✔ (valores encontrados no texto) |
| Queiroz & Leonel (2025), `Pesquisa e Desenvolvimento_estruturas_119.pdf` | 34 % das emissões; aberturas nas posições 2 e 6 elevam o aço em 23,5 % e 26,8 %; posições 4, 7, 8, 9 não elevam | ✔ — Tabela 1: aço 888 cm³ (sem abertura); posições 1 = +11,0 %, 2 = +23,5 %, 3 = +14,7 %, 4/7/8/9 = 0 %, 5 = +0,3 %, 6 = +26,8 % (o resumo omite 1, 3 e 5) |
| Pantoja et al. (2010) | NBR exige fck ≈ 38 MPa contra 24 MPa (ACI); índice de referência JCSS β = 3,8 | ✔ |
| Xia, Langelaar & Hendriks (2020) | 28 resultados (23 de OT + 5 STM manuais); materiais ortotrópicos pior que o elástico isotrópico; STS < 1 | ✔ |
| Brito (2026), `THALYSON_ISSAC_JESUS_BRITO.pdf` | EC = 30 GPa, ET = 200 GPa; Tikhonov; tolerância de equilíbrio 1e-4; resíduos 1e-11 a 1e-12 | ✔ (a tolerância 1e-4 é do resíduo de equilíbrio; o parâmetro de Tikhonov é 1e-12 por padrão) |
| Tavares & Canha (2019), `cap11_…pdf` | Ground Structure, custo nodal (Ln) | ✔ (existência; detalhes não conferidos) |
| Guest & Moen (2010); Almeida (2015) | MMA, HPM, pilar hammerhead; SESO, 109°28′16″, Maupertuis | ✔ (existência) |
| fib MC2010 vol. 1 (Bull. 65) | β alvo 1,5 (ELS), 3,1 (fadiga), 3,8 (ELU); 5 formatos de segurança; C120 e LC80 | ✔ |
| fib MC2010 vol. 2 (Bull. 56) | kc = 1,0 / 0,75 / 0,55; wlim = 0,30 mm (armado, classes de exposição 2–4); θ = 36° nível I | ✔, com **ressalva**: 0,55 é de **bielas** com armadura oblíqua; para **nós** o rascunho dá 1,0·ηfc (sem tirante) e 0,75·ηfc (com tirante), não 0,55 |

**Erros do resumo:** cita `001143839_2.pdf`, arquivo que não existe nas pastas (só há `001143839.pdf`, duplicado em `src/` e `src2/`); a frase sobre os nós atribui 0,55 a nós. **Não conferido:** fatores parciais iguais a 1,0 no ELS (a busca no texto não achou) e todos os números de página. **Não coberto pelo resumo:** Liang/Xie/Steven (2000), Bruggi (2009), Jewett (2019), Luo (2012), Pastore (2019) e Cilamce (2010).

**Útil para a calibração:** a Tabela 1 de Queiroz & Leonel (nove posições de abertura quadrada numa viga-parede, volume final 30 %, aço em cm³) é um caso de comparação direto para a nossa ferramenta (alvo: mesma ordenação das posições). Os dados geométricos da viga-parede não foram extraídos ainda.
