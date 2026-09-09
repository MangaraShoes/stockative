import { z } from "zod";
import { generateStructuredForTask } from "../ai/index.server";

interface ProductSample {
  title: string;
  description: string | null;
  productType: string | null;
  price: number;
}

const brandDraftSchema = z.object({
  brandDescription: z
    .string()
    .describe("Two to three sentences describing who this brand is and what makes it different"),
  brandTone: z
    .string()
    .describe("A short phrase describing the tone of voice, e.g. 'warm, confident, never pushy'"),
  brandAvoid: z
    .string()
    .describe("Things this brand's copy should never say or imply"),
});

export type BrandDraft = z.infer<typeof brandDraftSchema>;

// Rascunho de Brand Intelligence gerado pela IA a partir do próprio catálogo
// de produtos já sincronizado — o merchant revisa e edita antes de salvar,
// nunca é salvo automaticamente (decisão de Patricia, 09/09/2026).
//
// Isso NÃO inclui análise do site nem dos 2 concorrentes do Instagram ainda —
// essa segunda fonte depende da integração com Meta, que ainda não existe
// neste projeto. Quando essa integração existir, dá pra somar os posts dos
// concorrentes (via Business Discovery, ver ARCHITECTURE.md) a este mesmo
// prompt para um rascunho mais rico.
export async function draftBrandVoice(
  products: ProductSample[],
): Promise<BrandDraft> {
  const sample = products.slice(0, 20);
  const priceRange =
    sample.length > 0
      ? `€${Math.min(...sample.map((p) => p.price)).toFixed(2)} - €${Math.max(...sample.map((p) => p.price)).toFixed(2)}`
      : "unknown";

  const productList = sample
    .map(
      (p) =>
        `- ${p.title}${p.productType ? ` (${p.productType})` : ""}: ${p.description?.slice(0, 200) ?? "(no description)"}`,
    )
    .join("\n");

  const prompt = `Based on this Shopify store's product catalog, draft a brand voice profile. This is a DRAFT the merchant will review and edit — infer a plausible, specific personality from the products, don't be generic.

Price range: ${priceRange}

Products:
${productList}

Draft the brand description, tone of voice, and things to avoid saying.`;

  return generateStructuredForTask("brand_analysis", brandDraftSchema, prompt);
}
