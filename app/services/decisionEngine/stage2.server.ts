import { z } from "zod";
import { generateStructuredForTask } from "../ai/index.server";
import type { Stage1Output } from "./stage1.server";
import { CONTENT_LANGUAGES, type ContentLanguageCode } from "./constants";

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
}

const DEFAULT_BRAND_TONE =
  "quiet, confident, warm, never pushy or full of exclamation marks (placeholder — this shop hasn't filled in its brand voice yet)";

// Estágio 2 — só recebe a decisão já pronta do Estágio 1, nunca decide
// estratégia sozinho. Se a loja não preencheu Brand Intelligence ainda
// (onboarding em /app/brand), cai num tom neutro documentado como placeholder.
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
${brand.brandAvoid?.trim() ? `Never say or imply: ${brand.brandAvoid}` : ""}

Write the caption in ${languageLabel}. Follow the narrative framework's structure (${brief.narrativeFramework}) explicitly. Stay within the strength and scope of the sourced claims above — don't expand a specific, bounded claim (e.g. "supports extended wear") into a broader unbounded one (e.g. "all-day comfort" or "built to last for years") unless the evidence above actually supports that scope.`;

  return generateStructuredForTask("creative_copy", stage2Schema, prompt);
}
