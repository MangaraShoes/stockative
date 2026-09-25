import prisma from "../../db.server";
import { getProviderForTask } from "../ai/taskConfig.server";
import { applyLogoOverlay } from "./logoOverlay.server";
import type { ObservedScene } from "../ai/types.server";
import { isInconclusiveObservation, type SceneDecision, type CategoryRepertoire } from "./repertoire.server";
import { getOrClassifyProductVisuals } from "./productClassification.server";
import { getRepertoireForInteraction } from "./categoryDispatch.server";
import { selectVisualStrategy, VISUAL_MODE_GUIDANCE } from "./visualMode.server";
import { getFidelityConstraints, describeFidelityConstraints, type FidelityConstraints } from "./fidelityConstraints.server";
import type { CommercialObjective } from "../decisionEngine/constants";

// Sobe quando a arquitetura de decisão visual muda de forma relevante —
// registrada em todo GenerationLog (ver comentário lá) pra nunca perder de
// vista, olhando o histórico depois, com qual versão da lógica uma imagem
// foi decidida (Patricia, 14/09/2026: "registrar agora o modo visual, o
// objetivo e a versão da estratégia evita perder o histórico necessário
// depois").
const STRATEGY_VERSION = "v2-interaction-mode-split";

interface GenerateProductImageParams {
  shopId: string;
  productId: string;
  contentItemId?: string;
  referenceImageUrl: string;
  productTitle: string;
  creativeAngle: string;
  format: string;
  // Objetivo comercial deste post — escolhe a estratégia visual (interação +
  // modo) dentre as opções realmente válidas pro produto, ver
  // visualMode.server.ts (Patricia, 14/09/2026: "fazer o objetivo comercial
  // escolher entre opções válidas").
  objective: CommercialObjective;
  // Pedido pontual de correção ao regenerar (Patricia, 12/09/2026: "if I
  // asked to regenerate the image should have a space to add a comment
  // what would like to change") — muda só o que foi pedido, mantendo o
  // resto da cena igual, mesmo princípio de "corrigir o detalhe, não
  // refazer a imagem" já usado manualmente no projeto da Mangará.
  correctionNote?: string;
  // Brand voice da loja (Patricia, 12/09/2026: "este comentario a AI deve
  // saber como avaliar pois nao devemos nunca nos afastar do brand voice")
  // — passado pro prompt pra correção nunca pisar no tom da marca, além das
  // regras fixas de estética já embutidas abaixo.
  brandTone?: string | null;
  brandAvoid?: string | null;
}

interface BuildPromptParams extends GenerateProductImageParams {
  sceneDecision: SceneDecision;
  categoryPromptRules: string;
  visualModeGuidance: string;
  fidelityConstraintsText: string;
}

export type GenerateProductImageResult =
  | { status: "success"; creativeAssetId: string; imageUrl: string; attempts: number }
  | { status: "fallback"; reason: string; attempts: number };

// 1ª tentativa + 2 retries internos (não cobrados se falharem). Subido de 2
// pra 3 em 11/09/2026 com evidência real: mesmo com o prompt de composição
// corrigido, duas tentativas seguidas ainda falharam antes de uma terceira
// passar — variância normal do modelo generativo, não um prompt errado.
const MAX_ATTEMPTS = 3;

