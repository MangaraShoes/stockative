import prisma from "../../db.server";

// Fecha o loop Measure → Learn (Patricia, 14/09/2026, depois da análise
// estratégica do app: "medição e decisão são dois sistemas desconectados").
// v1 deliberadamente simples: não é o ciclo completo de 5 estados
// (Parar/Manter/Dobrar/Testar/Aguardar) do MARKETING-KNOWLEDGE.md seção 8,
// que pede 15-20 posts medidos — ainda não há volume pra isso. Aqui só
// calcula, por loja, o engajamento relativo de cada arquétipo criativo já
// usado, e devolve um resumo determinístico pro Estágio 1 usar como sinal
// informativo (nunca como regra que substitui a elegibilidade por
// evidência já existente em archetypes.server.ts).

const MIN_SAMPLE_SIZE = 3; // menos que isso, um post sortudo/azarado distorceria a média
const MIN_HOURS_TO_MATURE = 48; // não compara post de ontem (poucas curtidas ainda) com um de 2 semanas

export interface ArchetypePerformance {
  archetype: string;
  relativeScore: number; // 1.0 = igual à média da loja; >1 acima, <1 abaixo
  sampleSize: number;
}

function extractArchetype(decisionBrief: unknown): string | null {
  if (
    decisionBrief &&
    typeof decisionBrief === "object" &&
    "creativeArchetype" in decisionBrief &&
    typeof (decisionBrief as Record<string, unknown>).creativeArchetype === "string"
  ) {
    return (decisionBrief as Record<string, string>).creativeArchetype;
  }
  return null;
}

// Curtidas + comentários são os únicos campos reais disponíveis hoje
// (reach/saves ficam null até o escopo instagram_manage_insights ser
// aprovado pela Meta) — somar aqui os campos não-nulos já deixa isso
// crescer sozinho assim que a permissão chegar, sem precisar mudar nada.
function engagementScore(signal: { likes: number | null; comments: number | null; reach: number | null; saves: number | null; shares: number | null }): number {
  return (signal.likes ?? 0) + (signal.comments ?? 0) + (signal.reach ?? 0) + (signal.saves ?? 0) + (signal.shares ?? 0);
}

async function getMaturedEngagement(
  shopId: string,
): Promise<{ archetype: string | null; engagement: number }[]> {
  const items = await prisma.contentItem.findMany({
    where: {
      shopId,
      status: "published",
      publishedAt: { not: null },
      performanceSignals: { some: {} },
    },
    select: {
      publishedAt: true,
      decisionBrief: true,
      performanceSignals: {
        orderBy: { capturedAt: "desc" },
        take: 1,
        select: { capturedAt: true, likes: true, comments: true, reach: true, saves: true, shares: true },
      },
    },
  });

  const matured: { archetype: string | null; engagement: number }[] = [];
  for (const item of items) {
    const signal = item.performanceSignals[0];
    if (!signal || !item.publishedAt) continue;
    const hoursSincePublish =
      (signal.capturedAt.getTime() - item.publishedAt.getTime()) / (1000 * 60 * 60);
    if (hoursSincePublish < MIN_HOURS_TO_MATURE) continue; // ainda não maduro o bastante pra julgar

    matured.push({ archetype: extractArchetype(item.decisionBrief), engagement: engagementScore(signal) });
  }
  return matured;
}

// Devolve só arquétipos com amostra suficiente, ordenados do melhor pro
// pior — usado tanto pelo prompt do Estágio 1 quanto pela tela de
// Performance.
export async function getArchetypePerformance(shopId: string): Promise<ArchetypePerformance[]> {
  const matured = await getMaturedEngagement(shopId);
  if (matured.length === 0) return [];

  const shopAverage = matured.reduce((sum, m) => sum + m.engagement, 0) / matured.length;
  if (shopAverage === 0) return []; // sem nenhum engajamento medido ainda, nada real a aprender

  const byArchetype = new Map<string, number[]>();
  for (const m of matured) {
    if (!m.archetype) continue;
    const list = byArchetype.get(m.archetype) ?? [];
    list.push(m.engagement);
    byArchetype.set(m.archetype, list);
  }

  const result: ArchetypePerformance[] = [];
  for (const [archetype, engagements] of byArchetype) {
    if (engagements.length < MIN_SAMPLE_SIZE) continue;
    const avg = engagements.reduce((a, b) => a + b, 0) / engagements.length;
    result.push({ archetype, relativeScore: avg / shopAverage, sampleSize: engagements.length });
  }
  return result.sort((a, b) => b.relativeScore - a.relativeScore);
}

// Texto determinístico pro prompt do Estágio 1 — mesmo princípio de
// describeEvidence: fato observado e citável, nunca interpretação livre da
// IA. Null quando não há dado maduro suficiente ainda (loja nova, ou
// arquétipos ainda sem 3 posts medidos cada) — nesse caso o prompt do
// Estágio 1 simplesmente não recebe esse bloco, comportamento idêntico ao
// de hoje.
export function describeArchetypePerformance(perf: ArchetypePerformance[]): string | null {
  if (perf.length === 0) return null;
  const lines = perf.map(
    (p) =>
      `- ${p.archetype}: ${p.relativeScore >= 1 ? "performing" : "underperforming"} at ${p.relativeScore.toFixed(1)}x this shop's average engagement (based on ${p.sampleSize} published post(s))`,
  );
  return [
    "Real engagement history for this shop (likes/comments/reach/saves/shares on published posts, only archetypes with at least 3 measured posts shown):",
    ...lines,
    "This is a soft signal, not a rule: when more than one archetype from the eligible list above would genuinely fit this product, mildly prefer the ones performing above 1.0x. Never pick an archetype the evidence rules above don't already allow just because it scored well here, and never invent a reason to justify a low performer's exclusion — it may still be the right choice for this specific product.",
  ].join("\n");
}
