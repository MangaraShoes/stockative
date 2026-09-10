# Marketing Knowledge Layer

Reorganizado em 10/09/2026 a partir da avaliação crítica de Patricia sobre a primeira versão deste documento. A versão anterior registrava decisões na ordem em que foram tomadas; esta reorganiza por função, resolve as inconsistências apontadas na avaliação e adiciona as regras de evidência que faltavam. Nenhuma decisão de conteúdo foi perdida — o que mudou de lugar ou de forma está listado na seção 10 (Histórico).

Ponto original que segue valendo (Patricia, 09/09/2026): sem uma camada explícita de conhecimento de copywriting/narrativa, o Content Decision Engine sabe o quê promover e quando (Brand + Commerce + Customer + Calendar + Competitor Intelligence), mas não como estruturar um argumento persuasivo — e regride pra copy genérica mesmo com ótimos dados por trás. Este documento continua sendo essa camada. O que mudou é que agora ela também define **quando o sistema não tem base suficiente pra agir com confiança**, e o que fazer nesse caso.

---

## 1. Objetivo, escopo do MVP e exclusões

**Objetivo do documento**: dar ao Decision Engine (ver [ARCHITECTURE.md](ARCHITECTURE.md)) critério verificável de escolha, produção e avaliação de conteúdo — não só um repertório de técnicas persuasivas. Toda regra aqui precisa responder "como o sistema sabe que isso é o certo a fazer", não só "o que é uma boa prática de social media".

**Está dentro do MVP:**
- A hierarquia de decisão da seção 2 (objetivo → categoria → pilar → ideia/ângulo → arquétipo → framework → execução).
- Diagnóstico de posicionamento, inclusive em modo provisório quando falta dado (seção 5).
- Regras de evidência por arquétipo — o que pode e não pode ser alegado sem fonte (seção 4).
- Pilares de conteúdo aprovados pelo lojista (já implementado, ver [ARCHITECTURE.md](ARCHITECTURE.md) `content_pillars`).
- Planejamento semanal como portfólio, não posts isolados (seção 6).
- Geração de ideias com os 5 motores e seleção com critério editorial explícito, não nota de "potencial de venda" (seção 6).
- Alocação de crédito de imagem por prioridade semanal (cross-ref [ARCHITECTURE.md](ARCHITECTURE.md), não duplicado aqui).

**Fica fora do MVP, propositalmente:**
- Reels e stories — o produto hoje só publica imagem única e carrossel estático (ver publicação real em [ARCHITECTURE.md](ARCHITECTURE.md)). Qualquer menção a formato de vídeo neste documento é aspiracional, não uma capacidade atual.
- Funil de conversão completo PERFIL→BIO→CTA→OFERTA com dado real — depende de `instagram_manage_insights`, escopo ainda não solicitado no app da Meta (seção 3).
- Atribuição de lead/venda a um post específico — depende do redirecionador com UTM (`tracked_links`), ainda não construído, e de decisões de desenho ainda em aberto (janela de atribuição, o que fazer com um link compartilhado por vários posts — seção 7).
- Aprendizado automático de arquétipo/categoria a partir de performance — só acontece quando `performance_signals` tiver volume suficiente (mesmo limiar de handoff da Camada 3, ver [CLAUDE.md](CLAUDE.md) e seção 8).

As regras específicas de estética visual (composição, luz, fidelidade de produto na imagem gerada) não vivem aqui — ficam em `/Users/patriciacossettin/Mangara-Nano-Banana/CLAUDE.md`. Este documento cobre estratégia e texto; aquele cobre a geração de imagem em si.

---

## 2. Glossário e hierarquia dos conceitos

Consolidação pedida na avaliação — a versão anterior tinha dois modelos concorrentes (3 "papéis" do Content Mix e depois 4 "categorias" que supostamente os substituíam, os dois descritos como regra ativa). A partir de agora existe uma hierarquia só:

```
Objetivo comercial → Categoria estratégica → Pilar temático → Ideia/ângulo → Arquétipo → Framework → Execução
```