// A cena é sempre modelo vestindo/segurando/aplicando o produto (quando a
// interação escolhida tem modelo), editorial, produto em destaque
// (Patricia, 10/09/2026, depois de ver uma imagem gerada de mãos de
// artesão tecendo o produto — o `creativeAngle` do Estágio 1 é uma
// instrução de ARGUMENTO PARA A LEGENDA ("the handcrafted process..."), não
// uma instrução de cena fotográfica, e passá-lo direto como cena literal
// produz fotos que (a) contradizem a decisão de não vender como produto
// artesanal e (b) tendem a esconder o produto atrás de mãos/materiais em
// vez de mostrá-lo. A cena fica fixa; o creativeAngle só entra como
// contexto de mood/ambientação, nunca como literal do que aparece na foto.
//
// A primeira versão desse fix corrigiu a cena mas ficou genérica demais —
// "modelo vestindo, editorial" sozinho não é suficiente pra parecer uma
// campanha de verdade (Patricia, 10/09/2026: "ficou bem básica e sem
// graça"). As regras de estilo abaixo são a versão condensada, pra geração
// automática, do playbook validado ao longo de dezenas de iterações
// manuais pra Mangará (ver
// /Users/patriciacossettin/Mangara-Nano-Banana/CLAUDE.md — referência
// completa se algum produto continuar saindo fraco mesmo com isso).
//
// 14/09/2026 (Patricia: "queremos vender o app para todo o tipo de loja",
// depois refinado: "held descreve como alguém interage com o produto;
// Editorial descreve a abordagem criativa... separar essas dimensões"):
// deixou de assumir sempre "modelo vestindo, um prompt único" — esta
// função monta o caminho COM modelo (worn/held/applied — ver
// productClassification.server.ts); buildStandaloneImagePrompt logo abaixo
// é o caminho paralelo sem modelo nenhum. `categoryPromptRules` vem do
// CategoryRepertoire despachado por (categoria, interação);
// `visualModeGuidance` é a camada ORTOGONAL de abordagem criativa (Product
// Hero / Lifestyle / Editorial), escolhida pelo objetivo comercial, não
// pela categoria do produto.
function seasonStylingGuidance(season: BuildPromptParams["sceneDecision"]["season"]): string {
  if (season === "summer") {
    return "\n- This is a SUMMER product: the outfit must read as light and airy — a flowing dress, a linen piece, or a breezy skirt, never heavy trousers, a long coat, or anything that reads cold or wintery. The mood is warm, joyful and light: genuine, easy happiness in the eyes and an open, relaxed way of holding herself — this brand is Belgian precision paired with Brazilian warmth, and summer is where that warmth leads. Never somber, cold, or composed to the point of feeling serious.";
  }
  if (season === "winter") {
    return "\n- This is a WINTER product: the outfit can lean into richer layers — a structured coat worn open, a cinched waist, a heavier fabric with real drape and texture. The mood stays composed and elegant, warm and inviting rather than cold or clinical.";
  }
  return "";
}

