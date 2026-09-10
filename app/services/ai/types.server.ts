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
  | "image_quality_assessment"
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
  checkImageFidelity(
    referenceImageUrl: string,
    generatedImageDataUrl: string,
    productDescription: string,
  ): Promise<FidelityCheckResult>;
}
