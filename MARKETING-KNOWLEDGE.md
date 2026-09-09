# Marketing Knowledge Layer

Ponto levantado por Patricia em 09/09/2026: sem uma camada explícita de conhecimento de copywriting/narrativa, o Content Decision Engine sabe o quê promover e quando (Brand + Commerce + Customer + Calendar + Competitor Intelligence), mas não como estruturar um argumento persuasivo — e regride pra copy genérica ("Discover our beautiful EVA Black. Shop now!") mesmo com dados excelentes por trás.

Esta camada define **três dimensões separadas** que juntas formam a instrução criativa passada pro Estágio 2 do Decision Engine (ver [ARCHITECTURE.md](ARCHITECTURE.md)):

1. **Creative Archetype** — qual argumento estratégico (a categoria psicológica/persuasiva)
2. **Creative Angle** — qual mensagem específica para aquele produto/momento
3. **Narrative Framework** — como estruturar esse argumento no texto

Esta é uma primeira versão pra Patricia revisar/ajustar. É a peça de expertise de marketing mais importante do produto — vale tratar como documento vivo, não só config técnico.

## Arquétipos criativos

| Arquétipo | O que é | Estágio de funil | Objetivo comercial mais forte |
|---|---|---|---|
| **Educational** | Ensina algo que o cliente não sabia (como combinar, como cuidar do material, ciência do tamanho) | Awareness / Consideration | Engagement, Traffic |
| **Problem/Solution** | Nomeia uma frustração específica, posiciona o produto como resolução | Consideration | Conversion, Traffic |
| **Product Benefit** | Lidera com benefício funcional/emocional concreto, não lista de features | Consideration / Conversion | Conversion |
| **Social Proof** | Reviews, menções de clientes reais, números específicos | Consideration / Conversion | Conversion, Traffic |
| **Lifestyle/Aspiration** | Produto dentro de uma vida/identidade desejada, venda mínima direta | Awareness | Awareness, Engagement |
| **Founder Story** | A criadora por trás do produto, autenticidade | Awareness | Engagement |
| **Behind the Scenes** | Processo, artesania, origem do material | Awareness / Consideration | Engagement |
| **Comparison** | Contraste implícito ou explícito com alternativa (não precisa nomear concorrente — pode ser "vs. salto desconfortável o dia todo") | Consideration | Conversion |
| **Urgency** | Escassez, estoque limitado, promoção acabando | Conversion | Conversion, Inventory |
| **Newness** | Lançamento, "acabou de chegar", primeira olhada | Awareness / Consideration | Awareness, Traffic |
| **UGC-style** | Conteúdo com sensação de gerado por usuário, mesmo sendo produzido pela marca — alta confiança | Consideration | Engagement, Conversion |
| **Objection Handling** | Endereça uma hesitação direta (medo de tamanho, justificativa de preço, política de troca) | Conversion | Conversion |

## Creative Angle — a terceira dimensão (Patricia, 09/09/2026)

Arquétipo, ângulo e framework são três decisões diferentes, não uma. Sem separar isso, dois posts do mesmo produto com o mesmo arquétipo saem parecidos demais, ou o sistema esconde a mensagem específica dentro do "arquétipo" e perde granularidade.

- **Arquétipo** = categoria estratégica (enum fechado, os 12 acima).
- **Ângulo** = a mensagem específica gerada dentro daquele arquétipo, pra aquele produto, naquele momento (texto livre, não enum).
- **Framework** = o esqueleto estrutural que organiza o texto.

Exemplo — mesmo produto (EVA Black), dois posts diferentes:
```
Post A:
  Objective: Move inventory
  Archetype: Product Benefit
  Angle: All-day comfort without sacrificing style
  Framework: Hook → Value → Proof → CTA

Post B (mesmo produto, semana diferente):
  Objective: Move inventory
  Archetype: Comparison
  Angle: Flat comfort vs. spending the day in uncomfortable heels
  Framework: PAS
```
`creative_angle` é gerado pelo Estágio 1 a partir de: a definição do arquétipo escolhido + atributos reais do produto (Commerce Intelligence) + vocabulário/tom da marca (Brand Intelligence). Não vem de uma tabela fixa de ângulos — é a parte mais "criativa" da decisão estruturada, mas ainda assim decidida antes do texto final (Estágio 2), não inventada solta pelo Estágio 2.

## Frameworks narrativos (o esqueleto estrutural)

- **Hook → Value → Proof → CTA** — uso geral, bom default para legenda de Instagram.
- **PAS (Problem → Agitate → Solve)** — combina bem com Problem/Solution e Objection Handling.
- **AIDA (Attention → Interest → Desire → Action)** — combina bem com Lifestyle/Aspiration e Newness.
- **Before/After (transformação)** — combina bem com Product Benefit e Social Proof.

Arquétipo e framework são escolhidos juntos, mas são perguntas diferentes: arquétipo = qual argumento; framework = como esse argumento é sequenciado no texto.

