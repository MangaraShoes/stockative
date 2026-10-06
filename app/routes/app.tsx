import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate } from "../shopify.server";
import { ensureShopContentLanguage, ensureShopEmail, ensureShopTimezone, getOrCreateShop } from "../services/syncProducts.server";
import { getOnboardingStatus } from "../services/onboardingStatus.server";
import prisma from "../db.server";
import { fetchActiveSubscription, isBillingEnabled, planSelectionUrl } from "../services/billing/subscription.server";

// As mesmas fases do checklist da Home, na mesma ordem — usado aqui pra
// TRAVAR a navegação, não só sinalizar progresso (Patricia, 12/09/2026: "eu
// quero que a cliente seja obrigada a cumprir todas as etapas do setup").
// Cada fase lista as rotas que ela libera assim que fica completa, e as
// chaves de OnboardingStatus que precisam estar todas true pra considerar a
// fase feita — a última fase funde content pillars e weekly plan em uma só
// (Patricia, 12/09/2026: "acho que o 5 e 6 devem se fundir"), já que os
// pilares só existem pra alimentar o plano semanal. Social vem ANTES de
// brand voice porque o rascunho de brand voice por IA é construído a partir
// do Instagram real da cliente (bio, posts) junto com o About Us e os
// produtos da loja — sem o Instagram conectado primeiro, o rascunho não tem
// esse insumo (Patricia, 12/09/2026, mesma ordem em OnboardingStepper.tsx e
// app._index.tsx).
const SETUP_STEPS = [
  { keys: ["hasStock"], paths: ["/app/products"] },
  { keys: ["hasSocial"], paths: ["/app/social"] },
  { keys: ["hasCompetitors"], paths: ["/app/competitors"] },
  { keys: ["hasBrand"], paths: ["/app/store-voice"] },
  { keys: ["hasContentPillars", "hasPublished"], paths: ["/app/content-pillars", "/app/plan-week"] },
] as const;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin, redirect: adminRedirect } = await authenticate.admin(request);

  // Busca o fuso horário real da loja uma vez (cacheado depois) — usado
  // pro agendamento do plano semanal sair no horário local dela, não no do
  // servidor (Patricia, 12/09/2026, ver planWeek.server.ts).
  const { shop } = await getOrCreateShop(session.shop, session.accessToken ?? "");
  await ensureShopTimezone(admin, shop);
  await ensureShopContentLanguage(admin, shop);
  await ensureShopEmail(admin, shop);

  // Cobrança (Shopify App Pricing, 06/10/2026 — ver billing/subscription.server.ts).
  // Sem assinatura ativa (nem teste grátis), vai pra tela de planos da própria
  // Shopify, fora do iframe. Com assinatura, sincroniza o plano escolhido no
  // painel com Shop.plan, que define cadência e cota.
  let shopGid = shop.shopGid;
  if (!shopGid) {
    const response = await admin.graphql(`{ shop { id } }`);
    const json = (await response.json()) as { data?: { shop?: { id?: string } } };
    shopGid = json.data?.shop?.id ?? null;
    if (shopGid) await prisma.shop.update({ where: { id: shop.id }, data: { shopGid } });
  }
  let billing: { trialEndsAt: string | null } | null = null;
  if (isBillingEnabled() && shopGid) {
    const subscription = await fetchActiveSubscription(shopGid);
    if (!subscription) {
      throw adminRedirect(planSelectionUrl(session.shop), { target: "_top" });
    }
    if (subscription.plan !== shop.plan) {
      await prisma.shop.update({ where: { id: shop.id }, data: { plan: subscription.plan } });
    }
    billing = { trialEndsAt: subscription.trialEndsAt };
  }

  const status = await getOnboardingStatus(shop.id);
  const firstIncomplete = SETUP_STEPS.findIndex((step) => !step.keys.every((k) => status[k]));

  // Trava qualquer página além da próxima fase pendente — a Home continua
  // sempre acessível (é onde o checklist e o botão "Continue setup" vivem).
  const pathname = new URL(request.url).pathname;
  if (pathname !== "/app" && firstIncomplete !== -1) {
    const allowedPaths = SETUP_STEPS.slice(0, firstIncomplete + 1).flatMap(
      (step) => step.paths,
    );
    if (!allowedPaths.includes(pathname as (typeof allowedPaths)[number])) {
      throw redirect(SETUP_STEPS[firstIncomplete].paths[0]);
    }
  }

  // Mesma trava, agora pro menu de navegação: enquanto o setup não estiver
  // completo, só mostra os links que a fase atual já libera — o resto some
  // do menu em vez de aparecer clicável e devolver a cliente pra fase
  // pendente (Patricia, 12/09/2026, respondendo "sim" a essa proposta).
  const unlockedPaths: string[] | null =
    firstIncomplete === -1
      ? null // setup completo, nada travado
      : SETUP_STEPS.slice(0, firstIncomplete + 1).flatMap((step) => [...step.paths]);

  // Aviso vermelho no topo de TODA página (Patricia, 03/10/2026) quando
  // nada vai sair sozinho: publicação pausada, ou posts esperando aprovação.
  const pendingApprovalCount = shop.requireApproval
    ? await prisma.contentItem.count({
        where: { shopId: shop.id, weekBatchId: { not: null }, status: "draft" },
      })
    : 0;

  // eslint-disable-next-line no-undef
  return {
    publishingPaused: Boolean(shop.publishingPausedAt),
    pendingApprovalCount,
    trialEndsAt: billing?.trialEndsAt ?? null,
    apiKey: process.env.SHOPIFY_API_KEY || "",
    unlockedPaths,
    hasContentPillars: status.hasContentPillars,
  };
};

