import { z } from "zod";
import prisma from "../../db.server";
import { generateStructuredForTask } from "../ai/index.server";

// Abre a geração de imagem pra QUALQUER tipo de loja Shopify, não só
// calçado/vestuário (Patricia, 14/09/2026: "queremos vender o app para todo
// o tipo de loja"). `productType` da Shopify é texto livre — cada lojista
// escreve do seu jeito — então não dá pra confiar numa lista de
// palavras-chave pra cobrir "qualquer nicho do mundo" com confiança. Uma
// classificação por IA (barata, cacheada por produto) escala muito melhor
// que um dicionário de palavras-chave mantido à mão.
//
// Interação e modo visual são dimensões DIFERENTES (Patricia, 14/09/2026,
// revisão do desenho: "held descreve como alguém interage com o produto;
// Editorial descreve a abordagem criativa... uma imagem pode ser editorial
// com o produto na mão ou sozinho"). Este módulo só decide o que é FATO
// sobre o produto (categoria + quais interações fazem sentido comercial pra
// ele) — a escolha de MODO VISUAL entra depois, orientada pelo objetivo da
// campanha, em visualMode.server.ts.
export const PRODUCT_INTERACTIONS = ["worn", "held", "applied", "standalone"] as const;
export type ProductInteraction = (typeof PRODUCT_INTERACTIONS)[number];

// Enum curado (não texto livre) pra sempre bater com um repertório real na
// hora de despachar (ver categoryDispatch.server.ts) — "other" é a válvula
// de escape pra qualquer coisa fora dessa lista, nunca um erro. A lista
// cresce conforme repertórios dedicados forem sendo construídos e
// validados com lojistas reais de cada nicho — um repertório bem feito não
// nasce de uma vez, precisa da mesma rodada de correção ao vivo que o de
// calçado teve (e só o de calçado passou por essa rodada até agora).
export const VISUAL_CATEGORIES = [
  "footwear",
  "apparel",
  "bags_accessories",
  "jewelry",
  "beauty_personal_care",
  "home_decor",
  "furniture",
  "electronics",
  "food_beverage",
  "toys_kids",
  "other",
] as const;
export type VisualCategory = (typeof VISUAL_CATEGORIES)[number];

export interface ProductVisualClassification {
  category: VisualCategory;
  // SEMPRE pelo menos 1 — a campanha escolhe entre as válidas na hora de
  // gerar (ver visualMode.server.ts), não uma classificação fixa por
  // produto (Patricia, 14/09/2026: "se continuar classificado
  // exclusivamente como worn, handheld ou standalone, a campanha
  // continuará limitada pela classificação fixa. Um perfume pode permitir
  // standalone e held").
  validInteractions: ProductInteraction[];
}

const classificationSchema = z.object({
  category: z.enum(VISUAL_CATEGORIES),
  validInteractions: z.array(z.enum(PRODUCT_INTERACTIONS)).min(1),
});

async function classifyProductForImaging(params: {
  title: string;
  description: string | null;
  productType: string | null;
}): Promise<ProductVisualClassification> {
  const prompt = `You decide facts about how a product CAN be photographed for social media marketing — never anything else about the product, and never which specific approach to use (a campaign decides that later, from the options you give here).

Product:
- Title: ${params.title}
- Type: ${params.productType ?? "(not set)"}
- Description: ${params.description ?? "(none)"}

Decide two things:

1. category — the closest real-world merchandising category from the fixed list you were given. Pick "other" only when truly nothing else fits.

2. validInteractions — EVERY interaction mode that genuinely makes commercial sense for this specific product (pick as many as apply, at least one):
   - "worn": the product can be worn on a model's body (clothing, footwear, most jewelry, hats, eyewear).
   - "held": the product can be held or carried by a model without being worn or applied (bags, drinkware, books, tools, some accessories, a perfume bottle held in hand).
   - "applied": the product is actively being applied/used in a hands-on way, typically on skin/hair/a surface (skincare, makeup, a candle being lit, a cleaning product in use).
   - "standalone": the product can be shown on its own with no person at all — a styled still-life shot. This is almost always valid as a fallback even for wearable products (e.g. a shoe can also be shot alone), unless the product is genuinely meaningless without a person (rare).

Be generous but honest: include every interaction that a real marketer for this kind of product would actually consider using, not just the single most obvious one.`;

  return generateStructuredForTask("product_visual_classification", classificationSchema, prompt);
}

// Sempre lê o cache primeiro (ver ProductCache.imagingInteractions/imagingCategory)
// — classificar de novo a cada imagem gerada custaria uma chamada de IA por
// imagem à toa, já que os fatos sobre um produto não mudam entre uma
// geração e a próxima.
export async function getOrClassifyProductVisuals(
  productId: string,
): Promise<ProductVisualClassification> {
  const product = await prisma.productCache.findUniqueOrThrow({ where: { id: productId } });

  if (product.imagingInteractions && product.imagingCategory) {
    const storedInteractions = product.imagingInteractions
      .split(",")
      .filter((v): v is ProductInteraction => (PRODUCT_INTERACTIONS as readonly string[]).includes(v));
    if (
      storedInteractions.length > 0 &&
      (VISUAL_CATEGORIES as readonly string[]).includes(product.imagingCategory)
    ) {
      return {
        category: product.imagingCategory as VisualCategory,
        validInteractions: storedInteractions,
      };
    }
  }

  const classification = await classifyProductForImaging({
    title: product.title,
    description: product.description,
    productType: product.productType,
  });

  await prisma.productCache.update({
    where: { id: productId },
    data: {
      imagingInteractions: classification.validInteractions.join(","),
      imagingCategory: classification.category,
    },
  });

  return classification;
}
