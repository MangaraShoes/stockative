import type { AITaskType, AIProvider } from "./types.server";
import { OpenRouterProvider } from "./openRouterProvider.server";

// Roteamento por tarefa: qual provedor/modelo cada tarefa de IA usa. Isso é
// configuração, não código hardcoded — trocar de modelo não deveria exigir
// reescrever quem chama a IA (ver "AI Provider Layer" em ARCHITECTURE.md).
//
// Hoje só texto está ligado (image/video ficam para o Image MVP, Phase 2+).
// Todas as tarefas de texto passam pelo OpenRouter por enquanto — reaproveita
// a OPENROUTER_API_KEY que já existe (decisão de 09/09/2026). Trocar pra
// Anthropic direto no futuro é só mudar este arquivo, não quem usa a IA.
const TASK_MODEL_CONFIG: Record<
  Extract<AITaskType, "decision_engine" | "creative_copy" | "translation">,
  { model: string }
> = {
  decision_engine: { model: "anthropic/claude-haiku-4.5" }, // barato, forte em structured output
  creative_copy: { model: "anthropic/claude-sonnet-5" }, // forte em linguagem/branding
  translation: { model: "anthropic/claude-haiku-4.5" },
};

export function getProviderForTask(taskType: AITaskType): AIProvider {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENROUTER_API_KEY não está configurada. Adicione ao ambiente antes de chamar a IA.",
    );
  }

  if (taskType === "image" || taskType === "video") {
    throw new Error(
      `Tarefa "${taskType}" ainda não tem provedor configurado — fora do escopo do MVP de texto.`,
    );
  }

  const config = TASK_MODEL_CONFIG[taskType];
  return new OpenRouterProvider(apiKey, config.model);
}
