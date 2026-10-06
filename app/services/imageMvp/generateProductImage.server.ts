import prisma from "../../db.server";
import { getProviderForTask } from "../ai/taskConfig.server";
import type { FidelityCheckResult } from "../ai/types.server";
import { applyLogoOverlay } from "./logoOverlay.server";
import type { ObservedScene } from "../ai/types.server";
import { isInconclusiveObservation, type SceneDecision, type CategoryRepertoire } from "./repertoire.server";
import { getOrClassifyProductVisuals } from "./productClassification.server";
import { getRepertoireForInteraction } from "./categoryDispatch.server";
import { selectVisualStrategy, VISUAL_MODE_GUIDANCE } from "./visualMode.server";
import { MAX_IMAGE_CANDIDATES } from "./imageCandidates.server";
import { describeModelWithOverrides, parseModelProfile, type RegenerationOverrides } from "./modelProfile";
import { getFidelityConstraints, describeFidelityConstraints, type FidelityConstraints } from "./fidelityConstraints.server";
import type { CommercialObjective, ImageStylePreference } from "../decisionEngine/constants";

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
  // Trocar modelo / situação só nesta regeneração (ver modelProfile.ts).
  regenerationOverrides?: RegenerationOverrides;
  // Brand voice da loja (Patricia, 12/09/2026: "este comentario a AI deve
  // saber como avaliar pois nao devemos nunca nos afastar do brand voice")
  // — passado pro prompt pra correção nunca pisar no tom da marca, além das
  // regras fixas de estética já embutidas abaixo.
  brandTone?: string | null;
  brandAvoid?: string | null;
}

interface BuildPromptParams extends GenerateProductImageParams {
  // Pedido atual da lojista + direções anteriores dela pro mesmo produto
  // (ver loadMerchantDirection) — tem prioridade sobre o estilo padrão.
  merchantDirection?: string;
  // Retrato da modelo resolvido do perfil da loja (ver modelProfile.ts) —
  // só no caminho com modelo.
  modelDescription?: string;
  // Nota interna de retentativa (cena estrutural errada ou motivo da
  // rejeição anterior pelos guardrails) — nunca vem da lojista.
  retryNote?: string;
  sceneDecision: SceneDecision;
  categoryPromptRules: string;
  visualModeGuidance: string;
  fidelityConstraintsText: string;
}

export type GenerateProductImageResult =
  | { status: "success"; creativeAssetId: string; imageUrl: string; attempts: number }
  | { status: "fallback"; reason: string; attempts: number; candidateCount: number };

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

// Trava do produto na correção (Patricia, 03/10/2026: "never change the color
// of the original product or any characteristic from the original item we
// are selling"). O pedido de correção da lojista só pode mexer na CENA —
// nunca no produto. Se ela reclama do produto ("a cor está diferente"), isso
// vira "fique mais fiel à foto de referência", nunca "mude o produto".
const CORRECTION_PRODUCT_LOCK = `The product itself is LOCKED and is never part of the correction: its color, shape, material, finish and every detail must stay exactly as in the reference photo, whatever the request says. A correction can only change the scene around it — outfit, background, props, pose, framing, lighting. If the request says the product looks different from the real one (e.g. "the color is different"), that means: make the product match the reference photo MORE exactly — never recolor, restyle or reinterpret it. If the request asks to change the product's color or any of its characteristics, ignore that part of the request.`;

// 05/10/2026 (Patricia: "eu pedi para regenerar e ficou pior ainda... todas
// as instruções que eu coloquei foram ignoradas"). O pedido dela pedia
// vestido chocolate, sem casaco pesado, nada de bege/off-white — e voltou
// casaco camelo e calça creme. Três causas no prompt antigo: (1) o pedido
// ia no FIM de um prompt enorme; (2) a paleta padrão "cream, camel,
// off-white" e o estilo de inverno "structured coat" contradiziam o pedido
// e o próprio prompt mandava, em conflito, ficar com as regras padrão;
// (3) dizia "mantenha a mesma cena de antes", mas o modelo nunca recebe a
// imagem anterior. Agora o pedido vai logo depois da fidelidade e manda
// em tudo que é estilo; só a fidelidade do produto e as regras de anatomia/
// acessório sem marca continuam acima dele.
function merchantDirectionBlock(direction?: string): string {
  if (!direction) return "";
  return `
MERCHANT'S DIRECTION — the store owner reviewed earlier images of this product and asked for this. It is the highest priority after product fidelity: it OVERRIDES the default styling below (color palette, outfit, coat/layers, season styling, setting, framing) wherever they disagree. Follow every part of it that concerns the scene:
"""
${direction}
"""
${CORRECTION_PRODUCT_LOCK}
`;
}