export function buildWornOrHandheldPrompt(params: BuildPromptParams): string {
  const { action, environment, framing, light, season } = params.sceneDecision;

  return `This image must be an EXACT REPLICA of the product shown in the reference photo — same shape, color, proportions, materials, and details. Do NOT redesign, restyle, or reinterpret the product in any way.
${params.fidelityConstraintsText}

Scene: an editorial fashion photograph in a quiet-luxury aesthetic — a model wearing/holding/using the product as the clear hero of the shot. This is NOT a workshop/craftsman/behind-the-scenes shot and must NOT show hands assembling, crafting, or working on the product — only the finished product worn/carried/used by the model.
${params.visualModeGuidance}

The model is ${action.promptText}, in ${environment.promptText}, ${framing.promptText}, under ${light.promptText}.

Styling and composition (this is what separates a real editorial from a generic stock photo — follow all of it):
- Above everything else, the scene must feel calm, tranquil, comfortable, content and elegant — the kind of moment someone would genuinely want to be in. Never rushed, chaotic, staged-looking, or trying too hard. This is the baseline mood for every scene, whatever the season's specific energy on top of it.
- It should read as a real, everyday situation the customer could picture herself in — not an obviously posed photoshoot stance. If the model is holding or touching something (a cup, a railing, a door, furniture), that hand-object interaction must look anatomically real: a natural, relaxed grip, a plausible number of fingers, the object solidly and believably held, never floating or warped.
- The light described above should fall directly ON the product itself, not just on the background.
- A sober, neutral palette (cream, camel, black, off-white, stone) with at most one muted accent color if it helps (dusty pink, olive, khaki, dusty blue) — never a saturated or loud color that competes with the product.
- Include a real, visible touch of nature somewhere in frame — a plant, greenery, ivy, a tree, flowers — even in an architectural or urban setting. Never let the whole frame read as flat stone/concrete/beige with no living element at all.
- Strong contrast between the product and the surface/background immediately behind it, so its silhouette is unmistakable — never a dark product against a dark background or a light product lost against a light one.
- The model's outfit reads as one deliberate, elevated styling idea — an interesting layer, a structured shoulder, a cinched waist, a fabric with real drape or texture — never generic basics (plain blazer-and-jeans, plain t-shirt).${seasonStylingGuidance(season)}
- Any accessories (bags, jewelry, belts, sunglasses) must be plain, neutral, and generic — no visible logos, no distinctive hardware, shape, or design detail that would make it recognizable as a specific real-world brand or a different, unrelated product. Elegant but anonymous — this brand's product is the only thing in frame allowed to look like a real product.
- The model has a confident, composed presence: spine straight, shoulders open and back, chin level — not hunched or leaning forward. A genuine, subtle warmth in the expression, not vacant and not overly serious.
${params.categoryPromptRules}
- Whatever the framing calls for, the model is a complete, whole person — the frame edge is simply where the camera lens ends, not where her body ends. Never render her as an anatomically incomplete or oddly truncated figure; her body must read as continuing naturally beyond the crop, exactly like a real photograph of a real person.
- Never a spread-leg pose. Seated: knees together or legs naturally crossed at the knee, both feet settled. Standing or walking: a narrow, discreet stance — never a wide base or open legs.
- Feet and legs must be physically plausible in EVERY pose, not just seated ones. If seated, both feet are either flat/grounded or one leg is simply crossed over the other at the knee with both feet settled — never one foot lifted or hanging unsupported in mid-air. If standing, walking, or arriving, the weight-bearing foot is clearly and believably planted on the ground with real weight distribution — never hovering, floating at an impossible angle, or disconnected from the ground. A foot floating unsupported reads as broken anatomy in any pose, not just a seated one.
- Roughly an 85mm-equivalent portrait framing, camera at about hip height, natural distance from the subject — avoid wide-angle distortion that inflates the product or the pose.

Product: ${params.productTitle}
Mood/context for styling only (do NOT turn this into a literal scene description — it should only influence the model's styling and expression, never override the requirements above): ${params.creativeAngle}
Format: ${params.format}
${params.brandTone ? `\nBrand tone of voice (the vibe this brand always projects, visually too): ${params.brandTone}` : ""}${params.brandAvoid ? `\nNever: ${params.brandAvoid}` : ""}

The product must remain the clear focus of the composition, fully visible (not cropped out, not obscured by hands or props), well-lit, with clear contrast against its background. If the product has small connected parts (e.g. a heel attached to a sole, a handle attached to a bag), make sure they stay solidly connected — never floating or detached.
${
  params.correctionNote
    ? `\nThis is a CORRECTION of one specific detail from a previous generation of this same scene — it is not a request for a new scene. Keep the same scene, styling, pose, framing and lighting as before, and change ONLY this: "${params.correctionNote}". Weigh that request against everything above (the styling rules, the brand tone, and anything listed under "Never") — if it conflicts with any of them, apply the closest version of the request that still respects them instead of following it literally. A correction must never pull the image away from the brand's established editorial identity.`
    : ""
}`;
}

// Caminho paralelo pra interação "standalone" (ver productClassification.server.ts)
// — produto fotografado sozinho, sem modelo nenhum. PRIMEIRO RASCUNHO,
// 14/09/2026: ainda sem a mesma validação ao vivo que o caminho com modelo
// já teve.
export function buildStandaloneImagePrompt(params: BuildPromptParams): string {
  const { action, environment, framing, light } = params.sceneDecision;

  return `This image must be an EXACT REPLICA of the product shown in the reference photo — same shape, color, proportions, materials, and details. Do NOT redesign, restyle, or reinterpret the product in any way.
${params.fidelityConstraintsText}

Scene: a professional still-life product photograph, editorial quiet-luxury aesthetic — NO person, model, hand, or body part anywhere in frame. The product itself is the entire subject.
${params.visualModeGuidance}

The product is presented on ${environment.promptText}, styled as ${action.promptText}, shot from ${framing.promptText}, under ${light.promptText}.

