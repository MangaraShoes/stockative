import prisma from "../db.server";

interface AdminGraphqlClient {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
}

interface ShopifyProductNode {
  id: string;
  title: string;
  description: string | null;
  status: string;
  productType: string | null;
  tags: string[];
  createdAt: string;
  featuredImage: { url: string } | null;
  totalInventory: number;
  collections: { edges: { node: { title: string } }[] };
  variants: { edges: { node: { price: string; compareAtPrice: string | null } }[] };
}

const PRODUCTS_QUERY = `#graphql
  query SyncProducts($cursor: String) {
    products(first: 50, after: $cursor) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          id
          title
          description
          status
          productType
          tags
          createdAt
          totalInventory
          featuredImage {
            url
          }
          collections(first: 5) {
            edges {
              node {
                title
              }
            }
          }
          variants(first: 1) {
            edges {
              node {
                price
                compareAtPrice
              }
            }
          }
        }
      }
    }
  }
`;

// Garante que existe uma linha `Shop` para essa loja, criando na primeira vez
// (ex.: primeiro sync depois da instalação) ou atualizando o access token se já existir.
export async function getOrCreateShop(shopifyDomain: string, accessToken: string) {
  return prisma.shop.upsert({
    where: { shopifyDomain },
    update: { accessToken },
    create: { shopifyDomain, accessToken },
  });
}

// Busca todos os produtos da loja via Admin GraphQL (paginado) e grava/atualiza
// cada um em ProductCache. Retorna quantos produtos foram sincronizados.
export async function syncProducts(admin: AdminGraphqlClient, shopId: string): Promise<number> {
  let cursor: string | null = null;
  let hasNextPage = true;
  let syncedCount = 0;

  while (hasNextPage) {
    const response: Response = await admin.graphql(PRODUCTS_QUERY, {
      variables: { cursor },
    });
    const json = await response.json();
    const productsConnection = json.data.products;

    for (const edge of productsConnection.edges as { node: ShopifyProductNode }[]) {
      const node = edge.node;
      const firstVariant = node.variants.edges[0]?.node;
      const collections = node.collections.edges.map((e) => e.node.title).join(", ");

      await prisma.productCache.upsert({
        where: {
          shopId_shopifyProductId: {
            shopId,
            shopifyProductId: node.id,
          },
        },
        update: {
          title: node.title,
          description: node.description,
          price: firstVariant ? parseFloat(firstVariant.price) : 0,
          compareAtPrice: firstVariant?.compareAtPrice
            ? parseFloat(firstVariant.compareAtPrice)
            : null,
          inventoryQuantity: node.totalInventory,
          productType: node.productType,
          tags: node.tags.join(", "),
          collections,
          imageUrl: node.featuredImage?.url ?? null,
          status: node.status.toLowerCase(),
        },
        create: {
          shopId,
          shopifyProductId: node.id,
          title: node.title,
          description: node.description,
          price: firstVariant ? parseFloat(firstVariant.price) : 0,
          compareAtPrice: firstVariant?.compareAtPrice
            ? parseFloat(firstVariant.compareAtPrice)
            : null,
          inventoryQuantity: node.totalInventory,
          productType: node.productType,
          tags: node.tags.join(", "),
          collections,
          imageUrl: node.featuredImage?.url ?? null,
          status: node.status.toLowerCase(),
          shopifyCreatedAt: new Date(node.createdAt),
        },
      });

      syncedCount += 1;
    }

    hasNextPage = productsConnection.pageInfo.hasNextPage;
    cursor = productsConnection.pageInfo.endCursor;
  }

  return syncedCount;
}
