import prisma from "../../db.server";

export interface ProductUsageStat {
  timesUsed: number;
  lastUsedAt: string; // ISO string, já serializável pelo loader
}

// Consulta o histórico de content_items já criados por produto — sem custo
// de IA nenhum, é só o que já está guardado no banco. Responde "já usamos
// esse produto/imagem recentemente?" antes de gerar mais conteúdo pra ele.
//
// Limitação atual: conta TODO content_item (inclusive rascunhos), não só os
// publicados de verdade — porque a publicação real no Instagram/Facebook
// ainda não existe neste projeto (Meta OAuth não construído).
export async function getProductUsageStats(
  shopId: string,
): Promise<Record<string, ProductUsageStat>> {
  const items = await prisma.contentItem.findMany({
    where: { shopId, productId: { not: null } },
    select: { productId: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  const stats: Record<string, ProductUsageStat> = {};

  for (const item of items) {
    if (!item.productId) continue;
    const existing = stats[item.productId];
    if (existing) {
      existing.timesUsed += 1;
      existing.lastUsedAt = item.createdAt.toISOString();
    } else {
      stats[item.productId] = {
        timesUsed: 1,
        lastUsedAt: item.createdAt.toISOString(),
      };
    }
  }

  return stats;
}
