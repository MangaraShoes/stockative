// Cadência (posts/semana) e mix de formato (quantos viram Reel) por plano
// (Patricia, 24/09/2026). Reel custa mais que carrossel/post pra processar
// (encoding de vídeo, ver buildReel.server.ts), então o mix fica FIXO por
// plano — a lojista não escolhe livremente quantos Reels quer dentro do
// mesmo preço (isso quebraria a margem); quem quer mais Reels ou
// carrosséis compra Extras, SOMADOS ao plano (ver applyMonthlyExtras).

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

// Extras são comprados por MÊS, mas o plano é gerado por semana. Espalha o
// total mensal nas 4 "semanas" do mês (dias 1-7, 8-14, 15-21, 22-28) —
// como o plano semanal roda a cada 7 dias, cada uma dessas faixas cai
// exatamente uma vez por mês, então a soma do mês bate com o que a lojista
// comprou (dividir por 4.33 e arredondar sumiria com 1 reel extra/mês, por
// exemplo). Dias 29-31 não recebem extra nenhum.
const EXTRA_WEEKS_PER_MONTH = 4;

function extrasForWeek(monthlyExtras: number, weekOfMonth: number): number {
  if (monthlyExtras <= 0 || weekOfMonth >= EXTRA_WEEKS_PER_MONTH) return 0;
  return (
    Math.floor(((weekOfMonth + 1) * monthlyExtras) / EXTRA_WEEKS_PER_MONTH) -
    Math.floor((weekOfMonth * monthlyExtras) / EXTRA_WEEKS_PER_MONTH)
  );
}

function applyMonthlyExtras(
  base: WeeklySlotPlan,
  extraCarouselsPerMonth: number,
  extraReelsPerMonth: number,
  now: Date,
): WeeklySlotPlan {
  const weekOfMonth = Math.floor((now.getUTCDate() - 1) / 7);
  const extraCarousels = extrasForWeek(extraCarouselsPerMonth, weekOfMonth);
  const extraReels = extrasForWeek(extraReelsPerMonth, weekOfMonth);

  // Extras entram depois dos slots do plano, alternando reel/carrossel
  // enquanto houver dos dois — evita empilhar reels seguidos no fim.
  const reelSlotIndices = [...base.reelSlotIndices];
  let index = base.postsPerWeek;
  let reelsLeft = extraReels;
  let carouselsLeft = extraCarousels;
  while (reelsLeft > 0 || carouselsLeft > 0) {
    if (reelsLeft > 0 && (carouselsLeft === 0 || reelsLeft >= carouselsLeft)) {
      reelSlotIndices.push(index);
      reelsLeft--;
    } else {
      carouselsLeft--;
    }
    index++;
  }

  return { postsPerWeek: index, reelSlotIndices };
}

function baseWeeklySlotPlan(plan: string): WeeklySlotPlan {
  switch (plan) {
    case "grow":
      return GROW;
    case "plus":
      return PLUS;
    // "basic" e qualquer valor antigo/desconhecido (ex.: "starter", de
    // antes deste sistema existir, ou "custom", que virou Extras em
    // 30/09/2026) caem no mesmo default — nunca quebra uma loja com um
    // plano ainda não migrado.
    default:
      return BASIC;
  }
}

export function getWeeklySlotPlan(
  shop: {
    plan: string;
    extraCarouselsPerMonth: number;
    extraReelsPerMonth: number;
  },
  now: Date = new Date(),
): WeeklySlotPlan {
  return applyMonthlyExtras(baseWeeklySlotPlan(shop.plan), shop.extraCarouselsPerMonth, shop.extraReelsPerMonth, now);
}
