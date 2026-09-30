// Preço do crédito extra avulso (Patricia, 30/09/2026: "esta cobrança é
// mais pelo custo da imagem e dos vídeos, não queremos cobrar por carrossel
// ou reel mas sim por extra imagem e extra vídeo"). Cobrado uma vez, vale
// só no mês da compra (ImageCreditPurchase), somado à cota do plano.
// Oferecido só ao clicar Regenerate sem crédito (Weekly plan) — o plano
// sempre gera os posts/Reels combinados, a cota só limita regeneração.
//
// Valores fechados em 25/09/2026 (quando isso era o plano Custom),
// derivados do custo real por unidade: imagem ≈$0,11 entregue (Gemini 2.5
// Flash Image ~$0,04/tentativa + guardrails de fidelidade/composição via
// Claude Sonnet 5, 1,84 tentativas por imagem entregue) → €0,20, ~45% de
// margem; vídeo ≈$1,80 (API de vídeo externa cotada por ela) → €1,99, ~20%
// de margem de propósito — ela achou a margem equivalente ao Basic (~€2,97)
// cara demais pra cobrar por unidade avulsa. Nunca cobrado de verdade
// ainda — não existe integração de cobrança real (Fase 7, Shopify Billing).
export const EXTRA_CREDIT_PRICING = {
  pricePerImageCents: 20, // €0,20/imagem
  pricePerVideoCents: 199, // €1,99/vídeo
};

