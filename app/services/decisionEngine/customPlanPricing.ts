// Fórmula de preço do plano Custom — AINDA NÃO DEFINIDA por Patricia (só
// confirmou em 24/09/2026 que Reel pesa mais no cálculo que post/carrossel,
// sem número real: "teremos um quarto plano custom onde a pessoa escolhe o
// numero de reels ou postas mensal e vamos gerar um valor de acordo").
// Isolado neste arquivo, sozinho, de propósito — pra ficar fácil de trocar
// pelos valores reais assim que ela decidir, sem precisar mexer na tela nem
// no resto do cálculo. Nunca usado pra cobrar de verdade ainda — não existe
// integração de cobrança real (Fase 7, Shopify Billing, fica de fora deste
// plano de implementação).
export const CUSTOM_PLAN_PRICING = {
  pricePerPostCents: 0, // TODO(Patricia): preencher com o valor real
  pricePerReelCents: 0, // TODO(Patricia): preencher — deve ficar MAIOR que pricePerPostCents
};

export function estimateCustomPlanPriceCents(totalPostsPerMonth: number, reelsPerMonth: number): number {
  const imagePosts = Math.max(0, totalPostsPerMonth - reelsPerMonth);
  return imagePosts * CUSTOM_PLAN_PRICING.pricePerPostCents + reelsPerMonth * CUSTOM_PLAN_PRICING.pricePerReelCents;
}
