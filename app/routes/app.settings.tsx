import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { estimateCustomPlanPriceCents } from "../services/decisionEngine/customPlanPricing";

// Mesma conta de resolveCustomPlan em planTiers.server.ts (que continua
// sendo a fonte real usada na geração, ver Fase 2) — duplicada aqui, pura,
// só pra pré-visualizar ao vivo enquanto a lojista digita, sem round-trip
// ao servidor a cada tecla. planTiers.server.ts não pode ser importado
// direto num componente de cliente (React Router remove módulos .server do
// bundle do navegador).
const AVG_WEEKS_PER_MONTH = 4.33;
function previewCustomWeeklyPlan(totalPostsPerMonth: number, reelsPerMonth: number) {
  const postsPerWeek = Math.max(1, Math.round(totalPostsPerMonth / AVG_WEEKS_PER_MONTH));
  const reelsPerWeek = Math.min(Math.round(reelsPerMonth / AVG_WEEKS_PER_MONTH), postsPerWeek);
  return { postsPerWeek, reelsPerWeek };
}

const PLAN_OPTIONS = [
  {
    value: "basic",
    label: "Basic — €24.90/month",
    description: "3 posts/week (~12/month) — 2 image posts + 1 reel weekly.",
  },
  {
    value: "grow",
    label: "Grow",
    description: "5 posts/week — 3 image posts + 2 reels weekly. Pricing not set yet.",
  },
  {
    value: "plus",
    label: "Plus",
    description: "7 posts/week — 4 image posts + 3 reels weekly. Pricing not set yet.",
  },
  {
    value: "custom",
    label: "Custom",
    description: "Pick your own monthly posts and reels — priced accordingly.",
  },
] as const;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
  });

  return {
    plan: shop?.plan ?? "basic",
    customPostsPerMonth: shop?.customPostsPerMonth ?? null,
    customReelsPerMonth: shop?.customReelsPerMonth ?? null,
  };
};

// Não existe cobrança real ainda (Fase 7, Shopify Billing, fica de fora —
// ver plano de implementação) — trocar de plano aqui só muda a cadência e a
// cota que o app usa pra decidir e gerar conteúdo (Fases 2 e 3), do mesmo
// jeito que o piloto já testa hoje direto no banco. É a forma manual de
// escolher plano até a cobrança real existir.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({ where: { shopifyDomain: session.shop } });
  if (!shop) throw new Response("Shop not found", { status: 404 });

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "save-plan") {
    const plan = String(formData.get("plan") ?? "basic");
    if (!PLAN_OPTIONS.some((option) => option.value === plan)) {
      return { intent: "save-plan" as const, error: "Unknown plan." };
    }
    await prisma.shop.update({ where: { id: shop.id }, data: { plan } });
    return { intent: "save-plan" as const, error: null };
  }

  if (intent === "save-custom") {
    const customPostsPerMonth = Number(formData.get("customPostsPerMonth"));
    const customReelsPerMonth = Number(formData.get("customReelsPerMonth"));

    if (!Number.isFinite(customPostsPerMonth) || customPostsPerMonth <= 0) {
      return { intent: "save-custom" as const, error: "Enter a valid number of posts per month." };
    }
    if (!Number.isFinite(customReelsPerMonth) || customReelsPerMonth < 0) {
      return { intent: "save-custom" as const, error: "Enter a valid number of reels per month." };
    }
    if (customReelsPerMonth > customPostsPerMonth) {
      return { intent: "save-custom" as const, error: "Reels can't be more than total posts per month." };
    }

    await prisma.shop.update({
      where: { id: shop.id },
      data: { customPostsPerMonth, customReelsPerMonth },
    });
    return { intent: "save-custom" as const, error: null };
  }

  return { intent: "unknown" as const, error: "Unknown action." };
};

