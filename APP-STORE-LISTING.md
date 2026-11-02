# Rascunho do listing na Shopify App Store (14/10/2026)

> **29/10/2026: preenchido no formulário (rascunho salvo, não submetido).** Nome, categoria **Marketing and conversion → Marketing → Marketing - Other** (não existe categoria de social media; depois de submeter, só muda com apelação), idioma English, introdução, detalhes, 5 features, privacy `https://stockative.com/#privacy`, site `https://stockative.com`, subtítulo, 5 termos de busca, "não exige Online Store/POS", nomes dos medidores e dos planos. A checagem automática da Shopify pediu para tirar a palavra **"plan"** (confunde com plano de preço), por isso os textos abaixo usam "schedule"/"calendar". A feature "See reach, saves and link clicks" ficou de fora (máximo de 5). E-mails preenchidos em 29/10/2026: suporte `hello@stockative.com` (confirmar que recebe e-mail), review e submissão `patricia@mangara.be`. Faltam 5 pendências: feature media, screenshots, conta de teste, instruções de teste e screencast.

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
Turn your stock, sales and calendar into a ready-to-publish weekly social media schedule.
```

## App details (≤500)
```
Stockative builds your social media content from your store's data. Each week it looks at stock, sales speed, new arrivals and upcoming commercial dates, decides which products to promote and why, and builds a balanced schedule. For each post it creates an editorial image from your real product photo, checked for color and detail accuracy, plus a caption in your brand voice. Review, adjust and approve: Stockative publishes on time and shows each post's reach, engagement and link clicks.
```

## Feature list (≤80 cada)
```
Weekly content calendar based on your inventory, sales and commercial dates
AI editorial images that keep your product's color and details unchanged
Short product videos for Instagram and Facebook Reels and YouTube Shorts
Captions in your brand voice, in English, French, Dutch, German and more
Scheduled auto-publishing to Instagram, Facebook and Pinterest
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

## App card subtitle (≤62)
```
Weekly social posts planned from your stock and sales
```

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

Regras: mostrar a interface real, sem moldura de navegador, sem preço, sem dado pessoal, com alt text em todas.

**02/11/2026: prontas, fora do repositório, em `~/Desktop/stockative-screenshots/` (subir nesta ordem).** Capturadas com Cmd+Shift+4 no admin da Mangará (app antigo, mesmo código do público, com dados reais) e recortadas para 1600×900 sobre fundo branco, sem menu da Shopify nem barra da Sidekick. A captura feita pelo Chrome do Claude não serve: sai com 1470×745 em JPEG, abaixo dos 900 px.

| # | Arquivo | Alt text |
|---|---|---|
| 1 | `1-next-week-plan.png` | `Plan next week's posts and Reels by day, time and product` |
| 2 | `2-post-caption.png` | `Every caption is written in your brand voice, ready to review` |
| 3 | `3-store-voice.png` | `Your store voice, built by AI from your products and Instagram` |
| 4 | `4-social-accounts.png` | `Publish to Instagram, Facebook, Pinterest, TikTok and YouTube` |
| 5 | `5-performance.png` | `See which creative approaches work best for your audience` |
| 6 | `6-home.png` | `Get set up in a few guided steps` |

Ficou de fora a comparação still × editorial: no app as imagens aparecem só como miniaturas pequenas no Weekly plan.

## Ícone
1200×1200 px, PNG/JPG, sem texto, sem screenshot e sem foto (4.4). Reaproveitar o ícone do app atual se seguir essas regras.

**02/11/2026: pronto, `~/Desktop/stockative-screenshots/stockative-icon-1200.png`.** É o ícone atual (`.artifacts/stockative-icon.png`, caixa com post e barras, sem texto) ampliado de 392 px para 900 px e centralizado num fundo branco de 1200×1200. Se a Shopify reclamar da nitidez, vetorizar o desenho original.

---

## Demo screencast (4.5.3: em inglês ou com legenda em inglês, cobrindo onboarding e tudo o que o listing promete)