## Como o Estágio 1 escolhe (regra, não aprendizado, na v0)

Sem dados de performance suficientes (cold start, ver [CLAUDE.md](CLAUDE.md)), a escolha não pode ser livre — precisa ser restrita por regra, senão vira loteria de qualidade. Lógica:

1. `commercial_objective` (declarado pelo merchant ou decidido pela IA) + situação do produto via Commerce Intelligence (novo / bestseller / parado / com desconto) + contexto de calendário reduzem a lista de 12 arquétipos a um **shortlist de 2-4 elegíveis**.
2. A chamada de IA do Estágio 1 escolhe um arquétipo dentro desse shortlist (não dos 12 livremente) e o framework compatível.
3. **Regra de anti-repetição**: guardar os últimos N arquétipos usados por loja (ou por produto) e penalizar repetição recente. Mesmo princípio já usado nas regras visuais da Mangará — "duas imagens seguidas não podem parecer a mesma campanha" — aplicado agora à estrutura do texto.

Exemplo de mapeamento inicial (ajustar com uso real):
```
objective = inventory (estoque parado)     → [Urgency, Comparison, Product Benefit, Lifestyle]
objective = conversion + novo lançamento   → [Newness, Social Proof, Lifestyle/Aspiration]
objective = engagement                     → [Behind the Scenes, Founder Story, Educational, UGC-style]
objective = awareness                      → [Lifestyle/Aspiration, Founder Story, Newness]
```

## Content Mix — a semana como portfólio, não posts isolados (Patricia, 09/09/2026)

A regra de anti-repetição acima evita repetir o mesmo arquétipo, mas é uma restrição negativa ("não faça igual ao último"). Falta uma restrição positiva: o feed da semana precisa ter variedade de **papel**, não só de arquétipo individual — senão o sistema pode produzir Product Benefit / Product Benefit / Urgency, todos vendendo, sem nada de marca ou engajamento, mesmo que cada decisão isolada seja defensável.

Os 12 arquétipos se agrupam em 3 papéis:

| Papel | Arquétipos | Função na semana |
|---|---|---|
| **Comercial/venda** | Product Benefit, Urgency, Comparison, Newness, Objection Handling | Empurra ação direta |
| **Valor/engajamento** | Educational, Social Proof, UGC-style | Constrói confiança/interação sem venda dura |
| **Marca/lifestyle/storytelling** | Lifestyle/Aspiration, Founder Story, Behind the Scenes | Constrói identidade/afinidade de marca |

**Regra de portfólio (soft constraint, não fixa)**: nos ~3 posts de uma semana do plano Starter, mirar pelo menos 1 de cada papel — não travar 100% em "comercial" nem 100% em "lifestyle". Não precisa ser exatamente 1-1-1 toda semana (calendário comercial forte, tipo Black Friday, pode justificar mais peso comercial temporariamente), mas o planejamento semanal deveria notar e sinalizar quando o mix está desbalanceado, não só otimizar post a post.

**Como isso muda o Estágio 1**: o planejamento roda em dois níveis (ver [ARCHITECTURE.md](ARCHITECTURE.md)) — primeiro aloca papéis aos slots da semana (considerando calendário, prioridade de Commerce Intelligence, e o mix das últimas semanas), depois, dentro de cada papel já definido, escolhe produto + arquétipo específico + ângulo + framework. Isso é o que começa a fazer o sistema parecer um gestor de marketing pensando a semana como conjunto, não uma máquina escolhendo o melhor post isolado 12 vezes por mês.

## Fase 2: quando isso vira aprendido, não só regra

Uma vez que `performance_signals` por objetivo tem volume suficiente por loja (mesmo limiar de handoff da Camada 3, ver CLAUDE.md), o arquétipo escolhido passa a ser mais uma variável testável — o sistema pode aprender que, por exemplo, "Social Proof converte melhor que Urgency para esta marca especificamente", em vez de seguir só o mapeamento fixo acima. Isso conecta Marketing Knowledge Layer com Customer Intelligence (Camada 3): arquétipo vira um "braço" no sistema de ranking/aprendizado, não permanece regra estática pra sempre.

## Schema (campos que isso adiciona ao Decision Engine)

Ver `content_items.decision_brief` em [ARCHITECTURE.md](ARCHITECTURE.md):
```
{
  ...campos já existentes (objective, product, audience, reason, channel, funnel_stage, format, cta),
  creative_archetype: <um dos arquétipos acima>,
  creative_angle: <texto livre, gerado dentro do arquétipo escolhido — ver seção "Creative Angle" acima>,
  narrative_framework: <hook_value_proof_cta | pas | aida | before_after>
}
```
O Estágio 2 recebe isso como restrição estrutural explícita, não como sugestão vaga — a instrução de geração passa a ser algo como "siga Hook→Value→Proof→CTA usando o arquétipo Social Proof: abra com um momento de transformação específico, sustente com uma prova concreta (número de reviews, alegação de conforto), feche com CTA" em vez de "escreva um post sobre o EVA Black".
