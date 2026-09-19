import prisma from "../db.server";
import { CONTENT_LANGUAGES } from "./decisionEngine/constants";

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
  onlineStoreUrl: string | null;
  featuredImage: { url: string } | null;
  totalInventory: number;
  collections: { edges: { node: { title: string } }[] };
  variants: {
    edges: {
      node: {
        price: string;
        compareAtPrice: string | null;
        inventoryItem: { unitCost: { amount: string } | null };
      };
    }[];
  };
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
  onlineStoreUrl
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
        inventoryItem {
          unitCost {
            amount
          }
        }
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
    // uninstalledAt: null de propósito toda vez — se a loja reinstalou, o
    // próprio fato de authenticate.admin ter completado aqui já prova que
    // ela está instalada de novo, então reativa (achado de revisão
    // externa, 12/09/2026, complemento do fix de desinstalação em
    // webhooks.app.uninstalled.tsx).
    update: { accessToken, uninstalledAt: null },
    create: { shopifyDomain, accessToken },
  });
  return { shop, isNew: !existing };
}

// Busca e cacheia o fuso horário real da loja (Patricia, 12/09/2026:
// "precisamos considerar sim o fuso horario da loja") — só chama a Admin
// API na primeira vez; depois disso é uma leitura de banco. Chamado no
// loader raiz de /app (app.tsx), então roda cedo o bastante pra já estar
// disponível quando o plano semanal for gerado.
export async function ensureShopTimezone(
  admin: AdminGraphqlClient,
  shop: { id: string; ianaTimezone: string | null },
): Promise<string> {
  if (shop.ianaTimezone) return shop.ianaTimezone;

  // Roda no loader RAIZ de /app — toda página do app depende dele. Uma
  // falha aqui (ex.: escopo faltando, API fora do ar) nunca pode derrubar o
  // app inteiro pra uma "Application Error" em branco; na pior das
  // hipóteses, cai pro fuso UTC até a próxima tentativa (achado ao vivo,
  // 13/09/2026, ver ensureShopContentLanguage logo abaixo, que sofreu
  // exatamente isso na Mangará por falta do escopo read_locales).
  try {
    const response = await admin.graphql(`#graphql
      query stockativeShopTimezone {
        shop {
          ianaTimezone
        }
      }`);
    const json = await response.json();
    const timezone: string = json.data?.shop?.ianaTimezone ?? "UTC";

    await prisma.shop.update({ where: { id: shop.id }, data: { ianaTimezone: timezone } });
    return timezone;
  } catch (error) {
    console.error("ensureShopTimezone failed, falling back to UTC:", error);
    return "UTC";
  }
}

// Pré-preenche o idioma primário de publicação com o idioma REAL da loja
// (Patricia, 13/09/2026, pergunta direta: "o default language sempre vai
// ser a linguagem da loja né") — antes disso, contentLanguagePrimary só
// tinha o default fixo "en" do schema, então uma loja francesa como a
// Mangará via "English" pré-selecionado sem nenhuma relação com o idioma
// dela de verdade. Só ajusta enquanto a lojista não confirmou o idioma
// (languageConfirmed), pra nunca sobrescrever uma escolha explícita dela —
// mesmo padrão de ensureShopTimezone (chamado uma vez no loader raiz de
// /app). Usa shopLocales (não `shop.primaryLocale`, que não existe na Admin
// API — a única fonte pro idioma padrão da loja é essa lista com `primary`).
export async function ensureShopContentLanguage(
  admin: AdminGraphqlClient,
  shop: { id: string; languageConfirmed: boolean },
): Promise<void> {
  if (shop.languageConfirmed) return;

  // Roda no loader RAIZ de /app, junto de ensureShopTimezone — mesma regra:
  // nunca pode derrubar o app inteiro. Confirmado ao vivo na Mangará
  // (13/09/2026): a loja não tinha o escopo `read_locales` que shopLocales
  // exige, e o SDK do Admin API lança exceção nesse caso (não só devolve um
  // campo `errors` no JSON) — sem o try/catch, isso quebrava TODA página do
  // app, não só o pré-preenchimento do idioma. Na pior das hipóteses, o
  // idioma fica "en" (default do schema) até a lojista escolher na mão.
  try {
    const response = await admin.graphql(`#graphql
      query stockativeShopLocales {
        shopLocales {
          locale
          primary
        }
      }`);
    const json = await response.json();
    const locales: { locale: string; primary: boolean }[] = json.data?.shopLocales ?? [];
    const primaryLocale = locales.find((l) => l.primary)?.locale;
    if (!primaryLocale) return;

    const matched = CONTENT_LANGUAGES.find((lang) =>
      primaryLocale.toLowerCase().startsWith(lang.code),
    );
    if (!matched) return;

    await prisma.shop.update({
      where: { id: shop.id },
      data: { contentLanguagePrimary: matched.code },
    });
  } catch (error) {
    console.error("ensureShopContentLanguage failed, leaving language as-is:", error);
  }
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
      unitCost: firstVariant?.inventoryItem.unitCost
        ? parseFloat(firstVariant.inventoryItem.unitCost.amount)
        : null,
      inventoryQuantity: node.totalInventory,
      productType: node.productType,
      tags: node.tags.join(", "),
      collections,
      imageUrl: node.featuredImage?.url ?? null,
      productUrl: node.onlineStoreUrl,
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
      unitCost: firstVariant?.inventoryItem.unitCost
        ? parseFloat(firstVariant.inventoryItem.unitCost.amount)
        : null,
      inventoryQuantity: node.totalInventory,
      productType: node.productType,
      tags: node.tags.join(", "),
      collections,
      imageUrl: node.featuredImage?.url ?? null,
      productUrl: node.onlineStoreUrl,
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