| Nível | O que é | Cardinalidade |
|---|---|---|
| **Objetivo comercial** | `awareness \| engagement \| traffic \| conversion \| inventory` — já existe em `content_items.commercial_objective` | 1 por post |
| **Categoria estratégica** | `Atração \| Autoridade \| Relacionamento \| Conversão` — que papel esse post específico cumpre na máquina de crescimento | 1 por post — **não é propriedade fixa do pilar**, ver nota abaixo |
| **Pilar temático** | Território editorial específico da marca (4-6 por loja), nascido do diagnóstico (seção 5), aprovado pelo lojista | 1 por post, N pilares por loja |
| **Ideia/ângulo** | A mensagem específica gerada dentro do pilar, pra aquele produto/momento (texto livre) | 1 por post |
| **Arquétipo** | Categoria estratégica do argumento persuasivo (enum fechado, ver tabela abaixo) | 1 por post |
| **Framework** | Esqueleto estrutural do texto | 1 por post |
| **Execução** | Legenda, hashtags, CTA final — saída do Estágio 2 | 1 por post |

**Correção central desta reorganização: um pilar não fica preso a uma categoria estratégica única.** A versão anterior classificava cada pilar numa das 4 categorias de forma permanente. Na prática um pilar como "cuidados com o calçado" pode virar um post de Atração (dica solta, alcance), Autoridade (conteúdo mais técnico) ou Conversão (dica + CTA de compra de um produto específico), dependendo do ângulo escolhido naquela semana. O pilar carrega uma **categoria típica** (a que ele mais naturalmente serve, usada como prior no planejamento), mas a categoria real de cada post é decidida na hora do ângulo, não herdada automaticamente do pilar. Isso está refletido no schema consolidado (seção 7) e ainda **não** está refletido no código já implementado — ver seção 7 e a nota de decisão pendente no fim deste documento.

### Arquétipos (11 — `UGC-style` reclassificado, ver abaixo)

| Arquétipo | O que é | Estágio de funil | Objetivo comercial mais forte |
|---|---|---|---|
| **Educational** | Ensina algo que o cliente não sabia (como combinar, como cuidar do material, ciência do tamanho) | Awareness / Consideration | Engagement, Traffic |
| **Problem/Solution** | Nomeia uma frustração específica, posiciona o produto como resolução | Consideration | Conversion, Traffic |
| **Product Benefit** | Lidera com benefício funcional/emocional concreto, não lista de features | Consideration / Conversion | Conversion |
| **Social Proof** | Reviews, menções de clientes reais, números específicos | Consideration / Conversion | Conversion, Traffic |
| **Lifestyle/Aspiration** | Produto dentro de uma vida/identidade desejada, venda mínima direta | Awareness | Awareness, Engagement |
| **Founder Story** | A criadora por trás do produto, autenticidade | Awareness | Engagement |
| **Behind the Scenes** | Processo, artesania, origem do material | Awareness / Consideration | Engagement |
| **Comparison** | Contraste implícito ou explícito com alternativa (não precisa nomear concorrente) | Consideration | Conversion |
| **Urgency** | Escassez ou prazo reais | Conversion | Conversion, Inventory |
| **Newness** | Lançamento, "acabou de chegar", primeira olhada | Awareness / Consideration | Awareness, Traffic |
| **Objection Handling** | Endereça uma hesitação direta (medo de tamanho, justificativa de preço, política de troca) | Conversion | Conversion |

**`UGC-style` deixou de ser um arquétipo.** Ele descrevia um *tom de apresentação* (parece gerado por usuário), não um argumento — categoria de natureza diferente dos outros 11. Vira um atributo ortogonal, `presentation_style: ugc | editorial`, que pode se combinar com qualquer arquétipo acima (ex.: Product Benefit + tom UGC). Regra de evidência específica na seção 4: nunca simular um depoimento atribuído a uma pessoa real que não existe.

### Categorias estratégicas (substituem os "3 papéis" da versão anterior)

| Categoria | Função na semana | Arquétipos que tipicamente servem essa categoria |
|---|---|---|
| **Atração** | Ganhar alcance/atenção nova | Newness, Lifestyle/Aspiration, Comparison |
| **Autoridade** | Construir confiança/expertise | Educational, Behind the Scenes, Founder Story |
| **Relacionamento** | Aproximar/engajar quem já segue | Social Proof, Behind the Scenes, Founder Story |
| **Conversão** | Empurrar ação direta de compra | Product Benefit, Problem/Solution, Urgency, Objection Handling, Comparison |

