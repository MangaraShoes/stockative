import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, redirect, useActionData, useLoaderData, useNavigate, useNavigation } from "react-router";
import { goTo } from "../utils/navigateOnClick";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { useState } from "react";
import { draftContentPillars } from "../services/decisionEngine/draftContentPillars.server";
import {
  planWeeklyContent,
  planPromotionalWeek,
  createPromotion,
} from "../services/decisionEngine/planWeek.server";
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
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
  });

  const pillarsCount = shop
    ? await prisma.contentPillar.count({ where: { shopId: shop.id } })
    : 0;

  // Coleções reais da loja, pra escopar uma promoção (Patricia, 13/09/2026:
  // "acho melhor por collection assim ele pode criar uma collection com os
  // items que deseja promover sem ter que criar uma nova categoria") — em
  // vez de productType, que travaria numa categoria fixa do cadastro. Cada
  // linha em ProductCache.collections junta até 5 nomes com ", " (ver
  // syncProducts.server.ts), então separa e desduplica em JS.
  const collectionRows = shop
    ? await prisma.productCache.findMany({
        where: { shopId: shop.id, collections: { not: null } },
        select: { collections: true },
      })
    : [];
  const productCollections = Array.from(
    new Set(
      collectionRows
        .flatMap((row) => (row.collections ?? "").split(","))
        .map((name) => name.trim())
        .filter(Boolean),
    ),
  ).sort();

  const onboardingStatus = shop ? await getOnboardingStatus(shop.id) : EMPTY_ONBOARDING_STATUS;

  return {
    // brandDescription é o campo que realmente conta pro hasBrand (ver
    // onboardingStatus.server.ts) — brandTone sozinho não garante que o
    // store voice foi de fato preenchido.
    hasBrandVoice: Boolean(shop?.brandDescription?.trim()),
    hasContentPillars: pillarsCount > 0,
    productCollections,
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
  const mode = String(formData.get("mode") ?? "objective");

  // Nunca deixar uma falha aqui derrubar a tela em branco (achado ao vivo,
  // 13/09/2026, mesma regra já aplicada em store-voice e no loader raiz):
  // isso chama duas cadeias de IA seguidas (pillares + plano semanal
  // inteiro), então o risco de falha é maior que o normal.
  try {
    // Os pillares (estratégia de fundo) são gerados sempre, nos dois modos —
    // uma campanha promocional é um evento pontual, não substitui a
    // estratégia de conteúdo de longo prazo, e sem isso hasContentPillars
    // nunca ficaria true pelo caminho de promoção, travando o onboarding.
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

    if (mode === "promotion") {
      const occasionPreset = String(formData.get("occasionPreset") ?? "");
      const customOccasionName = String(formData.get("customOccasionName") ?? "").trim();
      const name = occasionPreset === "Other" ? customOccasionName : occasionPreset;
      const discountPct = Number(formData.get("discountPct"));
      const scopeType = String(formData.get("scopeType") ?? "store") as "store" | "collection";
      const scopeValue = scopeType === "collection" ? String(formData.get("scopeValue") ?? "") : null;
      const startsAt = new Date(String(formData.get("startsAt")));
      const endsAt = new Date(String(formData.get("endsAt")));

      if (!name || !Number.isFinite(discountPct) || discountPct <= 0) {
        return { error: "Fill in the campaign name and a real discount percentage." };
      }
      if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) {
        return { error: "Pick a valid start and end date, with the end after the start." };
      }

      const promotion = await createPromotion({
        shopId: shop.id,
        name,
        discountPct,
        scopeType,
        scopeValue,
        startsAt,
        endsAt,
      });

      await planPromotionalWeek(shop.id, promotion);
    } else {
      const objectiveValues = formData.getAll("objective").map(String) as CommercialObjective[];
      const forcedObjectives = objectiveValues.length > 0 ? objectiveValues : undefined;
      await planWeeklyContent(shop.id, forcedObjectives);
    }
  } catch (error) {
    console.error("Failed to build content pillars + weekly plan:", error);
    return {
      error:
        "Something went wrong while setting your content strategy and building this week's plan. Please try again.",
    };
  }

  throw redirect("/app/plan-week");
};

// Calendário anual de campanhas de e-commerce (Patricia, 13/09/2026: "já
// devemos todo o calendario anual de campanhas") — em ordem cronológica do
// ano, pra ela achar rápido a próxima data que se aplica à loja dela.
// "Other" sempre por último, pra ocasião que não está na lista.
const OCCASION_PRESETS = [
  "New Year Sale",
  "Valentine's Day",
  "Mother's Day",
  "Easter",
  "Father's Day",
  "Summer Sale",
  "Back to School",
  "Halloween",
  "Singles' Day (11.11)",
  "Black Friday",
  "Cyber Monday",
  "Christmas",
  "Boxing Day",
  "End of Season Sale",
  "Other",
] as const;

