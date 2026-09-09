# AI Commerce Content Manager

Projeto de Patricia Cossettin: um app Shopify que atua como gestor de marketing de conteúdo com IA, para vender como negócio paralelo à Mangará. Definido em 09/09/2026.

## Visão

Não é mais um agendador de redes sociais. É um sistema que decide **o que promover, por quê, quando e em qual canal**, com base nos dados reais da loja (Shopify) e no comportamento real dos clientes daquela marca — e só então gera o conteúdo.

Posicionamento central:
> "Your Shopify store knows what needs to sell. We turn it into content."

O problema que resolve: pequenos lojistas Shopify têm produtos, estoque, fotos e promoções, mas não têm departamento de marketing. Postam de forma inconsistente, esquecem datas comerciais, não usam dados de estoque na decisão de marketing, e gastam tempo demais criando legendas.

## Por que isso é diferente dos concorrentes (Buffer, Later, Vela, Seguno)

Conectar Shopify ao Instagram, chamar uma IA e agendar um post são problemas técnicos já resolvidos por vários concorrentes. **O valor real do produto — e o moat da empresa — está em decidir qual conteúdo tem maior probabilidade de gerar resultado comercial para aquela marca naquele momento**, não em gerar texto bonito.

O moat não vem de acesso a um modelo de IA (isso qualquer concorrente tem). Vem do sistema acumulado que entende Marca + Comércio + Estoque + Calendário + Mercado + Canal + Performance daquele merchant específico, e fica mais útil quanto mais tempo usa o produto.

## O cérebro em 5 camadas

Ordem importa: cada camada alimenta a seguinte. A IA nunca gera conteúdo direto — primeiro monta uma decisão estruturada, só depois escreve.

**1. Brand Intelligence — "Quem sou eu?"**
Estética, linguagem, posicionamento, público, faixa de preço, diferenciais, o que a marca deve/não deve dizer, estilo fotográfico. Responde como a marca deve se comunicar, não o que publicar amanhã.

**2. Commerce Intelligence — "O que preciso vender?"**
Estoque, vendas, preço, margem (quando disponível), produtos novos, bestsellers, slow movers, descontos, tamanhos disponíveis, collections. Um produto com 100 unidades parado há meses tem prioridade diferente de um com 3 unidades restantes.

**3. Customer Intelligence — "O que o consumidor quer?"** (a camada mais valiosa e mais difícil)
Aprende com performance real: Instagram/Facebook + tráfego/conversão Shopify + histórico de posts daquela marca. Exemplos do tipo de padrão que deveria emergir: produto no pé → mais engagement; close-up → menos likes mas mais visitas à página do produto; mensagem de "comfort" → melhor conversão. É aqui que a IA para de criar por criatividade genérica e passa a aprender o comportamento real dos clientes daquela marca.

**4. Commercial/Calendar Intelligence — "Por que agora?"**
Datas comerciais (Natal, Black Friday, Valentine's, Mother's Day etc.) + gatilhos internos (nova coleção, estoque excessivo, promoção, restock, lançamento).

**5. Creative Intelligence — "Como transformar tudo isso em conteúdo?"**
Só depois das quatro anteriores: produto + mensagem + formato + imagem + CTA + canal + horário.

### Content Decision Engine (o coração técnico do diferencial)

A IA não escreve post direto. Primeiro produz uma decisão estruturada, só depois gera o texto:

```
Commercial objective: Move slow inventory
Product: EVA Black
Audience: Women 30–50
Reason: High inventory / seasonal relevance
Channel: Instagram
Funnel stage: Consideration
Creative archetype: Product Benefit
Creative angle: All-day comfort without sacrificing style
Narrative framework: Hook → Value → Proof → CTA
Format: Lifestyle
CTA: Discover the collection
Uses AI image: Yes
```

Só então: `Generate Content`. Ver [ARCHITECTURE.md](ARCHITECTURE.md) para o desenho técnico de dois estágios (Decisão → Geração).

## Métrica de sucesso não é engagement — é objetivo declarado

Uma foto com 1.800 likes e 0 vendas não é melhor que uma com 430 likes e 17 pedidos, para este produto. O sistema separa objetivos, cada um com sua própria métrica de sucesso:

- **Awareness** → reach / views
- **Engagement** → saves / comments / shares
- **Traffic** → clicks
- **Conversion** → add-to-cart / orders / revenue
- **Inventory** → unidades movidas

O merchant escolhe a prioridade por campanha/post, ou deixa a IA decidir:
```
What's your priority?
◉ Increase sales
○ Grow audience
○ Increase engagement
○ Move inventory
○ Launch product
Ou: ◉ Let AI decide
```

`commercial_objective` é campo central do modelo de dados desde o Phase 1 — sem ele não dá pra medir se a Camada 3 está aprendendo a coisa certa.

## O problema do cold start (a limitação real da Camada 3)

Um lojista pequeno não gera volume de posts suficiente pra aprender nada estatisticamente confiável em semanas. Três mitigações, usadas juntas:

