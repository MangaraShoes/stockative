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
  images: { edges: { node: { id: string; url: string } }[] };
}

const PRODUCT_FIELDS = `#graphql
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
  images(first: 10) {
    edges {
      node {
        id
        url
      }
    }
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
`;

const PRODUCTS_QUERY = `#graphql
  query SyncProducts($cursor: String) {
    products(first: 50, after: $cursor) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          ${PRODUCT_FIELDS}
        }
      }
    }
  }
`;

const SINGLE_PRODUCT_QUERY = `#graphql
  query SyncSingleProduct($id: ID!) {
    product(id: $id) {
      ${PRODUCT_FIELDS}
    }
  }
`;

// Garante que existe uma linha `Shop` para essa loja, criando na primeira vez
// (ex.: primeiro sync depois da instalação) ou atualizando o access token se já existir.
export async function getOrCreateShop(shopifyDomain: string, accessToken: string) {
  const existing = await prisma.shop.findUnique({ where: { shopifyDomain } });
  const shop = await prisma.shop.upsert({
    where: { shopifyDomain },
    update: { accessToken },
    create: { shopifyDomain, accessToken },
  });
  return { shop, isNew: !existing };
}

// Grava/atualiza um único produto (e sua galeria) em ProductCache — usado
// tanto pelo sync completo quanto pelos webhooks de products/create e
// products/update, pra nunca duplicar essa lógica.
export async function upsertProduct(shopId: string, node: ShopifyProductNode): Promise<void> {
  const firstVariant = node.variants.edges[0]?.node;
  const collections = node.collections.edges.map((e) => e.node.title).join(", ");

  const product = await prisma.productCache.upsert({
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

  // Galeria completa (não só a featured image) — toda ProductImage é
  // sempre "still" (nunca geramos still por IA, ver ProductImage no schema).
  for (const [index, imageEdge] of node.images.edges.entries()) {
    await prisma.productImage.upsert({
      where: {
        productId_shopifyImageId: {
          productId: product.id,
          shopifyImageId: imageEdge.node.id,
        },
      },
      update: { url: imageEdge.node.url, position: index + 1 },
      create: {
        productId: product.id,
        shopifyImageId: imageEdge.node.id,
        url: imageEdge.node.url,
        position: index + 1,
      },
    });
  }
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
      await upsertProduct(shopId, edge.node);
      syncedCount += 1;
    }

    hasNextPage = productsConnection.pageInfo.hasNextPage;
    cursor = productsConnection.pageInfo.endCursor;
  }

  return syncedCount;
}

// Busca e grava um único produto via GraphQL, a partir do ID vindo de um
// webhook products/create ou products/update — não re-sincroniza o catálogo
// inteiro, só o produto que mudou.
export async function syncSingleProduct(
  admin: AdminGraphqlClient,
  shopId: string,
  shopifyProductId: string,
): Promise<void> {
  const response: Response = await admin.graphql(SINGLE_PRODUCT_QUERY, {
    variables: { id: shopifyProductId },
  });
  const json = await response.json();
  const node: ShopifyProductNode | null = json.data.product;
  if (!node) return;

  await upsertProduct(shopId, node);
}

// products/delete só manda o ID no payload, sem mais nenhum dado — a loja já
// não tem o produto pra buscar de volta. Arquiva em vez de apagar a linha,
// pra não quebrar content_items/creative_assets que ainda referenciam esse
// produto no histórico.
export async function archiveDeletedProduct(
  shopId: string,
  shopifyProductId: string,
): Promise<void> {
  await prisma.productCache.updateMany({
    where: { shopId, shopifyProductId },
    data: { status: "archived" },
  });
}
