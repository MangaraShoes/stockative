# TikTok Content Posting API — aprovação de escopo

## Achado em 27/09/2026: o mirror do TikTok nunca funcionou

Confirmado direto em produção: **0 de 4 posts format="reel" conseguiram publicar no TikTok, desde sempre** — não é uma falha recente nem intermitente. O erro real (só visível depois de adicionarmos log de verdade em 26/09/2026, ver `publishContentItem.server.ts`):

> `TikTokApiError: The user did not authorize the scope required for completing this request.`

Isso não tem nada a ver com token expirado ou reconexão (esse foi um problema real, mas separado, corrigido em 26/09/2026, ver `getValidTikTokAccessToken` em `tiktok/oauth.server.ts`). É sobre **escopo**: o endpoint de upload (`https://open.tiktokapis.com/v2/post/publish/inbox/video/init/`, chamado por `tiktok/publish.server.ts`) exige o escopo `video.upload`, que por sua vez exige DUAS aprovações — a da Meta app em si, e a do usuário durante o login. Hoje `TIKTOK_SCOPES` (`tiktok/api.server.ts`) só pede `user.info.profile` — `video.upload` nunca esteve na URL de autorização.

Um comentário no código já registrava, em 22/09/2026, que `video.upload` "não existe" como opção pra adicionar no painel do TikTok for Developers. O motivo real: **o app da Stockative ainda não foi aprovado pelo TikTok pra esse escopo**, então ele nem aparece como disponível pra pedir.

## O que precisa ser feito

- [ ] Entrar em **developers.tiktok.com → Manage apps → app da Stockative**
- [ ] Ir em **Products** (ou "Scopes", dependendo de como o painel estiver organizado hoje) e conferir se **Content Posting API** está adicionado como produto do app
- [ ] Dentro desse produto, checar se `video.upload` aparece como escopo disponível pra solicitar
  - Se aparecer: adicionar o escopo, atualizar `TIKTOK_SCOPES` em `tiktok/api.server.ts` pra incluir `video.upload` (formato: `["user.info.profile", "video.upload"].join(",")`), reconectar a conta da Mangará pra gerar um token novo com o escopo certo, testar 1 reel
  - Se não aparecer: significa que o produto Content Posting API do app precisa passar por revisão da própria TikTok antes de liberar o escopo — nesse caso, procurar no painel a opção de solicitar acesso/revisão pra esse produto (nome exato muda com frequência na plataforma da TikTok, confirmar no momento)

## Relação com o Direct Post audit já citado no app

O código (`tiktok/publish.server.ts`) já documentava que o modo usado hoje (**upload pra caixa de rascunhos/inbox**, a lojista confirma manualmente no app) foi escolhido de propósito pra evitar a auditoria de **Direct Post** (publicação automática de verdade, sem confirmação manual). Esse achado de 27/09/2026 mostra que **mesmo o modo mais simples (inbox) já exige aprovação de escopo** — não dá pra presumir que "inbox não precisa de revisão nenhuma". Vale confirmar com clareza, ao investigar o painel, se `video.upload` (upload/inbox) e a auditoria de Direct Post são processos separados ou o mesmo processo com nomes diferentes — isso muda o tamanho real do trabalho pela frente.

## Atualização 29/09/2026: Sandbox configurado

- App em **Production** ainda está em **Draft**: nunca foi enviado pra revisão (sem ícone, nenhum escopo aprovado).
- **Sandbox "Stockative"** criado, com Login Kit + Content Posting API (Direct Post desligado, só upload pra rascunho). Scopes: `user.info.basic`, `video.upload`, `user.info.profile`.
- Código: `TIKTOK_SCOPES` agora pede `video.upload`, e o callback recusa a conexão se o TikTok devolver o token sem esse escopo (`exchangeCodeForToken`).
- O vídeo vai por `PULL_FROM_URL` a partir de `${SHOPIFY_APP_URL}/media/content-item-video/<id>`. O domínio desse host precisa estar verificado em **Content Posting API → Verify domains**, separado no Sandbox e em Production.
- Falta: verificar o domínio, adicionar a conta TikTok da Mangará como Target User, Apply changes, trocar `TIKTOK_CLIENT_KEY`/`TIKTOK_CLIENT_SECRET` no Railway pelas credenciais do Sandbox, reconectar e testar 1 reel.
- Depois: replicar Content Posting API + `video.upload` em Production e enviar pra revisão.

## 30/09/2026: primeiro envio ao TikTok funcionando

