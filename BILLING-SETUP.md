# Cobrança — Shopify App Pricing (06/10/2026)

> **14/10/2026:** tudo aqui vale para o **app público** (`shopify.app.public.toml`, handle `stockative-2`, serviço `app-public` no Hetzner), não para o app original, que é Custom distribution e não pode cobrar pela Shopify. Ver [PUBLIC-APP.md](PUBLIC-APP.md).

The code is already in place and switched off. It turns on with `BILLING_ENABLED=true` in `/opt/stockative/.env.public` (the `app-public` service only). Until then, nothing changes for any shop.

How it works:
- Plans, prices and the free trial live in the **Partner Dashboard**.
- Shopify hosts the plan selection page and bills on the merchant's own Shopify invoice. It handles the trial, upgrades and prorated downgrades.
- The app does four things:
  - it sends shops without an active subscription to Shopify's plan page;
  - it syncs the chosen plan into `Shop.plan`, which drives cadence and credit quota;
  - it reports extra credits as usage;
  - the weekly cron stops generating plans for shops without a subscription.

The cron runs in the old `app` service, which has no `BILLING_ENABLED` and no Partner API credentials. So since 28/10/2026 the public service writes two fields on `Shop`: `billingRequired` (true only for shops of the public app) and `subscriptionActive`. It writes them on every `/app` load and on the `app_subscriptions/update` webhook (`webhooks.app.subscriptions_update.tsx`, public app version `stockative-4`). The cron skips shops with `billingRequired` and no active subscription. Old-app shops (Mangará) keep `billingRequired = false` and are not affected.

**Status on 28/10/2026:** the App Store registration is paid ($19, one-time) and the primary listing language is English. The three public plans exist as **drafts** under Pricing → "Draft and test plans": `basic` $24.90, `grow` $37.90 and `plus` $49.90. Each has a 7-day trial, redirect `/app`, "Free for partners and developers" ticked, and the `extra_image` ($0.20) and `extra_video` ($1.99) meters. **"Enable Shopify App Pricing" has not been clicked yet.** Do that only after the dev store test. The Mangará private plan is not created yet; it is only needed if Mangará migrates to this app. IDs: Partner org `5172871`, app `gid://shopify/App/435409649665`.

**Dev store test, 28/10/2026 (`stockative-public-test`):** with `BILLING_ENABLED=true`, the Partner org/app IDs and the Partner API token in `.env.public`, opening the app sent the store to Shopify's "Select a plan" page. All three plans showed as "Free to test" ($0). Grow was approved and the app came back to `/app?plan_handle=grow` with the "Free trial" banner (trial ends 04/11/2026). Settings → Plan shows "Current plan: Grow — $37.90/month" (Settings stays open during onboarding since 28/10/2026). Changing plans works: Grow → Plus on 29/10/2026 fired two `app_subscriptions/update` webhooks (both 200 OK in Dev Dashboard → Logs), and Settings showed Plus. Not checked yet: the `extra_image` usage event.

**"Enable Shopify App Pricing" stays greyed out** even with "I've verified my app is ready" ticked (29/10/2026). Shopify's [migration guide](https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing/migrating-to-shopify-app-pricing) asks for every plan to be tested on a dev store (Basic has not been) and for App Events to reach the meters. To send one test `extra_image` event without generating an image: `ssh -i ~/.ssh/stockative_hetzner root@37.27.24.159 'cd /opt/stockative && docker compose -f deploy/hetzner/docker-compose.yml --profile public exec app-public node deploy/hetzner/send-test-usage-event.mjs stockative-public-test.myshopify.com'`. It prints only status codes. Run on 29/10/2026: `auth: 200`, `event: 202 {"success":true}`, so the app's own credentials work for App Events.

Also on 29/10/2026 the Basic plan was approved on the dev store, so all three plans have now been tested, and the usage event was sent. **The button is still greyed out**, and the page shows no reason (no tooltip, and the "Before you switch" checklist is only advice). The page data says `managedPricingEnabled: false`, `hasEverConfiguredSapPlans: true`. Meanwhile the listing's Pricing section still counts "0 public plans" (legacy manual plans) and now also asks for display names for `extra_image` / `extra_video`. Next: fill those display names with the rest of the listing and retry; if it stays disabled, ask Shopify Partner Support why the switch is unavailable for an app that has never been published. `APP_EVENTS_CLIENT_ID/SECRET` are not set yet.