Essa tabela é **referência de afinidade**, não regra de amarração 1:1 — o mesmo arquétipo pode servir categorias diferentes dependendo do ângulo (Comparison aparece em Atração e Conversão de propósito).

### Frameworks narrativos

| Framework | Uso |
|---|---|
| **Hook → Value → Proof → CTA** | Default geral, legenda de Instagram |
| **PAS (Problem → Agitate → Solve)** | Problem/Solution, Objection Handling |
| **AIDA (Attention → Interest → Desire → Action)** | Lifestyle/Aspiration, Newness |
| **Before/After (transformação)** | Product Benefit, Social Proof |
| **HOOK→PROBLEMA→TENSÃO→DESCOBERTA→SOLUÇÃO→PAYOFF→CTA** | Formato longo, reservado pra carrossel de várias telas onde há espaço pra granularidade — pra legenda de imagem única, um dos 4 frameworks curtos acima continua sendo a escolha certa. Este framework precisa ser adicionado ao enum de `narrative_framework` no schema (seção 7) — ainda não estava lá. |

**Motores de ideia (Dor, Desejo, Curiosidade, Contradição, Prova)**: não fazem parte da hierarquia acima. São técnicas opcionais de geração usadas na Fase 2 (seção 6) pra produzir o banco de ideias dentro de um pilar já escolhido — o motor gera a ideia bruta, a hierarquia acima decide a categoria/arquétipo/framework do post final.

**Funil de crescimento — caminhos possíveis, não sequência obrigatória:**
```
ATENÇÃO → RETENÇÃO → VISITA AO PERFIL → SEGUIDOR → LEAD → VENDA
```
Descreve trajetórias típicas de crescimento no Instagram, não um funil que todo visitante precisa atravessar em ordem — alguém pode comprar sem nunca seguir a conta, ou virar lead sem antes ser "seguidor". É contexto de estratégia (em que fase o mês está focado), não uma condição que cada post precisa satisfazer. Convive com o `funnel_stage` já existente no schema (awareness/consideration/conversion/retention), que descreve o estágio de decisão de compra de um post específico — os dois campos respondem perguntas diferentes.

**Duas retenções diferentes, nunca confundir:**
- **Retenção de atenção**: quanto tempo/quão fundo alguém consome um post específico (relevante sobretudo pra vídeo/carrossel — hoje sem dado direto, curtidas/comentários são proxy fraco).
- **Retenção de clientes**: recompra, LTV — métrica de negócio, vem de pedidos Shopify, não de engajamento social.

---

## 3. Fontes de dados, disponibilidade e limitações

Correção da avaliação: a tabela anterior só distinguia "buildável agora" vs. "não buildável", o que não prova que o acesso está de fato disponível nem testado. A partir de agora, cada fonte carrega um dos 4 estágios: **documentado → validado na conta de teste → implementado → funcionando em produção.**

| Dado | Fonte | Requisito de escopo | Estágio atual |
|---|---|---|---|
| Conexão da conta Instagram Business própria (Mangará, `@mangara.official`) | Facebook Login for Business, `/me/accounts` | `pages_show_list`, `pages_read_engagement`, `business_management`, `instagram_basic`, `instagram_content_publishing` | **Funcionando em produção** — conexão real confirmada, `igBusinessAccountId` real obtido, publicação real testada (ver [ARCHITECTURE.md](ARCHITECTURE.md)) |
| Posts já publicados da própria conta (legenda, tipo, likes, comentários, data — inclusive de antes do Stockative) | `GET /{ig-user-id}/media` | Só `instagram_basic`, já concedido | **Funcionando em produção** — implementado e confirmado ao vivo em 10/09/2026 contra a conta real da Mangará (`fetchOwnAccountPosts`, ver `app/services/meta/businessDiscovery.server.ts`), traz legenda/likes/comentários reais dos posts já publicados |
| Posts públicos de até 2 concorrentes indicados pelo lojista | Business Discovery (`business_discovery.username(...)`) | `instagram_basic` + conta própria já conectada | **Bloqueado** — implementado e testado ao vivo em 10/09/2026 contra a conta real da Mangará: a Meta recusa com `(#10) Application does not have permission for this action`. O app só tem Standard Access; ler dado de conta de terceiro via Business Discovery exige Advanced Access via App Review — mesma pendência da linha abaixo, correção do que a versão anterior deste documento chamava de "buildável agora" |
| Alcance, impressões, visitas ao perfil, cliques no link | Instagram Insights API | Escopo `instagram_manage_insights`, **não solicitado no app da Meta** | **Bloqueado** — precisa voltar em "API setup with Facebook login" na Meta e pedir o escopo antes de qualquer teste ser possível |
| Visita → lead → venda atribuída a um post específico | `tracked_links` (redirecionador próprio com UTM) | Construir o redirecionador + decidir destino do CTA, janela de atribuição, tratamento de link compartilhado (seção 7) | **Não implementado**, desenho incompleto |

