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
export async function generateCreativeCopy(
  brief: Stage1Output,
  language: ContentLanguageCode,
  brand: BrandVoice,
): Promise<Stage2Output> {
  const languageLabel =
    CONTENT_LANGUAGES.find((l) => l.code === language)?.label ?? "English";

  const brandVoiceText = brand.brandTone?.trim()
    ? brand.brandTone
    : DEFAULT_BRAND_TONE;

  const prompt = `Write the final social media post copy based on this content strategy brief. Follow the brief exactly — do not change the strategy, only execute it in writing.

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

Brand voice: ${brandVoiceText}
${brand.brandDescription?.trim() ? `Brand description: ${brand.brandDescription}` : ""}
${brand.brandAvoid?.trim() ? `Never say or imply: ${brand.brandAvoid}` : ""}

Write the caption in ${languageLabel}. Follow the narrative framework's structure (${brief.narrativeFramework}) explicitly.`;

  return generateStructuredForTask("creative_copy", stage2Schema, prompt);
}
