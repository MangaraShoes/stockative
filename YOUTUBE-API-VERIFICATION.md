# YouTube Data API v3 — verificação e cota

Processo mais simples que o Meta App Review/Tech Provider — sem estrutura de Tech Provider, só a verificação padrão de OAuth do Google quando o app sai do modo Testing.

## Setup (uma vez, por Patricia)

- [ ] Projeto no Google Cloud Console criado/reaproveitado.
- [ ] "YouTube Data API v3" ativada nesse projeto.
- [ ] Tela de consentimento OAuth configurada (tipo External).
- [ ] OAuth 2.0 Client ID criado (tipo "Web application"), com `${SHOPIFY_APP_URL}/auth/youtube/callback` cadastrado em "Authorized redirect URIs".
- [ ] `YOUTUBE_CLIENT_ID`/`YOUTUBE_CLIENT_SECRET` preenchidos no `.env` de produção.

## Estado em 30/09/2026

- Projeto `stockative-509811` (número 526797383147, na org stockative.com), que é o do `YOUTUBE_CLIENT_ID` no Railway.
- Canal da Mangará ("M A N G A R Á | Women Shoes and Wishes") conectado com `patricia@mangara.be`, que foi adicionado como test user.
- Branding preenchido sem logo (enviar logo obriga a verificação de marca) e app passado de **Testing** pra **In production**, ainda **não verificado**. Motivo: no modo Testing o refresh token expira em 7 dias e a conexão cairia toda semana. Em produção sem verificação continua a tela de "app não verificado" e o limite de 100 usuários, mas o token não expira mais.
- O aviso "Your app requires verification" no painel é esperado. Só pedir a verificação quando for abrir pra outras lojistas.
- Precisa reconectar o YouTube uma vez depois da troca pra produção, porque o token emitido no Testing continua vencendo em 7 dias.

## Modo Testing vs verificação completa

`youtube.upload` e `youtube.readonly` são **sensitive scopes** do Google (não *restricted*: esses são os de Gmail/Drive, que exigem avaliação de segurança CASA; corrigido em 28/10/2026) — em modo **Testing** (até 100 usuários de teste, adicionados manualmente na tela de consentimento), funcionam sem revisão nenhuma. Isso já é suficiente pro piloto com a Mangará e um punhado de lojas.

Só quando o app precisar publicar pra QUALQUER lojista (não só contas de teste cadastradas manualmente) é que entra a revisão de verificação OAuth do Google — inclui validação de branding (nome, logo, política de privacidade) e, dependendo do volume, uma avaliação de segurança mais formal. Sem prazo fixo divulgado publicamente; começar essa submissão com folga antes de precisar dela pra valer, mesmo padrão de cautela do Meta App Review.

## Cota (ver também nota em CLAUDE.md)

- Orçamento dedicado de uploads (`videos.insert`, desde jun/2026): **100 uploads de vídeo/dia**, sem competir com o resto da cota.
- Orçamento geral: 10.000 unidades/dia (buscas, leituras de metadados etc.).
- Aumentar a cota de upload não tem plano pago — só um formulário de "Audit and Quota Extension" no próprio Google Cloud Console, revisado manualmente pelo Google (de semanas a meses). Só vale a pena pedir se o volume real de Shorts/dia algum dia chegar perto de 100.
- **Conferir os números atuais no painel de cota do projeto real assim que ele existir** — a estrutura mudou uma vez recentemente (jun/2026), pode mudar de novo.

## Pedido de verificação (preparado em 28/10/2026, para a App Store)

Motivo: o app público vai abrir para outras lojistas, e hoje quem conecta o YouTube vê "Google hasn't verified this app" (testado na dev store em 28/10/2026). Os dois escopos são *sensitive*, então o pedido é a verificação de escopo sensível + verificação de marca. Não há avaliação de segurança (CASA). O Google não promete prazo; mandar em paralelo à submissão da Shopify.

Onde: Google Cloud Console → projeto `stockative-509811` → **Google Auth Platform** (antigo "OAuth consent screen") → Branding, Data Access e, no fim, **Verification Center → Prepare for verification**.

### 1. Branding (Google Auth Platform → Branding)

| Campo | Valor |
|---|---|
| App name | `Stockative` (hoje a tela de consentimento mostra "stockative.com") |
| User support email | `hello@stockative.com` |
| App logo | ícone quadrado do Stockative, 120×120 px, PNG (o mesmo do app da Meta, `.artifacts/stockative-icon.png` redimensionado). Enviar o logo é o que dispara a verificação de marca; agora é a hora. |
| Application home page | `https://stockative.com` |
| Application privacy policy link | `https://stockative.com/#privacy` (o mesmo da Meta; já tem a frase de Limited Use do Google API Services User Data Policy) |
| Application terms of service link | `https://stockative.com/#terms` |
| Authorized domains | `stockative.com` (já verificado no Search Console pelo TXT `google-site-verification` no GoDaddy; cobre `app.` e `apps.`) |
| Developer contact | `hello@stockative.com` |