export default function ContentPillars() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const isGenerating = navigation.state !== "idle";

  // "objective" = conteúdo normal da semana; "promotion" = campanha real
  // (Black Friday, Christmas...) que SUBSTITUI o plano normal inteiro
  // (Patricia, 13/09/2026: "substitui, e sim trava a publicação depois do
  // prazo").
  const [mode, setMode] = useState<"objective" | "promotion">("objective");
  const [occasionPreset, setOccasionPreset] = useState<string>(OCCASION_PRESETS[0]);
  const [scopeType, setScopeType] = useState<"store" | "collection">("store");

  const submitLabel =
    mode === "promotion" ? "Build my promotional campaign" : "Build my weekly plan";

  return (
    <s-page heading="Weekly objective">
      <OnboardingStepper status={data.onboardingStatus} currentStepHref="/app/content-pillars" />

      <s-section heading="What's this week's goal?">
        {actionData?.error && (
          <s-paragraph>
            <strong>{actionData.error}</strong>
          </s-paragraph>
        )}

        {data.hasContentPillars ? (
          <>
            <s-paragraph>
              Your content strategy and this week&apos;s plan are already set up.
            </s-paragraph>
            {/* href= sozinho faz navegação de documento inteira e perde o
                contexto embutido do Shopify (achado ao vivo, 20/09/2026 —
                ver app/utils/navigateOnClick.ts). onClick intercepta e
                navega pelo React Router; href fica só de fallback/SEO. */}
            <s-link href="/app/plan-week" onClick={goTo(navigate, "/app/plan-week")}>
              View weekly plan
            </s-link>
          </>
        ) : (
          <>
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
              <input type="hidden" name="mode" value={mode} />
              <s-stack direction="block" gap="base">
                <s-stack direction="inline" gap="base">
                  <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <input
                      type="radio"
                      checked={mode === "objective"}
                      onChange={() => setMode("objective")}
                    />
                    Regular weekly content
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <input
                      type="radio"
                      checked={mode === "promotion"}
                      onChange={() => setMode("promotion")}
                    />
                    Seasonal or promotional campaign (Black Friday, Christmas…)
                  </label>
                </s-stack>

                {mode === "objective" && (
                  <>
                    <s-stack direction="inline" gap="base">
                      {COMMERCIAL_OBJECTIVES.map((objective) => (
                        <label
                          key={objective}
                          style={{ display: "flex", alignItems: "center", gap: 4 }}
                        >
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
                  </>
                )}

                {mode === "promotion" && (
                  <>
                    <s-paragraph>
                      This replaces the regular weekly content above — every
                      post this week will be about this campaign, and
                      nothing will publish once it ends.
                    </s-paragraph>

                    <s-stack direction="inline" gap="base">
                      <select
                        name="occasionPreset"
                        value={occasionPreset}
                        onChange={(e) => setOccasionPreset(e.target.value)}
                        style={{ padding: 8 }}
                      >
                        {OCCASION_PRESETS.map((preset) => (
                          <option key={preset} value={preset}>
                            {preset}
                          </option>
                        ))}
                      </select>
                      {occasionPreset === "Other" && (
                        <input
                          type="text"
                          name="customOccasionName"
                          placeholder="Campaign name"
                          style={{ padding: 8, flex: 1 }}
                        />
                      )}
                    </s-stack>

                    <s-stack direction="inline" gap="base" alignItems="center">
                      <input
                        type="number"
                        name="discountPct"
                        min="1"
                        max="90"
                        placeholder="Discount"
                        style={{ width: 100, padding: 8 }}
                      />
                      <s-text>% off</s-text>
                    </s-stack>

                    <s-stack direction="inline" gap="base">
                      <select
                        name="scopeType"
                        value={scopeType}
                        onChange={(e) => setScopeType(e.target.value as "store" | "collection")}
                        style={{ padding: 8 }}
                      >
                        <option value="store">Whole store</option>
                        <option value="collection">One collection</option>
                      </select>
                      {scopeType === "collection" && (
                        <select name="scopeValue" style={{ padding: 8 }}>
                          {data.productCollections.length === 0 ? (
                            <option value="">No collections found</option>
                          ) : (
                            data.productCollections.map((collection) => (
                              <option key={collection} value={collection}>
                                {collection}
                              </option>
                            ))
                          )}
                        </select>
                      )}
                    </s-stack>

                    <s-stack direction="inline" gap="base" alignItems="center">
                      <label>
                        Starts <input type="date" name="startsAt" style={{ padding: 8 }} />
                      </label>
                      <label>
                        Ends <input type="date" name="endsAt" style={{ padding: 8 }} />
                      </label>
                    </s-stack>
                  </>
                )}

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
                  {isGenerating ? "Building…" : submitLabel}
                </button>

                {isGenerating && (
                  <GeneratingProgressBar label="Setting your content strategy and building this week's posts…" />
                )}
              </s-stack>
            </Form>
          </>
        )}
      </s-section>
    </s-page>
  );
}