Nota de risco vinda da avaliação: o Facebook Login for Business exige conta Instagram Professional (Business/Creator) vinculada a uma Página do Facebook — confirmado no fluxo real da Mangará, mas isso é um requisito da **conta do lojista**, não só do app. Quando outro merchant conectar, o app precisa lidar com o caso de conta pessoal/sem Página vinculada (mensagem de erro clara, não falha silenciosa) — não implementado ainda, registrar como item de v0 antes de abrir pra outros merchants.

---

## 4. Regras de evidência e alegações permitidas

Seção nova — era a lacuna mais crítica apontada na avaliação. Regra geral primeiro, depois o requisito por arquétipo.

### Regra geral

> Toda alegação factual precisa de fonte identificável. Reviews, resultados, prazos, escassez e histórias não podem ser inventados pelo Estágio 2. Se a evidência não existir, o arquétipo é trocado por outro elegível, ou o dado é solicitado ao lojista antes de gerar — o sistema nunca preenche a lacuna criativamente.

Toda saída do Decision Engine (diagnóstico, seleção de ideia, geração de copy) classifica cada afirmação em um de três estados, nunca deixando implícito qual é qual:

- **`evidencia_observada`** — vem direto de um dado real (catálogo, pedido, review cadastrado, brand voice aprovado, post histórico).
- **`hipotese`** — inferência plausível mas não confirmada (ex.: "provavelmente o gargalo é X" quando não há dado de Insights pra confirmar).
- **`dado_ausente`** — o sistema reconhece que não tem a informação, em vez de inventar uma.

Curtidas e comentários são sempre **observação de interação pública** — nunca podem sustentar uma afirmação sobre alcance, visita ao perfil, lead ou venda sem virar explicitamente `hipotese` rotulada como tal.

### Pré-requisito de evidência por arquétipo

| Arquétipo | Precisa de | Se faltar |
|---|---|---|
| **Product Benefit** | Atributo real do produto (material, característica do cadastro Shopify) | Não pode inventar benefício não documentado |
| **Urgency** | Prazo real (promoção com data de fim) **ou** escassez real (`commerce_signals.inventory_quantity` abaixo de um limiar definido, nunca "estoque parado" — estoque parado pode ser excesso, o oposto de escassez) | Arquétipo fica inelegível pro produto/momento |
| **Social Proof** | Review/depoimento real cadastrado, ou número de vendas verificável (`units_sold`) | Lançamento sem review não é elegível — usar Newness ou Product Benefit |
| **Comparison** | Contraste pode ser implícito e genérico ("vs. salto desconfortável o dia todo"); alegação específica sobre concorrente nomeado exige fonte pública | Sem fonte, manter o contraste genérico, nunca alegar fato específico do concorrente |
| **Founder Story** | Fato real da fundadora (Brand Voice / onboarding) | Não pode inventar biografia |
| **Behind the Scenes** | Informação real de processo/material (cadastro do produto ou brand voice) | Não pode inventar detalhe de produção |
| **Educational** | Pode ser conhecimento geral do nicho, mas afirmação técnica específica precisa ser correta | Sem dado técnico confiável, manter a dica genérica, não inventar número/fato |
| **Objection Handling** | Objeção real e conhecida (política de troca/tamanho do cadastro real) | Não pode inventar política |
| **Newness** | Produto de fato recente (`shopify_created_at` dentro de uma janela definida) | Fora da janela, não é elegível como Newness |
| **Lifestyle/Aspiration** | Menor exigência factual (é sobre imagem/aspiração), mas não pode alegar fato específico não verificável | — |
| **Problem/Solution** | Frustração real e reconhecível do público-alvo (Fase 0/Brand Voice), não uma dor genérica de banco de imagem | Sem uma dor específica identificada, usar Product Benefit |
| **`presentation_style: ugc`** | Nunca simula depoimento atribuído a uma pessoa real inexistente — tom UGC, não citação forjada | — |

