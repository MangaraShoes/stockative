import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { EXTRAS_PRICING, estimateExtrasPriceCents } from "../services/decisionEngine/extrasPricing";

const formatEuro = (cents: number) => `€${(cents / 100).toFixed(2)}`;

const PLAN_OPTIONS = [
  {
    value: "basic",
    label: "Basic — €24.90/month",
    description: "3 posts/week (~12/month) — 2 image posts + 1 reel weekly.",
  },
  {
    value: "grow",
    label: "Grow — €37.90/month",
    description: "5 posts/week — 3 image posts + 2 reels weekly.",
  },
  {
    value: "plus",
    label: "Plus — €49.90/month",
    description: "7 posts/week — 4 image posts + 3 reels weekly.",
  },
] as const;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
  });

  return {
    plan: shop?.plan ?? "basic",
    extraCarouselsPerMonth: shop?.extraCarouselsPerMonth ?? 0,
    extraReelsPerMonth: shop?.extraReelsPerMonth ?? 0,
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

  if (intent === "save-extras") {
    const extraCarouselsPerMonth = Number(formData.get("extraCarouselsPerMonth"));
    const extraReelsPerMonth = Number(formData.get("extraReelsPerMonth"));

    if (!Number.isInteger(extraCarouselsPerMonth) || extraCarouselsPerMonth < 0) {
      return { intent: "save-extras" as const, error: "Enter a valid number of extra carousels." };
    }
    if (!Number.isInteger(extraReelsPerMonth) || extraReelsPerMonth < 0) {
      return { intent: "save-extras" as const, error: "Enter a valid number of extra reels." };
    }

    await prisma.shop.update({
      where: { id: shop.id },
      data: { extraCarouselsPerMonth, extraReelsPerMonth },
    });
    return { intent: "save-extras" as const, error: null };
  }

  return { intent: "unknown" as const, error: "Unknown action." };
};

export default function Settings() {
  const data = useLoaderData<typeof loader>();
  const planFetcher = useFetcher<typeof action>();
  const extrasFetcher = useFetcher<typeof action>();

  const [selectedPlan, setSelectedPlan] = useState(data.plan);
  const [extraCarousels, setExtraCarousels] = useState(String(data.extraCarouselsPerMonth));
  const [extraReels, setExtraReels] = useState(String(data.extraReelsPerMonth));

  const isSavingPlan = planFetcher.state !== "idle";
  const isSavingExtras = extrasFetcher.state !== "idle";

  const savePlan = () => planFetcher.submit({ intent: "save-plan", plan: selectedPlan }, { method: "POST" });
  const saveExtras = () =>
    extrasFetcher.submit(
      { intent: "save-extras", extraCarouselsPerMonth: extraCarousels, extraReelsPerMonth: extraReels },
      { method: "POST" },
    );

  const parsedCarousels = Number(extraCarousels);
  const parsedReels = Number(extraReels);
  const hasValidExtrasInput =
    Number.isInteger(parsedCarousels) && parsedCarousels >= 0 && Number.isInteger(parsedReels) && parsedReels >= 0;
  const extrasUnchanged =
    parsedCarousels === data.extraCarouselsPerMonth && parsedReels === data.extraReelsPerMonth;
  const extrasPriceCents = hasValidExtrasInput ? estimateExtrasPriceCents(parsedCarousels, parsedReels) : null;

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

      <s-section heading="Extras">
        <s-paragraph>
          Need more than your plan includes? Add extra carousels or reels on
          top of it each month — they&apos;re spread across the weeks and
          added to your plan, never replacing it. Extra carousel:{" "}
          {formatEuro(EXTRAS_PRICING.pricePerCarouselCents)} · Extra reel:{" "}
          {formatEuro(EXTRAS_PRICING.pricePerReelCents)}.
        </s-paragraph>

        <s-stack direction="inline" gap="base">
          <div>
            <s-paragraph>Extra carousels per month</s-paragraph>
            <input
              type="number"
              min={0}
              step={1}
              value={extraCarousels}
              onChange={(e) => setExtraCarousels(e.target.value)}
              style={{ padding: 8, width: 120 }}
            />
          </div>
          <div>
            <s-paragraph>Extra reels per month</s-paragraph>
            <input
              type="number"
              min={0}
              step={1}
              value={extraReels}
              onChange={(e) => setExtraReels(e.target.value)}
              style={{ padding: 8, width: 120 }}
            />
          </div>
        </s-stack>

        {extrasPriceCents !== null && extrasPriceCents > 0 && (
          <s-paragraph>Extras: +{formatEuro(extrasPriceCents)}/month on top of your plan.</s-paragraph>
        )}

        <div style={{ marginTop: 12 }}>
          <button
            type="button"
            onClick={saveExtras}
            disabled={isSavingExtras || !hasValidExtrasInput || extrasUnchanged}
            style={{
              display: "inline-block",
              padding: "8px 16px",
              border: "1px solid #a8abae",
              borderRadius: 8,
              background: "#c9cccf",
              color: "#202223",
              fontWeight: 500,
              opacity: isSavingExtras || !hasValidExtrasInput || extrasUnchanged ? 0.5 : 1,
              cursor: isSavingExtras || !hasValidExtrasInput || extrasUnchanged ? "default" : "pointer",
            }}
          >
            {isSavingExtras ? "Saving…" : "Save extras"}
          </button>
        </div>

        {extrasFetcher.data?.intent === "save-extras" && !extrasFetcher.data.error && (
          <s-paragraph>Saved.</s-paragraph>
        )}
        {extrasFetcher.data?.intent === "save-extras" && extrasFetcher.data.error && (
          <s-paragraph>
            <strong>{extrasFetcher.data.error}</strong>
          </s-paragraph>
        )}
      </s-section>
    </s-page>
  );
}
