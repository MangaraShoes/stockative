# Rascunho do listing na Shopify App Store (14/10/2026)

App: **Stockative (público)**, handle `stockative-2`. Ver [PUBLIC-APP.md](PUBLIC-APP.md). Onde preencher: Partner Dashboard → Stockative → Distribution → Manage submission.

Os textos estão em inglês, o idioma principal do listing. As traduções (FR/NL/DE/PT/ES) podem ser adicionadas depois, por locale.

## Regras da Shopify que moldaram o texto

Fonte: [App Store requirements](https://shopify.dev/docs/apps/launch/shopify-app-store/app-store-requirements) e [best practices](https://shopify.dev/docs/apps/launch/shopify-app-store/best-practices). Conferir de novo no formulário, porque a Shopify muda esses limites.

- Nome com no máximo 30 caracteres, único, começando pela marca (4.1.2).
- Introdução com até 100 caracteres. Detalhes com até 500. Cada feature com até 80.
- **Sem estatísticas, garantias de resultado nem superlativos** ("the only", "the best", "the first") no texto e nas imagens (4.3.3, 4.3.4). Por isso o "uma foto com 1.800 curtidas e 0 vendas" e o "único que decide" do PITCH.md **ficaram de fora**.
- Sem depoimentos (4.3.6) e sem preço nas imagens (4.2.2). Preço só na seção Pricing.
- Só listar idiomas que a **interface** suporta por completo (4.3.2).
- Informar requisitos para o app funcionar (4.3.8), como a conta do Instagram.
- Texto factual (1.1.4): **não prometer pedidos/vendas por post**. Hoje o app mede cliques no link rastreado (`/r/:code`) e métricas do Instagram, mas **não liga pedidos da Shopify a posts** (o `orders/paid` só recalcula velocidade de venda). Quando a atribuição existir, dá para voltar a falar em pedidos.
- Texto factual (1.1.4): **não anunciar publicação pública no TikTok** enquanto a auditoria de Direct Post não sair. Hoje só publica como "Only me" numa conta privada.

---

## App name
```
Stockative: AI Content Planner
```
(30 caracteres. Alternativas mais curtas: `Stockative: AI Social Planner` (29), `Stockative ‑ Content Autopilot` (30).)

## App introduction (≤100)
```
Turn your stock, sales and calendar into a ready-to-publish weekly social media plan.
```

## App details (≤500)
```
Stockative plans your social media from your store's data. Each week it looks at stock, sales speed, new arrivals and upcoming commercial dates, decides which products to promote and why, and builds a balanced plan. For each post it creates an editorial image from your real product photo, checked for color and detail accuracy, plus a caption in your brand voice. Review, adjust and approve: Stockative publishes on schedule and shows each post's reach, engagement and link clicks.
```

## Feature list (≤80 cada)
```
Weekly content plan based on your inventory, sales and commercial calendar
AI editorial images that keep your product's color and details unchanged
Short product videos for Instagram and Facebook Reels and YouTube Shorts
Captions in your brand voice, in English, French, Dutch, German and more
Scheduled auto-publishing to Instagram, Facebook and Pinterest
See reach, saves and link clicks for every published post
```
Depois da auditoria do TikTok, trocar a 5ª linha por `Scheduled auto-publishing to Instagram, Facebook, Pinterest and TikTok`.

## Requisitos (campo de requisitos / texto de detalhes, 4.3.8)
- Uma conta Instagram **Business ou Creator** ligada a uma Página do Facebook, para publicar no Instagram.
- Opcional: Pinterest, TikTok e um canal do YouTube.

## Idiomas
⚠️ Listar **só** os idiomas em que a interface do app está traduzida por completo, não os da geração de legenda. O app tem a configuração `appLanguage`, mas é preciso conferir tela por tela antes de marcar FR/NL/DE/PT/ES. Na dúvida, marcar só **English**.

## Categoria e tags
- Categoria: **Marketing and conversion → Social media** (confirmar o nome exato no formulário).
- Tags: as que existirem mais próximas de *social media posting*, *content scheduling*, *AI content*.

## Search terms (se o formulário pedir)
```
social media planner, instagram scheduler, ai product images, content calendar, social media posts
```

## Pricing details
Mesmos planos do [BILLING-SETUP.md](BILLING-SETUP.md) (USD, mesmos números do euro). O listing **precisa** mostrar o trial e as cobranças por uso (4.2.1).

| Plano | Preço | Inclui |
|---|---|---|
| Basic | $24.90/mês | 3 posts/semana · 8 imagens de IA + 4 vídeos/mês |
| Grow | $37.90/mês | 5 posts/semana · 13 imagens + 9 vídeos/mês |
| Plus | $49.90/mês | 7 posts/semana · 17 imagens + 13 vídeos/mês |

- 7-day free trial em todos.
- Additional charges: extra AI image $0.20, extra video $1.99, only when you choose to regenerate beyond your monthly quota.

Como o pricing é gerenciado pela Shopify (Shopify App Pricing), os planos vêm de lá. Conferir se a página de pricing do listing os reflete.

---

## Screenshots (3 a 6, 1600×900, cada uma mostrando algo diferente)

Regras: mostrar a interface real, sem moldura de navegador, sem preço, sem dado pessoal, com alt text em todas. Sugestão de 6:

| # | Tela | Legenda / alt text |
|---|---|---|
| 1 | **Weekly Plan**: a semana com 3 posts, dias e horários | `Your weekly content plan, built from your store data` |
| 2 | **Cartão de decisão** de um post: objetivo, produto, motivo, ângulo, CTA | `See why each product was chosen before the post is written` |
| 3 | **Still original × editorial gerada**, lado a lado, no app | `Editorial images from your real product photo` |
| 4 | **Post pronto**: carrossel + legenda + hashtags, com Approve/Regenerate | `Review, edit and approve every post` |
| 5 | **Conexões sociais**: Instagram, Facebook, Pinterest e YouTube conectados | `Connect your channels once, publish on schedule` |
| 6 | **Performance / What's working**: alcance, salvamentos e cliques por post | `See how each published post performs` |

Usar produtos da Mangará nas telas (fotos próprias, sem problema de direitos) numa loja de desenvolvimento rodando o app público, para não aparecer dado de cliente real.

## Ícone
1200×1200 px, PNG/JPG, sem texto, sem screenshot e sem foto (4.4). Reaproveitar o ícone do app atual se seguir essas regras.

---

## Demo screencast (4.5.3: em inglês ou com legenda em inglês, cobrindo onboarding e tudo o que o listing promete)

Roteiro de ~3–4 min, gravado numa **dev store** com o app público:

1. **Instalação**: App Store → Install → tela de permissões → app abre embutido no admin.
2. **Sync automático**: mostrar que os produtos já aparecem, sem clique (sync no `afterAuth`).
3. **Onboarding de marca**: questionário curto → Store Voice e pilares gerados.
4. **Conectar Instagram/Facebook** (e Pinterest/YouTube se quiser mostrar).
5. **Objetivo da semana**: escolher "Increase sales" ou "Let AI decide" e escolher dias e horários.
6. **Gerar o Weekly Plan**: abrir um post e mostrar o **cartão de decisão** (por que esse produto).
7. **Imagem editorial**: mostrar a imagem gerada ao lado da foto original do produto.
8. **Legenda**: regenerar uma vez informando o motivo.
9. **Aprovar e agendar**, depois **Publish now** num post, e mostrar o post publicado no Instagram.
10. **Performance**: o link rastreado do post e o painel "What's working" (alcance, engajamento, cliques).
11. **Plano e cobrança**: tela de seleção de plano da Shopify, o trial, e onde ver o uso de créditos extras.

Pode reaproveitar trechos do roteiro do [META-APP-REVIEW.md](META-APP-REVIEW.md), mas a Shopify quer o fluxo **completo do lojista**, não só a parte da Meta.

---

## Testing instructions (para o revisor da Shopify)

> **Decisão de 28/10/2026: submeter com uma conta de teste, sem esperar a Meta.** O revisor instala o app numa dev store dele e precisa passar do passo 2 do onboarding, que exige Instagram. O app da Meta continua em modo de desenvolvimento (Access Verification "In review" desde 23/09, sem previsão), e nesse modo só quem tem papel no app da Meta consegue conectar. Esperar a Meta deixaria a Shopify parada por tempo indeterminado.
>
> **Conta de teste do revisor:** ✅ criada e com papel de Tester no app da Meta (Patricia, 28/10/2026). Os passos ficam abaixo como referência:
> 1. Um e-mail novo só para isso (ex.: `reviewer@stockative.com`).
> 2. Um usuário do Facebook com esse e-mail e uma Página do Facebook nova (ex.: "Stockative Demo Store").
> 3. Uma conta Instagram nova, convertida para **Business**, ligada a essa Página.
> 4. No app da Meta (developers.facebook.com → Stockative → App roles → Roles → Add people → **Tester**), adicionar esse usuário do Facebook e aceitar o convite logado nele.
> 5. Testar o fluxo inteiro numa dev store com essa conta antes de submeter: Connect → publicar um post.
> 6. **Deixar a verificação em duas etapas desligada** nessa conta e fazer login nela algumas vezes antes. O revisor entra de outro país, e um Facebook novo com 2FA ou sem histórico costuma pedir código, o que trava a revisão.
> 7. Não trocar a senha nem desconectar nada até a Shopify aprovar (4.5.4, 4.5.5: as credenciais têm de valer durante toda a revisão).
>
> As credenciais vão **só** no campo de instruções da submissão no Partner Dashboard, nunca neste arquivo (o repositório é público).

Rascunho:
```
Stockative builds a weekly social media plan from the store's products and sales, generates posts (AI editorial image + caption) and publishes them to the merchant's connected channels.

1. Install the app. Products sync automatically on install; no setup needed for this step.
2. Onboarding step 2 asks you to connect Instagram. It is required because every post is planned for Instagram first and the other channels mirror it. Click Connect, log in to Facebook with the test account below, then select the Page "[NOME DA PÁGINA]" and its Instagram account.
   Our Meta app's Tech Provider access verification is still pending, so for now only accounts with a role in our Meta app can connect. The test account below has that role.
   Facebook login: [PREENCHER NO PARTNER DASHBOARD]
   Password: [PREENCHER NO PARTNER DASHBOARD]
   If Facebook asks for a security code, email [CONTATO] and we reply within a few hours.
3. Complete the rest of the onboarding (competitor accounts, store voice).
4. Go to "Weekly plan", choose a weekly objective (or "Let AI decide") and generate the plan. Generation takes about [X] minutes.
5. Open any post to see the decision behind it, the generated image and the caption. Approve it and click "Publish now" to publish immediately.
6. Billing: a 7-day free trial starts on install. Development stores are not charged.

Emergency contact: [PREENCHER — também cadastrar em Partner Dashboard → Settings (4.5.6)]
```

## Checklist antes de clicar em Submit
- [ ] Serviço `stockative-public` no ar, com as variáveis (PUBLIC-APP.md, item 1)
- [ ] Callbacks das redes no domínio do app público (PUBLIC-APP.md, item 3)
- [ ] Protected customer data, Step 2 respondido (PUBLIC-APP.md, item 4)
- [x] Planos criados no Shopify App Pricing **deste** app (BILLING-SETUP.md) e `BILLING_ENABLED=true` **só** no `app-public` (28/10/2026, testado na dev store; falta clicar "Enable Shopify App Pricing" e configurar o App Events)
- [ ] Política de privacidade com URL pública (a mesma usada na Meta serve, se cobrir dados da Shopify)
- [x] Conta de teste do revisor criada, com papel de Tester no app da Meta
- [ ] Fluxo testado numa dev store com a conta de teste, 2FA desligado, credenciais coladas nas instruções do Partner Dashboard
- [ ] Screenshots, ícone e screencast prontos
- [ ] Contato de emergência no Partner Dashboard
