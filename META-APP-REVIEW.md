# Meta App Review — Instagram Advanced Access

Rascunho de submissão pra liberar publicação automática no Instagram (`instagram_content_publish`) e insights (`instagram_manage_insights`) pra qualquer lojista, não só contas cadastradas como tester no app da Meta. Verificado contra a documentação oficial da Meta em 23/09/2026 — os nomes de escopo abaixo já foram confirmados atuais (ver `app/services/meta/graphApi.server.ts` pro histórico de por que isso já mudou antes).

## Descoberta em 23/09/2026: também precisa virar Tech Provider

Além do App Review normal, a Meta agora exige que qualquer app que publique em nome de VÁRIOS negócios diferentes (não só o seu próprio) seja identificado como **Tech Provider** — processo separado, independente do App Review (ver [Tech Providers](https://developers.facebook.com/docs/development/release/tech-providers)). Sem isso, nenhuma das 7 permissões abaixo pode ser concedida por um lojista que não tenha papel no app.

No App Dashboard: Dashboard → **Become a Tech Provider** → confirmar "Yes, I'm a Tech Provider" (decisão irreversível, mas obrigatória pro modelo de negócio da Stockative) → isso libera 3 sub-etapas:
1. **Business verification** — já estava ✅ (Mangará aparece "Verified" no painel, ID 164885676118621).
2. **Access verification** — formulário próprio (categoria do negócio = SaaS Platform; descrição de uso; portfolio único; link do site). Meta revisa em até 5 dias.
3. **App Review** — as 7 permissões abaixo.

## Antes de submeter (bloqueadores reais)

- [x] **Business Verification** — já feita (Mangará verificada no painel da Meta).
- [x] **Política de Privacidade** — publicada como seção da landing: `https://stockative.com/#privacy` (atenção: `stockative.com/privacy` dá 404 — é âncora, não rota).
- [x] **Terms of Service** — `https://stockative.com/#terms` (mesma observação: âncora na landing).
- [x] **Data Deletion Instructions** — coberto na própria Privacy Policy (webhook de desinstalação + pedido manual via privacy@stockative.com).
- [ ] Confirmar que a conta da Mangará continua funcionando como tester enquanto o review não sai (não bloqueia o piloto).

## Nota sobre posicionamento (23/09/2026)

As descrições abaixo diziam "small fashion/footwear brands", seguindo o texto mais antigo do CLAUDE.md ("vertical, não genérico"). Um comentário no código de 14/09/2026 registra que isso mudou ("queremos vender o app para todo o tipo de loja", `imagingCategory` já suporta apparel/jewelry/home_decor além de footwear) — o CLAUDE.md ainda não foi atualizado pra refletir essa decisão. As descrições de uso abaixo já foram ajustadas pra "small e-commerce brands" (mais amplo, evita ter que resubmeter depois), mas vale confirmar/fechar essa mudança de posicionamento no CLAUDE.md separadamente.

## Fluxo de conexão usado no app

Social accounts → botão Connect → dialog OAuth da Meta → volta pro app mostrando a conta Instagram Business conectada (username, foto). Esse é o fluxo que aparece em quase todo screencast abaixo — grava uma vez esse trecho e reaproveita nos que pedem "o login completo do Instagram".

---

## `instagram_basic`

**Descrição de uso:**
> Stockative is a Shopify app that helps small e-commerce brands plan and publish Instagram content automatically, based on their store's real inventory and sales data. We use instagram_basic for three things, all for the merchant's own connected Instagram Business account: (1) right after the merchant connects their account in our "Social accounts" screen, we read its basic profile info (username, ID, profile picture) to confirm the correct account was linked and display it back to them; (2) we read the account's own recent media (caption, media type, like and comment counts, timestamp) so our content engine can learn which of the brand's past posts performed best; (3) in the "Competitor accounts" screen, the merchant can optionally enter the usernames of up to 2 public Instagram Business/Creator accounts they admire in their niche, and we use Business Discovery to read those accounts' public profile and recent public posts (caption, media type, like and comment counts). This public data is only used as style/format reference inside our content decisions; it is never displayed as a comparison or scoreboard, and we never access any private data from those accounts.

**Screencast:** login completo do Instagram no app (Social accounts → Connect → dialog OAuth → volta pro app mostrando username/foto da conta conectada) + tela **Competitor accounts** adicionando um username e mostrando o perfil público encontrado.

---

## `pages_show_list`

**Descrição de uso:**
> Our app requires pages_show_list to list the Facebook Pages the merchant manages, so we can identify which Page is linked to their Instagram Business account during the connection flow in Social accounts. This is a required step before we can retrieve the merchant's Instagram Business Account ID for publishing.

**Screencast:** mesmo fluxo de conexão, mostrando a etapa de seleção/identificação da Página vinculada.

---

## `pages_read_engagement`

**Descrição de uso:**
> pages_read_engagement is required as a dependency of instagram_content_publish and instagram_basic to read the Facebook Page connected to the merchant's Instagram Business account, which we need to resolve the Instagram Business Account ID used for publishing.

**Screencast:** pode reaproveitar o vídeo do fluxo de conexão.

---

## `pages_manage_posts`

**Descrição de uso:**
> Stockative mirrors each Instagram post to the merchant's connected Facebook Page automatically, so the merchant doesn't have to post twice. pages_manage_posts lets our app publish that same content (image/caption) to the Facebook Page on the merchant's behalf, immediately after the Instagram post is published.

**Screencast:** um post sendo publicado no Instagram pelo app, e o mesmo conteúdo aparecendo na Página do Facebook conectada.

---

## `business_management`

**Descrição de uso:**
> business_management is used to access the Instagram Business Account associated with the merchant's Facebook Business Manager, confirming the merchant has the right role/permissions on the Page and Instagram account before we allow them to connect it in our app.

**Screencast:** mesmo fluxo de conexão, focando na etapa de verificação da conta business.

---

## `instagram_content_publish` (o principal)

**Descrição de uso:**
> Stockative's core feature is the "Weekly Plan": our AI decision engine analyzes the merchant's Shopify inventory, sales velocity, and commercial calendar to choose which products to promote, then generates a caption and an AI product photo, and publishes the finished post directly to the merchant's connected Instagram Business account at a scheduled time — with no manual step required if the merchant doesn't review it. instagram_content_publish is what lets our app create these organic feed photo posts (and, for select posts, Reels) on behalf of the business, exactly as the merchant would do manually from the Instagram app, but automated based on real store data.

**Screencast deve mostrar:**
1. Login completo do Instagram no app, concedendo a permissão.
2. Uma foto/post organic sendo criado — tela Weekly Plan mostrando um post já gerado (imagem + legenda).
3. O post saindo publicado de verdade no feed da conta conectada.

---

## `instagram_manage_insights`

**Descrição de uso:**
> After a post is published, Stockative collects its performance (reach, saves, shares, likes, comments) to learn which type of content and product performs best for that specific merchant, and uses that signal to improve future content decisions; these metrics are shown to the merchant in our "Performance" screen. We also read the account-level online_followers metric to find the hours of the day when the merchant's own followers are most active, so the weekly plan schedules posts at the times that fit their real audience instead of a generic default. instagram_manage_insights is used only for the merchant's own connected account and for posts our app published on their behalf.

**Screencast:** tela de Performance do app com métricas reais de um post publicado (reach/saves), puxadas da API. Se der, mostrar também o Weekly plan com os horários dos posts (vêm do online_followers).

---

## Instruções pro revisor (colar em "Provide instructions" / "Testing instructions")

Meta precisa conseguir entrar e testar sozinho. Antes de colar: criar/instalar o app numa loja Shopify de teste conectada a um **Instagram de teste + Página de teste** (nunca a conta real da Mangará — ver incidente de 23/09/2026), e trocar os `<...>` abaixo. Não commitar a senha neste arquivo — ela só vai no campo do painel da Meta.

```
Stockative is an embedded Shopify app, so it runs inside the Shopify admin.

TEST ACCESS
1. Go to https://<test-store>.myshopify.com/admin
2. Log in with:
   Email: <reviewer-staff-email>
   Password: <entered only in this field, not stored elsewhere>
3. In the left sidebar, open Apps > Stockative.

The test store already has products, and Stockative is installed on it.
You can connect your own Instagram Business account (linked to a Facebook
Page) or use the one we set up for review:
   Instagram: @<test-ig-username>  |  Facebook Page: <test-page-name>

STEPS TO TEST EACH PERMISSION
A) Connecting the account (instagram_basic, pages_show_list,
   pages_read_engagement, business_management)
   - In the app menu, open "Social accounts".
   - Click "Connect Instagram & Facebook" and complete Facebook Login,
     granting the requested permissions and selecting the Page linked to
     the Instagram Business account.
   - You are returned to the app, which shows the connected Instagram
     username.

B) Publishing (instagram_content_publish, pages_manage_posts)
   - Open "Create content", pick a product and click "Generate content".
     The app generates a caption and an AI product image.
   - In section "6. Publish", click "Publish to Instagram & Facebook".
   - The post appears on the connected Instagram account's feed and the
     same content appears on the linked Facebook Page.
   - Scheduled publishing works the same way: "Weekly plan" >
     "Generate this week's plan" creates posts that are published
     automatically at their scheduled time.

C) Competitor reference (instagram_basic, Business Discovery)
   - Open "Competitor accounts", enter a public Instagram Business
     username (e.g. a well-known brand) and save. The app shows that
     account's public profile info.

D) Insights (instagram_manage_insights)
   - Open "Performance". For posts published by the app, it shows reach,
     saves, shares, likes and comments read from the Instagram API.
     (Metrics are collected periodically, so a post published during
     the review may take a few hours to show data; the test account
     already has earlier posts with metrics.)
```

---

## Roteiro de gravação dos screencasts (30/09/2026)

### Preparação (uma vez)

1. **Gravador**: Cmd+Shift+5 → "Gravar parte da tela" → só a janela do navegador. Sem áudio. Arquivo `.mov` vai pra Mesa.
2. **Idioma inglês**: Facebook → Configurações → Idioma → English (US); Shopify admin → perfil → Preferências → Language → English. O revisor precisa ler a tela de permissões.
3. **Forçar o consentimento do zero** (repetir antes de cada tentativa): no app, Social accounts → Instagram & Facebook → **Disconnect**; no Facebook, Configurações → **Business Integrations** → Stockative → **Remove**. Sem isso a Meta pula a tela de permissões.
4. **Tela limpa**: janela anônima/perfil dedicado, zoom 110–125%, Não Perturbe ligado. Abas abertas: app, `instagram.com/<conta-teste>`, Página do Facebook de teste.
5. **Legendas**: gravar sem, depois iMovie → Títulos → "Lower Third" com as frases abaixo.

Cada vídeo: 1–3 min, **contínuo sem cortes** do clique em Connect até voltar pro app (espera pode ser acelerada, não cortada).

### Vídeo 1 — Conectar + publicar
`instagram_basic`, `pages_show_list`, `pages_read_engagement`, `business_management`, `instagram_content_publish`

| # | Na tela | Legenda |
|---|---|---|
| 1 | Shopify admin → Apps → Stockative → **Social accounts**, mostrando desconectado | "Merchant opens Stockative inside Shopify admin" |
| 2 | **Connect Instagram & Facebook** | "Merchant connects their Instagram Business account" |
| 3 | Dialog da Meta: login → selecionar Página de teste → selecionar IG de teste → lista de permissões (tudo marcado, mostrar devagar, 2–3s por tela) → Continue/Save | "Merchant selects their Facebook Page and Instagram account and grants permissions" |
| 4 | Volta pro app: "Connected!" + @ da conta (parar 3s) | "The app confirms the connected account (instagram_basic)" |
| 5 | **Create content** → escolher produto → **Generate content** | "Stockative generates a caption and product image from store data" |
| 6 | Rolar devagar mostrando imagem + legenda | — |
| 7 | Seção **"6. Publish"** → **Publish to Instagram & Facebook** → confirmação | "Merchant publishes the post (instagram_content_publish)" |
| 8 | Aba do Instagram → Cmd+R → post novo no feed → abrir e mostrar legenda | "The post is live on the merchant's Instagram feed" |

### Vídeo 2 — Espelho no Facebook
`pages_manage_posts` — mais fácil: continuar a gravação do Vídeo 1 e subir o mesmo arquivo.

| # | Na tela | Legenda |
|---|---|---|
| 1 | App com o post recém-publicado | "Same post published by Stockative" |
| 2 | Aba da Página do Facebook → Cmd+R → mesmo post (imagem + legenda) no topo | "The same content is published to the linked Facebook Page (pages_manage_posts)" |

### Vídeo 3 — Competitor accounts
`instagram_basic` (Business Discovery), subido como 2º vídeo dessa permissão

| # | Na tela | Legenda |
|---|---|---|
| 1 | **Competitor accounts** | "Merchant can add up to 2 public accounts they admire in their niche" |
| 2 | Digitar username de marca pública conhecida → **Check** | — |
| 3 | Perfil público encontrado (bio, site, posts) → salvar | "Only public profile and post data is read via Business Discovery, used as style reference – never shown as a comparison" |

### Vídeo 4 — Performance
`instagram_manage_insights` — gravar por último, com posts da conta de teste publicados há pelo menos algumas horas. Se só aparecem likes/comentários sem reach, a conta precisa ser reconectada pra pegar o escopo de insights.

| # | Na tela | Legenda |
|---|---|---|
| 1 | **Performance** | "Stockative tracks results of posts it published" |
| 2 | Seção **Published posts**, parar num post com reach + saves | "Reach, saves and shares read with instagram_manage_insights" |
| 3 | **Weekly plan** → horários agendados | "Posting times are based on when the merchant's own followers are online (online_followers)" |

### Depois de gravar

1. iMovie → legendas → Arquivo → Compartilhar → Arquivo → 1080p `.mp4`.
2. Assistir cada vídeo inteiro: tela de permissões legível, post aparece de verdade no IG e no FB, nenhuma senha ou dado pessoal visível.
3. Guardar fora do repositório (ex. `~/meta-review/`) e subir no painel: App Review → cada permissão → Upload screencast.

| Arquivo | Permissões |
|---|---|
| Vídeo 1 | instagram_basic, pages_show_list, pages_read_engagement, business_management, instagram_content_publish |
| Vídeo 2 (ou o 1) | pages_manage_posts |
| Vídeo 3 | instagram_basic (2º vídeo) |
| Vídeo 4 | instagram_manage_insights |

---

## Checklist de submissão

- [x] Business Verification concluída
- [ ] App settings → Basic preenchido (30/09/2026: estava sem Privacy URL, App domains, ícone e categoria; Terms e Data deletion com placeholder `facebook.com`) — valores: App domains `app.stockative.com` + `stockative.com`, Privacy `https://stockative.com/#privacy`, Terms `https://stockative.com/#terms`, Data deletion `https://stockative.com/#privacy`, ícone `~/Desktop/stockative-icon-1024.png`, categoria Business and pages
- [x] Redirect URI de produção cadastrado (`https://app.stockative.com/auth/meta/callback`, 30/09/2026 — antes só tinha o ngrok)
- [x] Data Deletion Instructions cobertas na Privacy Policy
- [x] Tech Provider confirmado (irreversível) + Access Verification submetida em 23/09/2026, "In review", resposta em até 5 dias (prazo final pra completar: 22/11/2026)
- [ ] Access Verification aprovada (30/09/2026: ainda "In review" no Alert Inbox, sem resposta)
- [x] Descrições de uso ajustadas pra cobrir Business Discovery (concorrentes) e online_followers (30/09/2026)
- [x] Texto de instruções pro revisor escrito (30/09/2026) — falta montar a loja/IG/Página de teste e preencher os `<...>`
- [ ] Loja Shopify de teste + Instagram/Página de teste prontos pro revisor
- [ ] Screencast principal gravado (login → post gerado → publicado)
- [ ] Screencast do Facebook Page mirror gravado
- [ ] Screencast da tela Competitor accounts gravado
- [x] Texto desatualizado da tela Performance ("permission we don't have yet") corrigido antes de gravar (30/09/2026)
- [ ] Screencast do Performance/insights gravado
- [ ] 7 descrições de uso coladas nos campos certos do painel
- [ ] Submeter e anotar a data aqui, pra acompanhar o prazo de 2-6 semanas