Two quirks in the plan form. Typing the plan name auto-fills the handle, so typing the handle again doubles it (`basicbasic`). The redirect field already starts with `/`, so typing `/app` gives `//app`.

Code: `app/services/billing/`, `app/routes/app.tsx`, `purchaseExtraCredits` in `creditUsage.server.ts`.

Decisions made by Patricia on 06/10/2026:
- 7-day free trial.
- Prices in USD with the same numbers as in euros.
- Mangará gets a free private plan with the Plus quota.
- Extra credits are a monthly **usage charge**, because Shopify App Pricing doesn't support one-time purchases.

Open question: **plan in Brazilian reais (BRL)**. The docs show a single price per plan. Check whether the plan editor offers a currency or a price per country.

## 1. Plans (Partner Dashboard)

Path: App distribution → All apps → Stockative → Distribution → Manage listing → Edit (locale) → Pricing content → Manage.

1. Under **Settings**, set **Pricing method** to **Shopify App Pricing**, and **Default billing frequency** to **Monthly**.
2. Under **Public plans → Add**, create three plans:

| Display name | Monthly | Free trial | Welcome link |
|---|---|---|---|
| Basic | 24.90 | 7 days | `/app` |
| Grow | 37.90 | 7 days | `/app` |
| Plus | 49.90 | 7 days | `/app` |

   - The name must contain "Basic", "Grow" or "Plus", because the code maps the plan by its name.
   - Tick **Free for partners and developers** (for dev stores).
   - In each plan, under **Add usage meter**, add two meters:
     - `extra_image`: Fixed, $0.20, 0 included units.
     - `extra_video`: Fixed, $1.99, 0 included units.
   - The handles must be exactly `extra_image` and `extra_video`.
   - Top features for each plan:
     - Basic: 3 posts/week (2 image posts + 1 reel), 8 AI images + 4 reels/month.
     - Grow: 5 posts/week (3 image + 2 reels).
     - Plus: 7 posts/week (4 image + 3 reels).
3. Under **Private plans → Add**, create **"Mangará"** at **$0**, and authorize it only for the Mangará store (`cdcfc8-47.myshopify.com`). The code treats it as Plus.

## 2. Credentials (`/opt/stockative/.env.public` on the Hetzner server)

| Variable | Where to get it |
|---|---|
| `SHOPIFY_PARTNER_ORG_ID` | `5172871` (the number in `partners.shopify.com/<ID>/...`) |
| `SHOPIFY_PARTNER_API_ACCESS_TOKEN` | Since 27/10/2026: Dev Dashboard → Organization settings → **Users → Security → Partner API clients** (`admin.shopify.com/organization/234695916/settings/organization-account/security`). Client "Stockative billing (app-public)" created 28/10/2026 with **Manage apps** + **Manage app subscriptions** |
| `SHOPIFY_APP_GID` | `gid://shopify/App/435409649665` |
| `APP_EVENTS_CLIENT_ID` / `APP_EVENTS_CLIENT_SECRET` | Optional since 28/10/2026. The Dev Dashboard no longer has an "API keys" page, and the App Events docs accept a Dev Dashboard app's own client ID/secret, so `appEvents.server.ts` falls back to `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET`. Not tested with a real usage event yet: if Accept charge fails with `App Events auth failed`, look here first |
| `SHOPIFY_APP_HANDLE` | Optional. Must be `stockative-2` here (the code defaults to `stockative-1`, the custom app) (from the URL `admin.shopify.com/store/<store>/apps/stockative-1`) |

## 3. Turn it on and test

1. With the variables set, add `BILLING_ENABLED=true` to `/opt/stockative/.env.public` and recreate `app-public` (`docker compose -f deploy/hetzner/docker-compose.yml --profile public up -d --force-recreate app-public`). Never set it in `.env.production`: the custom app cannot bill, and the scheduler there would skip Mangará.
2. On `stockative-public-test` (a dev store, so no charge), open the app. You should be sent to Shopify's plan page. Pick Grow and approve.
3. You come back to `/app`. Check the **"Free trial"** banner, and that Settings → Plan shows Grow.
4. Upgrade to Plus from **Change plan** and check the plan updates (allow up to 5 minutes for the cache).
5. Regenerate an image with no credit left → **Accept charge**, then check the `extra_image` event in the Dev Dashboard (App Events).
6. On Mangará, approve the private plan.

> ⚠️ Before turning it on in production, make sure **Mangará has approved the private plan**. Otherwise its weekly plan stops being generated.