Correção de 29/09: o problema nunca foi o painel. O Sandbox já tinha `video.upload` desde 21/09 (mangara.official é target user desde então, e as credenciais no Railway já eram as do Sandbox, com prefixo `sbaw`). O que faltava era o app **pedir** o escopo na URL de autorização. Depois do deploy de `b27f1a9` e da reconexão da conta, um envio manual do reel `cmuibc8zp000qqs2umg9lozfk` chegou em `SEND_TO_USER_INBOX` (publish_id `v_inbox_url~v2.7691307781580130325`).

O Sandbox basta pro piloto com a Mangará (até 10 contas). Pra outras lojistas, ainda falta: Content Posting API + `video.upload` em **Production**, preencher App details/App review e enviar pra revisão.

## 30/09/2026 (noite): primeiro Direct Post funcionando (Sandbox)

- Pedir `video.upload` e `video.publish` juntos derruba o login com "Something went wrong – scope". Cada um sozinho funciona. O app agora pede só `user.info.profile,video.publish` (commit 5da9fc2).
- Com a mangara.official **pública**, todo Direct Post volta `403 unaudited_client_can_only_post_to_private_accounts`, inclusive como SELF_ONLY. Com a conta privada, o creator_info passa a devolver `FOLLOWER_OF_CREATOR, MUTUAL_FOLLOW_FRIENDS, SELF_ONLY` (sem PUBLIC_TO_EVERYONE), e a mudança levou mais de 7 minutos pra aparecer na API.
- Teste manual com o reel `cmuo3pdy80006qz2u55rc204s` como SELF_ONLY: `PUBLISH_COMPLETE` em ~10s (publish_id `v_pub_url~v2-1.7691393057065355270`).
- Até a auditoria do Direct Post, Reels agendados pro TikTok só saem com a conta privada. Com a conta pública, falham com o erro acima.

## Checklist de acompanhamento

- [ ] Confirmado se `video.upload` precisa de revisão separada ou está dentro do mesmo processo do Direct Post
- [ ] Revisão solicitada — anotar data aqui
- [ ] Resposta da TikTok recebida — anotar resultado e prazo real observado
- [x] `TIKTOK_SCOPES` atualizado no código, conta reconectada, 1 reel de teste entregue na caixa de rascunhos (30/09/2026, Sandbox)

## Submissão da revisão em Production: textos prontos (30/09/2026)

### Antes de enviar: bloqueador no site (resolvido em 30/09/2026, commit 79cccc6)

Segundo as diretrizes da TikTok, a Privacy Policy precisa estar visível no site oficial e cobrir os dados usados. A seção "From connected social accounts" de stockative.com/#privacy hoje só cita Meta e Pinterest, e a lista "Who else processes it" não tem TikTok nem Google/YouTube. Adicionar:

**Em "From connected social accounts"** (substituir o parágrafo atual):

> If you connect Instagram/Facebook, Pinterest, TikTok or YouTube, we receive an access token (and, where the platform provides one, a refresh token) from that platform's own OAuth flow, plus the account identifiers needed to publish: a Facebook Page ID, an Instagram Business Account ID, a Pinterest board ID, your TikTok open ID and username, or your YouTube channel ID and title. We never receive your password for any of these platforms. From TikTok we only request the scopes needed to read your basic profile and to post the Reels you confirm to your TikTok account. A Reel is only posted to TikTok after you choose its visibility and settings and confirm it in Stockative, and we don't read your TikTok videos, followers or messages.

**Em "Who else processes it"** (adicionar dois itens):

> **TikTok Pte. Ltd.** Receives the Reels you confirm for TikTok, posted to your account with the visibility and settings you chose.
>
> **Google LLC (YouTube)** Publishes approved Reels as YouTube Shorts to the channel you connect. Stockative's use of information received from Google APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements.

(A frase de "Limited Use" também é exigida pela verificação do Google, então resolve o YouTube junto.)

**Em "How long we keep it" / exclusão**: confirmar que o texto diz que desconectar uma conta apaga os tokens dela. O código já faz isso (`disconnect-tiktok` apaga a linha de SocialAccount).

### Production → App details

| Campo | Valor |
|---|---|
| App icon | o mesmo logo 1024×1024 do Sandbox |
| App name | Stockative |
| Category | Business |
| Description (máx. 120) | `Turns your Shopify store's stock and sales data into on-brand social content, and publishes it for you.` (103 caracteres, a mesma do Sandbox) |
| Terms of Service URL | https://stockative.com/#terms |
| Privacy Policy URL | https://stockative.com/#privacy |
| Platforms | Web → https://stockative.com/ |

### Production → Products