**02/11/2026: gravado e montado, `~/Desktop/stockative-screenshots/stockative-screencast.mp4`** (3min31, 1920×984, sem áudio, legendas em inglês embutidas). Juntado de 5 gravações da `stockative-public-test` com o @stockative26: instalação, conexão Meta, concorrente, store voice, geração da semana, Publish now e post no Instagram, Next week's plan, Performance e Settings. Ficaram de fora o feed pessoal do Facebook e o trecho com o e-mail nas notificações. Não mostra a tela de escolha de plano (a assinatura de teste já existia). Montagem com AVFoundation (não há ffmpeg na máquina); o script ficou só no scratchpad da sessão. Falta subir no YouTube como Não listado e colar o link.

**Roteiro revisto em 02/11/2026** para bater com o app de hoje: onboarding em 5 passos, Instagram obrigatório, cobrança pelo Shopify App Pricing ligada no `app-public`. São de 4 a 5 minutos, gravados na dev store **`stockative-public-test`** com o app **público**.

**Antes de gravar:**
- **Desinstalar o app da dev store**, para a gravação começar pela instalação. Os dados ficam, porque `Shop` é chaveada pelo domínio, mas a Shopify pede de novo as permissões e a escolha de plano.
- **Conectar o @stockative26**, nunca o Instagram da Mangará: o passo 9 publica de verdade.
- Gravar com **Cmd+Shift+5 → Record Selected Portion**, só a janela do Chrome, com o admin em inglês e sem abas pessoais.
- Os trechos de espera, como a geração da semana e das imagens, podem ser cortados na edição (QuickTime → Edit → Trim, ou iMovie).
- **Narração:** gravar sem voz e pôr as falas abaixo como legenda em inglês, ou ler as falas em inglês. A Shopify aceita os dois (4.5.3).

| # | Na tela | Fala / legenda |
|---|---|---|
| 1 | Admin → Apps → instalar o Stockative → tela de permissões → **Install** | "Stockative installs from the Shopify App Store and asks for access to your products, orders and store languages." |
| 2 | Tela **Select a plan** da Shopify → escolher Basic → trial de 7 dias → volta ao app | "Plans are billed through Shopify, with a 7-day free trial." |
| 3 | Home com o stepper; passo 1 **Sync your stock** já Done | "The app syncs your catalog automatically and reads sales velocity, inventory age and days since last sale." |
| 4 | **Social accounts** → Connect Instagram & Facebook → login da Meta → @stockative26 conectado. Mostrar Pinterest, TikTok e YouTube como opcionais | "Connect Instagram and Facebook. Pinterest, TikTok and YouTube are optional extras." |
| 5 | **Competitor accounts**: adicionar 1 conta ou clicar em Skip | "Optionally add accounts you admire in your niche, as a style reference." |
| 6 | **Store voice**: os campos preenchidos pela IA; rolar até o tipo de foto | "Stockative drafts your store voice from your products, your Instagram and your About page. You can edit anything." |
| 7 | **Content pillars** → **Weekly plan**: escolher o objetivo da semana e gerar | "Pick this week's objective, or let Stockative decide per product." |
| 8 | Um post da semana: produto, objetivo, pilar, data, legenda e imagem editorial com as fotos do produto. Regenerar a legenda uma vez, com um motivo | "Each post says which product and why, with a caption in your voice and an editorial image built from your real product photo." |
| 9 | **Publish now** num post → abrir o Instagram do @stockative26 e mostrar o post publicado | "Posts go out automatically on schedule, or right away with Publish now." |
| 10 | O card **Next week's plan**: trocar um dia ou um produto | "Next week is planned ahead. Change days and products before anything is generated." |
| 11 | **Performance**: What's working + Published posts | "Performance shows reach, engagement and link clicks per post, and which creative approaches work for your audience." |
| 12 | **Settings** → plano atual e cota de regeneração | "Your plan and remaining regenerations are always visible in Settings." |

Sem preço extra na tela: não clicar em "Regenerate image only" sem crédito, porque isso abre a confirmação de cobrança. Subir o vídeo no YouTube como **Não listado** e colar o link no Partner Dashboard.

---

## Testing instructions (para o revisor da Shopify)