Styling and composition:
- Above everything else, the image should feel calm, considered, and desirable — never cluttered, chaotic, or like a generic stock photo.
- The light described above should fall directly ON the product, not just on the surrounding surface.
- A sober, neutral palette (cream, camel, black, off-white, stone) for the surface and any props, with at most one muted accent color if it helps — never a saturated or loud color that competes with the product.
- Strong contrast between the product and the surface/background immediately behind it, so its shape and color read unmistakably.
${params.categoryPromptRules}

Product: ${params.productTitle}
Mood/context for styling only (do NOT turn this into a literal scene description — it should only influence the styling, never override the requirements above): ${params.creativeAngle}
Format: ${params.format}
${params.brandTone ? `\nBrand tone of voice (the vibe this brand always projects, visually too): ${params.brandTone}` : ""}${params.brandAvoid ? `\nNever: ${params.brandAvoid}` : ""}

The product must remain the clear focus of the composition, fully visible (not cropped out, not obscured by a prop), well-lit, with clear contrast against its background. If the product has small connected parts, make sure they stay solidly connected — never floating or detached.
${
  params.correctionNote
    ? `\nThis is a CORRECTION of one specific detail from a previous generation of this same scene — it is not a request for a new scene. Keep the same scene, styling, angle and lighting as before, and change ONLY this: "${params.correctionNote}". Weigh that request against everything above — if it conflicts with any of it, apply the closest version of the request that still respects them instead of following it literally.`
    : ""
}`;
}

// Compara o solicitado com o observado só nos eixos ESTRUTURAIS (ação,
// ambiente) — luz fica de fora de propósito (ver repertoire.server.ts).
// "unknown"/"not_applicable" nunca contam como descumprimento: uma
// classificação inconclusiva não é evidência de repetição.
function hasStructuralMismatch(sceneDecision: SceneDecision, observed?: ObservedScene): boolean {
  if (!observed) return false;
  if (isInconclusiveObservation(observed.action) || isInconclusiveObservation(observed.environment)) {
    return false;
  }
  return observed.action !== sceneDecision.action.id || observed.environment !== sceneDecision.environment.id;
}

function buildStructuralCorrectionNote(sceneDecision: SceneDecision, observed: ObservedScene): string {
  return `The previous attempt showed the model ${observed.action.replace(/_/g, " ")} in ${observed.environment.replace(/_/g, " ")} instead of what was requested. This generation must clearly show the model ${sceneDecision.action.promptText}, in ${sceneDecision.environment.promptText}.`;
}

// Fluxo do Image MVP (ver ARCHITECTURE.md): classifica o produto (categoria
// + interações válidas — ver productClassification.server.ts) → o
// objetivo comercial escolhe UMA interação e UM modo visual dentre as
// válidas (ver visualMode.server.ts) → despacha o repertório certo →
// gera → checa fidelidade (com restrições estruturadas, ver
// fidelityConstraints.server.ts) → checa composição/estilo editorial → se
// qualquer um falhar, até 1 retry interno (não cobrado) → se os dois
// passarem, entrega e conta 1 crédito → se falhar de novo, sugere usar a
// foto original. O guardrail de composição existe pra pegar imagens
// tecnicamente corretas mas "básicas e sem graça" (Patricia, 10/09/2026) —
// roda em toda loja que usa o app, automaticamente, não é revisão manual.
//
// 12/09/2026: passou a também escolher a cena via repertório e registrar
// solicitado x observado em GenerationLog. Se a imagem passar nos
// guardrails de qualidade mas não bater com a diversidade estrutural
// pedida, tenta UMA correção pontual (correção limitada, não um orçamento
// novo de tentativas) antes de aceitar a versão original como entrega
// final — nunca descarta uma imagem válida só por causa da pose/ambiente
// não bater exatamente. Retry estrutural só se aplica ao caminho com
// modelo — still-life "standalone" pula essa etapa.
export async function generateProductImage(
  params: GenerateProductImageParams,
): Promise<GenerateProductImageResult> {
  const imageProvider = getProviderForTask("image");
  const fidelityProvider = getProviderForTask("image_fidelity_check");
  const compositionProvider = getProviderForTask("image_composition_check");
  // Buscado uma vez aqui (não só depois, pro overlay de logo) pra também
  // entrar no prompt como brand voice — ver comentário em correctionNote.
  const shop = await prisma.shop.findUnique({ where: { id: params.shopId } });

  const classification = await getOrClassifyProductVisuals(params.productId);
  const { interaction, mode } = selectVisualStrategy(params.objective, classification.validInteractions);
  const hasModel = interaction !== "standalone";
  const repertoire: CategoryRepertoire = getRepertoireForInteraction(classification.category, interaction);
  const fidelityConstraints: FidelityConstraints = getFidelityConstraints(classification.category);
  const fidelityConstraintsText = describeFidelityConstraints(fidelityConstraints);

  const sceneDecision = await repertoire.selectScene(params.shopId, params.productTitle);
  // Retry estrutural (ver hasStructuralMismatch) só faz sentido pro caminho
  // com modelo — sem sceneOptions aqui, o guardrail de composição não
  // preenche `observed` nenhum pro caminho standalone, então
  // hasStructuralMismatch nunca dispara pra ele.
  const sceneOptions = hasModel ? repertoire.sceneOptionIds : undefined;

  // campaignId = o weekBatchId do post, quando existe (post avulso de
  // "Create content" não tem, fica null — "quando disponível", Patricia
  // 12/09/2026). A consulta de histórico em repertoire.server.ts continua
  // sendo por LOJA (e por categoria, ver pickWeighted), isto é só um campo
  // extra pra filtrar mais fino depois.
  const campaignId = params.contentItemId
    ? (await prisma.contentItem.findUnique({
        where: { id: params.contentItemId },
        select: { weekBatchId: true },
      }))?.weekBatchId ?? null
    : null;

  let correctionNote = params.correctionNote;
  let usedStructuralRetry = false;
  let fallback: { imageDataUrl: string; model: string; generationLogId: string } | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const promptParams: BuildPromptParams = {
      ...params,
      correctionNote,
      brandTone: shop?.brandTone,
      brandAvoid: shop?.brandAvoid,
      sceneDecision,
      categoryPromptRules: repertoire.promptRules,
      visualModeGuidance: VISUAL_MODE_GUIDANCE[mode],
      fidelityConstraintsText,
    };
    const prompt = hasModel ? buildWornOrHandheldPrompt(promptParams) : buildStandaloneImagePrompt(promptParams);

    const generated = await imageProvider.generateImage(prompt, params.referenceImageUrl);
    const fidelity = await fidelityProvider.checkImageFidelity(
      params.referenceImageUrl,
      generated.imageDataUrl,
      params.productTitle,
      fidelityConstraints,
    );
    // Só vale checar composição se o produto em si já bateu — não faz
    // sentido avaliar estilo de uma imagem que nem é o produto certo.
    const composition = fidelity.passed
      ? await compositionProvider.checkImageComposition(
          generated.imageDataUrl,
          params.productTitle,
          sceneOptions,
          hasModel,
        )
      : { passed: false, issues: [] as string[], observed: undefined };
    const passed = fidelity.passed && composition.passed;
    // Decidido ANTES de gravar o log: se esta tentativa vai ficar só como
    // rede de segurança (retentativa de correção estrutural em curso), ela
    // ainda NÃO foi entregue, então não pode contar crédito ainda — achado
    // ao vivo, 12/09/2026: sem esse cuidado, a tentativa descartada e a
    // tentativa de correção entregue contavam 2 créditos pra 1 imagem só
    // (violava o princípio "1 crédito = 1 imagem ENTREGUE" já documentado
    // aqui). Se este acabar sendo o fallback realmente entregue (a correção
    // falhar), o crédito é ligado depois, no update logo abaixo.
    const isStructuralHold =
      passed && !usedStructuralRetry && attempt < MAX_ATTEMPTS && hasStructuralMismatch(sceneDecision, composition.observed);

    const generationLog = await prisma.generationLog.create({
      data: {
        contentItemId: params.contentItemId,
        taskType: "image",
        model: generated.model,
        passedFidelityCheck: fidelity.passed,
        passedCompositionCheck: fidelity.passed ? composition.passed : null,
        // 1 crédito = 1 imagem válida ENTREGUE ao merchant, nunca 1 chamada
        // de API — tentativa rejeitada por qualquer guardrail não é cobrada.
        countsAsCredit: passed && !isStructuralHold,
        // O correctionNote ORIGINAL da lojista (nunca a nota interna de
        // retry estrutural, que muta a variável local `correctionNote` no
        // loop acima) — é o sinal real de "o que ela pediu pra mudar" numa
        // regeneração, null pra uma geração normal (Patricia, 24/09/2026).
        regenerationReason: params.correctionNote ?? null,
        shopId: params.shopId,
        productId: params.productId,
        category: classification.category,
        campaignId,
        interaction,
        visualMode: mode,
        commercialObjective: params.objective,
        strategyVersion: STRATEGY_VERSION,
        fidelityConstraints: fidelityConstraints as unknown as object,
        requestedAction: sceneDecision.action.id,
        requestedEnvironment: sceneDecision.environment.id,
        requestedFraming: sceneDecision.framing.id,
        requestedLight: sceneDecision.light.id,
        observedAction: composition.observed?.action ?? null,
        observedEnvironment: composition.observed?.environment ?? null,
        observedFraming: composition.observed?.framing ?? null,
        observedLight: composition.observed?.light ?? null,
      },
    });

    if (passed) {
      if (isStructuralHold) {
        // Guarda esta versão válida como rede de segurança — se a correção
        // não passar nos guardrails de qualidade, entregamos esta em vez de
        // nada. "Correção limitada": no máximo uma tentativa extra por essa
        // razão, nunca um novo orçamento de tentativas.
        fallback = { imageDataUrl: generated.imageDataUrl, model: generated.model, generationLogId: generationLog.id };
        usedStructuralRetry = true;
        correctionNote = buildStructuralCorrectionNote(sceneDecision, composition.observed!);
        continue;
      }

      return deliverImage(generated.imageDataUrl, generationLog.id, params, shop, attempt);
    }
  }

  if (fallback) {
    // Liga o crédito só agora que sabemos que esta é de fato a entregue —
    // ver comentário acima sobre não contar 2 créditos pra 1 imagem.
    await prisma.generationLog.update({
      where: { id: fallback.generationLogId },
      data: { countsAsCredit: true },
    });
    return deliverImage(fallback.imageDataUrl, fallback.generationLogId, params, shop, MAX_ATTEMPTS);
  }

  return {
    status: "fallback",
    reason:
      "The AI couldn't generate an image that's both faithful to your product and up to editorial quality after two attempts. Use your original product photo for this post instead.",
    attempts: MAX_ATTEMPTS,
  };
}

async function deliverImage(
  imageDataUrl: string,
  generationLogId: string,
  params: GenerateProductImageParams,
  shop: { applyLogoOverlay: boolean; logoUrl: string | null } | null,
  attempts: number,
): Promise<GenerateProductImageResult> {
  const finalImageUrl =
    shop?.applyLogoOverlay && shop.logoUrl ? await applyLogoOverlay(imageDataUrl, shop.logoUrl) : imageDataUrl;

  // Liga o resultado do guardrail à imagem salva — sem isso, nada depois
  // (ex.: o reaproveitamento de imagem editorial em buildCarousel.server.ts)
  // consegue checar se essa imagem específica realmente passou nos
  // critérios de composição (achado real, 11/09/2026: uma imagem de
  // artesão trançando fibra foi reaproveitada num post publicado porque
  // nada linkava o CreativeAsset ao GenerationLog que a aprovou).
  const creativeAsset = await prisma.creativeAsset.create({
    data: {
      shopId: params.shopId,
      productId: params.productId,
      imageUrl: finalImageUrl,
      source: "ai_generated",
      generationLogId,
    },
  });

  return {
    status: "success",
    creativeAssetId: creativeAsset.id,
    imageUrl: finalImageUrl,
    attempts,
  };
}
