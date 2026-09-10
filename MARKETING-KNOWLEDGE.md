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

## Framework de posicionamento e funil de crescimento — "Social Media de Elite" (Patricia, 10/09/2026)

Pedido de Patricia depois de ver o primeiro rascunho de Brand Voice sair "básico, genérico-IA": o app não deveria só gerar posts a partir de um objetivo escolhido — deveria se comportar como uma estrategista de social media sênior, que **diagnostica antes de prescrever**. Isso adiciona uma camada de diagnóstico e auditoria por cima do que já existe (Brand/Commerce/Customer/Calendar Intelligence + este documento), não substitui nada.

### O funil próprio do produto

```
ATENÇÃO → RETENÇÃO → VISITA AO PERFIL → SEGUIDOR → LEAD → VENDA
```

Mais granular que o `funnel_stage` já existente no schema (`awareness | consideration | conversion | retention`) — este funil descreve especificamente a jornada de crescimento no Instagram, não só o estágio de decisão de compra. Os dois convivem: `funnel_stage` continua sendo campo do `decision_brief` de cada post (pra que estágio de compra aquele post específico empurra); o funil de crescimento acima é o contexto maior em que a estratégia da semana/mês se posiciona (estamos numa fase de ganhar atenção, ou de converter seguidor em lead?).

### 1. Diagnóstico de posicionamento (roda antes de qualquer estratégia de conteúdo)

Antes do Estágio 1 decidir o que postar, um novo passo de diagnóstico responde, com base no catálogo Shopify + vendas reais + Brand Intelligence já preenchida:

- **Quem eu ajudo** (público ideal — não é o público amplo do nicho, é quem essa marca especificamente atende)
- **Qual problema resolvo**
- **Qual resultado entrego**
- **Por que deveria me seguir** (diferencial)
- **Produto/ticket médio** (já derivável de `products_cache.price` agregado)
- **Formato principal** (reels/carrossel/stories — hoje o produto só publica imagem/carrossel estático, reels e stories ficam fora do MVP de publicação, ver limitações abaixo)
- **Seguidores / views médias** — vêm da própria conta Instagram conectada (ver "De onde vem o dado" abaixo), não são inseridos manualmente pelo merchant

**Saída principal deste passo: o gargalo.** Não é uma lista de diagnósticos soltos — é apontar **qual é o principal gargalo do perfil agora** (ex.: "atenção não é o problema, o perfil tem alcance; o gargalo é conversão de visita em seguidor, porque a bio não deixa claro o que a marca vende nem tem CTA") e é isso que deveria pesar mais na escolha de arquétipo/papel da semana, não só o objetivo comercial isolado por post.

### 2. Auditoria de conteúdo

Categoriza o histórico de posts (próprios e de concorrentes, ver "De onde vem o dado") em:
- **Temas saturados** — o que já foi postado demais, sem gerar resultado novo
- **Conteúdos genéricos** — o que poderia ser de qualquer marca do nicho, sem trazer características autorais
- **Conteúdos com maior potencial de alcance** — pelos dados públicos disponíveis (curtidas/comentários), o que performou acima da média
- **Conteúdos que geram autoridade** — tipicamente educational/founder story/behind the scenes (ver papéis em "Content Mix" acima)
- **Conteúdos que atraem compradores** — tipicamente os de papel comercial (product benefit, social proof) que empurram para o produto

Essa auditoria entra no Estágio 1 como mais um contexto de decisão — evita repetir um tema saturado, prioriza formatos que já provaram funcionar pra aquela marca especificamente.

### 3. Análise de conversão

```
POST → PERFIL → BIO → CTA → OFERTA
```

Audita cada elo: um post gera visita ao perfil (dado de alcance/impressão do post), o perfil converte visita em decisão de seguir (depende de bio, destaque, feed como vitrine), a bio direciona pra uma oferta clara, o CTA do post e da bio mandam pra onde. Hoje só o elo POST→PERFIL tem dado público (via curtidas/comentários como proxy); PERFIL→BIO→CTA→OFERTA depende de `instagram_manage_insights` (visitas ao perfil, cliques no link) e do link rastreado (`tracked_links`), nenhum dos dois construído ainda — ver "O que roda hoje vs. o que ainda não" abaixo.

### Tudo ancorado em Commerce Intelligence, sempre

Nenhuma recomendação de conteúdo (que produto empurrar, que tema evitar) pode ignorar `commerce_signals` (velocidade de venda) e `products_cache.inventory_quantity` (estoque disponível) — a auditoria de conteúdo e o diagnóstico de posicionamento informam **como** comunicar, mas **o que** promover continua vindo de Commerce + Calendar Intelligence, como já documentado desde o início do projeto. Isso não muda; só ganha uma camada de diagnóstico estratégico por cima.

