# Stockative

**Your Shopify store knows what needs to sell. We turn it into content.**

Stockative is an AI Commerce Content Manager for Shopify. Instead of just scheduling posts, it decides *what* to promote, *why*, *when*, and on *which channel* — based on a merchant's real product, inventory, sales, and brand data — and only then generates the content (copy + on-brand AI imagery) for approval.

See [`CLAUDE.md`](CLAUDE.md) for the full product vision, [`ARCHITECTURE.md`](ARCHITECTURE.md) for the technical design (data model, AI Provider Layer, two-stage Content Decision Engine), and [`MARKETING-KNOWLEDGE.md`](MARKETING-KNOWLEDGE.md) for the copywriting/archetype layer.

## Stack

- [React Router v7](https://reactrouter.com/) + [`@shopify/shopify-app-react-router`](https://shopify.dev/docs/api/shopify-app-react-router) (Shopify's current recommended app framework — not Remix)
- Prisma + SQLite for local dev (see [`prisma/schema.prisma`](prisma/schema.prisma))
- [OpenRouter](https://openrouter.ai/) as the AI backend, behind a vendor-agnostic provider layer (`app/services/ai/`) — swapping models/vendors is a config change, not a rewrite
- Nano Banana (`google/gemini-2.5-flash-image`, via OpenRouter) for AI product imagery, with an automated fidelity guardrail before anything reaches the merchant

## Prerequisites

- **Node.js** `>=20.19 <22` or `>=22.12` (use [nvm](https://github.com/nvm-sh/nvm) if you don't already have a matching version)
- **Shopify CLI** (`npm install -g @shopify/cli`) and a [Shopify Partners](https://partners.shopify.com/) account with access to this app and a development store
- An **[OpenRouter](https://openrouter.ai/)** API key
- **[ngrok](https://ngrok.com/)** (free tier is fine) — Shopify's default tunnel is unreliable for extended dev sessions, and `--use-localhost` gets blocked by Chrome's Private Network Access protection when the app is embedded in the real Shopify admin. ngrok is what actually works.

## Setup

1. **Install dependencies**

   ```shell
   npm install
   ```

2. **Set your OpenRouter API key** in your shell profile (`~/.zshrc` or equivalent) — the app reads it from the environment, no `.env` file needed:

   ```shell
   export OPENROUTER_API_KEY="sk-or-..."
   ```

3. **Link the app to your own Shopify Partner org / app record** (only needed once per machine, or if `shopify.app.toml`'s `client_id` doesn't belong to you):

   ```shell
   npm run config:link
   ```

4. **Set up the local database:**

   ```shell
   npm run setup
   ```

## Local development

Local dev needs two things running at once, in two separate terminal windows/tabs — **not** the embedded terminal panel in some IDEs/tools, which has been unreliable for the Shopify CLI's interactive prompts:

**Terminal 1 — ngrok tunnel** (keep this running):

```shell
ngrok http 3000
```

Copy the `https://<something>.ngrok-free.dev` URL it prints.

**Terminal 2 — the app itself** (keep this running too):

```shell
npm run dev -- --tunnel-url=https://<something>.ngrok-free.dev:3000
```

Then press `p` in that terminal to open the app, or go to the app inside your dev store's Shopify admin directly.

If the ngrok URL changes between sessions (free-tier URLs aren't permanent), update `application_url` and `[auth] redirect_urls` in [`shopify.app.toml`](shopify.app.toml) to match, then run `npm run deploy` to push the config — this is safe for a dev app and doesn't affect real merchants.

**After running a Prisma migration, always restart `npm run dev`** — the running dev server keeps a stale in-memory Prisma Client otherwise (Vite's hot reload doesn't pick up regenerated `node_modules` code).

## Useful scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the local dev server via the Shopify CLI |
| `npm run build` | Production build |
| `npm run typecheck` | Generate React Router types + run `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run setup` | `prisma generate && prisma migrate deploy` |
| `npx prisma migrate dev --name <name>` | Create and apply a new migration in dev |
| `npm run deploy` | Push `shopify.app.toml` config changes (scopes, URLs, webhooks) to Shopify |

## Project structure

- `app/services/ai/` — vendor-agnostic AI Provider Layer (OpenRouter adapter, task→model routing, generation logging)
- `app/services/decisionEngine/` — the two-stage Content Decision Engine (Stage 1: strategy brief, Stage 2: copy)
- `app/services/imageMvp/` — AI product image generation, fidelity guardrail, and carousel/gallery assembly
- `app/routes/app.*.tsx` — the embedded app's pages (Products, Brand voice, Create content, etc.)
- `prisma/schema.prisma` — the full data model

## Notes

- All merchant-facing UI copy is in English; code comments are in Portuguese.
- The dev database is SQLite (`prisma/dev.sqlite`, gitignored). Production is expected to move to Postgres.
- AI-generated images are currently stored as base64 data URIs in the database — fine for local dev/proof-of-concept, but needs real file storage (e.g. Shopify Files or S3) before any production use.
