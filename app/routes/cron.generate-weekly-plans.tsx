import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { generateDueWeeklyPlans } from "../services/decisionEngine/planWeek.server";
import { isCronRequestAuthorized } from "../services/cronAuth.server";

// Endpoint separado de /cron/publish-scheduled de propósito (achado de
// revisão externa, 12/09/2026: "there is also a distinction between
// publishing an existing plan automatically and creating the next plan
// automatically") — este GERA o próximo plano semanal pra cada loja
// pendente; o outro só PUBLICA o que já existe. Pensado pra rodar com
// intervalo maior (uma vez por dia já cobre), já que gerar chama a IA de
// verdade (custo real), diferente de checar publicações vencidas. Mesmo
// segredo compartilhado (CRON_SECRET) do outro endpoint.
async function runIfAuthorized(request: Request) {
  if (!isCronRequestAuthorized(request)) {
    throw new Response("Unauthorized", { status: 401 });
  }

  const outcomes = await generateDueWeeklyPlans();
  return { generated: outcomes.length, outcomes };
}

export const action = async ({ request }: ActionFunctionArgs) => runIfAuthorized(request);
export const loader = async ({ request }: LoaderFunctionArgs) => runIfAuthorized(request);
