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
  images: { pageInfo: { hasNextPage: boolean }; edges: { node: { id: string; url: string } }[] };
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
    pageInfo {
      hasNextPage
    }
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

// E-mail da loja (shop.email) — destinatário padrão das notificações por
// e-mail (Settings, 03/10/2026), cacheado porque o envio acontece no
// agendador, sem sessão de admin. Mesma regra: nunca derruba o app.
export async function ensureShopEmail(
  admin: AdminGraphqlClient,
  shop: { id: string; shopEmail: string | null },
): Promise<void> {
  if (shop.shopEmail) return;
  try {
    const response = await admin.graphql(`#graphql
      query stockativeShopEmail {
        shop {
          email
        }
      }`);
    const json = await response.json();
    const email: string | undefined = json.data?.shop?.email;
    if (email) await prisma.shop.update({ where: { id: shop.id }, data: { shopEmail: email } });
  } catch (error) {
    console.error("ensureShopEmail failed:", error);
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
//
// Também cacheia o idioma da loja em storeLanguage (Patricia, 03/10/2026) —
// é o default do idioma da INTERFACE do app (ver getAppLanguage), que não
// depende do idioma de publicação. Por isso não para mais só porque o
// idioma de publicação já foi confirmado: busca enquanto storeLanguage
// ainda não está gravado, ou sempre quando `force` (página Settings, pra
// refletir uma troca do idioma padrão feita depois no admin do Shopify).
export async function ensureShopContentLanguage(
  admin: AdminGraphqlClient,
  shop: { id: string; languageConfirmed: boolean; storeLanguage?: string | null },
  { force = false }: { force?: boolean } = {},
): Promise<void> {
  if (!force && shop.languageConfirmed && shop.storeLanguage) return;

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
      data: {
        storeLanguage: matched.code,
        ...(shop.languageConfirmed ? {} : { contentLanguagePrimary: matched.code }),
      },
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
  await Promise.all(
    node.images.edges.map((imageEdge, index) =>
      prisma.productImage.upsert({
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
      }),
    ),
  );

  // Foto apagada na Shopify sai daqui também (Patricia, 28/10/2026) — antes
  // ficava pra sempre, com a URL dando 404, e podia entrar como still no
  // carrossel de um post novo (achado na Jules: 5 de 11 fotos já não
  // existiam). Só quando a galeria veio inteira: com mais de 10 fotos, as
  // que ficaram de fora desta consulta não foram apagadas.
  if (!node.images.pageInfo.hasNextPage) {
    await removeDeletedProductImages(
      product.id,
      node.images.edges.map((edge) => edge.node.id),
    );
  }
}

// Post que ainda não saiu perde a foto apagada (publicaria uma imagem
// quebrada); post já publicado só perde o vínculo — o arquivo não existe
// mais mesmo, e o histórico do post continua.
const UNPUBLISHED_STATUSES = ["draft", "approved", "failed", "cancelled"];

async function removeDeletedProductImages(productId: string, currentShopifyImageIds: string[]): Promise<void> {
  const deleted = await prisma.productImage.findMany({
    where: { productId, shopifyImageId: { notIn: currentShopifyImageIds } },
    select: { id: true },
  });
  if (deleted.length === 0) return;
  const deletedIds = deleted.map((image) => image.id);

  await prisma.$transaction([
    prisma.contentItemImage.deleteMany({
      where: { productImageId: { in: deletedIds }, contentItem: { status: { in: UNPUBLISHED_STATUSES } } },
    }),
    prisma.contentItemImage.updateMany({
      where: { productImageId: { in: deletedIds } },
      data: { productImageId: null },
    }),
    prisma.productImage.deleteMany({ where: { id: { in: deletedIds } } }),
  ]);
}

const SYNC_BATCH_SIZE = 5;

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

    // Em lotes paralelos, não um produto por vez (Patricia, 28/10/2026:
    // Sync stock de 173 produtos demorava demais). Lote pequeno pra caber
    // no pool de conexões do Prisma no servidor de 2 vCPUs.
    const nodes = (productsConnection.edges as { node: ShopifyProductNode }[]).map((edge) => edge.node);
    for (let start = 0; start < nodes.length; start += SYNC_BATCH_SIZE) {
      await Promise.all(nodes.slice(start, start + SYNC_BATCH_SIZE).map((node) => upsertProduct(shopId, node)));
    }
    syncedCount += nodes.length;

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

const CATALOG_SNAPSHOT_QUERY = `#graphql
  query CatalogSnapshot($cursor: String) {
    products(first: 250, after: $cursor) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          id
          title
          status
          totalInventory
        }
      }
    }
  }
`;

// Teto por chamada: normalmente só 0-2 produtos divergem; se for um catálogo
// inteiro desatualizado, o resto entra nas próximas aberturas (ou no Sync).
const MAX_PRODUCTS_REFRESHED_PER_CALL = 20;
const CATALOG_REFRESH_INTERVAL_MS = 60_000;
const lastCatalogRefreshAt = new Map<string, number>();

// Achado de Patricia (26/10/2026): produto recém-criado não aparecia no
// "Swap for a different product" do Weekly plan. A cópia em ProductCache só
// muda por webhook, e ajuste de estoque depois da criação não dispara
// products/update (é inventory_levels/update, que exigiria o escopo
// read_inventory e reautorização de toda lojista) — o produto ficava com
// estoque 0 e fora do filtro. Webhook que falha também não tem nova
// tentativa. Aqui compara só id/título/status/estoque de todo o catálogo
// (uma consulta leve) e re-sincroniza só os que divergem. Throttled por loja
// porque o loader do Weekly plan revalida a cada 4s durante a geração.
export async function refreshStaleProducts(
  admin: AdminGraphqlClient,
  shopId: string,
): Promise<number> {
  const now = Date.now();
  if (now - (lastCatalogRefreshAt.get(shopId) ?? 0) < CATALOG_REFRESH_INTERVAL_MS) return 0;
  lastCatalogRefreshAt.set(shopId, now);

  const shopifyProducts: { id: string; title: string; status: string; totalInventory: number }[] = [];
  let cursor: string | null = null;
  let hasNextPage = true;
  while (hasNextPage) {
    const response: Response = await admin.graphql(CATALOG_SNAPSHOT_QUERY, { variables: { cursor } });
    const json = await response.json();
    const connection = json.data.products;
    for (const edge of connection.edges) shopifyProducts.push(edge.node);
    hasNextPage = connection.pageInfo.hasNextPage;
    cursor = connection.pageInfo.endCursor;
  }

  const cached = await prisma.productCache.findMany({
    where: { shopId },
    select: { shopifyProductId: true, title: true, status: true, inventoryQuantity: true },
  });
  const cachedById = new Map(cached.map((row) => [row.shopifyProductId, row]));

  const staleIds = shopifyProducts
    .filter((product) => {
      const row = cachedById.get(product.id);
      return (
        !row ||
        row.title !== product.title ||
        row.status !== product.status.toLowerCase() ||
        row.inventoryQuantity !== product.totalInventory
      );
    })
    .map((product) => product.id)
    .slice(0, MAX_PRODUCTS_REFRESHED_PER_CALL);

  for (const shopifyProductId of staleIds) {
    await syncSingleProduct(admin, shopId, shopifyProductId);
  }

  // Apagado na Shopify sem o webhook products/delete ter chegado — só dá pra
  // afirmar isso porque a listagem acima percorreu o catálogo inteiro.
  const liveIds = new Set(shopifyProducts.map((product) => product.id));
  const deletedIds = cached
    .filter((row) => row.status !== "archived" && !liveIds.has(row.shopifyProductId))
    .map((row) => row.shopifyProductId);
  if (deletedIds.length > 0) {
    await prisma.productCache.updateMany({
      where: { shopId, shopifyProductId: { in: deletedIds } },
      data: { status: "archived" },
    });
  }

  return staleIds.length + deletedIds.length;
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
