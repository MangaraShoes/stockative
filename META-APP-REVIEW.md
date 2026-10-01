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
> Stockative is a Shopify app that helps small e-commerce brands plan and publish Instagram content automatically, based on their store's real inventory and sales data. We use instagram_basic for three things, all for the merchant's own connected Instagram Business account: (1) right after the merchant connects their account in our "Social accounts" screen, we read its username and ID to confirm the correct account was linked, and the app shows "Connected: Instagram @username · Facebook Page <name>" so the merchant always sees which account posts go to; (2) we read the account's own recent media (caption, media type, like and comment counts, timestamp) so our content engine can learn which of the brand's past posts performed best; (3) in the "Competitor accounts" screen, the merchant can optionally enter the usernames of up to 3 public Instagram Business/Creator accounts they admire in their niche, and we use Business Discovery to read those accounts' public profile and recent public posts (caption, media type, like and comment counts). This public data is only used as style/format reference inside our content decisions; it is never displayed as a comparison or scoreboard, and we never access any private data from those accounts.

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

**Descrição de uso (versão colada no painel em 30/09/2026):**
> Many of our merchants' Facebook Pages and Instagram Business accounts are owned by a Business portfolio (Business Manager) rather than by the person directly. business_management is required so that, during Facebook Login, our app can list and access the Page and Instagram Business account that belong to the merchant's Business portfolio; without it, those Pages are not returned and the merchant cannot connect their account to publish. We do not use it to manage ad accounts, assets or users, and we never write to the Business Manager. In the screencast, the merchant selects their business during Facebook Login at 0:12.

Nota (auditoria 01/10/2026): o texto antigo falava em "verificar papéis/permissões no Business Manager", o que o código não faz — não usar.

**Screencast:** mesmo fluxo de conexão, na etapa de seleção do negócio.

---

## `instagram_content_publish` (o principal)

**Descrição de uso:**
> Stockative's core feature is the "Weekly Plan": our AI decision engine analyzes the merchant's Shopify inventory, sales velocity, and commercial calendar to choose which products to promote, then generates a caption and an AI product photo, and publishes the finished post directly to the merchant's connected Instagram Business account at a scheduled time — with no manual step required if the merchant doesn't review it. instagram_content_publish is what lets our app create these organic feed photo posts (and, for select posts, Reels) on behalf of the business, exactly as the merchant would do manually from the Instagram app, but automated based on real store data.

**Screencast deve mostrar:**
1. Login completo do Instagram no app, concedendo a permissão.
2. Tela Weekly plan mostrando um post já gerado (imagem + legenda) → **Publish now**.
3. O post saindo publicado de verdade no feed da conta conectada.

---

## `instagram_manage_insights`

**Descrição de uso:**
> After a post is published, Stockative collects its performance (reach, saves, shares, likes, comments) to learn which type of content and product performs best for that specific merchant, and uses that signal to improve future content decisions; these metrics are shown to the merchant in our "Performance" screen. We also read the account-level online_followers metric to find the hours of the day when the merchant's own followers are most active, so the weekly plan schedules posts at the times that fit their real audience instead of a generic default. instagram_manage_insights is used only for the merchant's own connected account and for posts our app published on their behalf.

**Screencast:** tela de Performance do app com métricas reais de um post publicado (reach/saves), puxadas da API. Se der, mostrar também o Weekly plan com os horários dos posts (vêm do online_followers).

---

## Instruções pro revisor (colar em "Provide instructions" / "Testing instructions")

Meta precisa conseguir entrar e testar sozinho. Loja de teste: `stockative-dev`, com a versão de **produção** do app instalada (30/09/2026 — antes só existia via dev preview) e **sem nenhuma rede conectada** (o Pinterest dela estava ligado ao `mangarashoes` real da Mangará, desconectado em 30/09/2026). O revisor conecta o Instagram de teste dele. O "Set your weekly goal" só funciona com Instagram conectado, então é o próprio revisor que faz, depois do passo A (instruções abaixo já nessa ordem). Login do revisor (30/09/2026): `review@stockative.com`, usuário da organização Shopify com papel Store administrator só na `stockative-dev`, Secure sign-in desligado. O e-mail é uma regra de roteamento no Purelymail (`review@stockative.com` → `stockative-review@mailinator.com`, caixa pública) — a Shopify recusa o domínio do Mailinator direto, e o código de verificação de dispositivo novo não dá pra desligar. Senha só no painel da Meta. **Depois da aprovação: remover o usuário e a regra de roteamento.** Não commitar a senha neste arquivo — ela só vai no campo do painel da Meta.

