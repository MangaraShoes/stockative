import { publishDueContentItems } from "./meta/publishContentItem.server";
import { generateDueWeeklyPlans } from "./decisionEngine/planWeek.server";

// Agendador dentro do próprio processo do app (Patricia, 30/09/2026) —
// substitui o cron do GitHub Actions pra publicar e gerar plano. O cron do
// GitHub é "best effort": na prática rodava a cada 2-3h em vez de a cada
// 15 min, e descartou a geração das ~10:22 de 30/09 — o lote da Mangará
// esvaziou às 08:57 e o plano novo só começou às 12:47. Um setInterval
// aqui roda no horário certo enquanto o servidor estiver no ar (e, se o
// servidor não estiver no ar, o cron externo também não adiantaria nada —
// ele só batia num endpoint deste mesmo servidor).
//
// Só liga no Railway de produção: RAILWAY_ENVIRONMENT_NAME é definido pelo
// próprio Railway, nunca localmente. Importante porque o .env local aponta
// pro MESMO banco Neon de produção — um `npm run dev` com agendador ligado
// publicaria posts reais da máquina da Patricia.
//
// Duplicidade é segura: publishContentItemToInstagram tem trava atômica
// contra publicação dupla e planWeeklyContent reivindica
// Shop.weeklyPlanGeneratingAt antes de gerar — então dois processos
// sobrepostos (ex.: durante um redeploy) não publicam/geram duas vezes.

const PUBLISH_INTERVAL_MS = 5 * 60 * 1000;
const GENERATE_INTERVAL_MS = 15 * 60 * 1000;
// Espera o servidor terminar de subir antes da primeira rodada, mas sem
// esperar um intervalo inteiro — um redeploy não pode atrasar publicação.
const FIRST_RUN_DELAY_MS = 30 * 1000;

type Job = { name: string; intervalMs: number; run: () => Promise<unknown> };

const jobs: Job[] = [
  {
    name: "publish-scheduled",
    intervalMs: PUBLISH_INTERVAL_MS,
    run: async () => {
      const outcomes = await publishDueContentItems();
      if (outcomes.length > 0) {
        console.log(`[scheduler] publish-scheduled: ${outcomes.length} due`, JSON.stringify(outcomes));
      }
    },
  },
  {
    name: "generate-weekly-plans",
    intervalMs: GENERATE_INTERVAL_MS,
    run: async () => {
      const outcomes = await generateDueWeeklyPlans();
      if (outcomes.length > 0) {
        console.log(`[scheduler] generate-weekly-plans: ${outcomes.length} shop(s)`, JSON.stringify(outcomes));
      }
    },
  },
];

// Nunca empilha duas rodadas do mesmo job: gerar um plano chama a IA e pode
// passar do intervalo — a próxima rodada só começa depois que esta acabar.
function schedule(job: Job) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await job.run();
    } catch (error) {
      console.error(`[scheduler] ${job.name} failed:`, error);
    } finally {
      running = false;
    }
  };
  setTimeout(() => {
    void tick();
    setInterval(() => void tick(), job.intervalMs);
  }, FIRST_RUN_DELAY_MS);
}

declare global {
  // eslint-disable-next-line no-var
  var __stockativeSchedulerStarted: boolean | undefined;
}

export function startInProcessScheduler() {
  if (process.env.RAILWAY_ENVIRONMENT_NAME !== "production") return;
  if (process.env.DISABLE_IN_PROCESS_SCHEDULER === "1") return;
  if (globalThis.__stockativeSchedulerStarted) return;
  globalThis.__stockativeSchedulerStarted = true;

  console.log("[scheduler] starting in-process scheduler (publish every 5 min, weekly plans every 15 min)");
  for (const job of jobs) schedule(job);
}