- **Login Kit**: redirect URI `https://app.stockative.com/auth/tiktok/callback`
- **Content Posting API**: Direct Post **ligado** (é o que faz o `video.publish` aparecer nos Scopes); Verify domains → `stockative.com` (verificar de novo em Production se não aparecer)

### Production → Scopes

`user.info.basic` (vem com o Login Kit), `user.info.profile` e `video.publish` — **sem `video.upload`**: pedir os dois juntos derruba o login com erro de "scope" (achado ao vivo, 30/09/2026) (Direct Post, ligado no produto Content Posting API — 30/09/2026, Patricia: o app precisa postar sozinho, sem a lojista abrir o TikTok). A TikTok recusa escopos pedidos que o vídeo demo não mostra em uso.

### App review → explicação dos produtos e escopos

> Stockative is a Shopify app for small fashion and footwear brands. It reads the merchant's own store data (inventory, sales, products) to decide which product to promote each week, then drafts social content for it: captions, product images and short vertical videos (Reels) built from the merchant's approved product images.
>
> **Login Kit (user.info.basic, user.info.profile):** On the "Social accounts" page inside the Stockative app (embedded in Shopify Admin), the merchant clicks "Connect TikTok" and signs in with TikTok. We read only the open_id and username, to show the merchant which TikTok account is connected (e.g. "TikTok account connected (@mangara.official)") and to associate uploads with the right account. We don't read videos, followers or any other profile data.
>
> **Content Posting API – Direct Post (video.publish):** Stockative plans a week of posts for the merchant, including Reels. For each Reel, the weekly plan screen shows a "TikTok" panel following the Content Sharing Guidelines: the connected TikTok account (nickname and avatar from creator_info), an editable caption, a "Who can see this video" dropdown with no default value and only the options returned by creator_info, Comment/Duet/Stitch checkboxes that are off by default and greyed out when disabled on the account, the commercial content disclosure toggle (Your brand / Branded content, with Branded content blocked for "Only me"), the Music Usage Confirmation (and Branded Content Policy when applicable) declaration, and a notice that the video may take a few minutes to process. Nothing is sent to TikTok until the merchant clicks "Post this Reel to TikTok". At the Reel's scheduled time, Stockative queries creator_info again, checks the video duration against max_video_post_duration_sec, posts it with PULL_FROM_URL from our verified domain (stockative.com), and polls the publish status to show the result in the plan. Reels the merchant didn't confirm for TikTok are never sent.
>
> Merchants can disconnect TikTok at any time from the same page, which deletes the stored tokens.

### Vídeo demo (gravar com o Sandbox, que é o exigido pra apps novos; ≤50 MB, até 5 vídeos)

Um único vídeo de 1 a 2 minutos, com a barra de endereço visível, mostrando `app.stockative.com` / admin.shopify.com:

1. Abrir o app Stockative dentro do Shopify Admin e mostrar rapidamente o dashboard (dá contexto do que é o app).
2. Ir em **Social accounts → TikTok**, clicar **Connect TikTok**.
3. Tela de login/autorização do TikTok: fazer login e mostrar **as permissões pedidas** (perfil + postar vídeo), depois autorizar.
4. De volta ao app: mostrar "TikTok account connected (@mangara.official)" (é o user.info.profile em uso).
5. Abrir o **Weekly Plan**, num Reel: mostrar o painel **TikTok** — conta de destino, legenda editável, "Who can see this video" sem valor padrão, Comment/Duet/Stitch desligados, toggle de divulgação comercial (ligar e mostrar Your brand / Branded content, e o "Only me" bloqueado com Branded content), a declaração da Music Usage Confirmation e o aviso de processamento. Escolher a visibilidade e clicar **Post this Reel to TikTok**.
6. Reagendar o Reel pra daqui a poucos minutos e esperar sair; mostrar no plano o status "Posted on TikTok".
7. No celular: abrir o perfil do TikTok e mostrar o vídeo publicado (no Sandbox ele sai "Only me", e a conta precisa estar privada — limitação da TikTok pra app não auditado).
8. (Opcional) Voltar ao app e mostrar o botão **Disconnect**.

Gravar a parte do celular com a gravação de tela do iPhone e juntar os dois trechos num vídeo só, ou mandar como 2 arquivos.

### Depois da aprovação

- As credenciais de Production são diferentes das do Sandbox (as do Sandbox começam com `sbaw`). Trocar `TIKTOK_CLIENT_KEY`/`TIKTOK_CLIENT_SECRET` no Railway pelas de Production.
- Reconectar a conta da Mangará (e a de qualquer outra lojista conectada no Sandbox), porque os tokens do Sandbox não valem com as credenciais de Production.
