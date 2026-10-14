# App público do Stockative (14/10/2026)

## Por que existe um segundo app

O app original (`shopify.app.toml`, client_id `f1978fb0…`) foi criado com **Custom distribution** presa à loja da Mangará (`cdcfc8-47.myshopify.com`). Isso foi verificado no Partner Dashboard em 14/10/2026. A Shopify não deixa trocar a distribuição depois de escolhida, e app custom:
- só instala em lojas da mesma organização Plus da Mangará, então **nenhuma loja piloto consegue instalar**;
- não pode cobrar pela cobrança de apps da Shopify, então o plano do `BILLING-SETUP.md` não funciona nele.

Por isso foi criado um segundo app, com **Public distribution**. É ele que vai para a App Store e que as lojas piloto instalam. O app antigo continua sendo o app da Mangará até ela migrar (ver "Depois da aprovação").

## O que já está feito (14/10/2026)

| Item | Estado |
|---|---|
| App novo "Stockative" na org Stockative do Dev Dashboard (app id `435409649665`, handle `stockative-2`) | ✅ criado |
| Distribuição **Public** | ✅ escolhida (irreversível, era o objetivo) |
| `shopify.app.public.toml` (client_id `eb3ff74e…`), mesmos escopos e webhooks do app antigo, incluindo os 3 webhooks GDPR | ✅ enviado com `shopify app deploy --config public` (versão ativa) |
| Protected customer data, Step 1: motivo **Analytics**, sem campos de PII (o `orders/paid` só recalcula velocidade de venda) | ✅ salvo; era exigido para o webhook `orders/paid` |
| Serviço Railway `stockative-public` (mesmo repo, branch `main`), domínio `stockative-public-production.up.railway.app` | ✅ criado, **sem variáveis**: vai falhar no boot até o passo 1 abaixo |

## Arquitetura

- **Mesmo código, mesmo banco Neon, dois serviços no Railway.** Cada serviço tem as credenciais Shopify do seu app. As tabelas `Shop` e `Session` são chaveadas pelo domínio da loja, então não colidem enquanto **nenhuma loja tiver os dois apps instalados ao mesmo tempo**. A Mangará fica só no app antigo, os pilotos só no novo.
- **O agendador roda só no serviço antigo** (`DISABLE_IN_PROCESS_SCHEDULER=1` no novo). Publicar e gerar planos não usa token da Shopify, só os tokens das redes sociais e o banco, então o serviço antigo atende as lojas dos dois apps. Mesmo se os dois rodassem, a duplicidade é segura (ver `scheduler.server.ts`).
- **Mídia** (imagens e vídeos) fica no banco (`/media/...`), então qualquer um dos dois serviços serve.
- O app antigo (custom) **nunca** liga `BILLING_ENABLED`, porque custom não pode cobrar. Cobrança só no serviço público.

## Pendências (Patricia)

### 1. Variáveis do serviço `stockative-public` no Railway
O auto mode bloqueou a cópia de segredos. Copie do serviço `stockative` **todas** as variáveis, exceto as do Railway, e troque estas:

| Variável | Valor no `stockative-public` |
|---|---|
| `SHOPIFY_API_KEY` | `eb3ff74e23e6e1a6e5ed129f29a46812` |
| `SHOPIFY_API_SECRET` | Dev Dashboard → Stockative (o novo) → Settings → Client secret |
| `SHOPIFY_APP_URL` | `https://stockative-public-production.up.railway.app`, ou o domínio próprio (item 2) |
| `SHOPIFY_APP_HANDLE` | `stockative-2` |
| `DISABLE_IN_PROCESS_SCHEDULER` | `1` (já está) |

Atalho: no Railway, em Variables → "Raw Editor" do serviço `stockative`, copie tudo, cole no `stockative-public` e troque as 4 linhas acima.

### 2. (Recomendado) Domínio próprio em vez do `*.up.railway.app`
Por exemplo `apps.stockative.com`: CNAME no GoDaddy (DNS do stockative.com) apontando para o alvo que `railway domain apps.stockative.com -s stockative-public` mostrar. Vale fazer **antes** do item 3, para não cadastrar os callbacks duas vezes. Também ajuda no TikTok: o `PULL_FROM_URL` exige domínio verificado, e um subdomínio de stockative.com tem mais chance de já estar coberto que um domínio do Railway. Se trocar, atualizar `application_url`/`redirect_urls` no `shopify.app.public.toml` e rodar de novo `npx @shopify/cli@latest app deploy --config public --allow-updates`.

### 3. Callbacks OAuth das redes no novo domínio
Os callbacks são montados a partir de `SHOPIFY_APP_URL`, então cada provedor precisa aceitar o domínio novo (mantendo o antigo):
- **Meta**: App Domains + Valid OAuth Redirect URIs → `<novo>/auth/meta/callback`
- **TikTok**: Redirect URI → `<novo>/auth/tiktok/callback`; verificar o domínio/prefixo de URL para `PULL_FROM_URL`
- **YouTube (GCP)**: Authorized redirect URIs → `<novo>/auth/youtube/callback`
- **Pinterest**: Redirect URI → `<novo>/auth/pinterest/callback`

### 4. Protected customer data, Step 2
Partner Dashboard → Stockative (novo) → API access requests → Protected customer data → **Data protection details**. São declarações sobre como os dados são protegidos (criptografia, retenção etc.) e precisam ser respondidas por você.

### 5. Testar numa loja de desenvolvimento
Um app público não aprovado só instala em loja de desenvolvimento (por exemplo `stockative-dev`, que hoje tem o app antigo instalado; desinstale antes ou crie outra dev store). Fluxo completo: instalar, sincronizar produtos, conectar o Instagram, gerar o plano da semana.

### 6. Listing e submissão na App Store
Rascunho dos textos, screenshots, screencast e instruções para o revisor em [APP-STORE-LISTING.md](APP-STORE-LISTING.md).
Partner Dashboard → Stockative (novo) → Distribution → **Manage submission**. Inclui listing, screenshots, screencast, conta de teste para o revisor, política de privacidade e os planos de preço do `BILLING-SETUP.md` (agora neste app). Só depois de aprovado as lojas piloto conseguem instalar.

## Depois da aprovação

- **Pilotos** instalam pelo link da App Store.
- **Mangará**: pode continuar no app antigo, ou migrar: desinstalar o antigo e instalar o público. Os dados ficam, porque `Shop` é chaveada pelo domínio e o banco é o mesmo. O plano privado "Mangará" do `BILLING-SETUP.md` existe para isso. Depois da migração, o serviço antigo pode ser desligado e o agendador religado no público.
- `railway.json` (config-as-code) está **deprecado** e funciona até 01/12/2026 (aviso do CLI do Railway em 14/10/2026). Migrar com `railway config migrate` antes disso.
