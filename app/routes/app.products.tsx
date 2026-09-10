import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getOrCreateShop, syncProducts } from "../services/syncProducts.server";
import { computeCommerceSignals } from "../services/computeCommerceSignals.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
  });

  const products = shop
    ? await prisma.productCache.findMany({
        where: { shopId: shop.id },
        include: { commerceSignal: true },
        orderBy: { updatedAt: "desc" },
      })
    : [];

  return { products };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  const { shop } = await getOrCreateShop(session.shop, session.accessToken ?? "");

  if (intent === "compute-signals") {
    const computedCount = await computeCommerceSignals(admin, shop.id);
    return { intent, computedCount };
  }

  const syncedCount = await syncProducts(admin, shop.id);
  return { intent: "sync-products", syncedCount };
};

export default function Products() {
  const { products } = useLoaderData<typeof loader>();
  const syncFetcher = useFetcher<typeof action>();
  const signalsFetcher = useFetcher<typeof action>();

  const isSyncing =
    ["loading", "submitting"].includes(syncFetcher.state) &&
    syncFetcher.formMethod === "POST";
  const isComputingSignals =
    ["loading", "submitting"].includes(signalsFetcher.state) &&
    signalsFetcher.formMethod === "POST";

  const runSync = () => syncFetcher.submit({}, { method: "POST" });
  const runComputeSignals = () =>
    signalsFetcher.submit({ intent: "compute-signals" }, { method: "POST" });

  return (
    <s-page heading="Products">
      <s-button
        slot="primary-action"
        onClick={runSync}
        {...(isSyncing ? { loading: true } : {})}
      >
        Sync products
      </s-button>

      <s-section heading="Synced products">
        <s-stack direction="inline" gap="base">
          <s-button
            onClick={runComputeSignals}
            variant="tertiary"
            {...(isComputingSignals ? { loading: true } : {})}
          >
            Calculate commerce signals
          </s-button>
        </s-stack>

        {syncFetcher.data?.intent === "sync-products" && (
          <s-paragraph>
            Last sync: {syncFetcher.data.syncedCount} product(s).
          </s-paragraph>
        )}
        {signalsFetcher.data?.intent === "compute-signals" && (
          <s-paragraph>
            Commerce signals recalculated for{" "}
            {signalsFetcher.data.computedCount} product(s).
          </s-paragraph>
        )}

        {products.length === 0 ? (
          <s-paragraph>
            No products synced yet. Click &quot;Sync products&quot; to import
            from your store.
          </s-paragraph>
        ) : (
          <s-stack direction="block" gap="base">
            {products.map((product) => (
              <s-box
                key={product.id}
                padding="base"
                borderWidth="base"
                borderRadius="base"
                background="subdued"
              >
                <s-stack direction="block" gap="base">
                  <s-heading>{product.title}</s-heading>
                  <s-paragraph>
                    Price: €{product.price.toFixed(2)}
                    {product.compareAtPrice
                      ? ` (from €${product.compareAtPrice.toFixed(2)})`
                      : ""}
                  </s-paragraph>
                  <s-paragraph>
                    Stock: {product.inventoryQuantity} · Status:{" "}
                    {product.status}
                  </s-paragraph>
                  {product.collections && (
                    <s-paragraph>Collections: {product.collections}</s-paragraph>
                  )}
                  {product.commerceSignal ? (
                    <s-paragraph>
                      Sold (30d): {product.commerceSignal.unitsSold30d} ·
                      Sales velocity:{" "}
                      {product.commerceSignal.salesVelocity.toFixed(2)}
                      /day · Last sale:{" "}
                      {product.commerceSignal.daysSinceLastSale !== null
                        ? `${product.commerceSignal.daysSinceLastSale} day(s) ago`
                        : "no recorded sale"}
                    </s-paragraph>
                  ) : (
                    <s-paragraph>
                      Commerce signal not calculated yet.
                    </s-paragraph>
                  )}
                </s-stack>
              </s-box>
            ))}
          </s-stack>
        )}
      </s-section>
    </s-page>
  );
}
