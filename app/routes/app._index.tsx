import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { getOrCreateShop } from "../services/syncProducts.server";
import { getOnboardingStatus } from "../services/onboardingStatus.server";
import { goTo } from "../utils/navigateOnClick";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const { shop } = await getOrCreateShop(session.shop, session.accessToken ?? "");
  const status = await getOnboardingStatus(shop.id);

  // Antes a Home redirecionava sozinha pro primeiro passo numa loja
  // recém-instalada, pra não mostrar uma tela vazia. Isso passou a atrapalhar
  // assim que a própria Home ganhou o bloco "Next step" em destaque (ver
  // return abaixo) — ele já cumpre o mesmo papel de guiar pro próximo passo,
  // sem esconder a abertura/pitch da página (Patricia, 12/09/2026: "não
  // estou conseguindo voltar na abertura"). A Home nunca mais redireciona
  // sozinha agora, com ou sem setup completo.
  const productsCount = await prisma.productCache.count({ where: { shopId: shop.id } });

  const [socialCount, publishedCount, stuckPosts] = await Promise.all([
    prisma.socialAccount.count({ where: { shopId: shop.id } }),
    prisma.contentItem.count({ where: { shopId: shop.id, status: "published" } }),
    // publishDueContentItems nunca tenta publicar (nem marca como failed) um
    // post vencido sem nenhuma imagem, pra não ficar batendo na Meta API pra
    // sempre falhar do mesmo jeito (ver publishContentItem.server.ts) — mas
    // isso ficava travado em silêncio, sem avisar ninguém (achado da análise
    // estratégica, 14/09/2026). Avisar aqui, no primeiro lugar que ela vê.
    prisma.contentItem.findMany({
      where: {
        shopId: shop.id,
        status: { in: ["draft", "approved"] },
        scheduledAt: { lte: new Date() },
        images: { none: {} },
      },
      select: { product: { select: { title: true } } },
    }),
  ]);

  return {
    ...status,
    productsCount,
    socialCount,
    publishedCount,
    stuckPostTitles: stuckPosts.map((p) => p.product?.title ?? "(product removed)"),
  };
};

interface ChecklistStep {
  done: boolean;
  title: string;
  description: string;
  href: string;
  cta: string;
}

