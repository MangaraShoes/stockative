import prisma from "../db.server";

// Os mesmos 4 passos que já apareciam soltos na Home (Patricia, 12/09/2026:
// "deveria vir o passo a passo... como uma sequencial de popups ou paginas
// que ela precisa passar até configurar a loja") — centralizado aqui pra
// Home e as 4 páginas de cada passo usarem exatamente o mesmo critério de
// "feito", nunca duas definições divergentes do mesmo status.
export interface OnboardingStatus {
  hasStock: boolean;
  hasBrand: boolean;
  hasSocial: boolean;
  hasCompetitors: boolean;
  hasContentPillars: boolean;
  hasPublished: boolean;
}

export async function getOnboardingStatus(shopId: string): Promise<OnboardingStatus> {
  const [
    productsCount,
    signalsCount,
    pillarsCount,
    socialCount,
    competitorCount,
    publishedCount,
    shop,
  ] = await Promise.all([
    prisma.productCache.count({ where: { shopId } }),
    prisma.commerceSignal.count({ where: { product: { shopId } } }),
    prisma.contentPillar.count({ where: { shopId } }),
    prisma.socialAccount.count({ where: { shopId } }),
    prisma.competitorAccount.count({ where: { shopId } }),
    prisma.contentItem.count({ where: { shopId, status: "published" } }),
    prisma.shop.findUniqueOrThrow({ where: { id: shopId } }),
  ]);

  return {
    hasStock: productsCount > 0 && signalsCount > 0,
    hasBrand: Boolean(shop.brandDescription?.trim()),
    hasSocial: socialCount > 0,
    // Passo próprio (Patricia, 12/09/2026: "teria que ser o step 3") — a
    // cliente PRECISA passar por essa decisão antes da store voice, mas pode
    // optar por não informar concorrentes; competitorsSkipped registra essa
    // recusa explícita como equivalente a "feito".
    hasCompetitors: competitorCount > 0 || shop.competitorsSkipped,
    // Passo próprio também (Patricia, 12/09/2026: "Your brand's content
    // pillars deveria ser o step 5") — antes vivia escondido dentro de
    // hasBrand, o que confundia o stepper e a lojista.
    hasContentPillars: pillarsCount > 0,
    hasPublished: publishedCount > 0,
  };
}