---

## 5. Diagnóstico, incluindo ausência de dados

### Duas coisas diferentes, que a versão anterior tratava como uma só

- **Posicionamento**: quem a marca ajuda, que problema resolve, que resultado entrega, diferencial. Deriva de catálogo + Brand Voice já aprovado — **pode ser trabalhado desde o primeiro dia**, sem precisar de histórico de performance.
- **Diagnóstico de desempenho** (o "gargalo"): qual elo do funil está travando agora. Depende de dado de comportamento real (`own_account_posts`, e melhor ainda com Insights) — **pode não existir ainda** numa conta nova ou recém-conectada, e não deve ser forçado.

### Saída do diagnóstico (schema)

```
diagnosis = {
  quem_ajudo: string,
  problema_que_resolvo: string,
  resultado_que_entrego: string,
  diferencial: string,
  gargalo_principal: string | null,      // null quando não há evidência suficiente pra apontar um
  confianca: "alta" | "media" | "baixa",
  evidencias: [{ afirmacao: string, fonte: string, tipo: "evidencia_observada" | "hipotese" }],
  dados_ausentes: string[],
  proximo_teste: string | null,
  is_provisional: boolean,
}
```

### Regra pra ausência de dado

Nada trava esperando dado perfeito. Quando não há histórico suficiente (conta nova, sem `own_account_posts` sincronizado, catálogo com poucas vendas), o diagnóstico sai com `is_provisional: true`, `confianca: "baixa"`, `gargalo_principal` pode ficar `null` em vez de forçado, e a estratégia inicial se apoia só no posicionamento (catálogo + Brand Voice aprovado) — nunca inventa um gargalo específico ("a bio não converte") sem ter como observar isso. Assim que houver dado suficiente (ver limiar de handoff da Camada 3, seção 8), o diagnóstico é recalculado e `is_provisional` vira `false`.

Isso também restringe quais arquétipos ficam elegíveis num diagnóstico provisório: nenhum arquétipo que dependa de prova de comportamento (ex.: Social Proof com número específico) deveria aparecer no shortlist até existir dado — o shortlist inicial tende a Educational, Founder Story, Behind the Scenes, Lifestyle/Aspiration, Product Benefit, que só dependem de posicionamento + catálogo.

---

## 6. Planejamento, seleção e produção

### Fase 1 — Pilares de conteúdo

4 a 6 pilares por marca, gerados uma vez a partir do diagnóstico + catálogo, lojista aprova/edita (já implementado, ver [ARCHITECTURE.md](ARCHITECTURE.md) `content_pillars`). Proibido pilar genérico ("educação", "inspiração") — precisa ser específico da marca.

Cada pilar tem: nome, função, público que atrai, problema explorado, promessa, formato ideal, CTA, **categoria típica** (a categoria estratégica que ele mais naturalmente serve — prior de planejamento, não amarração fixa, ver seção 2), e as anotações de papel na máquina de crescimento (gera mais alcance / gera mais seguidores / aproxima da compra / deve publicar menos).

### Fase 2 — Geração de ideias com os 5 motores

Pra cada pilar, os 5 motores (Dor, Desejo, Curiosidade, Contradição, Prova) geram um banco de ideias — 20 no total, distribuídas conforme a proporção de categorias definida na Fase 1/diagnóstico. Cada ideia: `hook`, `ideia_central`, `formato`, `promessa`, `cta`, `objetivo`.

**Seleção reformulada** (a versão anterior usava notas 0-10 em eixos como "potencial de venda", que lidas como estão parecem previsão de desempenho sem calibração nenhuma pra sustentar isso):

