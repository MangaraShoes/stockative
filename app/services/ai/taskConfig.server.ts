import type { AITaskType, AIProvider } from "./types.server";
import { OpenRouterProvider } from "./openRouterProvider.server";

// Roteamento por tarefa: qual provedor/modelo cada tarefa de IA usa. Isso é
// configuração, não código hardcoded — trocar de modelo não deveria exigir
// reescrever quem chama a IA (ver "AI Provider Layer" em ARCHITECTURE.md).
//
// Todas as tarefas passam pelo OpenRouter por enquanto — reaproveita a
// OPENROUTER_API_KEY que já existe (decisão de 09/09/2026). Trocar pra outro
// provedor no futuro é só mudar este arquivo, não quem usa a IA.
const TASK_MODEL_CONFIG: Record<
  Extract<
    AITaskType,
    | "decision_engine"
    | "creative_copy"
    | "translation"
    | "brand_analysis"
    | "content_pillars"
    | "image"
    | "image_fidelity_check"
    | "image_composition_check"
    | "image_quality_assessment"
  >,
  { model: string }
> = {
  decision_engine: { model: "anthropic/claude-haiku-4.5" }, // barato, forte em structured output
  creative_copy: { model: "anthropic/claude-sonnet-5" }, // forte em linguagem/branding
  translation: { model: "anthropic/claude-haiku-4.5" },
  brand_analysis: { model: "anthropic/claude-sonnet-5" }, // precisa de bom julgamento, não é tarefa frequente
  content_pillars: { model: "anthropic/claude-sonnet-5" }, // estratégia de marca, mesma exigência de julgamento do brand_analysis
  image: { model: "google/gemini-2.5-flash-image" }, // Nano Banana — mesmo modelo do projeto da Mangará
  image_fidelity_check: { model: "anthropic/claude-sonnet-5" }, // modelo de geração não é o ideal pra julgar a própria imagem
  image_composition_check: { model: "anthropic/claude-sonnet-5" }, // mesmo motivo do fidelity check — julgamento visual, não geração
  image_quality_assessment: { model: "anthropic/claude-sonnet-5" }, // mesmo modelo do fidelity check, tarefa de julgamento parecida
};

export function getProviderForTask(taskType: AITaskType): AIProvider {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENROUTER_API_KEY não está configurada. Adicione ao ambiente antes de chamar a IA.",
    );
  }

  if (taskType === "video") {
    throw new Error(
      `Tarefa "${taskType}" ainda não tem provedor configurado — fora do escopo do MVP.`,
    );
  }

  const config = TASK_MODEL_CONFIG[taskType];
  return new OpenRouterProvider(apiKey, config.model);
}