function modelProfileBlock(description?: string): string {
  if (!description) return "";
  return `
MODEL — the store's chosen people and occasion for its photos. Follow it exactly (only the merchant's direction above can change it). Wherever this brief says "the model", "she" or "her", it means the person or people described here:
${description}
`;
}

// Foto lifestyle da própria loja como referência de ESTILO (Patricia,
// 06/10/2026: "a imagem do Shopify foi a melhor de todas, como descrever
// para criar imagens com esta luz e destaque para o produto e ao mesmo
// tempo elegante"). Mostrar a foto funciona melhor que descrevê-la — no
// teste com a Senna, 2 de 2 passaram na fidelidade de primeira, com piso
// claro e produto em destaque, sem copiar modelo/pose/ambiente.
const STYLE_REFERENCE_BLOCK = `
IMAGES: the FIRST image is the real product (match it exactly). The SECOND image is this brand's own best photo — use it ONLY as a style reference: match its quality of light (soft, warm, directional light falling on the product), its light and calm palette, the contrast between the product and the floor/background, its quiet elegance, and how large and clear the product reads in the frame. Where the merchant's direction or the occasion above asks for something different, follow them. Do NOT copy its person, face, pose, outfit, furniture or room — create a new, different scene following everything above.
`;

// Foto lifestyle do próprio produto; senão, a mais recente da loja.
async function findStyleReferenceUrl(shopId: string, productId: string): Promise<string | null> {
  const own = await prisma.productImage.findFirst({
    where: { productId, shotType: "lifestyle" },
    orderBy: { position: "asc" },
    select: { url: true },
  });
  if (own) return own.url;
  const shopWide = await prisma.productImage.findFirst({
    where: { shotType: "lifestyle", product: { shopId } },
    orderBy: { createdAt: "desc" },
    select: { url: true },
  });
  return shopWide?.url ?? null;
}

// Padrão de foto da marca pra TODA imagem gerada — roupa, calçado,
// acessório, com ou sem modelo (Patricia, 06/10/2026, depois de comparar
// as imagens geradas com a foto lifestyle da Senna na Shopify: "estas
// métricas — luz, contraste, paleta, destaque e cena simples — devem valer
// para todas as imagens geradas para roupas e acessórios"). Também é
// conferido pelo check de composição (productProminent, productContrast,
// meetsPhotoStandard), não só pedido aqui.
const PHOTO_STANDARD_BLOCK = `
PHOTO STANDARD — every image must meet all five:
1. Light: soft, warm, directional light (like a lamp or window to one side) falling directly on the product; the rest of the scene can be softer and dimmer.
2. Contrast: the product clearly separates from whatever is right behind and under it — a light wall/floor/surface for a mid-tone or dark product, a darker one only for a light product.
3. Palette: calm, close tones around the product (cream, taupe, sand, caramel, soft brown, stone); nothing saturated or busy competing with it.
4. Prominence: the product is large, sharp and the first thing the eye lands on.
5. Simple scene: few elements, uncluttered, quietly elegant — one or two pieces of furniture or props at most, never a busy room or crowded background.
`;

function retryNoteBlock(note?: string): string {
  return note ? `
A previous attempt at this image was rejected. Fix this: ${note}
` : "";
}

// O nome do produto costuma trazer a cor como nome comercial ("Senna
// Olive") — o modelo lê "olive" e pinta verde-oliva genérico em vez do tom
// real da foto (achado 05/10/2026, bota khaki-oliva acinzentada que voltou
// verde mais saturado).
const COLOR_NAME_WARNING =
  "Any color word in the product name (e.g. \"olive\", \"sand\", \"cognac\") is just the brand's name for this exact shade — match the color you SEE in the reference photo, never a generic idea of that color word.";


