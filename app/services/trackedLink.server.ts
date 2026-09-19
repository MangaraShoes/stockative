import prisma from "../db.server";

// Fecha (parcialmente) o gap de "converter vendas é hoje inmensurável"
// (análise estratégica, 14/09/2026) — TrackedLink já existia no schema
// desde o MVP mas nenhum código nunca criava nem lia uma linha dela.
//
// Limitação real de plataforma, não de código: o Instagram NÃO permite link
// clicável no texto do feed nem legenda do Story (só o link da bio, que é
// da conta inteira, não do post) — então isso só mede cliques vindos do
// Facebook (que aceita link no texto do post) e do Pinterest (que já tem um
// campo de link estruturado no Pin). Tráfego vindo do Instagram em si
// continua sem medição de clique possível hoje.
function generateShortCode(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 10);
}

// Um ContentItem tem no máximo um TrackedLink (unique contentItemId) — se já
// existe (ex.: retry de um "partial"), reaproveita em vez de criar outro e
// perder a contagem de clique já acumulada.
export async function getOrCreateTrackedLink(contentItemId: string): Promise<string> {
  const existing = await prisma.trackedLink.findUnique({ where: { contentItemId } });
  if (existing) return existing.shortCode;

  const shortCode = generateShortCode();
  await prisma.trackedLink.create({ data: { contentItemId, shortCode } });
  return shortCode;
}

export function buildTrackedUrl(appUrl: string, shortCode: string): string {
  return `${appUrl}/r/${shortCode}`;
}
