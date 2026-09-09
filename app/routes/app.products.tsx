import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getOrCreateShop, syncProducts } from "../services/syncProducts.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
  });

  const products = shop
    ? await prisma.productCache.findMany({
        where: { shopId: shop.id },
        orderBy: { updatedAt: "desc" },
      })
    : [];

  return { products };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  const shop = await getOrCreateShop(session.shop, session.accessToken ?? "");
  const syncedCount = await syncProducts(admin, shop.id);

  return { syncedCount };
};

export default function Products() {
  const { products } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();

  const isSyncing =
    ["loading", "submitting"].includes(fetcher.state) &&
    fetcher.formMethod === "POST";

  const runSync = () => fetcher.submit({}, { method: "POST" });

  return (
    <s-page heading="Produtos">
      <s-button
        slot="primary-action"
        onClick={runSync}
        {...(isSyncing ? { loading: true } : {})}
      >
        Sincronizar produtos
      </s-button>

      <s-section heading="Produtos sincronizados">
        {fetcher.data?.syncedCount !== undefined && (
          <s-paragraph>
            Última sincronização: {fetcher.data.syncedCount} produto(s).
          </s-paragraph>
        )}

        {products.length === 0 ? (
          <s-paragraph>
            Nenhum produto sincronizado ainda. Clique em &quot;Sincronizar
            produtos&quot; para importar da sua loja.
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
                    Preço: €{product.price.toFixed(2)}
                    {product.compareAtPrice
                      ? ` (de €${product.compareAtPrice.toFixed(2)})`
                      : ""}
                  </s-paragraph>
                  <s-paragraph>
                    Estoque: {product.inventoryQuantity} · Status:{" "}
                    {product.status}
                  </s-paragraph>
                  {product.collections && (
                    <s-paragraph>Coleções: {product.collections}</s-paragraph>
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
