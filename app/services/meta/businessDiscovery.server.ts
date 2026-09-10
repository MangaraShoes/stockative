import { graphApiRequest, MetaGraphApiError } from "./graphApi.server";

interface MediaNode {
  caption?: string;
  media_type: string;
  like_count?: number;
  comments_count?: number;
  timestamp: string;
  permalink?: string;
}

export interface OwnPost {
  caption: string | null;
  mediaType: string;
  likeCount: number;
  commentsCount: number;
  timestamp: string;
  permalink: string | null;
}

export interface CompetitorSnapshot {
  username: string;
  followersCount: number | null;
  mediaCount: number | null;
  recentPosts: OwnPost[];
}

// Histórico da própria conta (inclusive de antes do Stockative existir) — só
// precisa do escopo já concedido (instagram_basic), ver MARKETING-KNOWLEDGE.md
// "De onde vem o dado". Nunca bloqueia o fluxo que a chama: falha vira lista
// vazia, não exceção.
export async function fetchOwnAccountPosts(
  igBusinessAccountId: string,
  accessToken: string,
): Promise<OwnPost[]> {
  try {
    const result = await graphApiRequest<{ data: MediaNode[] }>(`/${igBusinessAccountId}/media`, {
      fields: "caption,media_type,like_count,comments_count,timestamp,permalink",
      access_token: accessToken,
      limit: "12",
    });
    return result.data.map((node) => ({
      caption: node.caption ?? null,
      mediaType: node.media_type,
      likeCount: node.like_count ?? 0,
      commentsCount: node.comments_count ?? 0,
      timestamp: node.timestamp,
      permalink: node.permalink ?? null,
    }));
  } catch (error) {
    console.error("Own Instagram posts fetch failed:", error);
    return [];
  }
}

export type BusinessDiscoveryResult =
  | { ok: true; snapshot: CompetitorSnapshot }
  // code 10 = "Application does not have permission for this action" — visto
  // ao vivo em 10/09/2026 contra a conta real da Mangará: nosso app só tem
  // Standard Access ainda, Business Discovery pra conta de terceiro exige
  // Advanced Access via App Review (mesma pendência já documentada pro
  // instagram_manage_insights, ver MARKETING-KNOWLEDGE.md seção 3). Não é
  // culpa do username — precisa ser distinguido de "não existe" nos callers.
  | { ok: false; reason: "permission_denied"; message: string }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "unknown"; message: string };

// Business Discovery — dados públicos (likes/comentários/legenda) de QUALQUER
// conta Business/Creator pública, sem autorização dela, desde que a conta IG
// Business da própria loja já esteja conectada (ver ARCHITECTURE.md). Nunca
// expõe reach/saves/conversão, que são privados do dono da conta.
export async function fetchBusinessDiscovery(
  ownIgBusinessAccountId: string,
  accessToken: string,
  competitorUsername: string,
): Promise<BusinessDiscoveryResult> {
  try {
    const result = await graphApiRequest<{
      business_discovery?: {
        followers_count?: number;
        media_count?: number;
        media?: { data: MediaNode[] };
      };
    }>(`/${ownIgBusinessAccountId}`, {
      fields: `business_discovery.username(${competitorUsername}){followers_count,media_count,media.limit(12){caption,media_type,like_count,comments_count,timestamp}}`,
      access_token: accessToken,
    });

    const discovery = result.business_discovery;
    if (!discovery) return { ok: false, reason: "not_found" };

    return {
      ok: true,
      snapshot: {
        username: competitorUsername,
        followersCount: discovery.followers_count ?? null,
        mediaCount: discovery.media_count ?? null,
        recentPosts: (discovery.media?.data ?? []).map((node) => ({
          caption: node.caption ?? null,
          mediaType: node.media_type,
          likeCount: node.like_count ?? 0,
          commentsCount: node.comments_count ?? 0,
          timestamp: node.timestamp,
          permalink: null,
        })),
      },
    };
  } catch (error) {
    console.error(`Business Discovery failed for @${competitorUsername}:`, error);
    if (error instanceof MetaGraphApiError && error.code === 10) {
      return { ok: false, reason: "permission_denied", message: error.message };
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return { ok: false, reason: "unknown", message };
  }
}

