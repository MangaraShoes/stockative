import prisma from "../../db.server";
import { graphApiRequest } from "./graphApi.server";

interface MediaMetrics {
  like_count?: number;
  comments_count?: number;
}

export interface CollectPerformanceResult {
  collected: number;
  skipped: number;
  errors: string[];
}

// Só coleta o que a API de fato expõe com o escopo já concedido
// (instagram_basic): likes e comentários públicos de cada post publicado,
// mesmo endpoint já validado ao vivo em fetchOwnAccountPosts. reach/saves/
// shares continuam bloqueados (precisam de instagram_manage_insights, ainda
// não concedido, ver MARKETING-KNOWLEDGE.md seção 3) e
// productPageVisits/addToCart/orders/revenue dependem de tracked_links,
// ainda não construído — ficam null de propósito, nunca inventados. Grava
// um snapshot NOVO a cada coleta (não sobrescreve o anterior), pra dar pra
// ver a evolução no tempo (Patricia, 11/09/2026: "Start collecting
// available post metrics, with timestamped snapshots").
export async function collectPerformanceSignals(shopId: string): Promise<CollectPerformanceResult> {
  const socialAccount = await prisma.socialAccount.findUnique({
    where: { shopId_platform: { shopId, platform: "instagram" } },
  });
  if (!socialAccount?.accessToken) {
    return { collected: 0, skipped: 0, errors: ["Instagram not connected."] };
  }

  const publishedItems = await prisma.contentItem.findMany({
    where: { shopId, status: "published", externalPostId: { not: null } },
  });

  let collected = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const item of publishedItems) {
    try {
      const metrics = await graphApiRequest<MediaMetrics>(`/${item.externalPostId}`, {
        fields: "like_count,comments_count",
        access_token: socialAccount.accessToken,
      });

      await prisma.performanceSignal.create({
        data: {
          contentItemId: item.id,
          platform: "instagram",
          likes: metrics.like_count ?? null,
          comments: metrics.comments_count ?? null,
        },
      });
      collected += 1;
    } catch (error) {
      skipped += 1;
      errors.push(`${item.externalPostId}: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }

  return { collected, skipped, errors };
}
