import { z } from "zod";
import { generateStructuredForTask } from "../ai/index.server";
import type { Stage1Output } from "./stage1.server";
import { CONTENT_LANGUAGES, type ContentLanguageCode } from "./constants";
import { stripFrameworkLabels, toSingleParagraph } from "./captionFormat";
import { findUnsupportedClaims, type ClaimSources } from "./claimCheck.server";

const stage2Schema = z.object({
  captionText: z.string().describe("The full social media caption, ready to post"),
  hashtags: z.array(z.string()).describe("3-6 relevant hashtags, without the # symbol"),
  cta: z.string().describe("Final call-to-action line"),
});

export type Stage2Output = z.infer<typeof stage2Schema>;

export interface BrandVoice {
  brandDescription: string | null;
  brandTone: string | null;
  brandAvoid: string | null;
  // describeProductLine(): vazio quando a loja não configurou linhas.
  productLineNote: string;
}

const DEFAULT_BRAND_TONE =
  "quiet, confident, warm, never pushy or full of exclamation marks (placeholder — this shop hasn't filled in its brand voice yet)";

// Estágio 2 — só recebe a decisão já pronta do Estágio 1, nunca decide
// estratégia sozinho. Se a loja não preencheu Brand Intelligence ainda
// (onboarding em /app/store-voice), cai num tom neutro documentado como placeholder.
//
// evidenceSummary vem de describeEvidence() (stage1.server.ts) — resumo
// determinístico do que é real, não julgado por IA nenhuma vez (Patricia,
// 11/09/2026: "Evidence is not carried through into final-copy validation"
// — antes o Estágio 2 só via o brief e podia embelezar um ângulo cauteloso
// até virar alegação forte demais, sem nada que o impedisse de novo aqui).
export async function generateCreativeCopy(
  brief: Stage1Output,
  language: ContentLanguageCode,
  brand: BrandVoice,
  evidenceSummary: string,
  maxCaptionChars: number,
  // Só em "Regenerate caption only": a legenda anterior e o motivo que a
  // lojista deu pra rejeitá-la — sem isso a IA reescreve às cegas e pode
  // repetir exatamente o que ela não gostou.
  revision?: { previousCaption: string; feedback: string },
): Promise<Stage2Output> {
  const languageLabel =
    CONTENT_LANGUAGES.find((l) => l.code === language)?.label ?? "English";

  const brandVoiceText = brand.brandTone?.trim()
    ? brand.brandTone
    : DEFAULT_BRAND_TONE;

  const prompt = `Write the final social media post copy based on this content strategy brief. Follow the brief exactly — do not change the strategy, only execute it in writing.

Hard length limit: captionText must be at most ${maxCaptionChars} characters — Instagram rejects the whole post at publish time if the final caption (which may include a second-language translation appended after this text, plus CTA and hashtags) exceeds 2200 characters total. This is a hard requirement, not a stylistic preference — a shorter, tighter caption that respects this limit is strictly better than a longer one that gets rejected.

Brief:
- Product: ${brief.product}
- Audience: ${brief.audience}
- Reason: ${brief.reason}
- Channel: ${brief.channel}
- Funnel stage: ${brief.funnelStage}
- Creative archetype: ${brief.creativeArchetype}
- Creative angle: ${brief.creativeAngle}
- Narrative framework: ${brief.narrativeFramework}
- CTA: ${brief.cta}

Evidence available for this post — do not state anything beyond what this says is available, even if the creative angle above gestures at it:
${evidenceSummary}

Brand voice: ${brandVoiceText}
${brand.brandDescription?.trim() ? `Brand description: ${brand.brandDescription}` : ""}
${brand.productLineNote}
${brand.brandAvoid?.trim() ? `Never say or imply: ${brand.brandAvoid}` : ""}

Write the caption in ${languageLabel}. Follow the narrative framework's structure (${brief.narrativeFramework}), but never write the names of its stages in the caption (no "Before:", "After:", "Hook:" or their equivalents in any language) — the reader should feel the structure, not see it labeled. Write captionText as one single continuous paragraph, with no line breaks or blank lines. Stay within the strength and scope of the sourced claims above — don't expand a specific, bounded claim (e.g. "supports extended wear") into a broader unbounded one (e.g. "all-day comfort" or "built to last for years") unless the evidence above actually supports that scope.

Never use an em dash (—) anywhere in the caption. Use a comma, period, colon, or parentheses instead.${
    revision
      ? `

The merchant rejected a previous version of this caption. Write a clearly different one that fixes their complaint, while still following the brief, evidence and brand voice above.
Their reason: ${revision.feedback}
Previous caption (don't reuse its wording):
${revision.previousCaption}`
      : ""
  }`;

  const copy = await generateStructuredForTask("creative_copy", stage2Schema, prompt);
  return { ...copy, captionText: toSingleParagraph(stripFrameworkLabels(copy.captionText)) };
}

const MAX_CLAIM_REWRITES = 2;

// Toda legenda passa por aqui: reprovada na checagem de origem/autoria, é
// reescrita com o motivo. Nunca devolve legenda reprovada, porque o post pode
// sair sozinho depois. Melhor o erro aparecer do que publicar alegação falsa.
export async function generateVerifiedCopy(
  brief: Stage1Output,
  language: ContentLanguageCode,
  brand: BrandVoice,
  evidenceSummary: string,
  maxCaptionChars: number,
  claimSources: Omit<ClaimSources, "brandDescription" | "productLineNote">,
  revision?: { previousCaption: string; feedback: string },
): Promise<Stage2Output> {
  const sources: ClaimSources = {
    ...claimSources,
    brandDescription: brand.brandDescription,
    productLineNote: brand.productLineNote,
  };
  let currentRevision = revision;
  for (let attempt = 0; attempt <= MAX_CLAIM_REWRITES; attempt++) {
    const copy = await generateCreativeCopy(
      brief,
      language,
      brand,
      evidenceSummary,
      maxCaptionChars,
      currentRevision,
    );
    const violations = await findUnsupportedClaims(copy, sources);
    if (violations.length === 0) return copy;

    console.warn(`[claim-check] ${claimSources.productTitle}: ${violations.join(" | ")}`);
    currentRevision = {
      previousCaption: copy.captionText,
      feedback: `${revision ? `${revision.feedback} Also: ` : ""}remove these claims, from the caption and the hashtags, and do not replace them with similar ones: ${violations.join("; ")}`,
    };
  }
  throw new Error(
    `Could not write a caption for "${claimSources.productTitle}" without unsupported claims. Check this product's facts in Store voice.`,
  );
}

const avatarScriptSchema = z.object({
  script: z.string().describe("The exact words the presenter says, as plain spoken text"),
});

// Roteiro falado (vídeo com avatar). Mesma checagem da legenda: é a voz de uma
// pessoa real dizendo isso em público.
export async function generateVerifiedAvatarScript(
  brief: Stage1Output,
  language: ContentLanguageCode,
  brand: BrandVoice,
  evidenceSummary: string,
  claimSources: Omit<ClaimSources, "brandDescription" | "productLineNote">,
): Promise<string> {
  const languageLabel =
    CONTENT_LANGUAGES.find((l) => l.code === language)?.label ?? "English";
  const sources: ClaimSources = {
    ...claimSources,
    brandDescription: brand.brandDescription,
    productLineNote: brand.productLineNote,
    checkProductFacts: true,
  };
  let feedback = "";
  for (let attempt = 0; attempt <= MAX_CLAIM_REWRITES; attempt++) {
    // Patricia, 08/11/2026: o avatar soava como quem lê a ficha do produto.
    // Agora fala como uma amiga recomendando, uma ideia visível por frase (o
    // corte para a foto certa depende disso), e cria desejo pelo momento de uso.
    const prompt = `Write what the brand's founder says on camera in a vertical social video of about 20 seconds, in ${languageLabel}. At most 280 characters, 4 or 5 short spoken sentences.

It must sound like a friend telling you about something she loves, not like an ad being read:
- Sentence 1 is a hook of at most 50 characters built from a moment or a feeling the viewer knows (a situation, a small frustration, a question). Never open with the speaker's name, the brand name or the product name.
- Each middle sentence carries one idea about something you can see in the product (the leather, the closure, the pocket, how it looks worn), and says what it does for the person in that moment, not just what it is. One idea per sentence.
- Make the viewer picture herself using it: when, where, with what. That is where the desire comes from. Only mention urgency or low stock if the evidence below says so.
- The last sentence is a short, relaxed call to action to the link in bio.
- Mix short and slightly longer sentences, use everyday spoken words and contractions where the language has them. A small honest opinion is fine.
- Never use ad clichés such as discover, elevate, timeless, must-have, iconic, perfect for every occasion, or their equivalents in ${languageLabel}.

Facts: use only what the description and evidence state. Keep their meaning for materials and construction, never add a function they don't state. If the sources say where it is made, say so once.

No hashtags, emojis, stage directions, labels or em dashes. Never say the speaker personally owns, uses or designed the product, since that isn't known. The call to action points to the link in bio, never to a physical store.

Product: ${claimSources.productTitle}
Product description: ${claimSources.productDescription ?? "(none)"}
Audience: ${brief.audience}
Creative angle: ${brief.creativeAngle}

Evidence available for this post. Do not state anything beyond it:
${evidenceSummary}

Brand description: ${brand.brandDescription ?? "(none)"}
${brand.productLineNote}
${brand.brandAvoid?.trim() ? `Never say or imply: ${brand.brandAvoid}` : ""}${feedback}

Respond with only the JSON object, with the spoken text in "script".`;
    const { script } = await generateStructuredForTask("creative_copy", avatarScriptSchema, prompt);
    const cleaned = toSingleParagraph(script);
    const violations = await findUnsupportedClaims({ captionText: cleaned, hashtags: [], cta: "" }, sources);
    if (violations.length === 0) return cleaned;
    feedback = `\n\nA previous version was rejected. Remove these claims and do not replace them with similar ones: ${violations.join("; ")}`;
  }
  throw new Error(`Could not write a script for "${claimSources.productTitle}" without unsupported claims.`);
}

