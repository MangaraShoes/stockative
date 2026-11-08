import sharp from "sharp";
import { z } from "zod";
import { generateStructuredForTask } from "../ai/index.server";

const MIN_IMAGE_SECONDS = 1.5;
const PREVIEW_EDGE = 512;

export const avatarShotsSchema = z.object({
  shots: z.array(
    z.object({
      sentence: z.number().describe("1-based sentence number"),
      imageNumber: z.number().nullable().describe("1-based image to show, or null to keep the presenter on screen"),
    }),
  ),
});

export interface SentenceSpan {
  text: string;
  start: number;
  end: number;
}

export function splitSentences(script: string): string[] {
  return (script.trim().match(/[^.!?]+[.!?]*/g) ?? []).map((sentence) => sentence.trim()).filter(Boolean);
}

export function buildAvatarShotsPrompt(sentences: string[], imageCount: number): string {
  return `A presenter speaks these sentences in a short vertical product video. We cut to a product photo while she talks. The photos are attached in order, numbered from 1 to ${imageCount}.

${sentences.map((sentence, index) => `${index + 1}. ${sentence}`).join("\n")}

For each sentence, choose the photo that shows what is being said, or null to keep the presenter on screen:
- Sentence 1 and the last sentence are always null.
- What fits inside: a photo of the open interior. How it is worn: a photo of it being worn. Material or details: a close photo of the product.
- The product should be on screen as much as possible: every middle sentence gets a photo. When no photo shows that exact detail, use a photo of the whole product.
- Never use a photo that contradicts the sentence (an interior photo while she talks about how it looks worn, for example). In that case use null.
- Use each photo at most once.

Respond with only the JSON object.`;
}

async function toPreview(image: Buffer): Promise<string> {
  const jpeg = await sharp(image)
    .resize(PREVIEW_EDGE, PREVIEW_EDGE, { fit: "inside" })
    .jpeg({ quality: 80 })
    .toBuffer();
  return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
}

// IA escolhe a foto de cada frase. Falhou: o vídeo segue com os cortes fixos.
export async function planAvatarShots(script: string, images: Buffer[]): Promise<Array<number | null> | null> {
  const sentences = splitSentences(script);
  if (sentences.length < 3 || images.length === 0) return null;
  try {
    const { shots } = await generateStructuredForTask(
      "reel_shot_planning",
      avatarShotsSchema,
      buildAvatarShotsPrompt(sentences, images.length),
      { imageUrls: await Promise.all(images.map(toPreview)) },
    );
    return sentences.map((_, index) => {
      const number = shots.find((shot) => shot.sentence === index + 1)?.imageNumber ?? null;
      return number && number >= 1 && number <= images.length ? number - 1 : null;
    });
  } catch (error) {
    console.error("Failed to plan avatar shots:", error);
    return null;
  }
}

export function parseSilences(ffmpegOutput: string): number[] {
  const middles: number[] = [];
  let start: number | null = null;
  for (const line of ffmpegOutput.split("\n")) {
    const startMatch = /silence_start: ([\d.]+)/.exec(line);
    if (startMatch) start = Number(startMatch[1]);
    const endMatch = /silence_end: ([\d.]+)/.exec(line);
    if (endMatch && start !== null) {
      middles.push((start + Number(endMatch[1])) / 2);
      start = null;
    }
  }
  return middles;
}

// Tempo de cada frase pelo tamanho do texto, ajustado à pausa real mais próxima:
// o corte cai entre duas frases, não no meio de uma palavra.
export function sentenceSpans(sentences: string[], durationSec: number, silences: number[]): SentenceSpan[] {
  const totalChars = sentences.reduce((sum, sentence) => sum + sentence.length, 0) || 1;
  let chars = 0;
  let previous = 0;
  return sentences.map((text, index) => {
    chars += text.length;
    let end = index === sentences.length - 1 ? durationSec : (chars / totalChars) * durationSec;
    if (index < sentences.length - 1) {
      const estimate = end;
      const pause = silences
        .filter((silence) => silence > previous && Math.abs(silence - estimate) <= 1.2)
        .sort((a, b) => Math.abs(a - estimate) - Math.abs(b - estimate))[0];
      if (pause !== undefined) end = pause;
    }
    const span = { text, start: previous, end };
    previous = end;
    return span;
  });
}

export interface ShotSegment {
  kind: "avatar" | "image" | "split";
  start: number;
  end: number;
  imageIndex?: number;
}

export function segmentsFromShots(spans: SentenceSpan[], shots: Array<number | null>): ShotSegment[] {
  const segments: ShotSegment[] = [];
  const used = new Set<number>();
  spans.forEach((span, index) => {
    const isEdge = index === 0 || index === spans.length - 1;
    const picked = shots[index];
    const canShow =
      !isEdge && picked !== null && picked !== undefined && !used.has(picked) && span.end - span.start >= MIN_IMAGE_SECONDS;
    if (canShow) {
      used.add(picked);
      segments.push({ kind: "image", start: span.start, end: span.end, imageIndex: picked });
      return;
    }
    const last = segments[segments.length - 1];
    if (last?.kind === "avatar") last.end = span.end;
    else segments.push({ kind: "avatar", start: span.start, end: span.end });
  });
  return segments;
}
