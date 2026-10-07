import type { ActionFunctionArgs } from "react-router";
import { publishDueContentItems } from "../services/meta/publishContentItem.server";
import { isCronRequestAuthorized } from "../services/cronAuth.server";

// Endpoint pra um cron EXTERNO disparar (cron-job.org, GitHub Actions,
// Vercel Cron etc.) — não é um webhook da Shopify, por isso não usa
// authenticate.webhook. Protegido por um segredo compartilhado (env var
// CRON_SECRET) pra ninguém conseguir disparar publicação alheia só
// adivinhando a URL. Só aceita POST: GET com efeito colateral (publicar)
// é disparável por prefetch/crawler/link (auditoria de segurança, 07/10/2026).
async function runIfAuthorized(request: Request) {
  if (!isCronRequestAuthorized(request)) {
    throw new Response("Unauthorized", { status: 401 });
  }

  const outcomes = await publishDueContentItems();
  return { attempted: outcomes.length, outcomes };
}

export const action = async ({ request }: ActionFunctionArgs) => runIfAuthorized(request);
