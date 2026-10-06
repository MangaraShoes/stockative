# Cobrança — Shopify App Pricing (06/10/2026)

The code is already in place and switched off. It turns on with `BILLING_ENABLED=true` on Railway. Until then, nothing changes for any shop.

How it works:
- Plans, prices and the free trial live in the **Partner Dashboard**.
- Shopify hosts the plan selection page and bills on the merchant's own Shopify invoice. It handles the trial, upgrades and prorated downgrades.
- The app does four things:
  - it sends shops without an active subscription to Shopify's plan page;
  - it syncs the chosen plan into `Shop.plan`, which drives cadence and credit quota;
  - it reports extra credits as usage;
  - the weekly cron stops generating plans for shops without a subscription.

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

## 2. Credentials (Railway environment variables)

| Variable | Where to get it |
|---|---|
| `SHOPIFY_PARTNER_ORG_ID` | The number in the Partner Dashboard URL (`partners.shopify.com/<ID>/...`) |
| `SHOPIFY_PARTNER_API_ACCESS_TOKEN` | Partner Dashboard → Settings → **Partner API clients** → create a client with the **Manage apps** permission |
| `SHOPIFY_APP_GID` | `gid://shopify/App/<number>`, where the number is the app ID in the Partner Dashboard URL |
| `APP_EVENTS_CLIENT_ID` / `APP_EVENTS_CLIENT_SECRET` | Dev Dashboard → **API keys** (client credentials, used for the App Events API) |
| `SHOPIFY_APP_HANDLE` | Optional. Defaults to `stockative-1` (from the URL `admin.shopify.com/store/<store>/apps/stockative-1`) |

## 3. Turn it on and test

1. With the variables set, add `BILLING_ENABLED=true` on Railway.
2. On `stockative-dev` (a dev store, so no charge), open the app. You should be sent to Shopify's plan page. Pick Grow and approve.
3. You come back to `/app`. Check the **"Free trial"** banner, and that Settings → Plan shows Grow.
4. Upgrade to Plus from **Change plan** and check the plan updates (allow up to 5 minutes for the cache).
5. Regenerate an image with no credit left → **Accept charge**, then check the `extra_image` event in the Dev Dashboard (App Events).
6. On Mangará, approve the private plan.

> ⚠️ Before turning it on in production, make sure **Mangará has approved the private plan**. Otherwise its weekly plan stops being generated.
