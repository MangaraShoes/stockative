import prisma from "../../db.server";

export interface ProductUsageStat {
  timesUsed: number;
  lastUsedAt: string; // ISO string, já serializável pelo loader
}

// Consulta o histórico de content_items JÁ PUBLICADOS por produto — sem
// custo de IA nenhum, é só o que já está guardado no banco. Responde "já
// mostramos esse produto pra audiência recentemente?" antes de gerar mais
// conteúdo pra ele.
//
// Só conta status "published" (corrigido em 12/09/2026, achado de revisão
// externa: "product-repetition history counts abandoned drafts... a
// product appear overused despite never reaching the audience"). Antes
// contava TODO content_item, inclusive rascunho nunca publicado e
// experimento de teste — um produto podia ficar "esgotado" na rotação da
// semana sem nunca ter sido mostrado de verdade. Isso era resquício de
// quando a publicação real ainda não existia neste projeto.
export async function getProductUsageStats(
  shopId: string,
): Promise<Record<string, ProductUsageStat>> {
  const items = await prisma.contentItem.findMany({
    where: { shopId, productId: { not: null }, status: "published" },
    select: { productId: true, publishedAt: true, createdAt: true },
    orderBy: { publishedAt: "asc" },
  });

  const stats: Record<string, ProductUsageStat> = {};

  for (const item of items) {
    if (!item.productId) continue;
    const usedAt = (item.publishedAt ?? item.createdAt).toISOString();
    const existing = stats[item.productId];
    if (existing) {
      existing.timesUsed += 1;
      existing.lastUsedAt = usedAt;
    } else {
      stats[item.productId] = { timesUsed: 1, lastUsedAt: usedAt };
    }
  }

  return stats;
}