1. **Eliminar primeiro**: ideias sem evidência suficiente pro arquétipo pretendido (seção 4), incompatíveis com a marca, ou inexequíveis no formato atual do produto (reels/stories, por exemplo, saem aqui).
2. **Avaliar o que sobrou** em 5 eixos editoriais: especificidade, relevância, clareza, originalidade, adequação ao objetivo declarado. Isso é **julgamento editorial**, não previsão de resultado — nunca é apresentado como "essa ideia vai vender mais".
3. **Pesar pelo objetivo**: uma ideia de Autoridade não precisa ganhar por "potencial de venda" pra ser boa — os pesos dos 5 eixos variam pela categoria estratégica do slot.
4. **Guardar justificativa curta** pra cada seleção — auditoria de por que essa ideia entrou e outra não.
5. **Checar repetição** de mensagem, promessa e proposta visual — não só de arquétipo, que já tinha regra de anti-repetição.
6. Das ideias que sobrevivem à eliminação e à avaliação, as **12 melhores** avançam, respeitando a distribuição de categorias, não só a nota agregada mais alta isolada.

### Fase 3 — Otimização de hook e estrutura

Pra cada uma das 12 ideias: 3 variações de hook (curiosidade, erro, resultado, contradição, urgência, segredo, prova) → escolher a melhor; estruturar em 7 partes (HOOK→PROBLEMA→TENSÃO→DESCOBERTA→SOLUÇÃO→PAYOFF→CTA) quando o formato comportar (carrossel — pra imagem única, um framework curto da seção 2 continua sendo a escolha certa); 3 CTAs (seguir/comentar/comprar) → escolher o coerente com a categoria do post, não sempre o de venda. Regra de edição: se uma parte pode ser cortada sem prejudicar o conteúdo, corta — copy longa não é o objetivo, copy que sustenta atenção é.

### Cadência (pergunta que a versão anterior deixava em aberto)

- **Pilares**: gerados uma vez, revisados só quando a marca muda de direção (mesmo padrão do Brand Voice).
- **Banco de ideias (Fase 2/3)**: gerado em lote periódico — proposta v0: mensal, 20→12 ideias que alimentam várias semanas, não uma corrida por semana.
- **Plano semanal (Fase 4)**: puxa do banco já pontuado, mas **revalida estoque, promoções ativas e calendário na hora de agendar**, não confia no banco como verdade congelada — um produto que ficou sem estoque entre a geração da ideia e o agendamento não pode ser publicado com uma alegação de disponibilidade desatualizada.
- **Distribuição de categorias**: avaliada numa janela maior que uma semana (mensal, alinhado com o lote de ideias) — com 4 categorias e ~3 posts por semana, não é toda semana que as 4 aparecem, e isso é esperado, não um desbalanceamento a corrigir. A regra de portfólio da versão anterior ("~1 de cada papel por semana") vira soft constraint mensal, não semanal.

### Commerce restringe o quê, não obriga tudo

Correção da avaliação: `commerce_signals`/`products_cache.inventory_quantity` continuam sendo obrigatórios pra decidir **que produto e que alegação são válidos** (não posso dizer "últimas unidades" sem estoque baixo real, seção 4) — mas isso não significa que todo post precisa girar em torno de um SKU. Conteúdo de marca, serviço ou comunidade (ex.: Founder Story, Behind the Scenes, uma dica de cuidado sem produto específico) pode existir sem produto principal — o schema de `content_items` precisa permitir `product_id` nulo pra esses casos (ver seção 7, item pendente).

---

## 7. Schema consolidado

Mudanças em relação ao schema já documentado em [ARCHITECTURE.md](ARCHITECTURE.md), decorrentes desta reorganização:

```
content_pillars
  ...campos já existentes...
  typical_category [atração|autoridade|relacionamento|conversão]
    — renomeado de growth_category: é prior de planejamento, não categoria fixa do pilar (ver seção 2).
    PENDENTE: o código já implementado (Prisma schema + app/routes/app.content-pillars.tsx)
    ainda trata isso como growth_category único e definitivo por pilar. Migrar o nome/semântica
    do campo é decisão em aberto, não fiz essa mudança de código ainda — ver nota no fim do documento.

content_items
  ...campos já existentes...
  product_id            — passa a ser NULLABLE (conteúdo de marca/serviço sem produto principal, ver seção 6)
  strategic_category     [atração|autoridade|relacionamento|conversão]  — decidida por post, não herdada do pilar
  presentation_style     [ugc|editorial]  — novo, substitui UGC-style como arquétipo (seção 2)
  diagnosis_confidence_ref — referência à versão do diagnóstico usada nessa decisão (rastreabilidade)
  decision_brief.evidencias  — array { afirmacao, fonte, tipo: evidencia_observada|hipotese } (seção 4)
  cta_destination         — pra onde o CTA manda de fato (perfil, link, DM) — necessário antes de tracked_links
                            conseguir atribuir venda a um post (seção 3, item não implementado)

narrative_framework enum
  + 'hook_problema_tensao_descoberta_solucao_payoff_cta'   — o 5º framework (seção 2), faltava no enum

diagnosis   (novo, ver schema completo na seção 5)
  id, shop_id, quem_ajudo, problema_que_resolvo, resultado_que_entrego, diferencial,
  gargalo_principal (nullable), confianca [alta|media|baixa],
  evidencias (JSON array), dados_ausentes (JSON array), proximo_teste (nullable),
  is_provisional (bool), computed_at

tracked_links
  ...campos já existentes (id, content_item_id, short_code, utm_params, click_count)...
  PENDENTE DE DESENHO (seção 3): destino do CTA, vínculo com sessão/pedido Shopify,
  janela de atribuição, e tratamento de um link reaproveitado por mais de um post —
  nenhuma dessas quatro decisões está tomada ainda, registrado aqui pra não ficar implícito
  que tracked_links "resolve atribuição" só por existir.
```

**Correção de fato apontada na avaliação**: em nenhum lugar do código atual existe cálculo de ticket médio/AOV — a menção anterior neste documento ("ticket médio já derivável de `products_cache.price` agregado") estava errada e foi removida. Quando esse campo for construído, a definição correta é receita bruta de pedidos (menos descontos) dividida pelo número de pedidos, **derivada de pedidos reais** (`commerce_signals`/dados agregados de `orders`), nunca da média dos preços de tabela do catálogo — um catálogo com produtos parados e caros infla a média de preço sem refletir o que a cliente de fato paga.

---

## 8. Métricas e critérios para mudar a estratégia

Fase 5, reformulada: a saída nunca é "o post teve X curtidas" — é sempre uma de **5** decisões (a versão anterior tinha 4, faltava a opção de não decidir ainda):

| Decisão | Significa |
|---|---|
| **Parar** | O que eliminar — pilar/formato/ângulo que não está performando |
| **Manter** | O que já funciona, sem mudar |
| **Dobrar** | O que merece mais frequência/investimento |
| **Testar** | Que hipótese testar na semana seguinte |
| **Aguardar mais dados** | Evidência insuficiente pra qualquer uma das 4 decisões acima — nunca forçar uma conclusão só porque "é hora de decidir" |

**Limiar mínimo de evidência**: reaproveita o mesmo limiar de handoff já documentado pra Camada 3 (~15-20 `content_items` com `performance_signals` capturado, ver [ARCHITECTURE.md](ARCHITECTURE.md)). Abaixo disso, por pilar/formato/ângulo específico, a decisão é sempre "Aguardar mais dados" — com ~12 posts/mês divididos entre 4-6 pilares, um pilar isolado pode legitimamente levar meses pra acumular evidência própria suficiente.

**Comparações justas**: ao comparar desempenho entre posts/pilares, considerar idade do post, se houve promoção/desconto ativo, formato, e distribuição paga quando conhecida — nunca comparar um post de 2 dias com um de 2 meses como se fossem equivalentes.

**Enquanto os dados de Insights/tracked_links não existirem**: o ciclo Parar/Manter/Dobrar/Testar/Aguardar roda só com o que é público (curtidas, comentários) como proxy parcial — sempre sinalizado como proxy, nunca apresentado como o dado completo (mesma regra da seção 4 sobre interação pública vs. alcance/conversão).

---

## 9. Exemplos completos e critérios de aceitação

Quatro cenários que o sistema precisa saber responder explicitamente, incluindo quando a resposta é "não sei ainda":

**1. Loja sem histórico** (conta nova, sem `own_account_posts` sincronizado, poucas vendas registradas): diagnóstico sai `is_provisional: true`, `confianca: "baixa"`, `gargalo_principal: null`. A estratégia inicial usa só posicionamento (catálogo + Brand Voice aprovado). Pilares são gerados normalmente (não dependem de dado de desempenho). Arquétipos elegíveis no shortlist inicial ficam restritos aos que não exigem prova de comportamento (Educational, Founder Story, Behind the Scenes, Lifestyle/Aspiration, Product Benefit) — Social Proof e Urgency ficam de fora até haver dado real.