export function buildWornOrHandheldPrompt(params: BuildPromptParams): string {
  const { action, environment, framing, light, season } = params.sceneDecision;

  return `This image must be an EXACT REPLICA of the product shown in the reference photo — same shape, color, proportions, materials, and details. Do NOT redesign, restyle, or reinterpret the product in any way.
${params.fidelityConstraintsText}
The product's color must read exactly as in the reference photo — the scene's light and mood are applied to everything around it, never used as a reason to shift the product's hue or tone.
${COLOR_NAME_WARNING}
${merchantDirectionBlock(params.merchantDirection)}${modelProfileBlock(params.modelDescription)}${PHOTO_STANDARD_BLOCK}${retryNoteBlock(params.retryNote)}

Scene: an editorial fashion photograph in a quiet-luxury aesthetic — a model wearing/holding/using the product as the clear hero of the shot. This is NOT a workshop/craftsman/behind-the-scenes shot and must NOT show hands assembling, crafting, or working on the product — only the finished product worn/carried/used by the model.
${params.visualModeGuidance}

The model is ${action.promptText}, in ${environment.promptText}, ${framing.promptText}, under ${light.promptText}.

Styling and composition (this is what separates a real editorial from a generic stock photo — follow all of it):
- Above everything else, the scene must feel calm, tranquil, comfortable, content and elegant — the kind of moment someone would genuinely want to be in. Never rushed, chaotic, staged-looking, or trying too hard. This is the baseline mood for every scene, whatever the season's specific energy on top of it.
- It should read as a real, everyday situation the customer could picture herself in — not an obviously posed photoshoot stance. If the model is holding or touching something (a cup, a railing, a door, furniture), that hand-object interaction must look anatomically real: a natural, relaxed grip, a plausible number of fingers, the object solidly and believably held, never floating or warped.
- The light described above should fall directly ON the product itself, not just on the background.
- Default palette (unless the merchant's direction above asks otherwise): sober and neutral (cream, camel, black, off-white, stone, chocolate) with at most one muted accent color if it helps (dusty pink, olive, khaki, dusty blue) — never a saturated or loud color that competes with the product.
- Include a real, visible touch of nature somewhere in frame — a plant, greenery, ivy, a tree, flowers — even in an architectural or urban setting. Never let the whole frame read as flat stone/concrete/beige with no living element at all.
- Strong contrast between the product and the surface/background immediately behind it, so its silhouette is unmistakable — never a dark product against a dark background or a light product lost against a light one.
- The model's outfit reads as one deliberate, elevated styling idea — an interesting layer, a structured shoulder, a cinched waist, a fabric with real drape or texture — never generic basics (plain blazer-and-jeans, plain t-shirt).${seasonStylingGuidance(season)}
- Any accessories (bags, jewelry, belts, sunglasses) must be plain, neutral, and generic — no visible logos, no distinctive hardware, shape, or design detail that would make it recognizable as a specific real-world brand or a different, unrelated product. Elegant but anonymous — this brand's product is the only thing in frame allowed to look like a real product.
- The model has a confident, composed presence: spine straight, shoulders open and back, chin level — not hunched or leaning forward. A genuine, subtle warmth in the expression, not vacant and not overly serious.
${params.categoryPromptRules}
- Whatever the framing calls for, the model is a complete, whole person — the frame edge is simply where the camera lens ends, not where her body ends. Never render her as an anatomically incomplete or oddly truncated figure; her body must read as continuing naturally beyond the crop, exactly like a real photograph of a real person.
- Never a spread-leg pose. Seated: knees together or legs naturally crossed at the knee, both feet settled. Standing or walking: a narrow, discreet stance — never a wide base or open legs.
- Feet and legs must be physically plausible in EVERY pose, not just seated ones. If seated, both feet are either flat/grounded or one leg is simply crossed over the other at the knee with both feet settled — never one foot lifted or hanging unsupported in mid-air. If standing, walking, or arriving, the weight-bearing foot is clearly and believably planted on the ground with real weight distribution — never hovering, floating at an impossible angle, or disconnected from the ground. A foot floating unsupported reads as broken anatomy in any pose, not just a seated one.
- Roughly an 85mm-equivalent portrait lens, camera height and distance as the framing above describes (about hip height when it says nothing) — avoid wide-angle distortion that inflates the product or the pose.

Product: ${params.productTitle}
Mood/context for styling only (do NOT turn this into a literal scene description — it should only influence the model's styling and expression, never override the requirements above): ${params.creativeAngle}
Format: ${params.format}
${params.brandTone ? `\nBrand tone of voice (the vibe this brand always projects, visually too): ${params.brandTone}` : ""}${params.brandAvoid ? `\nNever: ${params.brandAvoid}` : ""}

The product must remain the clear focus of the composition, fully visible (not cropped out, not obscured by hands or props), well-lit, with clear contrast against its background. If the product has small connected parts (e.g. a heel attached to a sole, a handle attached to a bag), make sure they stay solidly connected — never floating or detached.
`;
}