1. **Instrumentar desde o dia 1, aprender depois.** Todo post gerado grava sinais de performance mesmo antes da IA usá-los pra decidir. Em alguns meses o merchant tem histórico suficiente pra a camada pesar de verdade.
2. **Priors cross-merchant por nicho**, enquanto não há dados próprios — mais um motivo pra focar em um nicho vertical (ver abaixo) em vez de "qualquer lojista": marcas parecidas dão priors mais úteis desde o primeiro dia de cada novo cliente. Limitação: só funciona depois de já haver uma base própria de merchants do nicho gerando dados — tem seu próprio cold start no nível da empresa.
3. **Concorrentes indicados pelo merchant (ideia de Patricia, 09/09/2026).** No onboarding, o merchant cita 2 contas de Instagram que considera fortes no nicho. Via **Business Discovery API** do Instagram Graph API, dá pra ler dados públicos de posts recentes dessas contas (likes, comentários, legenda, formato, cadência) sem precisar de autorização delas — desde que a própria marca já tenha conta IG Business conectada. Isso funciona desde o primeiro cliente, sem depender de base própria.

   **Limite importante**: Business Discovery só expõe dados públicos (likes/comentários/legenda/formato/cadência). Reach, saves, cliques e — crucial — **dados de conversão/venda nunca estão disponíveis** para conta de terceiro, porque essa informação é privada do dono. Ou seja, essa fonte fortalece de verdade a Camada 5 (Creative Intelligence — referência de formato/tom/cadência do nicho) e dá um proxy fraco de engajamento pra Camada 3, mas **não substitui** o sinal de conversão real da própria marca, que é o ponto mais importante que a Camada 3 precisa aprender (engajamento alto ≠ venda). Ver `competitor_accounts` / `competitor_posts` em [ARCHITECTURE.md](ARCHITECTURE.md).

   **Decisão (Patricia, 09/09/2026): referência silenciosa, não placar visível.** Os dados dos concorrentes citados alimentam o Decision Engine por trás dos panos — nunca aparecem como comparação direta pro merchant no dashboard (nada de "você: 2.1% vs concorrente: 4.3%"). Motivo: um placar visível provavelmente mostraria o merchant sempre atrás (ele escolheu contas que já considera fortes), com risco real de desmotivar em vez de engajar; e rotular isso como "benchmark de performance" seria enganoso, já que a API só dá engajamento público, não venda. Se algum dia fizer sentido expor isso ao merchant, a forma preferida seria um gap acionável ligado a uma sugestão de conteúdo específica ("formato X engaja mais nas contas que você admira, quer testar no seu próximo post?"), não um scoreboard genérico — mas isso não está no escopo do MVP.

   **A referência de concorrente é um bootstrap temporário, não uma fonte paralela permanente (Patricia, 09/09/2026).** Assim que a própria marca acumula dados suficientes de engajamento/posts, o app precisa aprender com o histórico dela mesma, não continuar se apoiando no concorrente. O peso do concorrente no Estágio 1 do Decision Engine decai conforme o volume de `performance_signals` próprios cresce, até a referência de concorrente virar só contexto de estilo secundário (ou sumir da decisão). Ver mecanismo de peso em [ARCHITECTURE.md](ARCHITECTURE.md).

Atribuição de clique em post orgânico do Instagram não existe de graça (feed não tem link clicável nativo) — precisa de link curto próprio com UTM por post, casado com pedidos no Shopify. É engenharia real, mas totalmente construível, e precisa entrar no escopo cedo — sem isso a Camada 3 vira só engagement, a métrica errada.

## Diferenciação e posicionamento

**Vertical, não genérico.** Focar em moda/calçado/acessórios DTC em vez de "qualquer lojista Shopify". Patricia já tem, pela própria Mangará, know-how testado em produção sobre fidelidade de imagem de produto gerada por IA (ver regras detalhadas em `/Users/patriciacossettin/Mangara-Nano-Banana/CLAUDE.md`) — isso é propriedade acumulada que concorrentes genéricos não têm, e pode virar um "Product Fidelity Engine" como feature própria (detectar erros como salto descolado, checar contraste sapato/fundo, comparar com still original antes de publicar).

**Europeu e multilíngue como ângulo central, não nota de rodapé.** Concorrentes (Buffer, Later, Vela, Seguno) são EN-first/US-first. Calendário comercial por país + conteúdo nativo em FR/DE/NL/PT é cunha real contra eles.

**Compliance-by-design como argumento de venda.** GDPR nativo, dados hospedados na UE — argumento forte pra lojistas europeus desconfiados de apps americanos.

**Vender resultado de negócio, não feature list.** Menos devolução, mais conversão — não "gerador de conteúdo".

## Modelo de negócio e custos (validado em 09/09/2026)

Patricia é desenvolvedora — o MVP é construído por ela mesma, então o custo dominante é tempo/oportunidade (competindo com a gestão da Mangará), não contratação. Custos diretos de infraestrutura para um MVP validado ficam abaixo de ~€100/mês.