export default function Settings() {
  const data = useLoaderData<typeof loader>();
  const planFetcher = useFetcher<typeof action>();
  const customFetcher = useFetcher<typeof action>();

  const [selectedPlan, setSelectedPlan] = useState(data.plan);
  const [customPosts, setCustomPosts] = useState(String(data.customPostsPerMonth ?? ""));
  const [customReels, setCustomReels] = useState(String(data.customReelsPerMonth ?? ""));

  const isSavingPlan = planFetcher.state !== "idle";
  const isSavingCustom = customFetcher.state !== "idle";

  const savePlan = () => planFetcher.submit({ intent: "save-plan", plan: selectedPlan }, { method: "POST" });
  const saveCustom = () =>
    customFetcher.submit(
      { intent: "save-custom", customPostsPerMonth: customPosts, customReelsPerMonth: customReels },
      { method: "POST" },
    );

  const parsedPosts = Number(customPosts);
  const parsedReels = Number(customReels);
  const hasValidCustomInput =
    Number.isFinite(parsedPosts) && parsedPosts > 0 && Number.isFinite(parsedReels) && parsedReels >= 0 && parsedReels <= parsedPosts;

  const customPreview = hasValidCustomInput ? previewCustomWeeklyPlan(parsedPosts, parsedReels) : null;
  const customPriceCents = hasValidCustomInput ? estimateCustomPlanPriceCents(parsedPosts, parsedReels) : null;

  return (
    <s-page heading="Plan">
      <s-section heading="Choose your plan">
        <s-paragraph>
          Your plan sets how many posts the AI generates automatically each
          week, and how many of them are reels. This never blocks automatic
          posting — it only changes the pace.
        </s-paragraph>

        <s-stack direction="block" gap="base">
          {PLAN_OPTIONS.map((option) => (
            <label key={option.value} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <input
                type="radio"
                name="plan"
                value={option.value}
                checked={selectedPlan === option.value}
                onChange={() => setSelectedPlan(option.value)}
                style={{ marginTop: 4 }}
              />
              <span>
                <strong>{option.label}</strong> — {option.description}
              </span>
            </label>
          ))}
        </s-stack>

        <div style={{ marginTop: 12 }}>
          <button
            type="button"
            onClick={savePlan}
            disabled={isSavingPlan || selectedPlan === data.plan}
            style={{
              display: "inline-block",
              padding: "8px 16px",
              border: "1px solid #000",
              borderRadius: 8,
              background: "#000",
              color: "#fff",
              fontWeight: 500,
              opacity: isSavingPlan || selectedPlan === data.plan ? 0.5 : 1,
              cursor: isSavingPlan || selectedPlan === data.plan ? "default" : "pointer",
            }}
          >
            {isSavingPlan ? "Saving…" : "Save plan"}
          </button>
        </div>

        {planFetcher.data?.intent === "save-plan" && !planFetcher.data.error && (
          <s-paragraph>Saved.</s-paragraph>
        )}
        {planFetcher.data?.intent === "save-plan" && planFetcher.data.error && (
          <s-paragraph>
            <strong>{planFetcher.data.error}</strong>
          </s-paragraph>
        )}
      </s-section>

      {selectedPlan === "custom" && (
        <s-section heading="Custom plan">
          <s-paragraph>
            Pick your own total posts per month, and how many of those should
            be reels (reels cost more to produce, so they&apos;re weighted
            higher in the price). Whatever you don&apos;t set falls back to
            the Basic cadence — this never blocks automatic posting.
          </s-paragraph>

          <s-stack direction="inline" gap="base">
            <div>
              <s-paragraph>Posts per month</s-paragraph>
              <input
                type="number"
                min={1}
                value={customPosts}
                onChange={(e) => setCustomPosts(e.target.value)}
                style={{ padding: 8, width: 120 }}
              />
            </div>
            <div>
              <s-paragraph>Of which, reels per month</s-paragraph>
              <input
                type="number"
                min={0}
                value={customReels}
                onChange={(e) => setCustomReels(e.target.value)}
                style={{ padding: 8, width: 120 }}
              />
            </div>
          </s-stack>

          {customPreview && (
            <s-paragraph>
              That&apos;s about {customPreview.postsPerWeek} post{customPreview.postsPerWeek === 1 ? "" : "s"}/week,{" "}
              {customPreview.reelsPerWeek} of them a reel.
              {customPriceCents !== null && (
                <>
                  {" "}
                  Estimated price:{" "}
                  {customPriceCents > 0
                    ? `€${(customPriceCents / 100).toFixed(2)}/month`
                    : "pricing for the Custom plan isn't set yet — contact us."}
                </>
              )}
            </s-paragraph>
          )}

          <div style={{ marginTop: 12 }}>
            <button
              type="button"
              onClick={saveCustom}
              disabled={isSavingCustom || !hasValidCustomInput}
              style={{
                display: "inline-block",
                padding: "8px 16px",
                border: "1px solid #a8abae",
                borderRadius: 8,
                background: "#c9cccf",
                color: "#202223",
                fontWeight: 500,
                opacity: isSavingCustom || !hasValidCustomInput ? 0.5 : 1,
                cursor: isSavingCustom || !hasValidCustomInput ? "default" : "pointer",
              }}
            >
              {isSavingCustom ? "Saving…" : "Save custom plan"}
            </button>
          </div>

          {customFetcher.data?.intent === "save-custom" && !customFetcher.data.error && (
            <s-paragraph>Saved.</s-paragraph>
          )}
          {customFetcher.data?.intent === "save-custom" && customFetcher.data.error && (
            <s-paragraph>
              <strong>{customFetcher.data.error}</strong>
            </s-paragraph>
          )}
        </s-section>
      )}
    </s-page>
  );
}