// Caminho paralelo pra interação "standalone" (ver productClassification.server.ts)
// — produto fotografado sozinho, sem modelo nenhum. PRIMEIRO RASCUNHO,
// 14/09/2026: ainda sem a mesma validação ao vivo que o caminho com modelo
// já teve.
export function buildStandaloneImagePrompt(params: BuildPromptParams): string {
  const { action, environment, framing, light } = params.sceneDecision;

  return `This image must be an EXACT REPLICA of the product shown in the reference photo — same shape, color, proportions, materials, and details. Do NOT redesign, restyle, or reinterpret the product in any way.
${params.fidelityConstraintsText}
The product's color must read exactly as in the reference photo — the scene's light and mood are applied to everything around it, never used as a reason to shift the product's hue or tone.
${COLOR_NAME_WARNING}
${merchantDirectionBlock(params.merchantDirection)}${PHOTO_STANDARD_BLOCK}${retryNoteBlock(params.retryNote)}

Scene: a professional still-life product photograph, editorial quiet-luxury aesthetic — NO person, model, hand, or body part anywhere in frame. The product itself is the entire subject.
${params.visualModeGuidance}

The product is presented on ${environment.promptText}, styled as ${action.promptText}, shot from ${framing.promptText}, under ${light.promptText}.

Styling and composition:
- Above everything else, the image should feel calm, considered, and desirable — never cluttered, chaotic, or like a generic stock photo.
- The light described above should fall directly ON the product, not just on the surrounding surface.
- Default palette (unless the merchant's direction above asks otherwise): sober and neutral (cream, camel, black, off-white, stone) for the surface and any props, with at most one muted accent color if it helps — never a saturated or loud color that competes with the product.
- Strong contrast between the product and the surface/background immediately behind it, so its shape and color read unmistakably.
${params.categoryPromptRules}

Product: ${params.productTitle}
Mood/context for styling only (do NOT turn this into a literal scene description — it should only influence the styling, never override the requirements above): ${params.creativeAngle}
Format: ${params.format}
${params.brandTone ? `\nBrand tone of voice (the vibe this brand always projects, visually too): ${params.brandTone}` : ""}${params.brandAvoid ? `\nNever: ${params.brandAvoid}` : ""}

The product must remain the clear focus of the composition, fully visible (not cropped out, not obscured by a prop), well-lit, with clear contrast against its background. If the product has small connected parts, make sure they stay solidly connected — never floating or detached.
`;
}

function isColorOnlyFailure(result: FidelityCheckResult): boolean {
  return !result.passed && result.failedAxes?.length === 1 && result.failedAxes[0] === "color";
}

// Até 2 votos extras sobre a mesma imagem: passa com 2 aprovações, reprova
// com 2 reprovações (o primeiro voto já conta como uma). Um voto extra que
// reprove outro eixo (forma, material, detalhes) reprova na hora.
async function judgeColorByMajority(
  firstVote: FidelityCheckResult,
  vote: () => Promise<FidelityCheckResult>,
): Promise<FidelityCheckResult> {
  let passes = firstVote.passed ? 1 : 0;
  let fails = firstVote.passed ? 0 : 1;
  let last = firstVote;
  while (passes < 2 && fails < 2) {
    last = await vote();
    if (!last.passed && !isColorOnlyFailure(last)) return last;
    if (last.passed) passes++;
    else fails++;
  }
  return passes >= 2 ? { passed: true, issues: [], failedAxes: [] } : last;
}