### De onde vem o dado — o que roda hoje vs. o que ainda não

Correção importante feita nesta mesma conversa: inicialmente eu (Claude) assumi que auditoria de conteúdo e análise de concorrentes precisariam esperar `performance_signals` se acumular a partir dos posts que o próprio Stockative publica — Patricia corrigiu: a API do Instagram já dá acesso a dado real **agora**, sem esperar:

| Dado | Fonte | Precisa de quê | Status |
|---|---|---|---|
| Posts já publicados da própria conta (legenda, tipo de mídia, curtidas, comentários, data) — inclusive de antes do Stockative existir | `GET /{ig-user-id}/media` + campos do media | Só os escopos já concedidos (`instagram_basic`) | **Buildável agora** |
| Posts públicos de até 2 concorrentes indicados pelo merchant (legenda, curtidas, comentários, tipo, data) | Business Discovery (`business_discovery.username(...)`) — já documentado desde o início do projeto, nunca construído | Só os escopos já concedidos (`instagram_basic`, conta IG Business própria já conectada) | **Buildável agora** |
| Alcance, impressões, visitas ao perfil, cliques no link da própria conta | Instagram Insights API | Escopo `instagram_manage_insights`, **ainda não pedido no app da Meta** | Precisa reconfigurar o app na Meta primeiro |
| Visita → lead → venda atribuída a um post específico | `tracked_links` (redirecionador próprio com UTM) | Construir o redirecionador (documentado, não implementado) | Não buildável ainda |

Ou seja: diagnóstico de posicionamento + auditoria de conteúdo (própria conta + concorrentes) dá pra construir com dado real imediatamente, usando exatamente o mesmo fluxo Facebook Login já conectado. Análise de conversão completa (PERFIL→BIO→CTA→OFERTA) e o funil até LEAD/VENDA precisam das duas peças da tabela acima ainda não construídas — até lá, ficam como estrutura pronta que passa a preencher com dado real assim que essas peças existirem, mesmo padrão de handoff regra→aprendizado já usado pra Camada 3.

## Sistema de crescimento completo: pilares, motores de ideia, estrutura de hook e ciclo de decisão (Patricia, 10/09/2026)

Especificação completa de Patricia, em cima do framework de diagnóstico acima — transforma o Decision Engine de "escolhe arquétipo + gera copy" (2 estágios) num pipeline de 5 fases. Cada fase abaixo é nova; nenhuma substitui o que já existe (arquétipos, ângulo, narrative framework continuam existindo, só passam a operar **dentro** de um pilar em vez de soltos).

### Fase 0 — Diagnóstico (já documentado acima, é a entrada obrigatória)

Nada do que segue roda sem primeiro identificar o gargalo principal do perfil (ver seção anterior). **Regra final de Patricia, vale pra todo o sistema**: nunca entregar estratégia genérica; toda decisão precisa de porquê; se o dado contradisser a hipótese do sistema, o dado vence — nunca o contrário. Isso é literalmente o mesmo princípio já usado em todo hipótese marcada como "validar antes de fixar" no resto dos documentos, só que agora é regra explícita de operação, não só de precificação.

### Fase 1 — Pilares de conteúdo (novo conceito, acima do Creative Archetype)

4 a 6 pilares por marca, gerados uma vez (mesmo padrão do Brand Voice: IA rascunha a partir do diagnóstico + catálogo, merchant aprova/edita, nunca autossalva). **Proibido pilar genérico** ("educação", "inspiração") — cada pilar precisa ser específico da marca, nascido do diagnóstico de posicionamento, não de uma lista universal de social media.

Cada pilar tem:

| Campo | O que define |
|---|---|
| Nome | Específico da marca, não genérico |
| Função | Por que esse pilar existe na estratégia |
| Público que atrai | Qual fatia do público ideal (Fase 0) esse pilar fala |
| Problema que explora | Qual dor/necessidade específica |
| Promessa | O que o público ganha ao consumir esse pilar |
| Formato ideal | Carrossel/imagem única (reels/stories ficam fora do MVP de publicação atual, ver limitações) |
| CTA | Ação que esse pilar tipicamente pede |

**Os pilares substituem/refinam o modelo de papéis do "Content Mix" acima**: em vez de 3 papéis (comercial/valor/marca), a distribuição passa a ser em 4 categorias — **Atração, Autoridade, Relacionamento, Conversão** — com porcentagem ideal definida pela IA a partir do diagnóstico (não fixa 25/25/25/25; depende do gargalo identificado na Fase 0 — ex.: gargalo é atenção → mais peso em Atração; gargalo é conversão → mais peso em Conversão). Cada pilar existente é então classificado numa dessas 4 categorias, e a distribuição semanal (Weekly Plan já construído) passa a alocar por essa proporção em vez do 1-1-1 solto anterior.