**2. Lançamento sem reviews**: `Newness` é elegível (produto dentro da janela de recência). `Social Proof` fica inelegível por falta de evidência (seção 4) — o sistema não inventa um número de vendas nem um depoimento. A ideia usa `Newness` ou `Product Benefit` no lugar.

**3. Estoque parado sem promoção ativa**: `Urgency` fica inelegível — estoque parado é o oposto de escassez, e não há prazo real de promoção. O sistema usa `Comparison`, `Product Benefit` ou `Lifestyle/Aspiration` em vez de fingir urgência. Se a intenção comercial for de fato escoar estoque, a ação correta é o lojista criar uma promoção real (com prazo) — só então `Urgency` fica elegível de novo, com evidência.

**4. Conteúdo de marca sem produto principal**: um post de Founder Story ou Behind the Scenes pode ser gerado com `content_items.product_id = null` (schema precisa permitir isso, seção 7). `commerce_signals` não entra na decisão desse post porque não há SKU envolvido — a restrição de "Commerce decide o quê promover" (seção 6) só se aplica quando o post de fato promove um produto.

Um exemplo passa no critério de aceitação deste documento quando, pros 4 cenários acima, alguém consegue prever exatamente o que o sistema produz e por quê — inclusive nos casos em que a resposta certa é reconhecer que falta dado.

---

## 10. Histórico de decisões substituídas

Preservado pra rastreabilidade, não como regra ativa — o que vale hoje é o resto do documento.

- **Content Mix original (Patricia, 09/09/2026)**: 3 "papéis" (Comercial/venda, Valor/engajamento, Marca/lifestyle/storytelling), com regra de portfólio "~1 de cada papel por semana". Substituído pelas 4 categorias estratégicas (seção 2) — que por sua vez deixaram de ser propriedade fixa do pilar nesta reorganização (10/09/2026).
- **4 categorias como propriedade fixa do pilar (Patricia, 10/09/2026, especificação original da Fase 1)**: cada pilar tinha uma `growth_category` única e definitiva. Substituído por `typical_category` como prior, com a categoria real decidida por post (seção 2) — **mudança de schema/código ainda pendente**, ver nota abaixo.
- **Tabela "de onde vem o dado" com 2 estágios (buildável agora / não buildável)**: substituída pela tabela de 4 estágios da seção 3 (documentado → validado → implementado → produção).
- **"Ticket médio já derivável de `products_cache.price` agregado"**: impreciso — ticket médio precisa vir de pedidos reais, não de preço de tabela. Corrigido na seção 7.
- **Notas 0-10 em "curiosidade, relevância, compartilhamento, potencial de seguir, potencial de venda"**: liam como previsão de performance sem calibração. Substituídas pelo processo de eliminação + avaliação editorial da seção 6.
- **Fase 5 com 4 decisões (Parar/Manter/Dobrar/Testar)**: sem opção de reconhecer evidência insuficiente. Substituída pelas 5 decisões da seção 8 (acrescenta "Aguardar mais dados").
- **"5 fases" descritas mas 6 enumeradas (Fase 0 a 5)**: era inconsistência de contagem, não de conteúdo — a numeração 0-5 (6 fases) é a que vale, mantida nas seções 5-8.

### Decisão em aberto, não resolvida nesta reorganização

O código já implementado (`prisma/schema.prisma` → `ContentPillar.growthCategory`, e a tela `app/routes/app.content-pillars.tsx`) ainda trata categoria como campo único e fixo por pilar — o modelo antigo, não o `typical_category` desta versão. Migrar isso é uma mudança real de schema (nova migration) e de UI, em cima de uma feature que acabou de ser implementada e ainda está em teste. Não fiz essa migração sozinho porque é uma decisão de custo/benefício que cabe à Patricia: manter o campo único como simplificação aceita do MVP (a categoria "típica" já é uma aproximação razoável na maioria dos posts), ou migrar agora para `typical_category` + categoria decidida por post antes de destravar a Fase 2.