const NAV_ITEMS = [
  { href: "/app", label: "Home" },
  { href: "/app/products", label: "Products" },
  { href: "/app/social", label: "Social accounts" },
  { href: "/app/competitors", label: "Competitor accounts" },
  { href: "/app/store-voice", label: "Store voice" },
  { href: "/app/content-pillars", label: "Weekly objective" },
  { href: "/app/plan-week", label: "Weekly plan" },
  { href: "/app/performance", label: "Performance" },
  { href: "/app/settings", label: "Settings" },
];

export default function App() {
  const { apiKey, unlockedPaths, hasContentPillars, publishingPaused, pendingApprovalCount, trialEndsAt } =
    useLoaderData<typeof loader>();
  const isUnlocked = (href: string) =>
    href === "/app" || unlockedPaths === null || unlockedPaths.includes(href);
  // "Weekly objective" só existe pra criar os pilares na primeira vez
  // (Patricia, 20/09/2026: "esconde o Weekly objective do menu quando já
  // tiver pilares") — depois disso ela só redireciona pra "Weekly plan"
  // (ver app.content-pillars.tsx), então some do menu pra não virar um
  // item morto. Regenerar a semana e criar uma campanha promocional nova já
  // vivem dentro da própria "Weekly plan".
  const isHiddenAfterSetup = (href: string) =>
    href === "/app/content-pillars" && hasContentPillars;

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        {NAV_ITEMS.filter((item) => isUnlocked(item.href) && !isHiddenAfterSetup(item.href)).map((item) => (
          <s-link key={item.href} href={item.href}>
            {item.label}
          </s-link>
        ))}
      </s-app-nav>
      {publishingPaused ? (
        <s-banner tone="critical" heading="Publishing is paused">
          No posts are going out and no new weeks are being planned. Resume in{" "}
          <s-link href="/app/settings">Settings</s-link>.
        </s-banner>
      ) : pendingApprovalCount > 0 ? (
        <s-banner tone="critical" heading={`${pendingApprovalCount} post${pendingApprovalCount === 1 ? "" : "s"} waiting for your approval`}>
          They won&apos;t publish until you approve them in the{" "}
          <s-link href="/app/plan-week">Weekly plan</s-link>.
        </s-banner>
      ) : trialEndsAt && new Date(trialEndsAt) > new Date() ? (
        <s-banner tone="info" heading="Free trial">
          Your 7-day free trial ends on {new Date(trialEndsAt).toLocaleDateString()}. Your plan is billed
          on your Shopify invoice after that. Change or cancel it anytime in{" "}
          <s-link href="/app/settings">Settings</s-link>.
        </s-banner>
      ) : null}
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
