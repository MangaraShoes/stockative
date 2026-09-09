import { z } from "zod";
import type {
  AIProvider,
  GenerateStructuredResult,
  GenerateTextResult,
} from "./types.server";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

interface OpenRouterResponse {
  choices: { message: { content: string } }[];
  usage?: { total_tokens?: number };
}

// Adaptador do AI Provider Layer que fala com o OpenRouter (openrouter.ai) —
// um intermediário que dá acesso a vários modelos (Claude, GPT, Gemini) por
// uma API só, no formato compatível com a API da OpenAI.
export class OpenRouterProvider implements AIProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  private async chat(messages: { role: string; content: string }[]) {
    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `OpenRouter request failed (${response.status}): ${errorBody}`,
      );
    }

    return (await response.json()) as OpenRouterResponse;
  }

  async generateText(prompt: string): Promise<GenerateTextResult> {
    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `OpenRouter request failed (${response.status}): ${errorBody}`,
      );
    }

    const json = (await response.json()) as OpenRouterResponse;

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

    const rawContent = json.choices[0]?.message.content ?? "{}";
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

    const data = schema.parse(parsed);

    return {
      data,
      model: this.model,
      tokensUsed: json.usage?.total_tokens ?? null,
    };
  }
}