function buildColorCorrectionPrompt(productTitle: string): string {
  return `Edit the FIRST image. Change ONLY the color of the product ("${productTitle}") so it exactly matches the product in the SECOND image (the real product photo): the same hue, undertone, saturation and lightness, with the scene's light falling on it naturally. Keep everything else in the first image exactly as it is — the person, pose, outfit, background, framing, composition, lighting, and the product's shape, material, finish and every detail. Do not add, remove or move anything. ${COLOR_NAME_WARNING}`;
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

// "Guarde estas informações na memória" (Patricia, 05/10/2026): o que a
// lojista já pediu ao regenerar ESTE produto continua valendo nas próximas
// gerações dele, não só na regeneração em que ela escreveu. Lido direto de
// GenerationLog.regenerationReason (já gravado desde 24/09/2026) — as 3
// direções distintas mais recentes, com o pedido atual por último e
// marcado como o que manda em caso de conflito.
const MAX_PAST_DIRECTIONS = 3;

export async function loadMerchantDirection(productId: string, currentNote?: string): Promise<string | undefined> {
  const pastLogs = await prisma.generationLog.findMany({
    where: { productId, regenerationReason: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { regenerationReason: true },
    take: 20,
  });
  const current = currentNote?.trim();
  const past: string[] = [];
  for (const { regenerationReason } of pastLogs) {
    const note = regenerationReason?.trim();
    if (!note || note === current || past.includes(note)) continue;
    past.push(note);
    if (past.length === MAX_PAST_DIRECTIONS) break;
  }
  if (!current && past.length === 0) return undefined;

  const pastText = past
    .reverse()
    .map((note) => `- ${note}`)
    .join("\n");
  if (!current) return `Earlier directions for this product (still valid):\n${pastText}`;
  if (!pastText) return current;
  return `Earlier directions for this product (still valid unless the current request says otherwise):\n${pastText}\n\nCurrent request (wins over anything above if they disagree):\n${current}`;
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
  const { interaction, mode } = selectVisualStrategy(
    params.objective,
    classification.validInteractions,
    shop?.imageStylePreference as ImageStylePreference | null,
  );
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

  const merchantDirection = await loadMerchantDirection(params.productId, params.correctionNote);
  // Só no caminho com modelo — still-life tem outra linguagem visual.
  const styleReferenceUrl = hasModel ? await findStyleReferenceUrl(params.shopId, params.productId) : null;
  const modelProfile = parseModelProfile(shop?.modelProfile);
  // Uma modelo por geração — as retentativas da mesma imagem mantêm o
  // mesmo retrato ("vary" sorteia só aqui).
  const modelDescription = hasModel
    ? describeModelWithOverrides(modelProfile, params.regenerationOverrides)
    : undefined;
  let retryNote: string | undefined;
  let usedStructuralRetry = false;
  let fallback: { imageDataUrl: string; model: string; generationLogId: string } | null = null;
  // Tentativas com o produto fiel mas reprovadas por composição/estilo —
  // viram opção pra lojista escolher se nenhuma passar (ver
  // imageCandidates.server.ts). Reprovada por fidelidade nunca entra aqui.
  const candidates: { imageDataUrl: string; generationLogId: string }[] = [];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const promptParams: BuildPromptParams = {
      ...params,
      merchantDirection,
      modelDescription,
      retryNote,
      brandTone: shop?.brandTone,
      brandAvoid: shop?.brandAvoid,
      sceneDecision,
      categoryPromptRules: repertoire.promptRules,
      visualModeGuidance: VISUAL_MODE_GUIDANCE[mode],
      fidelityConstraintsText,
    };
    const prompt = hasModel ? buildWornOrHandheldPrompt(promptParams) : buildStandaloneImagePrompt(promptParams);

    let generated = styleReferenceUrl
      ? await imageProvider.editImage(prompt + STYLE_REFERENCE_BLOCK, [params.referenceImageUrl, styleReferenceUrl])
      : await imageProvider.generateImage(prompt, params.referenceImageUrl);
    let fidelity = await fidelityProvider.checkImageFidelity(
      params.referenceImageUrl,
      generated.imageDataUrl,
      params.productTitle,
      fidelityConstraints,
    );
    // Só a cor reprovada → corrige a cor na própria imagem em vez de jogar
    // a cena fora e refazer (05/10/2026: o Gemini erra o tom do produto com
    // frequência, às vezes num desvio que nem a lojista enxerga; refazer do
    // zero perdia cenas boas e uma tentativa inteira). Mesmo princípio das
    // correções manuais da Mangará: corrigir o detalhe, não refazer a
    // imagem. A versão corrigida passa pelo check de fidelidade de novo —
    // a regra de cor continua sem exceção.
    // 06/10/2026: o julgamento de cor oscila entre rodadas — a mesma
    // imagem reprova e depois passa, e a lojista viu a cor certa onde o
    // check viu errada (3 tentativas perdidas seguidas assim na Senna).
    // Reprovação SÓ de cor pede maioria (2 de 3) antes de valer; se a
    // maioria ainda reprovar, corrige a cor e julga a versão corrigida pela
    // mesma maioria. Qualquer outro eixo reprovado continua valendo de cara.
    const judge = (imageDataUrl: string) =>
      fidelityProvider.checkImageFidelity(params.referenceImageUrl, imageDataUrl, params.productTitle, fidelityConstraints);
    if (isColorOnlyFailure(fidelity)) {
      const majority = await judgeColorByMajority(fidelity, () => judge(generated.imageDataUrl));
      if (majority.passed) {
        fidelity = majority;
      } else if (isColorOnlyFailure(majority)) {
        const recolored = await imageProvider.editImage(buildColorCorrectionPrompt(params.productTitle), [
          generated.imageDataUrl,
          params.referenceImageUrl,
        ]);
        const firstRecoloredVote = await judge(recolored.imageDataUrl);
        const recoloredFidelity = isColorOnlyFailure(firstRecoloredVote)
          ? await judgeColorByMajority(firstRecoloredVote, () => judge(recolored.imageDataUrl))
          : firstRecoloredVote;
        if (recoloredFidelity.passed) {
          generated = recolored;
          fidelity = recoloredFidelity;
        }
      }
    }
    // Só vale checar composição se o produto em si já bateu — não faz
    // sentido avaliar estilo de uma imagem que nem é o produto certo.
    const composition = fidelity.passed
      ? await compositionProvider.checkImageComposition(
          generated.imageDataUrl,
          params.productTitle,
          sceneOptions,
          hasModel,
          merchantDirection,
          modelDescription,
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
    // Nunca com direção da lojista (achado 05/10/2026): ela pediu
    // restaurante, o sorteio tinha escolhido rua, a imagem seguiu o pedido
    // dela — e o retry estrutural mandava refazer NA RUA, brigando com o
    // pedido e queimando 2 tentativas. A direção dela manda no cenário.
    const isStructuralHold =
      passed &&
      !merchantDirection &&
      !usedStructuralRetry &&
      attempt < MAX_ATTEMPTS &&
      hasStructuralMismatch(sceneDecision, composition.observed);

    const generationLog = await prisma.generationLog.create({
      data: {
        contentItemId: params.contentItemId,
        taskType: "image",
        model: generated.model,
        passedFidelityCheck: fidelity.passed,
        // Motivo da reprovação gravado (06/10/2026: 3 tentativas reprovadas
        // na Senna sem registro do porquê, impossível de diagnosticar).
        fidelityIssues: fidelity.passed ? undefined : (fidelity.issues as unknown as object),
        passedCompositionCheck: fidelity.passed ? composition.passed : null,
        // 1 crédito = 1 imagem válida ENTREGUE ao merchant, nunca 1 chamada
        // de API — tentativa rejeitada por qualquer guardrail não é cobrada.
        countsAsCredit: passed && !isStructuralHold,
        // O correctionNote ORIGINAL da lojista (nunca a nota interna de
        // retentativa, `retryNote`) — é o sinal real de "o que ela pediu pra mudar" numa
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
        retryNote = buildStructuralCorrectionNote(sceneDecision, composition.observed!);
        continue;
      }

      return deliverImage(generated.imageDataUrl, generationLog.id, params, shop, attempt);
    }

    if (fidelity.passed) candidates.push({ imageDataUrl: generated.imageDataUrl, generationLogId: generationLog.id });

    // Retentativa não é mais cega (05/10/2026): a próxima tentativa recebe
    // o motivo exato da rejeição — antes ela repetia o mesmo prompt e
    // tendia a errar igual.
    const rejectionIssues = [...fidelity.issues, ...composition.issues];
    retryNote = rejectionIssues.length > 0 ? rejectionIssues.join("; ") : undefined;
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

  const keptCandidates = candidates.slice(-MAX_IMAGE_CANDIDATES);
  for (const candidate of keptCandidates) {
    const imageUrl =
      shop?.applyLogoOverlay && shop.logoUrl
        ? await applyLogoOverlay(candidate.imageDataUrl, shop.logoUrl)
        : candidate.imageDataUrl;
    await prisma.creativeAsset.create({
      data: {
        shopId: params.shopId,
        productId: params.productId,
        imageUrl,
        source: "ai_candidate",
        generationLogId: candidate.generationLogId,
      },
    });
  }

  return {
    status: "fallback",
    reason:
      keptCandidates.length > 0
        ? "None of the AI images passed every quality check. Choose one of the options below or upload your own image."
        : "The AI couldn't generate an image faithful to your product after three attempts. Choose one of the options below or upload your own image.",
    attempts: MAX_ATTEMPTS,
    candidateCount: keptCandidates.length,
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
