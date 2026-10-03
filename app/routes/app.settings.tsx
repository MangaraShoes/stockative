import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { ensureShopContentLanguage } from "../services/syncProducts.server";
import { CONTENT_LANGUAGES, getAppLanguage } from "../services/decisionEngine/constants";

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
  const { session, admin } = await authenticate.admin(request);

  let shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
  });

  // Relê o idioma padrão da loja aqui (força), pra "Same as your store"
  // refletir uma troca feita depois no admin do Shopify.
  if (shop) {
    await ensureShopContentLanguage(admin, shop, { force: true });
    shop = await prisma.shop.findUnique({ where: { id: shop.id } });
  }

  return {
    plan: shop?.plan ?? "basic",
    // "store" = segue o idioma da loja (appLanguage null).
    appLanguageChoice: shop?.appLanguage ?? "store",
    storeLanguage: getAppLanguage({ storeLanguage: shop?.storeLanguage }),
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

  if (intent === "save-app-language") {
    const choice = String(formData.get("appLanguage") ?? "store");
    if (choice !== "store" && !CONTENT_LANGUAGES.some((lang) => lang.code === choice)) {
      return { intent: "save-app-language" as const, error: "Unknown language." };
    }
    await prisma.shop.update({
      where: { id: shop.id },
      data: { appLanguage: choice === "store" ? null : choice },
    });
    return { intent: "save-app-language" as const, error: null };
  }

  return { intent: "unknown" as const, error: "Unknown action." };
};

export default function Settings() {
  const data = useLoaderData<typeof loader>();
  const planFetcher = useFetcher<typeof action>();
  const languageFetcher = useFetcher<typeof action>();

  const [selectedPlan, setSelectedPlan] = useState(data.plan);

  const isSavingPlan = planFetcher.state !== "idle";

  const savePlan = () => planFetcher.submit({ intent: "save-plan", plan: selectedPlan }, { method: "POST" });

  const [selectedLanguage, setSelectedLanguage] = useState(data.appLanguageChoice);
  const isSavingLanguage = languageFetcher.state !== "idle";
  const languageUnchanged = selectedLanguage === data.appLanguageChoice;
  const saveLanguage = () =>
    languageFetcher.submit({ intent: "save-app-language", appLanguage: selectedLanguage }, { method: "POST" });
  const storeLanguageLabel =
    CONTENT_LANGUAGES.find((lang) => lang.code === data.storeLanguage)?.label ?? "English";

  return (
    <s-page heading="Settings">
      <s-section heading="App language">
        <s-paragraph>
          The language of the app itself, such as the suggested reasons when
          you regenerate a caption or image. It doesn't change the language
          your posts are published in (set that in Store voice).
        </s-paragraph>

        <select
          value={selectedLanguage}
          onChange={(event) => setSelectedLanguage(event.target.value)}
          style={{ padding: "6px 8px", borderRadius: 8, border: "1px solid #ccc" }}
        >
          <option value="store">Same as your store ({storeLanguageLabel})</option>
          {CONTENT_LANGUAGES.map((lang) => (
            <option key={lang.code} value={lang.code}>
              {lang.label}
            </option>
          ))}
        </select>

        <div style={{ marginTop: 12 }}>
          <button
            type="button"
            onClick={saveLanguage}
            disabled={isSavingLanguage || languageUnchanged}
            style={{
              display: "inline-block",
              padding: "8px 16px",
              border: "1px solid #000",
              borderRadius: 8,
              background: "#000",
              color: "#fff",
              fontWeight: 500,
              opacity: isSavingLanguage || languageUnchanged ? 0.5 : 1,
              cursor: isSavingLanguage || languageUnchanged ? "default" : "pointer",
            }}
          >
            {isSavingLanguage ? "Saving…" : "Save language"}
          </button>
        </div>

        {languageFetcher.data?.intent === "save-app-language" && !languageFetcher.data.error && (
          <s-paragraph>Saved.</s-paragraph>
        )}
        {languageFetcher.data?.intent === "save-app-language" && languageFetcher.data.error && (
          <s-paragraph>
            <strong>{languageFetcher.data.error}</strong>
          </s-paragraph>
        )}
      </s-section>

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

    </s-page>
  );
}
