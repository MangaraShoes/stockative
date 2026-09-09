import { z } from "zod";
import { generateStructuredForTask } from "../ai/index.server";

const qualitySchema = z.object({
  quality: z.enum(["good", "fair", "weak"]),
  recommendation: z
    .string()
    .describe(
      "One sentence: is an AI-generated lifestyle image worth the credit, and why",
    ),
});

export type ImageQualityAssessment = z.infer<typeof qualitySchema>;

// Avalia se a foto atual do produto (a que já está na Shopify) já é boa o
// bastante pra usar como está, antes de gastar um crédito gerando uma nova —
// complementa a alocação de crédito por prioridade comercial (ver
// ARCHITECTURE.md) com um segundo sinal: a foto que já existe precisa de ajuda?
export async function assessProductImageQuality(
  imageUrl: string,
  productTitle: string,
): Promise<ImageQualityAssessment> {
  const prompt = `Assess this product photo of "${productTitle}" for use in social media marketing. Consider lighting, focus/sharpness, background cleanliness, and whether it already looks appealing enough to post as-is, versus whether a fresh AI-generated lifestyle image would likely perform better.

Rate quality as "good" (usable as-is, an AI image may not add much), "fair" (usable, but an AI lifestyle image would likely help), or "weak" (poor lighting/focus/background, an AI image is recommended).`;

  return generateStructuredForTask(
    "image_quality_assessment",
    qualitySchema,
    prompt,
    { imageUrls: [imageUrl] },
  );
}
