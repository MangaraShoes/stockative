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

// Rodadas em andamento agora, pra o desligamento conseguir esperar por elas
// (ver waitForInFlightJobsThenExit).
const inFlight = new Set<Promise<void>>();
const timers: ReturnType<typeof setTimeout>[] = [];
let stopping = false;

// Nunca empilha duas rodadas do mesmo job: gerar um plano chama a IA e pode
// passar do intervalo — a próxima rodada só começa depois que esta acabar.
function schedule(job: Job) {
  let running = false;
  const tick = async () => {
    if (running || stopping) return;
    running = true;
    const run = (async () => {
      try {
        await job.run();
      } catch (error) {
        console.error(`[scheduler] ${job.name} failed:`, error);
      } finally {
        running = false;
      }
    })();
    inFlight.add(run);
    await run;
    inFlight.delete(run);
  };
  timers.push(
    setTimeout(() => {
      void tick();
      timers.push(setInterval(() => void tick(), job.intervalMs));
    }, FIRST_RUN_DELAY_MS),
  );
}

// Achado ao vivo, 30/09/2026: um redeploy às 15:02 matou no meio a
// publicação de um Reel que tinha começado às 15:00:21 — o post ficou preso
// em "publishing" e só saiu 15 min depois, pela recuperação de
// STUCK_PUBLISHING_MINUTES. No SIGTERM do redeploy, para de começar rodadas
// novas e espera as que já estão rodando terminarem antes de sair. O
// Railway só manda SIGKILL depois de deploy.drainingSeconds (railway.json),
// então SHUTDOWN_GRACE_MS precisa ficar abaixo disso. O servidor HTTP já é
// fechado pelo próprio react-router-serve no mesmo sinal; sem este exit
// explícito os setInterval manteriam o processo vivo até o SIGKILL.
const SHUTDOWN_GRACE_MS = 280 * 1000;

async function waitForInFlightJobsThenExit(signal: string) {
  if (stopping) return;
  stopping = true;
  for (const timer of timers) clearTimeout(timer);
  console.log(`[scheduler] ${signal} received, waiting for ${inFlight.size} in-flight job(s) before exiting`);
  const timedOut = await Promise.race([
    Promise.allSettled([...inFlight]).then(() => false),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(true), SHUTDOWN_GRACE_MS)),
  ]);
  console.log(`[scheduler] ${timedOut ? "grace period over" : "in-flight jobs finished"}, exiting`);
  process.exit(0);
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
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => void waitForInFlightJobsThenExit(signal));
  }
}
