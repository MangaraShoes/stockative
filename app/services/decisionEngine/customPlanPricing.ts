// Fórmula de preço do plano Custom (Patricia, 25/09/2026) — derivada do
// custo real por unidade (Gemini 2.5 Flash Image ~$0,04/imagem + Claude
// Sonnet 5 pros guardrails de fidelidade/composição ~$0,11 por post entregue
// no total; Reel via API de vídeo externa, $1,80/reel cotado por ela) com
// margem aplicada em cima desse custo — mesmo raciocínio usado pra fechar o
// preço do Basic em €24,90/mês (~54% de margem líquida da taxa de 2,9% da
// Shopify, que é o único corte real da Shopify abaixo de $1M de receita
// vitalícia do app). Reel ficou com margem mais enxuta (~20%) de propósito
// — ela achou a margem equivalente ao Basic (~47%, ~€2,97) cara demais pra
// cobrar por unidade avulsa. Isolado neste arquivo, sozinho, pra ficar fácil
// de revisar se o custo da API de vídeo mudar. Nunca usado pra cobrar de
// verdade ainda — não existe integração de cobrança real (Fase 7, Shopify
// Billing, fica de fora do plano de implementação original).
export const CUSTOM_PLAN_PRICING = {
  pricePerPostCents: 20, // €0,20/imagem
  pricePerReelCents: 199, // €1,99/reel
};

export function estimateCustomPlanPriceCents(totalPostsPerMonth: number, reelsPerMonth: number): number {
  const imagePosts = Math.max(0, totalPostsPerMonth - reelsPerMonth);
  return imagePosts * CUSTOM_PLAN_PRICING.pricePerPostCents + reelsPerMonth * CUSTOM_PLAN_PRICING.pricePerReelCents;
}
