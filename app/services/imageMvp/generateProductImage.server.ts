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

// 1ª tentativa + 2 retries internos (não cobrados se falharem). Subido de 2
// pra 3 em 11/09/2026 com evidência real: mesmo com o prompt de composição
// corrigido, duas tentativas seguidas ainda falharam antes de uma terceira
// passar — variância normal do modelo generativo, não um prompt errado.
const MAX_ATTEMPTS = 3;

// A cena é sempre modelo vestindo o produto, editorial, produto em destaque
// (Patricia, 10/09/2026, depois de ver uma imagem gerada de mãos de artesão
// tecendo o produto — o `creativeAngle` do Estágio 1 é uma instrução de
// ARGUMENTO PARA A LEGENDA ("the handcrafted process..."), não uma instrução
// de cena fotográfica, e passá-lo direto como cena literal produz fotos que
// (a) contradizem a decisão de não vender como produto artesanal e (b) tendem
// a esconder o produto atrás de mãos/materiais em vez de mostrá-lo. A cena
// fica fixa; o creativeAngle só entra como contexto de mood/ambientação, nunca
// como literal do que aparece na foto.
//
// A primeira versão desse fix corrigiu a cena mas ficou genérica demais —
// "modelo vestindo, editorial" sozinho não é suficiente pra parecer uma
// campanha de verdade (Patricia, 10/09/2026: "ficou bem básica e sem
// graça"). As regras de estilo abaixo são a versão condensada, pra geração
// automática, do playbook validado ao longo de dezenas de iterações manuais
// pra Mangará (ver /Users/patriciacossettin/Mangara-Nano-Banana/CLAUDE.md —
// referência completa se algum produto continuar saindo fraco mesmo com
// isso).
//
// Achado ao vivo em 11/09/2026: uma geração ficou linda mas reprovou na
// checagem de composição — saia midi comprida cobrindo até quase o
// tornozelo, sapato pequeno e parcialmente escondido no quadro. Regra 2 do
// playbook original já cobria exatamente isso ("calça boca larga... usar
// calça cropped que termine acima do tornozelo") e tinha ficado de fora da
// versão condensada — adicionada explicitamente abaixo.
export function buildImagePrompt(params: GenerateProductImageParams): string {
  return `This image must be an EXACT REPLICA of the product shown in the reference photo — same shape, color, proportions, materials, and details. Do NOT redesign, restyle, or reinterpret the product in any way.

Scene: an editorial fashion photograph in a quiet-luxury aesthetic — a model wearing/holding the product as the clear hero of the shot. This is NOT a workshop/craftsman/behind-the-scenes shot and must NOT show hands assembling, crafting, or working on the product — only the finished product worn/carried by the model.

Styling and composition (this is what separates a real editorial from a generic stock photo — follow all of it):
- Natural or soft golden-hour light, warm and flattering, falling directly ON the product itself, not just on the background.
- A sober, neutral palette (cream, camel, black, off-white, stone) with at most one muted accent color if it helps (dusty pink, olive, khaki, dusty blue) — never a saturated or loud color that competes with the product.
- Strong contrast between the product and the surface/background immediately behind it, so its silhouette is unmistakable — never a dark product against a dark background or a light product lost against a light one.
- The model's outfit reads as one deliberate, elevated styling idea — an interesting layer, a structured shoulder, a cinched waist, a fabric with real drape or texture — never generic basics (plain blazer-and-jeans, plain t-shirt). Understated gold jewelry or a structured bag is welcome, never loud logos.
- The model has a confident, composed presence: spine straight, shoulders open and back, chin level — not hunched or leaning forward. A genuine, subtle warmth in the expression, not vacant and not overly serious.
- If the product is footwear: frame it so its side silhouette is visible (never toe pointed straight at camera, which foreshortens it). Any pants, skirt, or dress hem MUST end above the ankle, leaving the ankle bare — never a long/midi/maxi length that covers the ankle or shoe, even partially. The shoe needs to occupy a real, noticeable portion of the frame, not just be a small detail at the bottom of a full-body shot — favor a closer crop (from roughly the knee or thigh down, or a seated/cropped pose) over a distant full-length shot when in doubt.
- Vary the setting rather than defaulting to the same interior every time — a garden, a café terrace, a sunlit interior with warm wood tones, a stone courtyard — whatever suits the product's season/mood.
- Roughly an 85mm-equivalent portrait framing, camera at about hip height, natural distance from the subject — avoid wide-angle distortion that inflates the product or the pose.

Product: ${params.productTitle}
Mood/context for styling only (do NOT turn this into a literal scene description — it should only influence the model's styling, expression and setting, never override the requirements above): ${params.creativeAngle}
Format: ${params.format}

The product must remain the clear focus of the composition, fully visible (not cropped out, not obscured by hands or props), well-lit, with clear contrast against its background. If the product has small connected parts (e.g. a heel attached to a sole, a handle attached to a bag), make sure they stay solidly connected — never floating or detached.`;
}

