import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getOrCreateShop, syncProducts } from "../services/syncProducts.server";
import { computeCommerceSignals } from "../services/computeCommerceSignals.server";
import { getOnboardingStatus, type OnboardingStatus } from "../services/onboardingStatus.server";
import { OnboardingStepper } from "../components/OnboardingStepper";

const EMPTY_ONBOARDING_STATUS: OnboardingStatus = {
  hasStock: false,
  hasBrand: false,
  hasSocial: false,
  hasCompetitors: false,
  hasContentPillars: false,
  hasPublished: false,
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
  });

  const productsCount = shop
    ? await prisma.productCache.count({ where: { shopId: shop.id } })
    : 0;

  const onboardingStatus = shop ? await getOnboardingStatus(shop.id) : EMPTY_ONBOARDING_STATUS;

  return { productsCount, onboardingStatus };
};

// Sync e cálculo de sinais eram dois botões separados na tela — a Patricia
// clicou e não sabia qual vinha primeiro (12/09/2026: "nem eu mesma sei onde
// devo clicar primeiro"). hasStock sempre exigiu os dois juntos mesmo, então
// viraram uma ação só: um clique importa o catálogo E calcula os sinais.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  const { shop } = await getOrCreateShop(session.shop, session.accessToken ?? "");

  const syncedCount = await syncProducts(admin, shop.id);
  const computedCount = await computeCommerceSignals(admin, shop.id);
  return { intent: "analyze-stock" as const, syncedCount, computedCount };
};

export default function Products() {
  const { productsCount, onboardingStatus } = useLoaderData<typeof loader>();
  const analyzeFetcher = useFetcher<typeof action>();

  const isAnalyzing =
    ["loading", "submitting"].includes(analyzeFetcher.state) &&
    analyzeFetcher.formMethod === "POST";

  const runAnalyze = () => analyzeFetcher.submit({}, { method: "POST" });

  return (
    <s-page heading="Products">
      {productsCount === 0 && (
        // Mesmo tratamento da Home — ação única em destaque no meio da
        // página em vez de um botão pequeno no canto (Patricia, 12/09/2026).
        <s-section>
          <s-box padding="large" borderRadius="large" background="strong">
            <s-stack direction="block" gap="base" alignItems="center">
              <s-heading>Sync your stock</s-heading>
              <s-paragraph>
                Your stock is just sitting there right now. Find out exactly
                which products need a push to start selling.
              </s-paragraph>
              <s-button
                onClick={runAnalyze}
                variant="primary"
                {...(isAnalyzing ? { loading: true } : {})}
              >
                Sync stock
              </s-button>
              {analyzeFetcher.data?.intent === "analyze-stock" &&
                analyzeFetcher.data.syncedCount === 0 && (
                  <s-paragraph>
                    <strong>
                      No products found in your Shopify store. Add at least
                      one active product, then sync again.
                    </strong>
                  </s-paragraph>
                )}
            </s-stack>
          </s-box>
        </s-section>
      )}

      <OnboardingStepper status={onboardingStatus} currentStepHref="/app/products" />

      {productsCount > 0 && (
        // Só a confirmação, sem listar produto por produto — não há razão
        // pra essa página virar um catálogo (Patricia, 12/09/2026: "não tem
        // por que aparecer a lista longa do stock"). O detalhe por produto
        // já existe na própria aba Products da Shopify.
        <s-section heading="Your stock">
          <s-paragraph>
            {analyzeFetcher.data?.intent === "analyze-stock"
              ? `Analyzed ${analyzeFetcher.data.syncedCount} product(s) — now we know exactly which ones need a push to start selling again.`
              : `${productsCount} product(s) synced and analyzed.`}
          </s-paragraph>

          {/* Fundo cinza sólido, inline — mesmo padrão do resto do app
              (Store voice, Content pillars, Competitors). O botão no canto
              superior (slot="primary-action") ficava fora desse padrão
              (Patricia, 12/09/2026: "o botão de sync stock voltou a
              aparecer no canto superior"). */}
          <div style={{ marginTop: 8 }}>
            <button
              type="button"
              onClick={runAnalyze}
              disabled={isAnalyzing}
              style={{
                display: "inline-block",
                padding: "8px 16px",
                border: "1px solid #a8abae",
                borderRadius: 8,
                background: "#c9cccf",
                color: "#202223",
                fontWeight: 500,
                opacity: isAnalyzing ? 0.5 : 1,
                cursor: isAnalyzing ? "default" : "pointer",
              }}
            >
              {isAnalyzing ? "Syncing…" : "Sync stock"}
            </button>
          </div>
        </s-section>
      )}
    </s-page>
  );
}
