import prisma from "../db.server";
import { graphApiRequest } from "./meta/graphApi.server";
import { fetchOwnAccountPosts, fetchBusinessDiscovery } from "./meta/businessDiscovery.server";
import type { OwnPost, CompetitorSnapshot } from "./meta/businessDiscovery.server";

interface AdminGraphqlClient {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
}

export interface BrandSources {
  shopDescription: string | null;
  aboutPageText: string | null;
  instagramBio: string | null;
  ownRecentPosts: OwnPost[];
  competitorSnapshots: CompetitorSnapshot[];
  // "blocked" quando há concorrentes cadastrados mas a Meta recusou por
  // falta de Advanced Access (ver businessDiscovery.server.ts) — diferente
  // de "nenhum concorrente cadastrado", pra UI poder explicar a diferença.
  competitorDataStatus: "ok" | "blocked" | "none";
}

const SHOP_QUERY = `#graphql
  query BrandVoiceShopInfo {
    shop {
      description
      primaryDomain {
        url
      }
    }
  }
`;

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&(rsquo|#39);/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

const FETCH_HEADERS = { "User-Agent": "Mozilla/5.0 (compatible; StockativeBot/1.0)" };
const ABOUT_PATH_FALLBACKS = ["/pages/about-us", "/pages/about", "/pages/our-story"];

// Acha a página "About Us" sem depender de um caminho fixo (precisa
// generalizar pra qualquer loja, não só a Mangará): primeiro procura um link
// que mencione about/story/mission na home, senão tenta os caminhos mais
// comuns de tema Shopify.
async function findAboutPageUrl(baseUrl: string): Promise<string | null> {
  try {
    const response = await fetch(baseUrl, { headers: FETCH_HEADERS });
    if (response.ok) {
      const html = await response.text();
      const match = html.match(/href="(\/pages\/[^"?#]*(?:about|story|mission)[^"?#]*)"/i);
      if (match) return new URL(match[1], baseUrl).toString();
    }
  } catch {
    // segue pros caminhos fixos abaixo
  }

  for (const path of ABOUT_PATH_FALLBACKS) {
    try {
      const url = new URL(path, baseUrl).toString();
      const response = await fetch(url, { headers: FETCH_HEADERS });
      if (response.ok) return url;
    } catch {
      continue;
    }
  }

  return null;
}

async function fetchAboutPageText(baseUrl: string): Promise<string | null> {
  const aboutUrl = await findAboutPageUrl(baseUrl);
  if (!aboutUrl) return null;

  try {
    const response = await fetch(aboutUrl, { headers: FETCH_HEADERS });
    if (!response.ok) return null;
    const html = await response.text();
    const text = htmlToText(html);
    return text.length > 0 ? text.slice(0, 2500) : null;
  } catch {
    return null;
  }
}

async function fetchInstagramBio(igBusinessAccountId: string, accessToken: string): Promise<string | null> {
  try {
    const result = await graphApiRequest<{ biography?: string }>(`/${igBusinessAccountId}`, {
      fields: "biography",
      access_token: accessToken,
    });
    return result.biography || null;
  } catch {
    return null;
  }
}

// Reúne as fontes de narrativa e de dado real da marca (Patricia, 10/09/2026:
// "a narrativa da marca deve vir da análise do about us do site, da
// descrição da marca no Shopify e no IG", depois ampliado: "ele precisa
// buscar os dados da conta do IG... inclusive as 2 indicações de contas de
// concorrentes"). Narrativa (about page/shop description/bio) não depende
// do catálogo, que serve só de evidência de fato material — ver
// draftBrandVoice.server.ts. Posts próprios e de concorrentes são uma
// categoria à parte: referência de estilo/nicho, nunca fonte de alegação
// factual sobre a marca (mesma separação de MARKETING-KNOWLEDGE.md entre
// performance_signals reais e proxy de engajamento público). Fonte ausente
// (IG não conectado, sem concorrentes cadastrados, sem página About Us) é
// omitida silenciosamente, nunca inventada.
export async function fetchBrandSources(
  admin: AdminGraphqlClient,
  shopId: string,
): Promise<BrandSources> {
  const shopResponse = await admin.graphql(SHOP_QUERY);
  const shopJson = await shopResponse.json();
  const shopDescription: string | null = shopJson.data?.shop?.description || null;
  const primaryDomainUrl: string | null = shopJson.data?.shop?.primaryDomain?.url || null;

  const socialAccount = await prisma.socialAccount.findUnique({
    where: { shopId_platform: { shopId, platform: "instagram" } },
  });
  const competitorAccounts = await prisma.competitorAccount.findMany({ where: { shopId } });

  const igAccountId = socialAccount?.igBusinessAccountId;
  const igToken = socialAccount?.accessToken;
  const canQueryInstagram = Boolean(igAccountId && igToken);

  const [aboutPageText, instagramBio, ownRecentPosts, competitorResults] = await Promise.all([
    primaryDomainUrl ? fetchAboutPageText(primaryDomainUrl) : Promise.resolve(null),
    canQueryInstagram ? fetchInstagramBio(igAccountId!, igToken!) : Promise.resolve(null),
    canQueryInstagram ? fetchOwnAccountPosts(igAccountId!, igToken!) : Promise.resolve([]),
    canQueryInstagram
      ? Promise.all(
          competitorAccounts.map((c) => fetchBusinessDiscovery(igAccountId!, igToken!, c.instagramUsername)),
        )
      : Promise.resolve([]),
  ]);

  const competitorSnapshots = competitorResults
    .filter((r): r is Extract<typeof r, { ok: true }> => r.ok)
    .map((r) => r.snapshot);
  const competitorDataStatus: BrandSources["competitorDataStatus"] =
    competitorAccounts.length === 0
      ? "none"
      : competitorResults.some((r) => !r.ok && r.reason === "permission_denied")
        ? "blocked"
        : "ok";

  return {
    shopDescription,
    aboutPageText,
    instagramBio,
    ownRecentPosts,
    competitorSnapshots,
    competitorDataStatus,
  };
}