export default function Index() {
  const data = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  // Onboarding real do merchant, na ordem em que os dados de fato fluem no
  // produto (Patricia, 12/09/2026: "vamos analisar o estoque antes de
  // tudo") — cada passo lê o estado real do banco, não é só uma lista
  // estática, então o "Done" reflete o que o lojista já fez de verdade.
  // Social vem antes de brand voice porque o rascunho de brand voice por IA
  // usa o Instagram real da cliente (bio, posts) junto com o About Us e os
  // produtos — pedir isso antes de conectar social deixaria a cliente sem
  // esse insumo (Patricia, 12/09/2026, mesma ordem em app.tsx e
  // OnboardingStepper.tsx).
  const steps: ChecklistStep[] = [
    {
      done: data.hasStock,
      title: "Sync your stock",
      description:
        "Stop guessing which products are stuck. We look at sales velocity, inventory age and days since last sale to find out exactly which stock needs a push.",
      href: "/app/products",
      cta: "Go to Products",
    },
    {
      done: data.hasSocial,
      title: "Connect your social accounts",
      description:
        "Connect Instagram, Facebook and Pinterest so Stockative can publish straight to your channels.",
      href: "/app/social",
      cta: "Connect accounts",
    },
    {
      done: data.hasCompetitors,
      title: "Add competitor accounts",
      description:
        "Point us to up to 3 accounts you consider strong in your niche, or skip it. This sharpens your store voice and content strategy with real reference data.",
      href: "/app/competitors",
      cta: "Add competitors",
    },
    {
      done: data.hasBrand,
      title: "Set your store voice",
      description:
        "Describe your store, so every post stays on-message. Stockative can draft this for you from your Instagram, your Shopify About Us page and your products.",
      href: "/app/store-voice",
      cta: "Set store voice",
    },
    {
      // Content pillars e weekly plan fundidos numa fase só — os pilares só
      // existem pra alimentar o plano semanal (Patricia, 12/09/2026: "acho
      // que o 5 e 6 devem se fundir").
      done: data.hasContentPillars && data.hasPublished,
      title: "Get your weekly plan",
      description:
        "Pick what you want this week's posts to achieve, and Stockative builds your content strategy, picks what to post, generates the content, and publishes it for you.",
      href: data.hasContentPillars ? "/app/plan-week" : "/app/content-pillars",
      cta: data.hasContentPillars ? "View weekly plan" : "Set your weekly goal",
    },
  ];

  const setupComplete = steps.every((step) => step.done);
  const nextStepIndex = steps.findIndex((step) => !step.done);
  const nextStep = nextStepIndex === -1 ? undefined : steps[nextStepIndex];

  return (
    <s-page heading="Home">
      {data.stuckPostTitles.length > 0 && (
        <s-section>
          <s-box padding="base" borderWidth="base" borderRadius="base" background="strong">
            <s-stack direction="block" gap="small">
              <s-stack direction="inline" gap="small" alignItems="center">
                <s-badge tone="critical">Needs attention</s-badge>
                <s-heading>
                  {data.stuckPostTitles.length} post
                  {data.stuckPostTitles.length === 1 ? "" : "s"} missed its
                  schedule
                </s-heading>
              </s-stack>
              <s-paragraph>
                {data.stuckPostTitles.join(", ")} — image generation never
                finished, so Stockative held these back instead of
                publishing incomplete. Go to{" "}
                <s-link href="/app/plan-week" onClick={goTo(navigate, "/app/plan-week")}>
                  Weekly plan
                </s-link>{" "}
                to generate an image or swap the product.
              </s-paragraph>
            </s-stack>
          </s-box>
        </s-section>
      )}

      <s-section heading="Welcome to Stockative 🎉">
        {/* Frase de abertura escolhida pela Patricia (12/09/2026) — a
            explicação do que a Stockative faz vem primeiro, sem repetir a
            mesma ideia duas vezes. */}
        <s-heading>
          Stockative turns the products sitting in your Shopify store into
          social campaigns designed to help you sell them.
        </s-heading>
        <s-paragraph>
          You&apos;re always in control: you can swap the products chosen for
          you, or change the day and time each post goes out, from the{" "}
          <s-link href="/app/plan-week" onClick={goTo(navigate, "/app/plan-week")}>
            Weekly plan
          </s-link>{" "}
          tab.
        </s-paragraph>
      </s-section>

      {nextStep && (
        // Foco único da página enquanto o setup não termina — um botão
        // pequeno no canto se perdia no meio do resto da Home (Patricia,
        // 12/09/2026: "deve estar destacado no meio da página como única
        // opção nesta etapa"). Substitui o antigo botão discreto no
        // primary-action; o checklist completo continua abaixo pra dar
        // visão do progresso, mas a ação em si só existe aqui.
        <s-section>
          <s-box padding="large" borderRadius="large" background="strong">
            <s-stack direction="block" gap="base" alignItems="center">
              <s-badge tone="info">Next step</s-badge>
              <s-heading>{nextStep.title}</s-heading>
              <s-paragraph>{nextStep.description}</s-paragraph>
              <s-button
                href={nextStep.href}
                onClick={goTo(navigate, nextStep.href)}
                variant="primary"
              >
                {nextStep.cta}
              </s-button>
            </s-stack>
          </s-box>
        </s-section>
      )}

      <s-section heading={setupComplete ? "Setup" : "Get started"}>
        {!setupComplete && (
          <s-paragraph>
            Finish these {steps.length} steps, in order, to get Stockative
            fully up and running.
          </s-paragraph>
        )}
        <s-stack direction="block" gap="base">
          {steps.map((step, index) => {
            // Trava visual das fases ainda não liberadas — o servidor já
            // bloqueia a navegação (ver app.tsx), isso só evita mostrar um
            // link clicável que ia levar a um redirect de volta pra cá.
            const locked = !step.done && index !== nextStepIndex;
            return (
              <s-box
                key={step.title}
                padding="base"
                borderWidth="base"
                borderRadius="base"
              >
                <s-stack direction="block" gap="small">
                  <s-stack direction="inline" gap="small" alignItems="center">
                    <s-heading>
                      {index + 1}. {step.title}
                    </s-heading>
                    <s-badge tone={step.done ? "success" : locked ? "neutral" : "info"}>
                      {step.done ? "Done" : locked ? "Locked" : "Next up"}
                    </s-badge>
                  </s-stack>
                  <s-paragraph>{step.description}</s-paragraph>
                  {locked ? (
                    <s-text color="subdued">
                      Finish step {nextStepIndex + 1} first to unlock this.
                    </s-text>
                  ) : (
                    <s-link href={step.href} onClick={goTo(navigate, step.href)}>
                      {step.cta}
                    </s-link>
                  )}
                </s-stack>
              </s-box>
            );
          })}
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Your snapshot">
        <s-paragraph>
          <s-text>Products synced: </s-text>
          <s-text type="strong">{data.productsCount}</s-text>
        </s-paragraph>
        <s-paragraph>
          <s-text>Social accounts connected: </s-text>
          <s-text type="strong">{data.socialCount}</s-text>
        </s-paragraph>
        <s-paragraph>
          <s-text>Posts published: </s-text>
          <s-text type="strong">{data.publishedCount}</s-text>
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
