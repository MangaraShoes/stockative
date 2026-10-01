import prisma from "../db.server";

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
