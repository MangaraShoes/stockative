import type { z } from "zod";
import prisma from "../../db.server";
import { getProviderForTask } from "./taskConfig.server";
import type { AITaskType } from "./types.server";

interface LogOptions {
  contentItemId?: string;
}

// Ponto de entrada público do AI Provider Layer: chama o provedor configurado
// pra essa tarefa e registra a chamada em generation_logs (custo/uso por
// tarefa — ver ARCHITECTURE.md). Quem chama isso nunca sabe qual provedor
// está por trás, só a tarefa que precisa realizar.
export async function generateTextForTask(
  taskType: AITaskType,
  prompt: string,
  options: LogOptions = {},
) {
  const provider = getProviderForTask(taskType);
  const result = await provider.generateText(prompt);

  await prisma.generationLog.create({
    data: {
      contentItemId: options.contentItemId,
      taskType,
      model: result.model,
      tokensUsed: result.tokensUsed,
    },
  });

  return result.text;
}

export async function generateStructuredForTask<T>(
  taskType: AITaskType,
  schema: z.ZodType<T>,
  prompt: string,
  options: LogOptions & { imageUrls?: string[] } = {},
): Promise<T> {
  const provider = getProviderForTask(taskType);
  const result = await provider.generateStructured(schema, prompt, {
    imageUrls: options.imageUrls,
  });

  await prisma.generationLog.create({
    data: {
      contentItemId: options.contentItemId,
      taskType,
      model: result.model,
      tokensUsed: result.tokensUsed,
    },
  });

  return result.data;
}
