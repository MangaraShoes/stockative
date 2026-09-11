import { z } from "zod";
import type {
  AIProvider,
  CompositionCheckResult,
  FidelityCheckResult,
  GenerateImageResult,
  GenerateStructuredResult,
  GenerateTextResult,
} from "./types.server";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

type MessageContent =
  | string
  | ({ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } })[];

interface Message {
  role: string;
  content: MessageContent;
}

interface OpenRouterResponse {
  choices: {
    message: {
      content: string;
      images?: { type: string; image_url: { url: string } }[];
    };
  }[];
  usage?: { total_tokens?: number };
}

const fidelityCheckSchema = z.object({
  passed: z.boolean(),
  issues: z.array(z.string()),
});

// Adaptador do AI Provider Layer que fala com o OpenRouter (openrouter.ai) —
// um intermediário que dá acesso a vários modelos (Claude, GPT, Gemini) por
// uma API só, no formato compatível com a API da OpenAI.
export class OpenRouterProvider implements AIProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  private async request(body: Record<string, unknown>): Promise<OpenRouterResponse> {
    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: this.model, ...body }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `OpenRouter request failed (${response.status}): ${errorBody}`,
      );
    }

    return (await response.json()) as OpenRouterResponse;
  }

  private async chat(messages: Message[]) {
    return this.request({ messages, response_format: { type: "json_object" } });
  }

  async generateText(prompt: string): Promise<GenerateTextResult> {
    const json = await this.request({
      messages: [{ role: "user", content: prompt }],
    });

    return {
      text: json.choices[0]?.message.content ?? "",
      model: this.model,
      tokensUsed: json.usage?.total_tokens ?? null,
    };
  }

  async generateStructured<T>(
    schema: z.ZodType<T>,
    prompt: string,
    options?: { imageUrls?: string[] },
  ): Promise<GenerateStructuredResult<T>> {
    const jsonSchema = z.toJSONSchema(schema);

    const systemPrompt = `You must respond with a single JSON object that conforms exactly to this JSON Schema, and nothing else (no prose, no markdown fences):\n\n${JSON.stringify(jsonSchema)}`;

    const userContent: MessageContent = options?.imageUrls?.length
      ? [
          { type: "text", text: prompt },
          ...options.imageUrls.map(
            (url) => ({ type: "image_url" as const, image_url: { url } }),
          ),
        ]
      : prompt;

    const json = await this.chat([
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ]);

    const data = parseJsonResponse(json.choices[0]?.message.content ?? "{}", schema);

    return {
      data,
      model: this.model,
      tokensUsed: json.usage?.total_tokens ?? null,
    };
  }

  async generateImage(
    prompt: string,
    referenceImageUrl: string,
  ): Promise<GenerateImageResult> {
    const json = await this.request({
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: referenceImageUrl } },
          ],
        },
      ],
      modalities: ["image", "text"],
    });

    const imageUrl = json.choices[0]?.message.images?.[0]?.image_url.url;
    if (!imageUrl) {
      throw new Error(
        `Model did not return an image. Raw response: ${JSON.stringify(json)}`,
      );
    }

    return { imageDataUrl: imageUrl, model: this.model };
  }

  async checkImageFidelity(
    referenceImageUrl: string,
    generatedImageDataUrl: string,
    productDescription: string,
  ): Promise<FidelityCheckResult> {
    const systemPrompt = `You must respond with a single JSON object that conforms exactly to this JSON Schema, and nothing else (no prose, no markdown fences):\n\n${JSON.stringify(z.toJSONSchema(fidelityCheckSchema))}`;

    const prompt = `Compare these two product images. The FIRST is the original real product photo. The SECOND is an AI-generated recreation of the same product ("${productDescription}") in a new scene.

Check ONLY product fidelity — does the second image show the EXACT SAME product (same shape, color, proportions, materials, details)? Ignore differences in background, scene, model/person, lighting style — those are supposed to differ. Fail it only for real product mismatches: wrong color, wrong proportions, a detached or malformed part (e.g. a heel that looks disconnected from the shoe), missing or invented details.

Set passed=false if there is a real product mismatch, and list the specific issues.`;

    const json = await this.chat([
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: referenceImageUrl } },
          { type: "image_url", image_url: { url: generatedImageDataUrl } },
        ],
      },
    ]);

    return parseJsonResponse(
      json.choices[0]?.message.content ?? "{}",
      fidelityCheckSchema,
    );
  }

  // Guardrail de composição/estilo — roda em toda loja que usa o app, não só
  // a Mangará (Patricia, 10/09/2026, depois de ver uma imagem tecnicamente
  // correta mas "básica e sem graça"). O checkImageFidelity acima só garante
  // que o PRODUTO bate com o original; este garante que a CENA parece uma
  // campanha editorial de verdade, não uma foto de banco de imagens genérica
  // — os critérios espelham as regras de estilo em generateProductImage.server.ts.
  async checkImageComposition(
    generatedImageDataUrl: string,
    productDescription: string,
  ): Promise<CompositionCheckResult> {
    const systemPrompt = `You must respond with a single JSON object that conforms exactly to this JSON Schema, and nothing else (no prose, no markdown fences):\n\n${JSON.stringify(z.toJSONSchema(fidelityCheckSchema))}`;

    const prompt = `Assess this AI-generated product photo of "${productDescription}" against the editorial fashion-photography standard used for this brand's campaigns.

HARD VETOES — check these first, on their own, before anything else. If either applies, you MUST set passed=false, even if the lighting and styling are otherwise excellent — these override every other criterion below.

1. Is this a workshop/craftsman/behind-the-scenes shot showing hands assembling, crafting, weaving, or working on the product (raw materials, tools, a workbench)? If yes, issue "workshop/craftsman shot". This brand's photos are always the FINISHED product worn/carried by a model, never the making-of process.
2. If a model is seated and both feet are visible, is either foot lifted or hanging unsupported in mid-air, not resting on the ground or settled against the other leg? If yes, issue "unnatural floating foot" — nobody sits still with a foot floating like that; it reads as broken anatomy, not a candid pose.

If it clears both vetoes, then also assess:
1. Light: warm, natural/soft golden light falling directly on the product — not flat, generic studio lighting.
2. Contrast: strong, clear contrast between the product and its immediate background/surface, so its silhouette reads clearly.
3. Styling: the outfit/setting reads as one deliberate, elevated idea (an interesting layer, texture, or structure) — not generic basics, and not a flat/boring composition.
4. Presence: if a model is shown, their pose and expression are confident and composed, not stiff, vacant, or slouched.
5. Product visibility: the product is the clear hero, fully visible, not obscured by hands, props, or awkward cropping.

Set passed=false if the image reads as generic, flat, "stock photo" boring, or fails any of the above — even when nothing is technically wrong with the product itself. List the specific issues (e.g. "flat lighting", "outfit reads as generic basics", "background doesn't contrast with product").`;

    const json = await this.chat([
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: generatedImageDataUrl } },
        ],
      },
    ]);

    return parseJsonResponse(
      json.choices[0]?.message.content ?? "{}",
      fidelityCheckSchema,
    );
  }
}

function parseJsonResponse<T>(rawContent: string, schema: z.ZodType<T>): T {
  // Alguns modelos devolvem o JSON envolto em blocos de código markdown
  // (```json ... ```) mesmo quando instruídos a não fazer isso — remove
  // isso antes de tentar interpretar como JSON.
  const cleanedContent = rawContent
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleanedContent);
  } catch {
    throw new Error(
      `Model did not return valid JSON for structured output: ${rawContent}`,
    );
  }

  return schema.parse(parsed);
}
