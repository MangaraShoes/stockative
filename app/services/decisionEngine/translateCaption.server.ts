import { z } from "zod";
import { looksEnglish, toSingleParagraph } from "./captionFormat";
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
): Promise<string | null> {
  const languageLabel =
    CONTENT_LANGUAGES.find((l) => l.code === targetLanguage)?.label ?? targetLanguage;

  const prompt = buildTranslationPrompt(captionText, languageLabel);

  for (let attempt = 0; attempt < 3; attempt++) {
    // Modelo às vezes devolve o texto puro em vez de JSON: conta como tentativa
    // falha, não pode derrubar o plano da semana.
    const result = await generateStructuredForTask("translation", translationSchema, prompt).catch(
      (error: unknown) => {
        console.warn(`[translation] attempt ${attempt + 1} failed:`, error);
        return null;
      },
    );
    if (!result) continue;
    const translated = toSingleParagraph(result.translatedText);
    if (targetLanguage === "en" || !looksEnglish(translated)) return translated;
    console.warn(`[translation] came back in English instead of ${languageLabel}, attempt ${attempt + 1}`);
  }
  // Melhor só o idioma principal do que um bloco no idioma errado.
  return null;
}

export function buildTranslationPrompt(captionText: string, languageLabel: string): string {
  return `Translate this social media caption into ${languageLabel}. This is a professional marketing translation — preserve the tone, structure, and persuasive intent exactly, and keep it as one single continuous paragraph with no line breaks; don't translate word-for-word if that would sound stiff. Don't add or remove content, don't add hashtags.

Never use an em dash (—) anywhere in the translation, even if the original caption has one. Use a comma, period, colon, or parentheses instead.

Use only real, everyday words of ${languageLabel}. Never coin or borrow a word: if there is no natural equivalent, rephrase.

Caption:
${captionText}

Respond with only the JSON object, with the translation in "translatedText". No plain text.`;
}

// Monta a legenda final — só o idioma principal, ou principal seguido do
// secundário traduzido no mesmo post (mesmo padrão que a Mangará já usa de
// verdade no Instagram: legenda completa em FR, depois a mesma legenda
// completa em NL, uma abaixo da outra).
export function buildBilingualCaption(primaryCaption: string, secondaryCaption: string | null): string {
  if (!secondaryCaption) return primaryCaption;
  return `${primaryCaption}\n\n${secondaryCaption}`;
}
