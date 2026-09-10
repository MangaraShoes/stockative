# Arquitetura técnica — MVP

Ver [CLAUDE.md](CLAUDE.md) para a visão de produto e o modelo de 5 camadas que esta arquitetura implementa. Este documento cobre só o desenho técnico.

## Stack

| Camada | Escolha | Por quê |
|---|---|---|
| Framework do app | React Router v7 + `@shopify/shopify-app-react-router` | Scaffold oficial da Shopify em set/2026 — resolve OAuth, sessão, webhooks e verificação HMAC de fábrica. **Correção de 09/09/2026**: Remix e React Router se fundiram (RR v7); a Shopify migrou a recomendação de `shopify-app-template-remix` para `shopify-app-template-react-router` — o pacote Remix só serve pra quem já tem app existente em Remix, não pra projeto novo. [Fonte](https://github.com/Shopify/shopify-app-template-react-router). |
| ORM / DB | Prisma + Postgres | Vem pronto no template oficial. Postgres gerenciado: Supabase, Neon ou Railway. |
| Hosting | Railway ou Fly.io | Precisa de processo persistente (webhooks + worker), não só serverless. |
| Job/scheduler | Worker próprio, polling a cada 1-5 min | Fila robusta (BullMQ/Redis) é complexidade desnecessária nesse volume inicial. |
| Geração de texto/imagem | **AI Provider Layer** — não amarrado a um provedor (ver seção própria abaixo) | Claude, OpenAI, Gemini para texto; Nano Banana para imagem; Runway/Hailuo/Veo para vídeo depois. `generation_logs` já loga modelo/custo por chamada. |
| Billing | Shopify Billing API (`AppSubscription` + cobrança pontual pra pacote de créditos) | Evita escopo de PCI, integra nativamente com checkout da própria Shopify. |
| Tracking de clique | Redirecionador próprio (short link + UTM) | Instagram orgânico não expõe clique por post nativamente — necessário para a Camada 3 (Customer Intelligence). |

## AI Provider Layer

Nenhuma tarefa de IA fica amarrada a um provedor único (decisão de Patricia, 09/09/2026). Uma interface comum — `generateStructured(schema, prompt)` para output estruturado, `generateText(prompt)` para texto livre, `generateImage(prompt, referenceImages)` para imagem — é implementada por adapter de cada provedor (Anthropic, OpenAI, Gemini/Nano Banana, e depois Runway/Hailuo/Veo para vídeo). O roteamento por tarefa é configuração, não código hardcoded — trocar de modelo não deveria exigir redeploy:

```
task_model_config = {
  decision_engine: { provider: 'anthropic', model: '...' },   // barato, forte em structured output
  creative_copy:    { provider: 'anthropic', model: '...' },  // forte em linguagem/branding — testar vs. outros
  translation:      { provider: '...', model: '...' },        // avaliar API de tradução dedicada vs. LLM genérico
  image:            { provider: 'google', model: 'gemini-2.5-flash-image' },  // Nano Banana
  video:            { provider: 'runway' },                   // Phase 2+
}
```

`generation_logs` ganha um campo `task_type` (decision_engine|creative_copy|translation|image|video) para comparar custo/qualidade por tarefa entre provedores — sem isso o log só diz custo total, não onde vale trocar de modelo.

Escopo do MVP: construir a interface (pra troca ser config, não reescrita), mas ligar só um provedor de texto por tarefa no v0 — não é chamar 3 provedores em paralelo desde o dia 1, só não fechar a porta pra isso depois.

## Fluxo de dados

```
Shopify Store
   │  OAuth + webhooks (products/update, app/uninstalled, GDPR)
   ▼
App Backend (React Router v7 + Shopify App package)  ──►  Postgres
   │        │
   │        ▼
   │   Worker (cron 1-5min)
   │        ├──► Meta Graph API (publica quando scheduled_at vence)
   │        ├──► Token refresh (long-lived tokens Meta expiram em 60d)
   │        └──► Coleta de performance_signals (Meta Insights + cliques do redirecionador + pedidos Shopify)
   │
   ├──► AI Provider Layer → Decision Engine (structured output, Estágio 1)
   ├──► AI Provider Layer → Creative Copy (geração de texto/criativo, Estágio 2)
   └──► Meta Graph API (post now / criação de container IG)
```

## Content Decision Engine — geração em dois estágios

Não é um prompt só. A IA nunca escreve texto de marketing antes de produzir uma decisão estruturada.

```
Estágio 1 — Decisão (structured output / JSON schema, sem gerar texto de marketing)
  Input: produto + Commerce Intelligence (estoque, vendas, margem) +
         Calendar Intelligence (datas comerciais) +
         Customer Intelligence (se já houver dados; senão, priors por nicho) +
         objetivo escolhido pelo merchant (ou "let AI decide")
  Output: { objective, product, audience, reason, channel,
            funnel_stage, creative_archetype, creative_angle,
            narrative_framework, format, cta, uses_ai_image }

Estágio 2 — Geração (texto/criativo)
  Input: o JSON do estágio 1 + Brand Intelligence (tom, vocabulário, proibições)
  Output: legenda + hashtags + CTA final
```

`creative_archetype`, `creative_angle` e `narrative_framework` vêm da [Marketing Knowledge Layer](MARKETING-KNOWLEDGE.md) — sem esses campos o Estágio 2 tende a regredir pra copy genérica mesmo com ótimos dados de Commerce/Calendar/Customer Intelligence por trás. São três decisões diferentes, não uma: `creative_archetype` é a categoria estratégica (enum restrito, escolhido de um shortlist de 2-4 elegíveis pro objetivo/situação do produto, não livremente entre os 12); `creative_angle` é a mensagem específica gerada dentro daquele arquétipo pra aquele produto (texto livre, não enum — ex.: arquétipo `Product Benefit` pode gerar o ângulo "All-day comfort without sacrificing style" num post e "Comfort that keeps up with your commute" noutro, mesmo produto, mesmo arquétipo); `narrative_framework` é o esqueleto estrutural do texto.

Vantagem prática: já é diferenciador no Phase 1, mesmo sem histórico de performance (Camada 3) — decidir com base em Commerce + Calendar Intelligence já é muito melhor que "escreva um post para X". Custo extra é baixo (uma chamada de LLM a mais, a primeira com output estruturado).

### Planejamento semanal como portfólio, não posts isolados

Ponto de Patricia (09/09/2026): decidir cada post isoladamente, mesmo que cada decisão seja individualmente defensável, pode produzir uma semana desequilibrada (ex.: Product Benefit / Product Benefit / Urgency, todos vendendo, nada de marca ou engajamento). O planejamento semanal precisa pensar no conjunto antes de decidir cada slot. Ver "Content Mix" em [MARKETING-KNOWLEDGE.md](MARKETING-KNOWLEDGE.md) para o mapeamento de arquétipos em papéis (comercial / valor-engajamento / marca-lifestyle) e a regra de portfólio (~1 de cada papel nos 3 posts da semana, soft constraint, não regra fixa). O Estágio 1 roda em dois níveis: primeiro aloca papéis aos slots da semana, depois escolhe produto/arquétipo/ângulo dentro de cada papel.

### Alocação de crédito de imagem

**Regra de composição, mudou em 09/09/2026 (Patricia): nenhum post é feito só de foto still — fica pobre.** Todo post sempre tem uma imagem **editorial** (com ambiente/modelo, fonte = `creative_assets`, nunca gerada a partir de still puro) na posição 1 da sequência; as fotos still da galeria do Shopify (`product_images`), quando o produto tem, entram depois, nunca sozinhas cobrindo o post inteiro. Isso substitui o desenho anterior desta seção, que assumia que um post "sem crédito de imagem" ficava só com `creative_assets.source = shopify_existing` como imagem única — esse caminho não existe mais como opção válida de composição.

O que isso muda na pergunta de custo: a decisão do Estágio 1 deixa de ser *"este post ganha imagem de IA, sim ou não"* e passa a ser *"este post ganha uma imagem de IA **nova**, ou reaproveita uma editorial já gerada para este produto que ainda não foi usada como capa em nenhum post"* — a editorial de posição 1 nunca se repete como capa pro mesmo produto (é sempre nova ou uma ainda-não-usada), mas as stills de apoio podem repetir livremente. Reaproveitar uma editorial existente não consome crédito novo (mesma lógica de `creative_assets` reutilizável entre canais, já documentada abaixo). Regra v0 pra decidir quando vale gerar uma editorial nova (não aprendida — mesma limitação de cold start da Camada 3): ranquear os posts da semana pela prioridade já calculada por Commerce Intelligence (estoque/vendas) + relevância de calendário + peso do objetivo comercial; o post de maior prioridade da semana recebe `uses_ai_image: true` (= gera editorial nova); os demais reaproveitam a editorial mais recente e ainda não usada daquele produto, ou uma delas se o produto nunca teve uma editorial gerada e não é a prioridade da semana — nesse caso o merchant é avisado que aquele post específico vai precisar de uma geração fora do fluxo automático, ou pode comprar crédito extra.

**Não implementado ainda**: o código atual (`buildCarousel.server.ts`) já resolve corretamente o reaproveitamento por produto (nunca repete a editorial como capa), mas a ligação com a *alocação semanal de crédito* acima — decidir quando vale gerar uma editorial nova vs. forçar reaproveitamento mesmo sem uma disponível — ainda não existe; hoje toda chamada a `buildCarousel` gera uma editorial nova sempre que não há uma sobrando, sem olhar pro orçamento da semana.

**Hipótese inicial a validar, não regra assumida (Patricia, 09/09/2026)**: hoje o peso favorece dar imagem de IA a posts de `conversion`/`inventory`, por parecer intuitivo que esses objetivos mais se beneficiam de prova visual forte. Mas pode ser o oposto: uma imagem lifestyle forte pode gerar mais awareness → tráfego → venda futura, enquanto posts de conversão podem performar melhor com fotografia real do produto, que transmite mais confiança que uma imagem gerada. Essa é exatamente a pergunta que o próprio produto deve responder com o tempo — assim que `performance_signals` tiver volume suficiente, a alocação de crédito por objetivo vira mais uma variável testável (mesma lógica de handoff regra→aprendizado da Camada 3 e do arquétipo, ver MARKETING-KNOWLEDGE.md), não uma regra fixa pra sempre.

## Modelo de dados

```
shops
  id, shopify_domain, access_token (encriptado), plan, installed_at, uninstalled_at

social_accounts
  id, shop_id, platform [instagram|facebook], access_token (encriptado),
  expires_at, ig_business_account_id, fb_page_id

products_cache
  id, shop_id, shopify_product_id, shopify_variant_id (nullable —
    preenchido quando o detalhe por variante importa, ex. tamanho
    específico em falta; decisão de conteúdo por padrão opera no
    nível de produto, agregando variantes),
  title, description, price, compare_at_price, inventory_quantity,
  product_type, tags, collections, image_url, status,
  shopify_created_at, updated_at

commerce_signals   (materializado por job periódico, não calculado
  on-the-fly a cada decisão — evita estourar rate limit da Admin API
  toda vez que o Decision Engine precisa ranquear produtos)
  product_id (FK products_cache), units_sold_7d, units_sold_30d,
  revenue_30d, sales_velocity, days_since_last_sale,
  inventory_age_days, margin (nullable — Phase posterior, Shopify
  não expõe custo de forma uniforme pra todo catálogo), computed_at

content_items
  id, shop_id, product_id, platform,
  commercial_objective [awareness|engagement|traffic|conversion|inventory],
  decision_brief (JSON do estágio 1, guardado para auditoria/aprendizado),
  caption_text, hashtags, cta, creative_asset_id,
  status [draft|approved|scheduled|published|failed],
  scheduled_at, published_at, external_post_id, tracked_link_id

tracked_links
  id, content_item_id, short_code, utm_params, click_count

performance_signals
  content_item_id, platform, reach, likes, comments, saves, shares,
  clicks, product_page_visits, add_to_cart, orders, revenue,
  captured_at

generation_logs
  content_item_id, task_type [decision_engine|creative_copy|translation|image|video],
  model, tokens_used, cost_estimate,
  passed_fidelity_check (boolean, só relevante pra task_type=image),
  counts_as_credit (boolean), created_at

creative_assets
  id, shop_id, product_id, image_url,
  source [shopify_existing|ai_generated], generation_log_id (nullable),
  created_at

image_credit_purchases
  id, shop_id, credits_purchased, price_paid, purchased_at

competitor_accounts
  id, shop_id, instagram_username, added_at

competitor_posts   (sync periódico via Instagram Graph API — Business Discovery)
  id, competitor_account_id, ig_media_id, caption, media_type,
  like_count, comment_count, posted_at, permalink, synced_at
```

`competitor_accounts`/`competitor_posts` mitigam o cold start da Camada 3 desde o primeiro cliente: no onboarding, o merchant indica 2 contas do Instagram que considera fortes no nicho, e um job periódico consulta a **Business Discovery API** (endpoint do Instagram Graph API que expõe dados públicos de qualquer conta Business/Creator pública, sem precisar de autorização dela — requer só que a conta IG Business da própria marca já esteja conectada). Retorna likes, comentários, legenda, tipo de mídia, data — nunca reach, saves, cliques ou conversão, que são privados do dono. Os agregados (formato mais comum, taxa média de engajamento por tipo de post, tom/cadência) entram no Estágio 1 do Decision Engine como "referência de estilo do nicho", **separados** de `performance_signals` (dados reais da própria marca) para nunca confundir proxy público de engajamento com sinal de conversão real na hora de aprender. Referência silenciosa, nunca exposta como placar no dashboard (decisão de 09/09/2026, ver [CLAUDE.md](CLAUDE.md)).

**Handoff de peso: concorrente é bootstrap, não fonte permanente.** O Estágio 1 calcula um peso pra própria marca com base no volume de `performance_signals` já capturado, ex.:

```
own_data_points = count(content_items com performance_signals capturado, por shop)
weight_own = min(1, own_data_points / 15)   // 15 é ponto de partida, validar na prática
weight_competitor = 1 - weight_own
```

Enquanto `weight_own` é baixo (marca recém-instalada), a referência de concorrente pesa mais no contexto do Estágio 1. Conforme `own_data_points` cresce (ordem de grandeza: 15-20 posts com sinal capturado, tipicamente 60-90 dias de uso), `weight_competitor` tende a zero e a decisão passa a se apoiar no histórico real da própria marca — a referência de concorrente vira só contexto de estilo secundário, nunca mais proxy de engajamento.

`generation_logs` existe desde o MVP para calcular custo real de IA por cliente antes de fixar preço definitivo, e depois virar base de limite de créditos por plano.

**Consumo de quota e crédito é sempre derivado, nunca um contador duplicado** (evita inconsistência entre contador e realidade):
- **Quota de posts** (~12/mês no Starter): conta `content_items` com `status IN (scheduled, published)` dentro do ciclo de cobrança. Regenerar legenda/objetivo várias vezes num rascunho não consome quota — só conta quando o conteúdo entra de fato no calendário/publicação. **Geração manual continua sempre disponível** (Patricia, 09/09/2026), inclusive depois da quota mensal esgotada — nesse caso o merchant compra créditos extra de post avulsos, sem teto de quantidade (mesmo modelo de cobrança pontual do crédito de imagem, tabela `post_credit_purchases`, ainda não criada). Ainda não implementado: hoje nada no código marca `content_item` como `scheduled`/`published` (não existe calendário/scheduling nem publicação real), então o enforcement de quota não tem como disparar de fato até essa peça existir — a quota por enquanto é só a promessa comercial, não uma trava no produto.
- **Crédito de imagem** (~5/mês no Starter): **1 crédito = 1 imagem válida entregue ao merchant, não 1 chamada de API** (correção de Patricia, 09/09/2026 — a versão anterior isentava a 1ª geração de cada post, o que desalinhava da promessa comercial de "5 AI product creatives per month"). `generation_logs` grava `counts_as_credit = true` só na geração que **passa** a checagem de fidelidade (`passed_fidelity_check = true`) e é mostrada como pronta — seja na 1ª tentativa ou depois de um retry interno. Qualquer tentativa que falha a checagem (rejeitada antes de chegar ao merchant) grava `counts_as_credit = false`, seja 1ª tentativa, retry interno, ou reação a um "Regenerate" do merchant que também falhou. Exemplo: geração 1 falha fidelidade → 0 crédito; retry interno passa → 1 crédito (entregue); merchant pede Regenerate e a nova versão passa → +1 crédito. O número de retries internos por falha continua limitado (ex.: 2 tentativas antes de sugerir a foto original) — esse limite protege o custo de infra da empresa, não decide o que é cobrado do merchant, que só paga por imagem que de fato recebe. Saldo restante fica visível na UI antes de cada pedido de Regenerate. Sem crédito disponível, o botão vira "comprar mais créditos" (cobrança pontual via Shopify Billing, gravada em `image_credit_purchases`).
- Uma mesma `creative_asset` (1 crédito gasto) pode ser referenciada por mais de um `content_item` — por exemplo, o mesmo criativo de IA usado no post do Instagram e replicado no Facebook não gasta um segundo crédito.

`commercial_objective` e `decision_brief` existem desde o MVP porque são o que permite, mais tarde, medir se a Camada 3 está aprendendo a métrica certa — sem eles não dá pra nunca avaliar isso.

**Como `commerce_signals` é preenchido** (correção de Patricia, 09/09/2026 — o schema anterior de `products_cache` não sustentava a promessa de "estoque alto + vendas baixas = prioridade alta" no fluxo do usuário): precisa de escopo `read_orders` além dos escopos de produto, e um job periódico (worker, o mesmo cron do scheduling, rodando por exemplo 1x/dia) que agrega pedidos recentes por produto e recalcula `units_sold_7d/30d`, `revenue_30d`, `sales_velocity`, `days_since_last_sale`. Não calcular isso on-the-fly a cada vez que o Decision Engine precisa ranquear produtos — estouraria rate limit da Admin API rápido num catálogo de centenas de SKUs. `inventory_age_days` deriva de `products_cache.shopify_created_at`. `margin` fica nullable no MVP — Shopify não expõe custo de forma uniforme pra todo catálogo sem o merchant preencher `cost_per_item` manualmente, o que não dá pra assumir que existe.

## OAuth — os dois pontos de atrito

**Shopify**: trivial com `@shopify/shopify-app-react-router`. Único trabalho extra: registrar os webhooks obrigatórios de GDPR (`customers/redact`, `shop/redact`, `customers/data_request`) — sem eles a Shopify recusa aprovação na App Store.

**Meta (Instagram/Facebook)** — reverificado via busca em 10/09/2026 na hora de implementar de fato (a versão de 09/09 tinha o nome de escopo errado, corrigido abaixo):
- Lojista precisa ter Página do Facebook ligada a conta Instagram Business/Creator (Professional).
- **Fluxo escolhido: Facebook Login for Business** (não o mais novo "Instagram API with Instagram Login", que dispensa Página do Facebook mas não dá acesso a Business Discovery) — necessário porque `competitor_accounts`/Business Discovery (ver acima) só existe nesse fluxo clássico, e não faz sentido manter dois fluxos de OAuth Meta diferentes no mesmo app.
- Escopos confirmados pra esse fluxo: `pages_show_list`, `instagram_basic`, `instagram_content_publish`, `pages_read_engagement`. **`instagram_business_content_publish` é de outro fluxo (Instagram Login) e não se aplica aqui** — reverter qualquer menção anterior a esse nome nesta seção.
- É permissão restrita — exige App Review da Meta (vídeo demo, política de privacidade pública, verificação de negócio). 2-4 a 2-6 semanas, múltiplas rodadas de submissão são comuns, recusa na primeira tentativa é normal.
- Publicação no Instagram é em 2 passos: `POST /{ig-user-id}/media` (cria container, só aceita `image_url` apontando pra um JPEG publicamente acessível) → `POST /{ig-user-id}/media_publish` (publica, usa o `creation_id` do passo anterior). Carrossel é 3 passos: um container por imagem com `is_carousel_item=true`, depois um container "pai" com `media_type=CAROUSEL` e `children=[ids]`, depois publicar o pai.
- **Importante pro piloto**: publicar só na própria conta (modo desenvolvedor, dando papel de "Instagram Tester" pra conta) **não exige App Review**. A revisão só é obrigatória quando contas de terceiros (outros merchants) se conectam ao app. Ou seja, o piloto com a própria Mangará (ver [CLAUDE.md](CLAUDE.md)) pode rodar publicação real sem esperar a fila de revisão — só precisa entrar na fila quando for abrir pra outros merchants.
- Usa o token da **Página** (obtido via `/me/accounts` depois do login), não o token de usuário — é o que a Graph API espera pra publicar em nome da conta Instagram ligada àquela Página.

**Mitigação de velocidade pra quando já for multi-merchant**: enquanto o App Review de produção não sai, gerar a legenda e mostrar um botão "copiar e abrir Instagram" em vez de publicar via API — valida a demanda sem esperar semanas.

## Fluxo do usuário (Phase 1)

1. Instala o app → OAuth Shopify → sync inicial de produtos (GraphQL paginado) para `products_cache`.
2. Onboarding curto de Brand Intelligence (questionário, não IA analisando o site ainda).
3. Lista produtos no dashboard, com prioridade calculada pela Commerce Intelligence (estoque alto + vendas baixas = prioridade alta, etc.) → clica "Create Content".
4. Merchant escolhe objetivo (ou "Let AI decide") → Estágio 1 do Decision Engine monta o brief → Estágio 2 gera o texto.
5. Preview → Edit / Regenerate / Post Now / Schedule / Skip.
6. **Post Now**: chama Meta Graph API direto (ou mostra "copiar e abrir Instagram" na v0 pré-App-Review).
7. **Schedule**: grava em `content_items` com `status=scheduled`; worker publica quando `scheduled_at` vence.
8. Link do post é um `tracked_link` com UTM próprio → cliques e pedidos Shopify casados por UTM alimentam `performance_signals`, mesmo antes da Camada 3 estar "ligada" para decisão.

## Segurança/compliance não-negociáveis

- Tokens (Shopify e Meta) encriptados em repouso.
- Webhooks de GDPR implementados e respondendo dentro do prazo exigido.
- No `app/uninstalled`: revogar tokens, marcar loja inativa, agendar exclusão de dados.
- Política de privacidade e termos publicados antes de submeter para review.

## Image MVP (revisão de escopo, Patricia, 09/09/2026)

Geração de imagem **entra no Phase 1**, mas numa forma deliberadamente pequena — não o Image Studio completo do brief original. Motivo: se a estratégia e a legenda forem ótimas mas a imagem for sempre a foto de still crua do Shopify, o MVP testa uma versão artificialmente fraca da proposta central do produto.

Fluxo:
```
Foto do produto (Shopify) → decision_brief do Estágio 1 do Decision Engine
  → geração de imagem (Nano Banana) com regras rígidas de fidelidade de produto
  → checagem automática de fidelidade (verificador de IA compara gerada vs. original)
  → preview pro merchant → approve / regenerate → usada no post
```

Sem edição avançada, sem múltiplos formatos por imagem, sem vídeo, sem galeria — isso é Phase 2 (Image Studio completo do brief original).

**Guardrail de fidelidade**: antes de mostrar a imagem como "pronta" pro merchant, uma segunda chamada de IA compara a gerada com a foto original e sinaliza problema óbvio (proporção, cor, geometria — as mesmas categorias de erro já documentadas na prática real da Mangará, ver `/Users/patriciacossettin/Mangara-Nano-Banana/CLAUDE.md`). Se falhar, até 1 retry automático interno; tentativas rejeitadas não consomem crédito. Se o retry passar e a imagem for entregue ao merchant, consome 1 crédito conforme a regra acima. Se falhar de novo, o sistema sugere usar a foto original do Shopify em vez de forçar uma imagem ruim.

**Alocação de crédito por semana**: ver "Alocação de crédito de imagem" na seção do Decision Engine acima — todo post sempre tem uma editorial (nova ou reaproveitada), mas só o post de maior prioridade da semana ganha uma editorial **nova**, dentro do orçamento do plano; os demais reaproveitam uma já gerada para aquele produto.

Segue fora do MVP: Pinterest/TikTok, multi-mercado, criação automática de promoção Shopify. Camada 3 (Customer Intelligence) entra em modo instrumentação apenas — não decide nada ainda no Phase 1.

## Estimativa de tempo (Patricia programando)

- Scaffold Shopify (OAuth, webhooks, sessão): 2-3 dias
- Sync de produtos + Commerce Intelligence (scoring de prioridade): 2-3 dias
- AI Provider Layer (interface + 1 provedor ligado): 1-2 dias
- Decision Engine (dois estágios, com Marketing Knowledge Layer) + UI de geração: 4-5 dias
- Image MVP (geração + guardrail de fidelidade + alocação semanal de crédito): 4-5 dias
- Meta OAuth + publicação (sem contar espera do App Review): 3-5 dias
- Tracked links + captura de performance_signals: 2 dias
- Calendário/scheduling + planejamento semanal: 2-3 dias
- Billing via Shopify (assinatura + compra pontual de créditos): 2-3 dias

Total: ~6-7 semanas de trabalho focado, rodando em paralelo com a submissão do App Review da Meta (maior lead time, não maior esforço).
