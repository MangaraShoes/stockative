import prisma from "../db.server";
import { apiVersion } from "../shopify.server";

// Apaga TODOS os dados de uma loja (Patricia, 01/10/2026 — auditoria pro
// Meta App Review: a política promete apagar os dados depois da
// desinstalação, e não existia nada fazendo isso). Chamado pelo webhook
// obrigatório shop/redact da Shopify, que chega ~48h depois de a loja
// desinstalar o app — é o que a Privacy Policy descreve.
//
// Nenhuma relação do schema tem onDelete: Cascade, então a ordem importa.
// Existe um ciclo ContentItem → CreativeAsset → GenerationLog → ContentItem;
// ele é quebrado zerando GenerationLog.contentItemId antes de apagar os posts.
export async function deleteAllShopData(shopifyDomain: string): Promise<{ deleted: boolean }> {
  const shop = await prisma.shop.findUnique({ where: { shopifyDomain } });

  await prisma.session.deleteMany({ where: { shop: shopifyDomain } });
  if (!shop) return { deleted: false };
  const shopId = shop.id;

  await prisma.$transaction(async (tx) => {
    const contentItemIds = (
      await tx.contentItem.findMany({ where: { shopId }, select: { id: true } })
    ).map((item) => item.id);
    const generationLogIds = (
      await tx.generationLog.findMany({
        where: { OR: [{ shopId }, { contentItemId: { in: contentItemIds } }] },
        select: { id: true },
      })
    ).map((log) => log.id);

    await tx.contentItemImage.deleteMany({
      where: { OR: [{ contentItemId: { in: contentItemIds } }, { creativeAsset: { shopId } }] },
    });
    await tx.trackedLink.deleteMany({ where: { contentItemId: { in: contentItemIds } } });
    await tx.performanceSignal.deleteMany({ where: { contentItemId: { in: contentItemIds } } });
    await tx.generationLog.updateMany({
      where: { id: { in: generationLogIds } },
      data: { contentItemId: null },
    });
    await tx.contentItem.deleteMany({ where: { shopId } });
    await tx.creativeAsset.deleteMany({ where: { shopId } });
    await tx.generationLog.deleteMany({ where: { id: { in: generationLogIds } } });

    await tx.commerceSignal.deleteMany({ where: { product: { shopId } } });
    await tx.productImage.deleteMany({ where: { product: { shopId } } });
    await tx.productCache.deleteMany({ where: { shopId } });

    await tx.competitorPost.deleteMany({ where: { competitorAccount: { shopId } } });
    await tx.competitorAccount.deleteMany({ where: { shopId } });

    await tx.socialAccount.deleteMany({ where: { shopId } });
    await tx.pinterestBoard.deleteMany({ where: { shopId } });
    await tx.contentPillar.deleteMany({ where: { shopId } });
    await tx.promotion.deleteMany({ where: { shopId } });
    await tx.imageCreditPurchase.deleteMany({ where: { shopId } });

    await tx.shop.delete({ where: { id: shopId } });
  }, { timeout: 60_000 });

  return { deleted: true };
}

// Loja que reinstalou (03/11/2026): o shop/redact chega ~48h depois da
// desinstalação mesmo que a loja tenha voltado nesse meio-tempo, e apagar
// aí destruiria os dados (e a sessão) de uma instalação ativa. Só o webhook
// usa isto — o "Delete all data" de Settings apaga com o app instalado, de
// propósito.
//
// uninstalledAt preenchido = o app/uninstalled chegou e nenhuma reinstalação
// passou por getOrCreateShop depois — não está instalada. uninstalledAt
// vazio é ambíguo: ou a loja reinstalou, ou o webhook de desinstalação se
// perdeu. Aí pergunta à própria Shopify se o token ainda vale: 200 =
// instalada; 401/402/403/404 = não está. Qualquer outra resposta lança
// erro, o webhook devolve 500 e a Shopify tenta de novo.
export async function isShopStillInstalled(shopifyDomain: string): Promise<boolean> {
  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain },
    select: { uninstalledAt: true, accessToken: true },
  });
  if (!shop || shop.uninstalledAt) return false;

  const response = await fetch(`https://${shopifyDomain}/admin/api/${apiVersion}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": shop.accessToken },
    body: JSON.stringify({ query: "{ shop { id } }" }),
  });
  if (response.ok) return true;
  if ([401, 402, 403, 404].includes(response.status)) return false;
  throw new Error(`Could not check whether ${shopifyDomain} is installed: HTTP ${response.status}`);
}
