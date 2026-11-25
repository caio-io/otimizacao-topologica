# CSFM como guia de desenvolvimento

Fonte: IDEA StatiCa, *CSFM explained* (Kaláb) — https://www.ideastatica.com/support-center/support-center-knowledge-base/csfm-explained
(resumo feito a partir da página; ela **não** traz fórmulas dos modelos de material, limites de deformação, fórmula de abertura de fissura nem algoritmo de dimensionamento — isso está no livro ETH 2020 e na página "Theoretical Background" da IDEA, ainda não lidos).

## O que a página afirma
- STM: despreza a tração do concreto, só ELU; exige verificar tirantes, nós e a deformação transversal das bielas; **não avalia ELS** (deformações, fissuração). A página critica escolher uma geometria e checar só a armadura.
- CSFM: análise **não linear de elementos finitos** em estado plano; concreto 2D (sem resistência à tração), armadura como elementos 1D axiais, fissuras fictícias distribuídas e **girantes**, perpendiculares às tensões principais; carregamento incremental com Newton-Raphson. O resultado é um campo de tensões **compatível e contínuo**, não bielas independentes.
- Concreto: diagrama parábola-retângulo da norma, com **redução da resistência à compressão** em função da deformação de tração transversal; **enrijecimento à tração** pela deformação média da armadura. Aço: modelo da norma.
- Verificações: ELU (tensões/deformações do concreto e utilização da armadura) e **ELS (flechas, limites de tensão e abertura de fissura w ≤ wlim)**.
- Fluxo típico: define-se o detalhamento, verifica-se e aumenta-se a armadura até passar (no exemplo, 0,36 mm > 0,30 mm → mais barras).
- Limites: 2D (estado plano); não serve onde pode haver ruptura frágil sem armadura transversal.
- O campo de tensões pode partir de uma análise **elástica linear** por MEF (exemplo citado pela página).

## O que isso muda no nosso caminho
1. **A otimização topológica deixa de ser obrigatória.** Os parâmetros que você vem ajustando um a um (método, fração de volume, raio do filtro) só existem no ramo "TO → STM". O ramo CSFM parte do campo elástico (que já temos, com reações em equilíbrio) e dimensiona/verifica armadura. Proposta de dois ramos na interface:
   - **A — Campo de tensões (CSFM-like):** MEF elástico → zonas tracionadas → armadura sugerida (As = T/fyd integrando σ nas zonas de tração) → verificações. Sem parâmetros de TO.
   - **B — STM por TO:** o atual, tratado como ferramenta de *concepção*, não de verificação.
2. **Verificação em ELS** (fissuração) passa a ser um objetivo explícito; hoje não existe.
3. **Roteiro de modelo de material** (próximas fases): concreto sem tração + redução por deformação transversal + enrijecimento à tração, em elementos de armadura 1D. Depende de ler o livro ETH/Theoretical Background para as fórmulas.

## Sobre os critérios "em aberto" (método, fração de volume, raio do filtro)
Observação do usuário: cada caso precisa de ajuste minucioso para convergir. Isso é uma propriedade conhecida da TO (e Xia et al., 2020 recomendam filtro e relatam sensibilidade à malha). Para reduzir a dependência do usuário:
- **Raio do filtro em metros**, não em elementos (largura mínima de biela física, ex.: ≥ 2–3 × altura útil de armadura ou ≥ 5 cm), convertendo para elementos conforme a malha.
- **Fração de volume por continuação:** em vez de um valor fixo, reduzir o volume enquanto a flexibilidade não subir além de um limite (ex.: +30%) e parar no "joelho"; mostrar a curva volume × flexibilidade.
- **Painel de convergência/caminho de carga:** para cada força, verificar por busca em largura se há caminho sólido até algum apoio; sinalizar quando a topologia desconecta (evento que já observamos nos consolos); mostrar histórico de flexibilidade e do nº de elementos trocados.
- **Valores padrão calibrados por exemplo** (viga-parede 35–40%; consolos a calibrar) e modo "avançado" para alterar.