Gargalos que não são de dinheiro, são de tempo/processo:
- **Meta App Review** para permissão de publicação do Instagram — confirmar o nome exato do scope vigente no momento da implementação (mudou de `instagram_content_publish` pra `instagram_business_content_publish` entre a escrita deste documento e set/2026; nomes de permissão da Meta mudam com frequência, ver detalhe verificado em [ARCHITECTURE.md](ARCHITECTURE.md)). 2-4 a 2-6 semanas, precisa começar cedo e em paralelo ao dev — mas não é bloqueio pro piloto com a própria conta da Mangará, que roda em modo tester sem exigir review.
- **Aprovação na Shopify App Store**: exige webhooks GDPR obrigatórios (`customers/redact`, `shop/redact`, `customers/data_request`), HTTPS, verificação HMAC.
- **CAC**: a App Store não dá tráfego de graça — SEO, conteúdo, parcerias com agências Shopify ou anúncios pagos são necessários.

Custo variável a monitorar desde o dia 1: geração de imagem (agora dentro do Phase 1, ver Image MVP em [ARCHITECTURE.md](ARCHITECTURE.md)) pode corroer a margem se não houver limite de créditos por plano — logar custo por geração (`generation_logs`) desde o MVP, e contar custo real por chamada, não por imagem aprovada (se o merchant clica Regenerate 3x, foram 4 gerações pra entregar 1 imagem útil).

### Hipótese de preço do plano Starter (09/09/2026 — validar com dados reais antes de fixar)

| Starter — €9,90/mês | Incluído |
|---|---|
| Posts gerados | ~12/mês |
| Frequência sugerida | 3/semana |
| AI images | ~5/mês |
| Posts usando foto existente do Shopify | ilimitados, dentro dos 12 |
| Regenerar legenda/objetivo | ilimitado, não consome quota (só conta quando o conteúdo entra no calendário) |
| Instagram + Facebook, Content Decision Engine, calendário comercial, scheduling, brand profile, performance tracking | ✓ |
| Imagens extras além das 5 | compradas separadamente, cobrança pontual |

**Esses números são hipótese, não preço fechado.** A lógica de 12 posts/3 por semana é o equilíbrio entre "o merchant sente que o app está cuidando de verdade das redes" e "não incentivar conteúdo ruim só pra preencher calendário". As 5 imagens de IA por ~12 posts partem da ideia de que nem todo post precisa de imagem gerada — só o de maior prioridade da semana (ver alocação semanal em [ARCHITECTURE.md](ARCHITECTURE.md)), o resto usa fotografia já existente da loja. Os números exatos (5? 8? 3?) só devem ser fixados depois de medir o custo real por imagem via `generation_logs` durante o piloto.

**Posicionamento de venda**: não vender como "12 posts", vender como plano de conteúdo pronto. Exemplo de semana que o app monta sozinho:
- Segunda: produto estratégico (prioridade por Commerce Intelligence) + foto existente da loja
- Quarta: conteúdo de engagement/storytelling (arquétipo Behind the Scenes/Founder Story) + foto existente
- Sexta: conteúdo comercial (arquétipo Urgency/Social Proof) + imagem de IA (o "hero" da semana, dentro do orçamento de crédito)

Na semana seguinte a estratégia muda conforme estoque, calendário, objetivo e resultados anteriores. Linha de venda: **"€9.90/month — AI decides what to promote, creates your posts and includes 5 AI product creatives every month."**

**Validação concreta planejada com a própria Mangará**: o sistema decide promover uma sandália com estoque alto, escolhe o arquétipo "Product Benefit" com ângulo comfort + summer versatility, gera a legenda e uma imagem lifestyle mantendo o sapato fiel ao original. Esse é o teste real do produto completo (decisão + copy + imagem fiel), não uma versão cortada dele.

## Regra de faseamento

Não construir Phase 2 antes de validar Phase 1 (brief original, seção 45, reforçada nesta revisão). Dado o cold start da Camada 3, a sequência recomendada é:

- **Phase 1**: Camadas 1 (Brand, via questionário curto no onboarding), 2 (Commerce, viável dia 1 com dados Shopify), 4 (Calendar, baseada em regras/datas fixas) e 5 (Creative, já como Decision Engine de dois estágios). Instrumentação da Camada 3 (tracked links + captura de sinais) começa aqui, mesmo sem uso ativo ainda.
- **Phase 2**: Camada 3 liga de verdade quando já existe histórico suficiente por merchant (ou priors cross-merchant do nicho).

Antes de escrever a plataforma completa: validar manualmente com um grupo piloto pequeno (3-5 marcas de moda/calçado pequenas) se a dor e o preço são reais.

## Documentos deste projeto

- [ARCHITECTURE.md](ARCHITECTURE.md) — arquitetura técnica do MVP (stack, AI Provider Layer, modelo de dados, fluxo OAuth, Decision Engine em dois estágios, Image MVP).
- [MARKETING-KNOWLEDGE.md](MARKETING-KNOWLEDGE.md) — arquétipos criativos e frameworks narrativos que alimentam o Estágio 2 do Decision Engine.