```
Stockative is an embedded Shopify app, so it runs inside the Shopify admin.

TEST ACCESS
1. Go to https://admin.shopify.com/store/stockative-dev
2. Log in with:
   Email: review@stockative.com
   Password: <entered only in this field, not stored elsewhere>
   Shopify asks for a 6-digit email verification code when logging in from
   a new device. That inbox is public, so you can read the code yourself:
   https://www.mailinator.com/v4/public/inboxes.jsp?to=stockative-review
   (open the latest "Shopify verification code" email; codes expire in 10
   minutes).
3. In the left sidebar, open Apps > Stockative.

This is a test store with sample products and Stockative already installed.
No Instagram account is connected, so please connect your own test
Instagram Business account (linked to a Facebook Page) in step A.

STEPS TO TEST EACH PERMISSION
A) Connecting the account (instagram_basic, pages_show_list,
   pages_read_engagement, business_management)
   - In the app menu, open "Social accounts".
   - Click "Connect Instagram & Facebook" and complete Facebook Login,
     granting the requested permissions and selecting the Page linked to
     the Instagram Business account.
   - You are returned to the app, which shows the account as connected.

B) Publishing (instagram_content_publish, pages_manage_posts)
   - After connecting, go back to the app's Home and click "Set your weekly
     goal" (or open "Weekly objective" in the app menu). Pick a goal, e.g.
     "Drive traffic to the shop", and click "Build my weekly plan". The app
     picks products from the store's inventory and sales data and writes a
     caption and an AI product image for each post (this takes 1-3 minutes),
     then opens "Weekly plan".
   - On any post, click "Publish now" and confirm.
   - The post appears on the connected Instagram account's feed and the
     same content appears on the linked Facebook Page.
   - Posts that aren't published manually go out automatically at their
     scheduled day and time.

C) Competitor reference (instagram_basic, Business Discovery)
   - Open "Competitor accounts", enter a public Instagram Business
     username (e.g. a well-known brand), click "Check" and confirm. The app
     shows that account's public profile (bio, website).

D) Insights (instagram_manage_insights)
   - Open "Performance". For posts published by the app, it shows reach,
     saves, shares, likes and comments read from the Instagram API.
     Instagram only makes insights available some hours after a post is
     published, so a post published during the review may still show
     "No data collected yet" at first; the screencast shows this screen
     with real data from an older post.
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
| 5 | **Weekly plan** → mostrar os posts da semana já montados pelo app a partir do estoque/vendas | "Stockative plans the week's posts from store data" |
| 6 | Rolar devagar num post mostrando imagem + legenda | — |
| 7 | Nesse post → **Publish now** → confirmar no aviso → mensagem "Published on Instagram and Facebook." | "Merchant publishes the post (instagram_content_publish)" |
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
- [x] App settings → Basic preenchido em 30/09/2026 (estava sem Privacy URL, App domains, ícone e categoria; Terms e Data deletion com placeholder `facebook.com`) — valores: App domains `app.stockative.com` + `stockative.com`, Privacy `https://stockative.com/#privacy`, Terms `https://stockative.com/#terms`, Data deletion `https://stockative.com/#privacy`, ícone `~/Desktop/stockative-icon-1024.png`, categoria Business and pages
- [x] As 7 permissões "Ready for testing" nos casos de uso (30/09/2026): `instagram_manage_insights` faltava no caso de uso Instagram API (dava "Invalid Scopes" no OAuth) e foi adicionado; `pages_manage_posts` fica no caso de uso Manage Pages. Também aparecem `instagram_business_basic`, `instagram_business_manage_messages` e `instagram_manage_comments` como Ready for testing — o app não usa, **não enviar pra App Review**
- [x] Redirect URI de produção cadastrado (`https://app.stockative.com/auth/meta/callback`, 30/09/2026 — antes só tinha o ngrok)
- [x] Data Deletion Instructions cobertas na Privacy Policy
- [x] Tech Provider confirmado (irreversível) + Access Verification submetida em 23/09/2026, "In review", resposta em até 5 dias (prazo final pra completar: 22/11/2026)
- [ ] Access Verification aprovada (30/09/2026: ainda "In review" no Alert Inbox, sem resposta)
- [x] Descrições de uso ajustadas pra cobrir Business Discovery (concorrentes) e online_followers (30/09/2026)
- [x] Texto de instruções pro revisor escrito (30/09/2026) — falta montar a loja/IG/Página de teste e preencher os `<...>`
- [x] Loja de teste pronta pro revisor (30/09/2026): `stockative-dev` com app de produção, sem redes conectadas, login `review@stockative.com` testado com código via Mailinator
- [x] Screencast principal gravado e editado (30/09/2026): `~/Desktop/META VIDEO 1 - final.mp4` (2min05s) — conexão com tela de permissões completa (via "Edit settings"), Publish now, post no IG e no FB, Performance com reach. Serve pras 7 permissões. Texto com tempos pra colar em cada permissão:
  ```
  0:00 – Merchant opens Stockative (Social accounts) inside Shopify admin and clicks "Connect Instagram & Facebook"
  0:04 – Facebook Login for Business: merchant selects their Facebook Page (0:08), business (0:12) and Instagram Business account (0:16)
  0:20 – Merchant reviews and grants the requested permissions
  0:32 – Back in the app, the connected account is confirmed
  0:40 – Weekly plan: a post generated by Stockative from the store's inventory and sales data (image + caption)
  0:48 – Merchant clicks "Publish now" and confirms
  1:32 – The post is live on the merchant's Instagram feed (instagram_content_publish)
  1:40 – The same post is published to the linked Facebook Page (pages_manage_posts)
  1:56 – Performance screen: reach and engagement read from Instagram Insights (instagram_manage_insights)
  ```
