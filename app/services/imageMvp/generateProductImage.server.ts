import prisma from "../../db.server";
import { getProviderForTask } from "../ai/taskConfig.server";
import { applyLogoOverlay } from "./logoOverlay.server";

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

// A cena é sempre modelo vestindo o produto, editorial, produto em destaque
// (Patricia, 10/09/2026, depois de ver uma imagem gerada de mãos de artesão
// tecendo o produto — o `creativeAngle` do Estágio 1 é uma instrução de
// ARGUMENTO PARA A LEGENDA ("the handcrafted process..."), não uma instrução
// de cena fotográfica, e passá-lo direto como cena literal produz fotos que
// (a) contradizem a decisão de não vender como produto artesanal e (b) tendem
// a esconder o produto atrás de mãos/materiais em vez de mostrá-lo. A cena
// fica fixa; o creativeAngle só entra como contexto de mood/ambientação, nunca
// como literal do que aparece na foto.
function buildImagePrompt(params: GenerateProductImageParams): string {
  return `This image must be an EXACT REPLICA of the product shown in the reference photo — same shape, color, proportions, materials, and details. Do NOT redesign, restyle, or reinterpret the product in any way.

Scene: a model wearing/holding the product, shot in an editorial fashion-photography style — natural or soft studio light, clean uncluttered background with good contrast against the product's color, the product as the clear hero of the composition. This is NOT a workshop/craftsman/behind-the-scenes shot and must NOT show hands assembling, crafting, or working on the product — only the finished product worn by the model.

Product: ${params.productTitle}
Mood/context for styling only (do NOT turn this into a literal scene description — it should only influence the model's styling, expression and setting, never override the "model wearing the product, editorial" requirement above): ${params.creativeAngle}
Format: ${params.format}

The product must remain the clear focus of the composition, fully visible (not cropped out, not obscured by hands or props), well-lit, with clear contrast against its background. If the product has small connected parts (e.g. a heel attached to a sole, a handle attached to a bag), make sure they stay solidly connected — never floating or detached.`;
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
      const shop = await prisma.shop.findUnique({ where: { id: params.shopId } });

      const finalImageUrl =
        shop?.applyLogoOverlay && shop.logoUrl
          ? await applyLogoOverlay(generated.imageDataUrl, shop.logoUrl)
          : generated.imageDataUrl;

      const creativeAsset = await prisma.creativeAsset.create({
        data: {
          shopId: params.shopId,
          productId: params.productId,
          imageUrl: finalImageUrl,
          source: "ai_generated",
        },
      });

      return {
        status: "success",
        creativeAssetId: creativeAsset.id,
        imageUrl: finalImageUrl,
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
