import type { z } from "zod";

// Tarefas de IA do produto — cada uma pode ser roteada pra um provedor/modelo
// diferente via task-config.server.ts, sem precisar mexer no código que a chama.
export type AITaskType =
  | "decision_engine"
  | "creative_copy"
  | "translation"
  | "brand_analysis"
  | "content_pillars"
  | "image"
  | "image_fidelity_check"
  | "image_composition_check"
  | "image_quality_assessment"
  | "product_visual_classification"
  | "video";

export interface GenerateTextResult {
  text: string;
  model: string;
  tokensUsed: number | null;
}

export interface GenerateStructuredResult<T> {
  data: T;
  model: string;
  tokensUsed: number | null;
}

export interface GenerateImageResult {
  imageDataUrl: string; // data:image/...;base64,...
  model: string;
}

export interface FidelityCheckResult {
  passed: boolean;
  issues: string[];
}

// Classificação do que REALMENTE apareceu na imagem gerada, pra comparar
// com o que foi solicitado ao repertório (ver repertoire.server.ts) — nunca
// substitui o solicitado, os dois ficam gravados lado a lado em
// GenerationLog. "unknown"/"not_applicable" são respostas válidas: o
// avaliador não deve inventar uma pose quando as pernas não aparecem, por
// exemplo (Patricia, 12/09/2026).
export interface ObservedScene {
  action: string;
  environment: string;
  framing: string;
  light: string;
}

export interface SceneOptions {
  actions: string[];
  environments: string[];
  framings: string[];
}

// Composição/estilo editorial, não se o produto bate com o original (ver
// checkImageComposition) — `observed` só vem preenchido quando `sceneOptions`
// é passado (hoje: só calçado, ver generateProductImage.server.ts).
export interface CompositionCheckResult extends FidelityCheckResult {
  observed?: ObservedScene;
}

// Interface comum que todo adaptador de provedor de IA precisa implementar.
export interface AIProvider {
  generateText(prompt: string): Promise<GenerateTextResult>;
  generateStructured<T>(
    schema: z.ZodType<T>,
    prompt: string,
    options?: { imageUrls?: string[] },
  ): Promise<GenerateStructuredResult<T>>;
  // Gera uma imagem a partir de uma foto de referência (fidelidade de
  // produto) — ver "Image MVP" em ARCHITECTURE.md.
  generateImage(
    prompt: string,
    referenceImageUrl: string,
  ): Promise<GenerateImageResult>;
  // Guardrail de fidelidade: compara a imagem gerada com a original.
  // `constraints` (ver fidelityConstraints.server.ts) é o que checar
  // explicitamente, além do julgamento geral — AJUDA a avaliar fidelidade,
  // nunca a garante sozinho (Patricia, 14/09/2026).
  checkImageFidelity(
    referenceImageUrl: string,
    generatedImageDataUrl: string,
    productDescription: string,
    constraints?: { preserve: string[]; neverAlter: string[] },
  ): Promise<FidelityCheckResult>;
  // Guardrail de composição/estilo editorial — roda em toda loja que usa o
  // app, não só a Mangará (Patricia, 10/09/2026: "como vamos fazer para esta
  // avaliação ocorrer automaticamente tanto na minha loja como em outras").
  // `hasModel` (default true, pra nunca mudar o comportamento de calçado/
  // vestuário sem passar nada) muda os vetos e critérios: um still-life
  // "standalone" (ver productClassification.server.ts) não tem pose/mãos/
  // corpo pra checar, e não PODE ter pessoa nenhuma em quadro.
  checkImageComposition(
    generatedImageDataUrl: string,
    productDescription: string,
    sceneOptions?: SceneOptions,
    hasModel?: boolean,
  ): Promise<CompositionCheckResult>;
}
