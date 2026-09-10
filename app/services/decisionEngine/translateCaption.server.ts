import { z } from "zod";
import { generateStructuredForTask } from "../ai/index.server";
import { CONTENT_LANGUAGES, type ContentLanguageCode } from "./constants";

const translationSchema = z.object({
  translatedText: z.string(),
});

// Traduz uma legenda já pronta — nunca decide estratégia de novo, só
// converte pro segundo idioma configurado da loja (Patricia, 10/09/2026, ver
// "Idioma(s) de publicação" em prisma/schema.prisma). Usa o taskType
// `translation` que já existia no AI Provider Layer desde o início do
// projeto mas nunca tinha sido de fato ligado a nada.
export async function translateCaption(
  captionText: string,
  targetLanguage: ContentLanguageCode,
): Promise<string> {
  const languageLabel =
    CONTENT_LANGUAGES.find((l) => l.code === targetLanguage)?.label ?? targetLanguage;

  const prompt = `Translate this social media caption into ${languageLabel}. This is a professional marketing translation — preserve the tone, structure, line breaks, and persuasive intent exactly; don't translate word-for-word if that would sound stiff. Don't add or remove content, don't add hashtags.

Caption:
${captionText}`;

  const result = await generateStructuredForTask("translation", translationSchema, prompt);
  return result.translatedText;
}

// Monta a legenda final — só o idioma principal, ou principal seguido do
// secundário traduzido no mesmo post (mesmo padrão que a Mangará já usa de
// verdade no Instagram: legenda completa em FR, depois a mesma legenda
// completa em NL, uma abaixo da outra).
export function buildBilingualCaption(primaryCaption: string, secondaryCaption: string | null): string {
  if (!secondaryCaption) return primaryCaption;
  return `${primaryCaption}\n\n${secondaryCaption}`;
}
