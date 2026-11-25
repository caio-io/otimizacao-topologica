# STM-TopOpt — Otimização topológica para regiões D de concreto

Ferramenta web (protótipo educacional) que, dada uma região D de concreto — por enquanto viga-parede — calcula pelo
Método dos Elementos Finitos (estado plano de tensão) onde o material realmente trabalha, usando **BESO** ou **SIMP**,
e mostra o campo de tensões principais (trajetórias de tração e compressão), as reações de apoio e a deformada.

> ⚠️ **Protótipo para estudo.** Os resultados ainda não foram calibrados contra a literatura e não substituem o projeto
> de um engenheiro responsável. A extração automática do modelo de bielas e tirantes **não** faz parte desta versão.

## Roda no navegador?

O **cálculo roda inteiramente no navegador** (em um Web Worker): nenhum dado sai do seu computador. Para abrir a
ferramenta é preciso, uma vez, ter o [Node.js](https://nodejs.org) (versão 20 ou superior) para instalar e servir a página:

```powershell
npm install
npm run dev
```

Abra o endereço que o terminal mostrar (normalmente <http://localhost:5173>). Para gerar arquivos estáticos que podem ser
hospedados em qualquer servidor web (não funciona abrindo o `index.html` direto do disco):

```powershell
npm run build      # saída em apps/web/dist
npm test           # testes do núcleo de cálculo
```

## Mini manual

1. **Escolha um exemplo** em *Exemplo*: *Viga-parede* (3,0 × 1,5 m, carga de 1000 kN no topo) ou *Viga-parede com abertura*.
2. **(Opcional) Pré-análise:** clique em **Campo elástico (sem otimizar)**. Mostra, na hora, as trajetórias de tensão do
   domínio cheio. Vermelho = tração (onde ficam os tirantes), azul = compressão (onde ficam as bielas).
3. **Otimize:** clique em **Otimizar**. O BESO remove material pouco solicitado até atingir a *fração de volume*. Acompanhe
   a evolução; **Parar** interrompe. O controle *Iteração (histórico)* permite voltar a qualquer passo.
4. **Visualização:** *Topologia + trajetórias*, *Deformada (MEF)*, *Mapa σ1 (tração)* ou *Mapa σ2 (compressão)*; é possível
   mostrar a malha de elementos finitos.
5. **Reações de apoio** aparecem na tela e na barra lateral, com o resíduo de equilíbrio (deve ser ≈ 0).

### Editando geometria, apoios e forças

| Ação | Como |
|---|---|
| Material | Ferramentas **Retângulo** / **Polígono** (arraste, ou clique vértices; duplo clique/Enter fecha) |
| Abertura | **Abertura** / **Abertura poligonal**; pode haver várias |
| Força | Ferramenta **Força** e clique sobre um **lado** da geometria (as linhas pontilhadas azuis mostram onde é possível). Edite Fx e Fy (kN) ou digite x,y (o ponto é projetado no lado mais próximo) |
| Apoio | Ferramenta **Apoio**; arraste ao longo de um lado (ou clique num ponto do lado para apoio pontual). Tipos: *fixo* (restringe ux e uy), *móvel desliza em x* (só uy), *móvel desliza em y* (só ux) |
| Mover | **Selecionar/mover**: arraste. Forças e apoios que estão sobre os lados da geometria acompanham o movimento |
| Excluir | Selecione e pressione **Delete** |
| Navegar | Roda do mouse: zoom · botão direito arrastando: deslocar · **Ajustar vista** |
| Travar | **Travar geometria principal** impede mover/alterar o material; aberturas, forças e apoios continuam livres |
| Limpar | **Limpar resultados** apaga só os resultados; **Limpar tudo** apaga também geometria, apoios e forças |

Regras: **forças e apoios só podem ficar sobre os lados (contorno) da geometria** (grip obrigatório; ao longo do lado o ponto encaixa no tamanho do elemento); a **largura da placa de
aplicação** é única para todas as forças; é preciso ao menos 3 vínculos que impeçam o corpo rígido, ao menos uma força e
um apoio em cada direção da resultante — o programa avisa o que falta antes de calcular.

### Parâmetros (passe o mouse sobre cada um para ver a dica)

- **Método** — BESO (padrão): remove/devolve elementos; resultado preto-e-branco, parecido com uma treliça. SIMP: densidades contínuas, mais suave.
- **Fração de volume** — quanto do material original deve restar (0,35 = 35%).
- **Raio do filtro** — distância, em elementos, em que vizinhos se influenciam; define a espessura mínima das barras e evita o padrão em xadrez.
- **Tamanho do elemento** — lado do elemento finito (resolução da malha). Menor = mais detalhe e mais lento (limite de 40 000 elementos).

## Estrutura

```
packages/core   @stm/core — cálculo (TypeScript puro): MEF Q4, BESO, SIMP, tensões, reações, cena editável
apps/web        interface (Vite + Web Worker)
docs            referências e notas
ARCHITECTURE.md arquitetura e roteiro
```

Unidades: m e kN. Forças positivas para a direita/para cima (carga para baixo = Fy negativo).
