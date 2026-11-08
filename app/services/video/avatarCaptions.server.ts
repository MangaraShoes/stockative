import { z } from "zod";
import { generateStructuredForTask } from "../ai/index.server";
import { looksEnglish } from "../decisionEngine/captionFormat";
import { CONTENT_LANGUAGES } from "../decisionEngine/constants";

const captionsSchema = z.object({ sentences: z.array(z.string()) });

// O avatar fala no idioma principal da loja e a legenda na tela sai no
// segundo idioma, uma frase por vez (Patricia, 08/11/2026: fala em FR,
// legenda em NL). Assim o Reel serve aos dois públicos. Sem segundo idioma,
// ou se a tradução falhar, o Reel fica só com o gancho de antes.
export async function translateReelCaptions(
  sentences: string[],
  targetLanguage: string | null | undefined,
  primaryLanguage: string | null | undefined,
): Promise<string[] | null> {
  if (!targetLanguage || targetLanguage === primaryLanguage || sentences.length === 0) return null;
  const languageLabel = CONTENT_LANGUAGES.find((lang) => lang.code === targetLanguage)?.label ?? targetLanguage;
  const prompt = buildReelCaptionsPrompt(sentences, languageLabel);

  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await generateStructuredForTask("translation", captionsSchema, prompt).catch((error: unknown) => {
      console.warn(`[reel captions] attempt ${attempt + 1} failed:`, error);
      return null;
    });
    // Uma legenda por frase falada, senão a legenda sai fora de tempo.
    if (!result || result.sentences.length !== sentences.length) continue;
    const captions = result.sentences.map((sentence) => sentence.replace(/\s+/g, " ").trim());
    if (captions.some((caption) => !caption)) continue;
    if (targetLanguage !== "en" && captions.some(looksEnglish)) continue;
    return captions;
  }
  return null;
}

export function buildReelCaptionsPrompt(sentences: string[], languageLabel: string): string {
  return `These are the sentences a presenter speaks in a short vertical product video. Translate each one into ${languageLabel} for the subtitles on screen.

${sentences.map((sentence, index) => `${index + 1}. ${sentence}`).join("\n")}

- Exactly one translated sentence for each numbered sentence, in the same order (${sentences.length} in total). Never merge or split sentences.
- Natural, short subtitle language. Keep the meaning and tone, not word for word.
- Use only real, everyday words of ${languageLabel}. Never coin or borrow a word.
- Never use an em dash (—).

Respond with only the JSON object, with the translations in "sentences".`;
}
