import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, redirect, useActionData, useLoaderData, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { draftContentPillars } from "../services/decisionEngine/draftContentPillars.server";
import { planWeeklyContent } from "../services/decisionEngine/planWeek.server";
import {
  COMMERCIAL_OBJECTIVES,
  OBJECTIVE_LABELS,
  type CommercialObjective,
  type ContentLanguageCode,
} from "../services/decisionEngine/constants";
import { getOnboardingStatus, type OnboardingStatus } from "../services/onboardingStatus.server";
import { OnboardingStepper } from "../components/OnboardingStepper";
import { GeneratingProgressBar } from "../components/GeneratingProgressBar";

const EMPTY_ONBOARDING_STATUS: OnboardingStatus = {
  hasStock: false,
  hasBrand: false,
  hasSocial: false,
  hasCompetitors: false,
  hasContentPillars: false,
  hasPublished: false,
};

// Passo redesenhado (Patricia, 13/09/2026: "não acho que precisamos mostrar
// esta previa dos posts do cliente neste momento, só queremos que ele
// defina qual o objetivo que ele quer alcançar... e após montamos os
// pillares internamente e já passamos direto para o weekly plan"). Antes
// disso, este passo mostrava um preview editável de cada pilar (nome,
// função, promessa...) pra revisão manual — a lojista achou confuso demais
// pra algo que ela nunca ia usar diretamente. Agora: ela só escolhe o(s)
// objetivo(s) da semana (pode marcar mais de um — "conversion and
// relationship"), e os pillares são gerados e salvos sozinhos, sem tela de
// revisão, seguidos direto pela geração do weekly plan.
//
// Página só de PRIMEIRA VEZ (Patricia, 20/09/2026: "esconde o Weekly
// objective do menu quando já tiver pilares") — uma vez que os pilares
// existem, essa tela não tem mais nada de único pra mostrar (regenerar a
// semana normal e criar uma campanha promocional nova já vivem em
// app.plan-week.tsx), então só redireciona pra lá em vez de mostrar um
// dead-end.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
  });

  const pillarsCount = shop
    ? await prisma.contentPillar.count({ where: { shopId: shop.id } })
    : 0;
  if (pillarsCount > 0) {
    throw redirect("/app/plan-week");
  }

  const onboardingStatus = shop ? await getOnboardingStatus(shop.id) : EMPTY_ONBOARDING_STATUS;

  return {
    // brandDescription é o campo que realmente conta pro hasBrand (ver
    // onboardingStatus.server.ts) — brandTone sozinho não garante que o
    // store voice foi de fato preenchido.
    hasBrandVoice: Boolean(shop?.brandDescription?.trim()),
    onboardingStatus,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
  });
  if (!shop) throw new Response("Shop not found", { status: 404 });

  // Instagram conectado é obrigatório antes de gerar o plano semanal —
  // mesma regra de app.plan-week.tsx. hasSocial (que já travou o onboarding
  // até aqui) só exige QUALQUER conta social, não Instagram
  // especificamente, então essa checagem continua necessária.
  const socialAccount = await prisma.socialAccount.findUnique({
    where: { shopId_platform: { shopId: shop.id, platform: "instagram" } },
  });
  if (!socialAccount?.igBusinessAccountId) {
    return { error: "Connect Instagram first — see Social accounts." };
  }

  const formData = await request.formData();

  // Nunca deixar uma falha aqui derrubar a tela em branco (achado ao vivo,
  // 13/09/2026, mesma regra já aplicada em store-voice e no loader raiz):
  // isso chama duas cadeias de IA seguidas (pillares + plano semanal
  // inteiro), então o risco de falha é maior que o normal.
  try {
    const products = await prisma.productCache.findMany({
      where: { shopId: shop.id },
      select: { title: true, description: true, productType: true, price: true },
    });
    const draft = await draftContentPillars(
      products,
      {
        brandDescription: shop.brandDescription,
        brandTone: shop.brandTone,
        brandAvoid: shop.brandAvoid,
      },
      shop.contentLanguagePrimary as ContentLanguageCode,
    );

    await prisma.$transaction([
      prisma.contentPillar.deleteMany({ where: { shopId: shop.id } }),
      prisma.contentPillar.createMany({
        data: draft.map((p) => ({ ...p, shopId: shop.id })),
      }),
    ]);

    const objectiveValues = formData.getAll("objective").map(String) as CommercialObjective[];
    const forcedObjectives = objectiveValues.length > 0 ? objectiveValues : undefined;
    await planWeeklyContent(shop.id, forcedObjectives);
  } catch (error) {
    console.error("Failed to build content pillars + weekly plan:", error);
    return {
      error:
        "Something went wrong while setting your content strategy and building this week's plan. Please try again.",
    };
  }

  throw redirect("/app/plan-week");
};

export default function ContentPillars() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isGenerating = navigation.state !== "idle";

  return (
    <s-page heading="Weekly objective">
      <OnboardingStepper status={data.onboardingStatus} currentStepHref="/app/content-pillars" />

      <s-section heading="What's this week's goal?">
        {actionData?.error && (
          <s-paragraph>
            <strong>{actionData.error}</strong>
          </s-paragraph>
        )}

        <s-paragraph>
          Pick what you want this week&apos;s posts to achieve. Stockative
          builds your content strategy around it and generates this
          week&apos;s plan right away.
        </s-paragraph>

        {!data.hasBrandVoice && (
          <s-paragraph>
            <strong>
              Set up your Store voice first — it grounds everything
              Stockative writes.
            </strong>
          </s-paragraph>
        )}

        <Form method="post">
          <s-stack direction="block" gap="base">
            <s-stack direction="inline" gap="base">
              {COMMERCIAL_OBJECTIVES.map((objective) => (
                <label key={objective} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <input type="checkbox" name="objective" value={objective} />
                  {OBJECTIVE_LABELS[objective]}
                </label>
              ))}
            </s-stack>
            <s-paragraph>
              <s-text color="subdued">
                Leave all unchecked to let Stockative decide per product.
              </s-text>
            </s-paragraph>

            <button
              type="submit"
              disabled={!data.hasBrandVoice || isGenerating}
              style={{
                display: "inline-block",
                alignSelf: "flex-start",
                padding: "8px 16px",
                border: "1px solid #000",
                borderRadius: 8,
                background: "#000",
                color: "#fff",
                fontWeight: 500,
                opacity: !data.hasBrandVoice ? 0.5 : 1,
                cursor: isGenerating || !data.hasBrandVoice ? "default" : "pointer",
              }}
            >
              {isGenerating ? "Building…" : "Build my weekly plan"}
            </button>

            {isGenerating && (
              <GeneratingProgressBar label="Setting your content strategy and building this week's posts…" />
            )}
          </s-stack>
        </Form>
      </s-section>
    </s-page>
  );
}
