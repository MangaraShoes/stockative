import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { collectDuePerformanceSignals } from "../services/meta/collectPerformance.server";
import { isCronRequestAuthorized } from "../services/cronAuth.server";

// Fecha o loop de Measure → Learn (Patricia, 13/09/2026, ver
// collectDuePerformanceSignals) — sem isso, dado de performance só existia
// se a lojista abrisse a tela de Performance e clicasse. Mesmo segredo
// compartilhado (CRON_SECRET) e mesmo padrão dos outros dois endpoints de
// cron; pensado pra rodar 1x/dia.
async function runIfAuthorized(request: Request) {
  if (!isCronRequestAuthorized(request)) {
    throw new Response("Unauthorized", { status: 401 });
  }

  const outcomes = await collectDuePerformanceSignals();
  return { shopsProcessed: outcomes.length, outcomes };
}

export const action = async ({ request }: ActionFunctionArgs) => runIfAuthorized(request);
export const loader = async ({ request }: LoaderFunctionArgs) => runIfAuthorized(request);
