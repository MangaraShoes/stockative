import type { z } from "zod";

// Tarefas de IA do produto — cada uma pode ser roteada pra um provedor/modelo
// diferente via task-config.server.ts, sem precisar mexer no código que a chama.
export type AITaskType =
  | "decision_engine"
  | "creative_copy"
  | "translation"
  | "image"
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

// Interface comum que todo adaptador de provedor de IA precisa implementar.
// generateImage fica de fora por enquanto — só texto está no escopo do MVP
// (ver "AI Provider Layer" em ARCHITECTURE.md).
export interface AIProvider {
  generateText(prompt: string): Promise<GenerateTextResult>;
  generateStructured<T>(
    schema: z.ZodType<T>,
    prompt: string,
  ): Promise<GenerateStructuredResult<T>>;
}
