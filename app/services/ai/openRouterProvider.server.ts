import { z } from "zod";
import type {
  AIProvider,
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
  ): Promise<GenerateStructuredResult<T>> {
    const jsonSchema = z.toJSONSchema(schema);

    const systemPrompt = `You must respond with a single JSON object that conforms exactly to this JSON Schema, and nothing else (no prose, no markdown fences):\n\n${JSON.stringify(jsonSchema)}`;

    const json = await this.chat([
      { role: "system", content: systemPrompt },
      { role: "user", content: prompt },
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