// Fluxo do Image MVP (ver ARCHITECTURE.md): gera → checa fidelidade → checa
// composição/estilo editorial → se qualquer um falhar, até 1 retry interno
// (não cobrado) → se os dois passarem, entrega e conta 1 crédito → se falhar
// de novo, sugere usar a foto original. O guardrail de composição existe
// pra pegar imagens tecnicamente corretas mas "básicas e sem graça"
// (Patricia, 10/09/2026) — roda em toda loja que usa o app, automaticamente,
// não é revisão manual.
export async function generateProductImage(
  params: GenerateProductImageParams,
): Promise<GenerateProductImageResult> {
  const imageProvider = getProviderForTask("image");
  const fidelityProvider = getProviderForTask("image_fidelity_check");
  const compositionProvider = getProviderForTask("image_composition_check");
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
    // Só vale checar composição se o produto em si já bateu — não faz
    // sentido avaliar estilo de uma imagem que nem é o produto certo.
    const composition = fidelity.passed
      ? await compositionProvider.checkImageComposition(generated.imageDataUrl, params.productTitle)
      : { passed: false, issues: [] as string[] };
    const passed = fidelity.passed && composition.passed;

    const generationLog = await prisma.generationLog.create({
      data: {
        contentItemId: params.contentItemId,
        taskType: "image",
        model: generated.model,
        passedFidelityCheck: fidelity.passed,
        passedCompositionCheck: fidelity.passed ? composition.passed : null,
        // 1 crédito = 1 imagem válida ENTREGUE ao merchant, nunca 1 chamada
        // de API — tentativa rejeitada por qualquer guardrail não é cobrada.
        countsAsCredit: passed,
      },
    });

    if (passed) {
      const shop = await prisma.shop.findUnique({ where: { id: params.shopId } });

      const finalImageUrl =
        shop?.applyLogoOverlay && shop.logoUrl
          ? await applyLogoOverlay(generated.imageDataUrl, shop.logoUrl)
          : generated.imageDataUrl;

      // Liga o resultado do guardrail à imagem salva — sem isso, nada
      // depois (ex.: o reaproveitamento de imagem editorial em
      // buildCarousel.server.ts) consegue checar se essa imagem específica
      // realmente passou nos critérios de composição (achado real,
      // 11/09/2026: uma imagem de artesão trançando fibra foi reaproveitada
      // num post publicado porque nada linkava o CreativeAsset ao
      // GenerationLog que a aprovou).
      const creativeAsset = await prisma.creativeAsset.create({
        data: {
          shopId: params.shopId,
          productId: params.productId,
          imageUrl: finalImageUrl,
          source: "ai_generated",
          generationLogId: generationLog.id,
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
      "The AI couldn't generate an image that's both faithful to your product and up to editorial quality after two attempts. Use your original product photo for this post instead.",
    attempts: MAX_ATTEMPTS,
  };
}