- [x] Screencast da tela Competitor accounts (30/09/2026): `~/Desktop/META VIDEO 2 - competitors final.mp4` (0:29) — 2º vídeo do `instagram_basic` (Business Discovery). Texto:
  ```
  0:00 – Competitor accounts screen: merchant enters the username of a public Instagram Business account in their niche and clicks "Check"
  0:08 – Merchant confirms it's the right account; the app shows its public profile (bio, website) read via Business Discovery
  0:16 – A second account is added the same way. This public data is only used as style reference for content decisions, never shown as a comparison
  ```
- [x] Texto desatualizado da tela Performance ("permission we don't have yet") corrigido antes de gravar (30/09/2026)
- [x] Pedido montado no painel (30/09–01/10/2026): 8 permissões (as 7 + public_profile) com descrição e vídeo — instagram_basic usa "META VIDEO instagram_basic (1+2).mp4" (vídeo 1 + concorrentes a partir de 2:06), as demais "META VIDEO 1 - final.mp4"; Data handling (controller Mangara Shoes BV, Belgium; processors Railway/Neon/OpenRouter, todos "IT solutions…"; requests-4 sustentado por PUBLIC-AUTHORITY-REQUESTS-POLICY.md); plataforma Website `https://app.stockative.com` + Reviewer instructions
- [x] Privacy Policy atualizada e no ar (01/10/2026): cita Mangara Shoes BV como controller, insights, Business Discovery, Railway/Neon. Netlify: créditos esgotaram em 30/09 porque todo push no main fazia deploy — corrigido com netlify.toml (`ignore` fora de .artifacts/); upgrade pro plano Personal ($9/mês) em 01/10 pra publicar. **Decidir antes de 26/10/2026 se volta pro Free.**
- Nota (01/10/2026): o guia oficial da Meta diz que chamadas de teste levam **até 2 dias** pra aparecer, não 24h, e precisam ter acontecido nos últimos 30 dias.
- [x] Auditoria de 01/10/2026 (META-READINESS-AUDIT-2026-10-01.md) tratada: exclusão de dados real (tokens na desinstalação + webhooks GDPR/shop/redact), política alinhada (publicação automática, dados enviados à IA, prazos de exclusão), @Instagram + Página visíveis em Social accounts. Webhooks GDPR registrados na Shopify em 01/10/2026 (`shopify app deploy`, versão stockative-10). Conexão regravada mostrando o @ (vídeos v2). Atualizar no painel o texto do instagram_basic (item 1 agora cita o @ e a Página, não foto de perfil).
- [x] Vídeos v2 (01/10/2026), substituem os anteriores: `~/Desktop/META VIDEO 1 - final v2.mp4` (1:50, todas as permissões) e `~/Desktop/META VIDEO instagram_basic (1+2) v2.mp4` (2:18). Conexão regravada mostrando @ e Página. Tempos: 0:04 Página · 0:06 negócio · 0:08 Instagram · 0:12 permissões · 0:20 "Connected: Instagram @mangara.official · Facebook Page Mangará" · 0:24 Weekly plan · 0:32 Publish now · 1:18 post no Instagram · 1:28 post na Página · 1:42 Performance · 1:50 Competitor accounts (só no vídeo 1+2).
- [x] API test call do instagram_manage_insights registrada (5 seções verdes em 01/10/2026)
- [ ] Último bloqueio: "API test calls" do instagram_manage_insights (chamadas feitas 30/09 ~22:26 via refresh da Performance da Mangará, aparecem em até 24h)
- [ ] Submeter e anotar a data aqui, pra acompanhar o prazo de 2-6 semanas