> **Decisão de 28/10/2026: submeter com uma conta de teste, sem esperar a Meta.** O revisor instala o app numa dev store dele e precisa passar do passo 2 do onboarding, que exige Instagram. O app da Meta continua em modo de desenvolvimento (Access Verification "In review" desde 23/09, sem previsão), e nesse modo só quem tem papel no app da Meta consegue conectar. Esperar a Meta deixaria a Shopify parada por tempo indeterminado.
>
> **Conta de teste do revisor:** ⚠️ **não confirmada.** Este arquivo marcou em 28/10/2026 que estava criada, mas em 29/10/2026 Patricia não se lembra de ter criado. Tratar como **não criada** até alguém ver o usuário em App roles → Roles no app da Meta.
>
> **Andamento em 29/10/2026 (Patricia):**
> - ✅ Facebook de teste **Patricia Teixeira**, login `pcossettin@gmail.com`. Era uma conta antiga sem uso (nome "Paula Lamp"), renomeada; verificada pelo Google.
> - ✅ Instagram **@stockative26**, profissional, ligado à Página Stockative Demo Store (02/11/2026). Substitui o antigo @stockative.demo, apagado por estar ligado à conta de Facebook recusada.
> - ✅ Página **Stockative Demo Store**, criada pela conta **principal** da Patricia (a conta de teste não conseguia criar Página: "An error occurred… Page policies"). A Meta pôs a Página e o Instagram num portfólio novo **Stockative Demo Store** (ID 2290287498495357), separado do da Mangará. Página e Instagram já estão ligados.
> - ⏸ Dar acesso à conta de teste: o convite para `pcossettin@gmail.com` nunca chegou (provavelmente porque o Instagram com o mesmo e-mail já é membro do portfólio). O convite para `patricia@mangara.be`, aberto em janela anônima logada como Patricia Teixeira, falhou em "Accept" com **"The user cannot be added to the business"**: a Meta está restringindo a conta de teste (é a mesma causa do bloqueio de Página). Plano: esperar 24–48 h sem mexer e aceitar de novo pelo link do e-mail (o convite vale até 28/11/2026). Se continuar falhando, criar uma conta de teste nova com outro e-mail.
> - ⏸ Papel de Tester no app da Meta e teste na `stockative-public-test`.
> - ❌ **01/11/2026:** convite novo (enviado para `patricia@mangara.be`, aberto logado como Patricia Teixeira) falhou de novo em "Accept invitation" com **"The user cannot be added to the business"**. Account Overview/Account Status sem nenhum problema listado: é bloqueio silencioso da Meta, sem recurso. Acesso direto pela Página não existe aqui, porque a Página está no portfólio (Page access abre o Business Suite, que só atribui membros do portfólio). Próximo passo: conta de teste nova.
> - ✅ **01/11/2026:** Gmail novo e Facebook novo criados pela Patricia para ser a conta do revisor (o e-mail fica fora deste arquivo, que é público). Deixar a conta "amadurecer" 3–5 dias com uso normal, 2FA desligado, antes do convite para o portfólio Stockative Demo Store (Full control na Página e no @stockative26), do papel de Tester no app da Meta e do teste na `stockative-public-test`.
> - ✅ **01/11/2026:** a conta nova (**Priscila Cosset**) entrou no portfólio Stockative Demo Store, com acesso à Página e ao @stockative26. Falta: papel de Tester no app da Meta e teste do Connect na `stockative-public-test`.
>
> Passos para criar:
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
- [x] Serviço `app-public` no ar, com as variáveis (PUBLIC-APP.md, item 1)
- [x] Callbacks das redes no domínio do app público (PUBLIC-APP.md, item 3; TikTok em revisão)
- [x] Protected customer data, Step 2 respondido (PUBLIC-APP.md, item 4; 01/11/2026 — fica *Draft* até a submissão)
- [x] Dados da empresa e bancários para recebimento: **Mangara Shoes BV**, Private Corporation (01/11/2026)
- [x] Planos criados no Shopify App Pricing **deste** app (BILLING-SETUP.md) e `BILLING_ENABLED=true` **só** no `app-public` (Shopify App Pricing ativado em 29/10/2026, os 3 planos e o App Events testados na dev store)
- [x] Política de privacidade com URL pública: `https://stockative.com/#privacy` no listing (conferir se o texto cobre os dados da Shopify)
- [ ] Conta de teste do revisor criada, com papel de Tester no app da Meta (marcada por engano em 28/10/2026; não confirmada em 29/10/2026)
- [ ] Fluxo testado numa dev store com a conta de teste, 2FA desligado, credenciais coladas nas instruções do Partner Dashboard
- [ ] Screenshots, ícone e screencast prontos
- [ ] Contato de emergência no Partner Dashboard
