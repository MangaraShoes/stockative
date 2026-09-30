// Cadência (posts/semana) e mix de formato (quantos viram Reel) por plano
// (Patricia, 24/09/2026). Reel custa mais que carrossel/post pra processar
// (encoding de vídeo, ver buildReel.server.ts), então o mix fica FIXO por
// plano — a lojista não escolhe livremente quantos Reels quer dentro do
// mesmo preço (isso quebraria a margem). Crédito extra comprado avulso
// (ImageCreditPurchase) só aumenta a cota de geração/regeneração, nunca a
// cadência.

export interface WeeklySlotPlan {
  postsPerWeek: number;
  // Índices (0-based) dos slots da semana que são Reel — os demais viram
  // carrossel/post normal (ou post simples, se o produto não tiver stills
  // suficientes pra carrossel, já é o comportamento atual do buildCarousel).
  reelSlotIndices: number[];
}

// Basic idêntico ao comportamento de hoje (3 posts/semana, 1 Reel) — nenhuma
// loja existente percebe diferença nenhuma até ganhar um plano diferente.
const BASIC: WeeklySlotPlan = { postsPerWeek: 3, reelSlotIndices: [0] };
const GROW: WeeklySlotPlan = { postsPerWeek: 5, reelSlotIndices: [0, 2] };
const PLUS: WeeklySlotPlan = { postsPerWeek: 7, reelSlotIndices: [0, 2, 4] };

export function getWeeklySlotPlan(shop: { plan: string }): WeeklySlotPlan {
  switch (shop.plan) {
    case "grow":
      return GROW;
    case "plus":
      return PLUS;
    // "basic" e qualquer valor antigo/desconhecido (ex.: "starter", de
    // antes deste sistema existir, ou "custom", que virou crédito avulso
    // em 30/09/2026) caem no mesmo default — nunca quebra uma loja com um
    // plano ainda não migrado.
    default:
      return BASIC;
  }
}
