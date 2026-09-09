import prisma from "../../db.server";
import { getProviderForTask } from "../ai/taskConfig.server";

interface GenerateProductImageParams {
  shopId: string;
  productId: string;
  contentItemId?: string;
  referenceImageUrl: string;
  productTitle: string;
  creativeAngle: string;
  format: string;
}

export type GenerateProductImageResult =
  | { status: "success"; creativeAssetId: string; imageUrl: string; attempts: number }
  | { status: "fallback"; reason: string; attempts: number };

const MAX_ATTEMPTS = 2; // 1ª tentativa + 1 retry interno (não cobrado se falhar)

function buildImagePrompt(params: GenerateProductImageParams): string {
  return `This image must be an EXACT REPLICA of the product shown in the reference photo — same shape, color, proportions, materials, and details. Do NOT redesign, restyle, or reinterpret the product in any way. Only change the surrounding scene.

Product: ${params.productTitle}
Scene/creative angle: ${params.creativeAngle}
Format: ${params.format}

The product must remain the clear focus of the composition, fully visible (not cropped out or obscured), well-lit, with clear contrast against its background. If the product has small connected parts (e.g. a heel attached to a sole, a handle attached to a bag), make sure they stay solidly connected — never floating or detached.`;
}

// Fluxo do Image MVP (ver ARCHITECTURE.md): gera → checa fidelidade → se
// falhar, até 1 retry interno (não cobrado) → se passar, entrega e conta 1
// crédito → se falhar de novo, sugere usar a foto original.
export async function generateProductImage(
  params: GenerateProductImageParams,
): Promise<GenerateProductImageResult> {
  const imageProvider = getProviderForTask("image");
  const fidelityProvider = getProviderForTask("image_fidelity_check");
  const prompt = buildImagePrompt(params);

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const generated = await imageProvider.generateImage(
      prompt,
      params.referenceImageUrl,
    );
    const fidelity = await fidelityProvider.checkImageFidelity(
      params.referenceImageUrl,
      generated.imageDataUrl,
      params.productTitle,
    );

    await prisma.generationLog.create({
      data: {
        contentItemId: params.contentItemId,
        taskType: "image",
        model: generated.model,
        passedFidelityCheck: fidelity.passed,
        // 1 crédito = 1 imagem válida ENTREGUE ao merchant, nunca 1 chamada
        // de API — tentativa rejeitada pelo guardrail não é cobrada.
        countsAsCredit: fidelity.passed,
      },
    });

    if (fidelity.passed) {
      const creativeAsset = await prisma.creativeAsset.create({
        data: {
          shopId: params.shopId,
          productId: params.productId,
          imageUrl: generated.imageDataUrl,
          source: "ai_generated",
        },
      });

      return {
        status: "success",
        creativeAssetId: creativeAsset.id,
        imageUrl: generated.imageDataUrl,
        attempts: attempt,
      };
    }
  }

  return {
    status: "fallback",
    reason:
      "The AI couldn't generate an image faithful to your product after two attempts. Use your original product photo for this post instead.",
    attempts: MAX_ATTEMPTS,
  };
}
