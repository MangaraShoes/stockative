import prisma from "../../db.server";
import { graphApiRequest } from "./graphApi.server";

interface MediaMetrics {
  like_count?: number;
  comments_count?: number;
}

interface MediaInsightValue {
  name: string;
  values: { value: number }[];
}
interface MediaInsightsResponse {
  data: MediaInsightValue[];
}

export interface CollectPerformanceResult {
  collected: number;
  skipped: number;
  errors: string[];
}

// reach/saves/shares exigem instagram_manage_insights (Patricia, 13/09/2026:
// "precisamos ativar o instagram_manage_insights o quanto antes" — escopo
// adicionado em graphApi.server.ts). Best-effort: se a conta ainda não tem a
// permissão de verdade concedida (precisa reconectar Instagram pra pegar o
// escopo novo, e a Meta ainda pode exigir App Review pra Advanced Access em
// produção, mesma situação do Business Discovery), a chamada falha e os 3
// campos ficam null — nunca inventados, nunca quebra a coleta de
// likes/comentários que já funciona.
async function fetchMediaInsights(
  mediaId: string,
  accessToken: string,
): Promise<{ reach: number | null; saves: number | null; shares: number | null }> {
  try {
    const response = await graphApiRequest<MediaInsightsResponse>(`/${mediaId}/insights`, {
      metric: "reach,saved,shares",
      access_token: accessToken,
    });
    const byName = new Map(response.data.map((d) => [d.name, d.values[0]?.value ?? null]));
    return {
      reach: byName.get("reach") ?? null,
      saves: byName.get("saved") ?? null,
      shares: byName.get("shares") ?? null,
    };
  } catch {
    return { reach: null, saves: null, shares: null };
  }
}

// Likes e comentários públicos de cada post publicado, mesmo endpoint já
// validado ao vivo em fetchOwnAccountPosts, mais reach/saves/shares agora
// que o escopo foi pedido (ver fetchMediaInsights acima).
// productPageVisits/addToCart/orders/revenue continuam dependendo de
// tracked_links, ainda não construído — ficam null de propósito, nunca
// inventados. Grava um snapshot NOVO a cada coleta (não sobrescreve o
// anterior), pra dar pra ver a evolução no tempo (Patricia, 11/09/2026:
// "Start collecting available post metrics, with timestamped snapshots").
export async function collectPerformanceSignals(shopId: string): Promise<CollectPerformanceResult> {
  const socialAccount = await prisma.socialAccount.findUnique({
    where: { shopId_platform: { shopId, platform: "instagram" } },
  });
  if (!socialAccount?.accessToken) {
    return { collected: 0, skipped: 0, errors: ["Instagram not connected."] };
  }

  const publishedItems = await prisma.contentItem.findMany({
    where: { shopId, status: "published", externalPostId: { not: null } },
    include: { trackedLink: true },
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
      const insights = await fetchMediaInsights(item.externalPostId!, socialAccount.accessToken);

      await prisma.performanceSignal.create({
        data: {
          contentItemId: item.id,
          platform: "instagram",
          likes: metrics.like_count ?? null,
          comments: metrics.comments_count ?? null,
          reach: insights.reach,
          saves: insights.saves,
          shares: insights.shares,
          // Cliques reais no link rastreado (Facebook/Pinterest só — ver
          // trackedLink.server.ts), não do Instagram em si. Snapshot do
          // total acumulado até agora, mesmo padrão dos outros campos.
          clicks: item.trackedLink?.clickCount ?? null,
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

export interface CollectDuePerformanceOutcome {
  shopId: string;
  result: CollectPerformanceResult;
}

// Fecha o loop de Measure → Learn (Patricia, 13/09/2026, depois de revisar o
// Growth & Creative Intelligence Roadmap) — antes collectPerformanceSignals
// só rodava se a lojista abrisse a tela de Performance e clicasse "Refresh",
// então na prática quase nunca rodava (daí o "1 snapshot pra 9 posts"
// documentado em planWeek.server.ts). Sem medição regular, nada do resto do
// roadmap (fadiga criativa, aprendizado de performance) tem onde se apoiar.
// Pensado pra rodar 1x/dia via cron, mesmo padrão de generateDueWeeklyPlans
// — cada chamada grava um snapshot NOVO por post publicado, então rodar
// todo dia é o que de fato dá pra ver evolução no tempo em vez de um ponto
// isolado.
export async function collectDuePerformanceSignals(): Promise<CollectDuePerformanceOutcome[]> {
  const shops = await prisma.shop.findMany({
    where: {
      uninstalledAt: null,
      socialAccounts: { some: { platform: "instagram", igBusinessAccountId: { not: null } } },
    },
    select: { id: true },
  });

  const outcomes: CollectDuePerformanceOutcome[] = [];
  for (const shop of shops) {
    const result = await collectPerformanceSignals(shop.id);
    outcomes.push({ shopId: shop.id, result });
  }
  return outcomes;
}