Além disso, cada pilar recebe uma anotação de papel na máquina de crescimento:
- Qual pilar deve gerar mais **alcance**
- Qual deve gerar mais **seguidores**
- Qual deve aproximar o público da **compra**
- Qual deve **publicar menos** (não todo pilar merece frequência igual)

### Fase 2 — Geração de ideias com os 5 motores

Pra cada pilar, gerar ideias de conteúdo usando 5 gatilhos psicológicos explícitos (diferente de/complementar ao Creative Archetype — os motores geram a ideia bruta, o arquétipo already-existente continua decidindo a categoria estratégica do post final):

| Motor | O que explora |
|---|---|
| **Dor** | O que o público quer eliminar |
| **Desejo** | O resultado que ele quer alcançar |
| **Curiosidade** | Algo que ele ainda não sabe |
| **Contradição** | Uma crença comum que merece ser questionada |
| **Prova** | Casos, exemplos, dados, experiências reais (produto/cliente) |

Gera 20 ideias (não uma por pilar — distribuídas pelos pilares conforme a proporção da Fase 1). Cada ideia tem: `hook`, `ideia_central`, `formato`, `promessa`, `cta`, `objetivo`. Cada ideia recebe nota de 0 a 10 em 5 eixos — curiosidade, relevância, compartilhamento, potencial de seguir, potencial de venda — e só as **12 melhores** (maior nota agregada, respeitando a distribuição de pilares/categorias da Fase 1, não só as 12 notas mais altas isoladas) avançam pra próxima fase.

### Fase 3 — Otimização de hook e estrutura

Pra cada uma das 12 ideias selecionadas:
1. Gerar 3 variações de hook, usando tipos diferentes dentre: curiosidade, erro, resultado, contradição, urgência, segredo, prova. Escolher o melhor.
2. Estruturar o conteúdo em 7 partes: `HOOK → PROBLEMA → TENSÃO → DESCOBERTA → SOLUÇÃO → PAYOFF → CTA`. Isso é uma versão mais granular do `narrative_framework` já existente (`hook_value_proof_cta | pas | aida | before_after`) — na prática, vira um **quinto framework**, mais longo e mais explícito, reservado pra quando o formato do post (carrossel de várias telas) comporta essa granularidade toda; pra legenda de imagem única, os frameworks mais curtos já existentes continuam fazendo mais sentido. **Regra de edição**: cada parte precisa dar um motivo pra continuar lendo — se alguma parte puder ser cortada sem prejudicar o conteúdo, cortar. Copy longa não é o objetivo; copy que sustenta atenção é.
3. Gerar 3 CTAs por ideia — pra seguir, pra comentar, pra comprar/virar lead — e escolher o mais coerente com o conteúdo específico daquele post (não sempre o de venda; um post de Atração provavelmente usa o CTA de seguir/comentar, não o de compra).

### Fase 4 — Execução (calendário) e Fase 5 — Análise (métricas viram decisão)

**Calendário**: mesma função que o Weekly Plan já construído (`app/services/decisionEngine/planWeek.server.ts`) — a mudança é o que cada slot carrega: além de produto/objetivo já decididos hoje, passa a levar `tema` (o pilar), `hook` escolhido (Fase 3), `formato`, `objetivo`, `cta` e **`métrica principal`** — qual número aquele post específico deveria mover, definido antes de publicar, não escolhido depois pra justificar o resultado.

**Análise — transformar número em decisão, nunca só descrever**: quando `performance_signals` tiver dado (mesma limitação de cold start documentada em CLAUDE.md/ARCHITECTURE.md pra Camada 3 — hoje ainda não tem post publicado com métrica capturada), a saída da análise nunca é "o post teve X curtidas" — é sempre uma de 4 decisões:

| Decisão | Significa |
|---|---|
| **Parar** | O que eliminar — pilar/formato/ângulo que não está performando |
| **Manter** | O que já funciona, sem mudar |
| **Dobrar** | O que merece mais frequência/investimento |
| **Testar** | Que hipótese testar na semana seguinte |

Essa é a instanciação concreta da Camada 3 (Customer Intelligence) já documentada desde o início do projeto — antes só dizia "o sistema aprende com o tempo", agora tem vocabulário de saída explícito. Métricas relevantes pro ciclo: alcance, views, retenção, compartilhamentos, salvamentos, visitas ao perfil, seguidores, leads, vendas — a maioria depende das peças ainda não construídas na tabela "De onde vem o dado" acima (`instagram_manage_insights`, `tracked_links`); enquanto isso, o ciclo Parar/Manter/Dobrar/Testar roda com o que já é público (curtidas, comentários) como proxy parcial, sinalizado como tal, nunca apresentado como se fosse o dado completo.
