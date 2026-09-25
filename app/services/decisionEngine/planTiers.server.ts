// Cadência (posts/semana) e mix de formato (quantos viram Reel) por plano
// (Patricia, 24/09/2026). Reel custa mais que carrossel/post pra processar
// (encoding de vídeo, ver buildReel.server.ts), então o mix fica FIXO por
// plano — a lojista não escolhe livremente quantos Reels quer dentro do
// mesmo preço (isso quebraria a margem); quem quer um mix diferente
// precisa do plano "custom".

export interface WeeklySlotPlan {
  postsPerWeek: number;
  // Índices (0-based) dos slots da semana que são Reel — os demais viram
  // carrossel/post normal (ou post simples, se o produto não tiver stills
  // suficientes pra carrossel, já é o comportamento atual do buildCarousel).
  reelSlotIndices: number[];
}

const AVG_WEEKS_PER_MONTH = 4.33;

// Basic idêntico ao comportamento de hoje (3 posts/semana, 1 Reel) — nenhuma
// loja existente percebe diferença nenhuma até ganhar um plano diferente.
const BASIC: WeeklySlotPlan = { postsPerWeek: 3, reelSlotIndices: [0] };
const GROW: WeeklySlotPlan = { postsPerWeek: 5, reelSlotIndices: [0, 2] };
const PLUS: WeeklySlotPlan = { postsPerWeek: 7, reelSlotIndices: [0, 2, 4] };

// Plano custom: deriva do total mensal que a lojista escolheu, dividido
// pela média de semanas por mês. Cai pro default do Basic se ela ainda não
// configurou nada (nunca trava a geração automática esperando essa
// escolha, mesma regra de "nada é obrigatório a ponto de pausar os
// posts").
function resolveCustomPlan(customPostsPerMonth: number | null, customReelsPerMonth: number | null): WeeklySlotPlan {
  if (!customPostsPerMonth || customPostsPerMonth <= 0) return BASIC;

  const postsPerWeek = Math.max(1, Math.round(customPostsPerMonth / AVG_WEEKS_PER_MONTH));
  const reelsPerWeekRaw = customReelsPerMonth ? customReelsPerMonth / AVG_WEEKS_PER_MONTH : 0;
  // Nunca mais reels do que posts na semana, e sempre espaçados (mesmo
  // princípio de índice 0/2/4 dos planos fixos, evita 2 reels seguidos).
  const reelsPerWeek = Math.min(Math.round(reelsPerWeekRaw), postsPerWeek);
  const reelSlotIndices = Array.from({ length: reelsPerWeek }, (_, i) => i * 2).filter(
    (index) => index < postsPerWeek,
  );

  return { postsPerWeek, reelSlotIndices };
}

export function getWeeklySlotPlan(shop: {
  plan: string;
  customPostsPerMonth: number | null;
  customReelsPerMonth: number | null;
}): WeeklySlotPlan {
  switch (shop.plan) {
    case "grow":
      return GROW;
    case "plus":
      return PLUS;
    case "custom":
      return resolveCustomPlan(shop.customPostsPerMonth, shop.customReelsPerMonth);
    // "basic" e qualquer valor antigo/desconhecido (ex.: "starter", de
    // antes deste sistema existir) caem no mesmo default — nunca quebra
    // uma loja com um plano ainda não migrado.
    default:
      return BASIC;
  }
}
