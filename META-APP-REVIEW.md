# Meta App Review — Instagram Advanced Access

Rascunho de submissão pra liberar publicação automática no Instagram (`instagram_content_publish`) e insights (`instagram_manage_insights`) pra qualquer lojista, não só contas cadastradas como tester no app da Meta. Verificado contra a documentação oficial da Meta em 23/09/2026 — os nomes de escopo abaixo já foram confirmados atuais (ver `app/services/meta/graphApi.server.ts` pro histórico de por que isso já mudou antes).

## Antes de submeter (bloqueadores reais)

- [ ] **Business Verification** — separado do App Review, exigido pra QUALQUER app pedindo Advanced Access. Precisa de documento legal da empresa (Stockative/Mangará). Pode levar dias — iniciar em paralelo, não depois.
- [ ] **Política de Privacidade** publicada com URL real (a Meta exige o link no painel do app).
- [ ] **Data Deletion Instructions** — URL ou processo descrito de como o usuário pede exclusão de dados (exigido separado da política de privacidade).
- [ ] Confirmar que a conta da Mangará continua funcionando como tester enquanto o review não sai (não bloqueia o piloto).

## Fluxo de conexão usado no app

Social accounts → botão Connect → dialog OAuth da Meta → volta pro app mostrando a conta Instagram Business conectada (username, foto). Esse é o fluxo que aparece em quase todo screencast abaixo — grava uma vez esse trecho e reaproveita nos que pedem "o login completo do Instagram".

---

## `instagram_basic`

**Descrição de uso:**
> Stockative is a Shopify app that helps small fashion/footwear brands plan and publish Instagram content automatically, based on their store's real inventory and sales data. We use instagram_basic to read the connected Instagram Business account's basic profile info (username, ID, profile picture) right after the merchant connects their account in our "Social accounts" settings screen, so we can confirm the correct account was linked and display it back to the merchant in our app.

**Screencast:** login completo do Instagram no app (Social accounts → Connect → dialog OAuth → volta pro app mostrando username/foto da conta conectada).

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
> After a post is published, Stockative collects its performance (reach, saves, shares, likes, comments) to learn which type of content and product performs best for that specific merchant, and uses that signal to improve future content decisions. instagram_manage_insights lets us read this post-level insight data for posts our app published on the merchant's behalf.

**Screencast:** tela de Performance do app com métricas reais de um post publicado (reach/saves), puxadas da API.

---

## Checklist de submissão

- [ ] Business Verification concluída
- [ ] Privacy Policy publicada + URL cadastrada no painel do app
- [ ] Data Deletion Instructions publicada + URL/processo cadastrado
- [ ] Screencast principal gravado (login → post gerado → publicado)
- [ ] Screencast do Facebook Page mirror gravado
- [ ] Screencast do Performance/insights gravado
- [ ] 7 descrições de uso coladas nos campos certos do painel
- [ ] Submeter e anotar a data aqui, pra acompanhar o prazo de 2-6 semanas