Conferir antes: as duas âncoras abrem a seção certa no celular e no computador; `/privacy` e `/terms` dão 404, então nunca usar esses caminhos.

### 2. Escopos (Google Auth Platform → Data Access)

Têm que ser **exatamente** os do código (`YOUTUBE_SCOPES` em `app/services/youtube/api.server.ts`), nem mais nem menos:

- `https://www.googleapis.com/auth/youtube.upload`
- `https://www.googleapis.com/auth/youtube.readonly`

Justificativas (colar em inglês):

> **youtube.upload** — Stockative is a Shopify app that plans and publishes a store's social media content. When the merchant connects their YouTube channel, every Reel in their weekly content plan (a short vertical video of one of their products, generated in the app and approved by the merchant) is also uploaded to that channel as a YouTube Short at its scheduled time, with the title and description the merchant reviewed. We only call videos.insert on the channel the merchant connected; we never edit, delete or read other videos. No narrower scope allows uploading a video.

> **youtube.readonly** — Used for a single call right after the merchant connects: channels.list with mine=true, to read the connected channel's ID and title. We show the channel title on the Social accounts page so the merchant can confirm which channel their Shorts will go to, and store the channel ID to route uploads. We read nothing else (no videos, subscribers, comments or analytics). youtube.upload alone does not grant access to channels.list.

Como os dados são usados (campo de descrição geral):

> Stockative stores only the OAuth tokens and the channel ID and title, encrypted at rest in our EU-hosted database. Data from Google APIs is used only to publish the merchant's own approved Shorts to their own channel, is never sold, never used for advertising, and never used to train AI models. When the merchant disconnects YouTube or uninstalls the app, the tokens are deleted; Shopify's shop/redact request deletes all remaining data 48 hours after uninstall. Our use of information received from Google APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements.

⚠️ Conferir antes de enviar a frase "encrypted at rest": vale para o banco no Neon (criptografia em repouso do provedor). Se o Google perguntar por criptografia na aplicação, os tokens hoje ficam em texto no banco; responder com o que é verdade.

### 3. Vídeo de demonstração (em inglês, no YouTube como **Unlisted**)

O Google exige: o fluxo de consentimento completo, a tela de consentimento mostrando os **mesmos dois escopos**, o **nome do app e o client ID** visíveis, e o uso de cada escopo dentro do app.

Roteiro (~3 min, gravação de tela com narração ou legendas em inglês):

1. **Google Cloud Console → Clients → "Stockative Web"**: mostrar o client ID `526797383147-…` e o nome do projeto. (Prova de qual client está sendo demonstrado.)
2. **Shopify admin → app Stockative → Social accounts**: mostrar a seção "YouTube (optional)" e clicar em **Connect YouTube**.
3. **Tela de login do Google**: deixar a barra de endereço visível por alguns segundos (ela contém o `client_id=526797383147-…`). Escolher a conta.
4. **Tela de consentimento**: parar nela e mostrar o nome "Stockative", o logo e os dois escopos (upload de vídeos; ver a conta do YouTube). Clicar **Continue**/**Allow**.
5. **De volta ao app**: mostrar "Connected: <nome do canal>". Narrar: *"This is the only use of youtube.readonly: we read the channel name so the merchant can confirm where Shorts will be published."*
6. **Weekly plan**: abrir um Reel aprovado, mostrar o vídeo, o título e a descrição, e clicar **Publish now** (ou mostrar o horário agendado). Narrar: *"At the scheduled time, Stockative uploads this Reel to the connected channel as a Short, using youtube.upload."*
7. **YouTube Studio do canal**: mostrar o Short que acabou de chegar.
8. **Social accounts → Disconnect** no YouTube. Narrar que os tokens são apagados.

⚠️ O passo 6 publica **público** de verdade (decisão de 26/09/2026: Shorts saem como públicos). Gravar com um canal de teste, ou com a Mangará e um Reel real que ela queira publicar mesmo, e nunca com produto de demonstração da dev store. Depois da gravação, se for canal de teste, apagar o Short.

### 4. Enviar e acompanhar

- [ ] Branding atualizado (nome Stockative + logo) e salvo
- [ ] Data Access com só os dois escopos
- [ ] Vídeo gravado e enviado como Unlisted; link no formulário
- [ ] Verification Center → **Prepare for verification** → enviar; anotar a data aqui
- [ ] Responder os e-mails do Google (chegam no contato de desenvolvedor; costumam pedir ajuste no vídeo ou na política). Anotar cada ida e volta aqui
- [ ] Aprovado: anotar a data e o prazo real; a tela "Google hasn't verified this app" some e o limite de 100 usuários cai
- [ ] Nas instruções para o revisor da Shopify, enquanto não aprovar: YouTube é opcional e a tela de aviso do Google é esperada
