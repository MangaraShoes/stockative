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

## Checklist de acompanhamento

- [ ] Confirmado se `video.upload` precisa de revisão separada ou está dentro do mesmo processo do Direct Post
- [ ] Revisão solicitada — anotar data aqui
- [ ] Resposta da TikTok recebida — anotar resultado e prazo real observado
- [ ] `TIKTOK_SCOPES` atualizado no código, conta reconectada, 1 reel de teste confirmado publicando de verdade no TikTok
