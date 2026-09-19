import { z } from "zod";
import type {
  AIProvider,
  CompositionCheckResult,
  FidelityCheckResult,
  GenerateImageResult,
  GenerateStructuredResult,
  GenerateTextResult,
  SceneOptions,
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

// Schema dinâmico pra classificação observada (Patricia, 12/09/2026, piloto
// de diversidade criativa) — "unknown"/"not_applicable" sempre aceitos,
// além das opções reais do repertório passado por quem chama, pra nunca
// forçar o avaliador a inventar uma pose/ambiente que não deu pra ver.
const OBSERVED_FALLBACK = ["unknown", "not_applicable"] as const;

// z.enum exige uma tupla não vazia no tipo (`[string, ...string[]]`), mas
// os arrays aqui são montados dinamicamente por spread — o TS não consegue
// provar que o resultado nunca é vazio. Sempre tem pelo menos os 2 valores
// de OBSERVED_FALLBACK, então isso nunca lança em tempo de execução.
function toEnumTuple(values: string[]): [string, ...string[]] {
  if (values.length === 0) throw new Error("Expected at least one enum value.");
  return values as [string, ...string[]];
}

function buildCompositionCheckSchema(sceneOptions?: SceneOptions) {
  if (!sceneOptions) {
    return z.object({ passed: z.boolean(), issues: z.array(z.string()) });
  }
  return z.object({
    passed: z.boolean(),
    issues: z.array(z.string()),
    observed: z.object({
      action: z.enum(toEnumTuple([...sceneOptions.actions, ...OBSERVED_FALLBACK])),
      environment: z.enum(toEnumTuple([...sceneOptions.environments, ...OBSERVED_FALLBACK])),
      framing: z.enum(toEnumTuple([...sceneOptions.framings, ...OBSERVED_FALLBACK])),
      light: z.string(), // luz não é restrita a enum — não entra na exigência de diversidade
    }),
  });
}

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
    constraints?: { preserve: string[]; neverAlter: string[] },
  ): Promise<FidelityCheckResult> {
    const systemPrompt = `You must respond with a single JSON object that conforms exactly to this JSON Schema, and nothing else (no prose, no markdown fences):\n\n${JSON.stringify(z.toJSONSchema(fidelityCheckSchema))}`;

    // `constraints` (ver fidelityConstraints.server.ts) dá uma checklist
    // explícita além do julgamento geral abaixo — não substitui o
    // julgamento, complementa: a lista nunca cobre tudo que pode dar
    // errado, e o julgamento geral nunca é preciso o bastante sozinho.
    const constraintsInstructions = constraints
      ? `\n\nAlso specifically verify this checklist:\n${constraints.preserve.map((p) => `- Preserved: ${p}`).join("\n")}\n${constraints.neverAlter.map((n) => `- Must NOT be true: ${n}`).join("\n")}`
      : "";

    const prompt = `Compare these two product images. The FIRST is the original real product photo. The SECOND is an AI-generated recreation of the same product ("${productDescription}") in a new scene.

Check ONLY product fidelity — does the second image show the EXACT SAME product (same shape, color, proportions, materials, details)? Ignore differences in background, scene, model/person, lighting style — those are supposed to differ. Fail it only for real product mismatches: wrong color, wrong proportions, a detached or malformed part (e.g. a heel that looks disconnected from the shoe), missing or invented details.

Set passed=false if there is a real product mismatch, and list the specific issues.${constraintsInstructions}`;

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
    sceneOptions?: SceneOptions,
    hasModel: boolean = true,
  ): Promise<CompositionCheckResult> {
    const compositionCheckSchema = buildCompositionCheckSchema(sceneOptions);
    const systemPrompt = `You must respond with a single JSON object that conforms exactly to this JSON Schema, and nothing else (no prose, no markdown fences):\n\n${JSON.stringify(z.toJSONSchema(compositionCheckSchema))}`;

    const observedInstructions = sceneOptions
      ? `\n\nAlso classify what the image ACTUALLY shows (not what was requested — you don't know what was requested), as the "observed" object:
- action: pick the closest match from [${sceneOptions.actions.join(", ")}], or "not_applicable" if ${hasModel ? "no person/legs are visible" : "genuinely nothing in the image resembles any of these"}, or "unknown" if visible but genuinely unclear.
- environment: pick the closest match from [${sceneOptions.environments.join(", ")}], or "unknown" if it doesn't clearly match any.
- framing: pick the closest match from [${sceneOptions.framings.join(", ")}], or "unknown" if unclear.
- light: describe the lighting in a few words (free text, no fixed list).
Never guess or force a match — "unknown"/"not_applicable" are correct answers when the image genuinely doesn't show enough to tell.`
      : "";

    // `hasModel=false` é still-life puro (ver productClassification.server.ts,
    // paradigm "standalone") — os vetos e critérios de pose/mãos/corpo do
    // caminho com modelo simplesmente não se aplicam, e ganham um veto
    // próprio (nenhuma pessoa pode aparecer).
    const prompt = hasModel
      ? `Assess this AI-generated product photo of "${productDescription}" against the editorial fashion-photography standard used for this brand's campaigns.

HARD VETOES — check these first, on their own, before anything else. If any applies, you MUST set passed=false, even if the lighting and styling are otherwise excellent — these override every other criterion below.

1. Is this a workshop/craftsman/behind-the-scenes shot showing hands assembling, crafting, weaving, or working on the product (raw materials, tools, a workbench)? If yes, issue "workshop/craftsman shot". This brand's photos are always the FINISHED product worn/carried by a model, never the making-of process.
2. Check physical plausibility of the feet/legs in ANY pose, not just seated: if seated, is either foot lifted or hanging unsupported in mid-air instead of resting on the ground or settled against the other leg? If standing, walking, or arriving, is the weight-bearing foot clearly and realistically planted, with believable weight distribution — not hovering with no visible support, floating at an impossible angle, or disconnected from the ground plane? If either applies, issue "unnatural floating foot" — this is a real anatomy failure regardless of which pose it happens in, not something limited to sitting.
3. Are the legs shown in a spread/open pose (wide stance standing, or knees apart while seated)? If yes, issue "spread-leg pose" — this brand never shows that pose, regardless of how well it shows the product. Seated poses must have knees together or legs naturally crossed; standing/walking poses must use a narrow, discreet stance.
4. Is any accessory (bag, jewelry, sunglasses, belt) rendered with a visible logo, distinctive hardware, or a shape/design so specific it reads as an identifiable real-world brand or a different product? If yes, issue "branded accessory" — every accessory in frame must look plain and generic; only this brand's own product is allowed to look like a real product.
5. If a person is shown, does her body read as anatomically incomplete or oddly truncated — e.g. the frame cuts her off in a way that looks like she has no torso/upper body, rather than a normal, believable photographic crop of a whole person? A tight or waist-down crop is fine WHEN it reads like an intentional photo of a complete person continuing beyond the frame; it fails when the cut looks like the body itself ends there. If it looks incomplete/truncated, issue "incomplete or truncated body".

If it clears all vetoes, then also assess:
1. Light: warm, natural/soft golden light falling directly on the product — not flat, generic studio lighting.
2. Contrast: strong, clear contrast between the product and its immediate background/surface, so its silhouette reads clearly.
3. Styling: the outfit/setting reads as one deliberate, elevated idea (an interesting layer, texture, or structure) — not generic basics, and not a flat/boring composition.
4. Presence: if a model is shown, their pose and expression are confident and composed, not stiff, vacant, or slouched.
5. Product visibility: the product is the clear hero, fully visible, in sharp focus, and prominent in the frame — not obscured by hands or props, not a small/incidental detail, and not lost to motion blur or an unclear angle in a walking/motion pose.
6. Scene plausibility: does everything in the scene make physical sense together — is there a real, present object supporting a seated pose (a bench, chair, armchair, step) rather than an implied or missing one, does the scene match a real place that could exist? If a seated pose has no visible, plausible seat, issue "seated with no visible seat".
7. Purchase desire: stepping back from the technical checklist, does this photo genuinely make you want to own the product — does the scene, light, and mood feel inviting and desirable, or does it read as cold, sterile, sad, or forgettable even if nothing above is technically wrong? If it doesn't create desire, issue "doesn't create desire for the product".
8. Hand/object realism: if the model is holding or touching an object (a cup, a door, a railing, furniture), does the hand-object interaction look anatomically real — a natural grip, a plausible number of fingers, the object solidly held rather than floating or warped? If it looks off, issue "unnatural hand/object interaction".
9. Everyday authenticity: does the moment read as a real, candid, everyday situation the customer could actually picture herself in — not an obviously posed photoshoot stance? A genuine little action (sipping a drink, resting a hand naturally) reads better than a static, camera-aware pose.

Set passed=false if the image reads as generic, flat, "stock photo" boring, or fails any of the above — even when nothing is technically wrong with the product itself. List the specific issues (e.g. "flat lighting", "outfit reads as generic basics", "background doesn't contrast with product").${observedInstructions}`
      : `Assess this AI-generated still-life product photo of "${productDescription}" against a real, professional e-commerce/editorial product-photography standard.

HARD VETOES — check these first. If any applies, you MUST set passed=false, even if the lighting and styling are otherwise excellent.

1. Is any person, hand, or body part visible anywhere in the frame? This must be a pure still-life shot with NO human presence at all. If any person/hand/body part appears, issue "unexpected person in standalone shot".
2. Is this a workshop/craftsman/behind-the-scenes shot showing hands assembling or crafting the product (raw materials, tools, a workbench)? If yes, issue "workshop/craftsman shot" — this brand's photos always show the FINISHED product, never the making-of process.
3. Is any prop or surrounding object rendered with a visible logo, distinctive hardware, or a shape/design so specific it reads as an identifiable real-world brand or a different product? If yes, issue "branded prop" — every prop in frame must look plain and generic; only this brand's own product is allowed to look like a real product.

If it clears all vetoes, then also assess:
1. Light: soft, considered light that falls directly on the product, with clean, natural-looking shadows — not flat, harsh, or amateur-looking.
2. Contrast: strong, clear contrast between the product and its surface/background, so its shape and color read clearly.
3. Styling: the surface and any props read as one deliberate, elevated idea — not cluttered, not a flat/boring composition, not generic stock-photo styling.
4. Product visibility: the product is the unmistakable hero, fully visible, in sharp focus, and prominent in the frame — not obscured by a prop, not a small/incidental detail.
5. Scene plausibility: does the surface and any props make physical sense together (nothing floating, nothing physically implausible)?
6. Purchase desire: stepping back from the technical checklist, does this photo genuinely make you want to own the product — does it feel considered and desirable, or cold, sterile, or forgettable even if nothing above is technically wrong? If it doesn't create desire, issue "doesn't create desire for the product".

Set passed=false if the image reads as generic, flat, "stock photo" boring, or fails any of the above — even when nothing is technically wrong with the product itself. List the specific issues.${observedInstructions}`;

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
      compositionCheckSchema,
    );
  }
}

function parseJsonResponse<T>(rawContent: string, schema: z.ZodType<T>): T {
  // Alguns modelos "pensam em voz alta" e emitem mais de um bloco ```json
  // antes de chegar na resposta final — ex.: um primeiro JSON incompleto,
  // seguido de "Wait, that's not matching the schema... let me provide the
  // complete object" e só então o JSON de verdade (visto ao vivo em
  // 12/09/2026, derrubando a página inteira porque nada acima tinha
  // try/catch). Testa do ÚLTIMO bloco pro primeiro, já que o último
  // costuma ser a correção final, e pula qualquer candidato que não seja
  // JSON válido ou não bata com o schema, em vez de falhar no primeiro.
  const fencedBlocks = [...rawContent.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map((match) =>
    match[1].trim(),
  );

  const trimmed = rawContent.trim();
  const candidates = [
    ...fencedBlocks.reverse(),
    trimmed.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim(),
    trimmed,
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const parsed: unknown = JSON.parse(candidate);
      return schema.parse(parsed);
    } catch {
      // tenta o próximo candidato
    }
  }

  throw new Error(
    `Model did not return valid JSON for structured output: ${rawContent}`,
  );
}
