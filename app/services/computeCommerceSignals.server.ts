import prisma from "../db.server";

interface AdminGraphqlClient {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
}

interface OrderLineItemNode {
  quantity: number;
  originalTotalSet: { shopMoney: { amount: string } };
  product: { id: string } | null;
}

interface OrderNode {
  id: string;
  createdAt: string;
  lineItems: { edges: { node: OrderLineItemNode }[] };
}

const ORDERS_QUERY = `#graphql
  query SyncOrdersForSignals($cursor: String, $query: String) {
    orders(first: 50, after: $cursor, query: $query) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          id
          createdAt
          lineItems(first: 50) {
            edges {
              node {
                quantity
                originalTotalSet {
                  shopMoney {
                    amount
                  }
                }
                product {
                  id
                }
              }
            }
          }
        }
      }
    }
  }
`;

interface ProductAggregate {
  unitsSold7d: number;
  unitsSold30d: number;
  revenue30d: number;
  lastSaleAt: Date | null;
}

// Agrega pedidos dos últimos 30 dias por produto (unidades vendidas, receita,
// data da última venda). Roda como job periódico, nunca a cada decisão do
// Decision Engine — evita estourar o limite de chamadas da Admin API.
export async function computeCommerceSignals(
  admin: AdminGraphqlClient,
  shopId: string,
): Promise<number> {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const dateFilter = thirtyDaysAgo.toISOString().split("T")[0];
  const searchQuery = `created_at:>=${dateFilter}`;

  const aggregates = new Map<string, ProductAggregate>();

  let cursor: string | null = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const response: Response = await admin.graphql(ORDERS_QUERY, {
      variables: { cursor, query: searchQuery },
    });
    const json = await response.json();
    const ordersConnection = json.data.orders;

    for (const edge of ordersConnection.edges as { node: OrderNode }[]) {
      const order = edge.node;
      const orderDate = new Date(order.createdAt);

      for (const lineItemEdge of order.lineItems.edges) {
        const lineItem = lineItemEdge.node;
        const shopifyProductId = lineItem.product?.id;
        if (!shopifyProductId) continue;

        const existing = aggregates.get(shopifyProductId) ?? {
          unitsSold7d: 0,
          unitsSold30d: 0,
          revenue30d: 0,
          lastSaleAt: null,
        };

        existing.unitsSold30d += lineItem.quantity;
        existing.revenue30d += parseFloat(lineItem.originalTotalSet.shopMoney.amount);
        if (orderDate >= sevenDaysAgo) {
          existing.unitsSold7d += lineItem.quantity;
        }
        if (!existing.lastSaleAt || orderDate > existing.lastSaleAt) {
          existing.lastSaleAt = orderDate;
        }

        aggregates.set(shopifyProductId, existing);
      }
    }

    hasNextPage = ordersConnection.pageInfo.hasNextPage;
    cursor = ordersConnection.pageInfo.endCursor;
  }

  // Recalcula para TODOS os produtos da loja, não só os que venderam —
  // um produto sem vendas no período precisa continuar com zeros, não
  // ficar com um sinal comercial desatualizado de um cálculo anterior.
  const products = await prisma.productCache.findMany({
    where: { shopId },
    select: { id: true, shopifyProductId: true, shopifyCreatedAt: true },
  });

  let computedCount = 0;

  for (const product of products) {
    const aggregate = aggregates.get(product.shopifyProductId);
    const daysSinceLastSale = aggregate?.lastSaleAt
      ? Math.floor((now.getTime() - aggregate.lastSaleAt.getTime()) / (24 * 60 * 60 * 1000))
      : null;
    const inventoryAgeDays = product.shopifyCreatedAt
      ? Math.floor((now.getTime() - product.shopifyCreatedAt.getTime()) / (24 * 60 * 60 * 1000))
      : null;

    await prisma.commerceSignal.upsert({
      where: { productId: product.id },
      update: {
        unitsSold7d: aggregate?.unitsSold7d ?? 0,
        unitsSold30d: aggregate?.unitsSold30d ?? 0,
        revenue30d: aggregate?.revenue30d ?? 0,
        salesVelocity: (aggregate?.unitsSold30d ?? 0) / 30,
        daysSinceLastSale,
        inventoryAgeDays,
        computedAt: now,
      },
      create: {
        productId: product.id,
        unitsSold7d: aggregate?.unitsSold7d ?? 0,
        unitsSold30d: aggregate?.unitsSold30d ?? 0,
        revenue30d: aggregate?.revenue30d ?? 0,
        salesVelocity: (aggregate?.unitsSold30d ?? 0) / 30,
        daysSinceLastSale,
        inventoryAgeDays,
      },
    });

    computedCount += 1;
  }

  return computedCount;
}
