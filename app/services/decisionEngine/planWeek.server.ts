import { notifyWeeklyPlanReady } from "../email/notify.server";
import {
  classifyShopifyShotTypes,
  discardPendingImageCandidates,
  loadLifestyleShopifyImage,
  loadPendingImageCandidates,
  loadPreviousHeroImage,
  type ImageCandidate,
} from "../imageMvp/imageCandidates.server";
import { MAX_IMAGE_REGENERATIONS_PER_POST } from "./constants";
import type { RegenerationOverrides } from "../imageMvp/modelProfile";
import type { ContentPillar, Prisma, Promotion } from "@prisma/client";
import prisma from "../../db.server";
import { inferObjective, computeSlowMoverSignal } from "./archetypes.server";
import { getArchetypePerformance, describeArchetypePerformance } from "./performanceLearning.server";
import { decideContentBrief, describeEvidence, type Stage1Output } from "./stage1.server";
import { generateCreativeCopy } from "./stage2.server";
import { buildCarousel } from "../imageMvp/buildCarousel.server";
import { generateReelForContentItem } from "../video/generateReelForContentItem.server";
import { getProductUsageStats } from "./contentHistory.server";
import { translateCaption, buildBilingualCaption } from "./translateCaption.server";
import { maxPrimaryCaptionChars, buildFinalCaption, parseStoredHashtags, stripFrameworkLabels } from "./captionFormat";
import { parseStoredTikTokSettings, TIKTOK_TITLE_MAX_LENGTH, type TikTokPostSettings } from "../tiktok/postSettings";
import {
  COMMERCIAL_OBJECTIVES,
  MAX_CAPTION_REGENERATIONS_PER_POST,
  type CommercialObjective,
  type ContentLanguageCode,
} from "./constants";
import { getTopOnlineHours } from "../meta/audienceInsights.server";
import { nextWeeklyOccurrenceInTimezone } from "../timezone";
import { currentSeasonInTimezone, seasonScoreBoost } from "./seasonality.server";
import { getRemainingCredits } from "./creditUsage.server";
import { getWeeklySlotPlan } from "./planTiers.server";

// Usado só por planPromotionalWeek (campanhas tipo Black Friday) — o plano
// semanal REGULAR (planWeeklyContent) passou a usar getWeeklySlotPlan(shop)
// (Patricia, 24/09/2026: cadência 3/5/7 e mix de Reel por plano), ver
// planTiers.server.ts. Campanha promocional continua fixa em 3 por
// enquanto — não fazia parte do pedido de tornar isso configurável.
const POSTS_PER_WEEK = 3;
// Achado ao vivo, 21/09/2026: com isso igual a WEEKLY_PLAN_INTERVAL_DAYS (7),
// um produto usado nesta semana chega EXATAMENTE sem penalidade no instante
// em que a próxima semana é gerada (daysSinceLastUsed=7, e a checagem é
// "< 7") — na prática a rejeição de reuso nunca protegia contra repetir o
// mesmo produto de uma semana pra outra, só dentro da mesma semana (troca
// manual, geração repetida). Maior que o intervalo semanal por uma margem
// real (quase o dobro) garante que o produto da semana passada ainda chega
// penalizado -100 na nova rodada, dando espaço pro resto do catálogo entrar.
const AVOID_REUSE_WITHIN_DAYS = 13;

export interface WeeklyPlanImage {
  position: number;
  url: string;
  source: "ai_generated" | "shopify_existing";
}

export interface WeeklyPlanSlot {
  contentItemId: string;
  productId: string;
  productTitle: string;
  objective: string;
  objectiveSource: string | null; // merchant | ai | campaign (null em posts antigos)
  pillarName: string | null; // qual pilar (Fase 1) orientou este post, se algum
  promotionName: string | null; // qual promoção real gerou este post, se alguma (ver Promotion)
  needsManualImage: boolean; // ainda sem nenhuma imagem — não pode ser publicado assim (ver publishDueContentItems)
  // Imagens de IA com o produto fiel mas reprovadas por estilo/destaque,
  // esperando a lojista escolher (ver imageCandidates.server.ts).
  imageCandidates: ImageCandidate[];
  imageRegenerationsLeft: number; // de MAX_IMAGE_REGENERATIONS_PER_POST
  previousImage: ImageCandidate | null; // editorial anterior, ainda escolhível
  shopifyLifestyleImage: ImageCandidate | null; // foto não-still da Shopify, se houver
  scheduledAt: string; // ISO — quando o post sai no ar se ninguém mexer, ver DEFAULT_WEEKLY_SCHEDULE
  publishedAt: string | null; // ISO — quando de fato saiu no ar, se já publicou
  status: string; // draft | approved | publishing | partial | published | failed | cancelled
  captionText: string; // legenda completa, pra lojista ver o que vai publicar antes de aprovar
  captionRegenerationCount: number; // quantas das MAX_CAPTION_REGENERATIONS_PER_POST já foram usadas
  images: WeeklyPlanImage[];
  format: string; // post | reel — ver ContentItem.format em prisma/schema.prisma
  videoUrl: string | null; // só quando format="reel" (ver generateReelForContentItem.server.ts)
  // Direct Post no TikTok (só Reel) — configuração confirmada pela lojista
  // (null = ainda não confirmou, não vai pro TikTok), último status do
  // envio, e a legenda sugerida pra pré-preencher o campo do TikTok.
  tiktokSettings: TikTokPostSettings | null;
  tiktokPublishStatus: string | null;
  tiktokDefaultTitle: string;
}

// Dia da semana (0=domingo) + horário em que cada slot posta por padrão, se
// a lojista não mudar (Patricia, 12/09/2026: "vamos deixar tbem predefinido
// o dia e horario que vai ser postado mas o cliente tbem deve poder alterar
// isso... caso ele nao interaja com o app vamos seguir postando os produtos
// definidos pelo app nos dias e horarios tbem pre definidos"). Índice do
// array = índice do slot na semana (hero é sempre o slot 0, então fica com o
// melhor horário). Baseado em pesquisa de 12/09/2026 sobre engajamento no
// Instagram pra moda/e-commerce (ver fontes na resposta que acompanha este
// commit): terça, quarta e quinta são os dias que mais performam de forma
// consistente (sexta e sábado ficam abaixo da média, inclusive pra varejo);
// quarta ao meio-dia é o horário isolado com melhor engajamento geral
// (Buffer, 9,6M posts); moda especificamente tem um segundo pico à noite
// (18h-21h, "mindset de compra pós-trabalho"). Esses dia+hora são sempre
// interpretados no FUSO HORÁRIO REAL da loja (ver resolveWeeklySchedule e
// timezone.ts), nunca no fuso do servidor — essencial pra vender em Brasil
// e Europa ao mesmo tempo.
export const DEFAULT_WEEKLY_SCHEDULE: { weekday: number; hour: number; minute: number }[] = [
  { weekday: 3, hour: 12, minute: 0 }, // quarta 12h — melhor horário isolado
  { weekday: 4, hour: 9, minute: 0 }, // quinta 9h — segundo melhor horário
  { weekday: 2, hour: 19, minute: 0 }, // terça 19h — pico noturno de moda/compra
  // Dias extras pros planos Grow (5) e Plus (7) — antes eram só os 3 acima
  // reaproveitados em ciclo (`schedule[index % 3]`), então o 4º post saía
  // no MESMO dia e minuto do 1º (achado de 03/10/2026). Mesmo critério da
  // pesquisa: segunda à noite e sexta ao meio-dia antes do fim de semana.
  { weekday: 1, hour: 19, minute: 0 }, // segunda 19h
  { weekday: 5, hour: 12, minute: 0 }, // sexta 12h
  { weekday: 0, hour: 19, minute: 0 }, // domingo 19h
  { weekday: 6, hour: 11, minute: 0 }, // sábado 11h
];

export type WeeklyScheduleSlot = { weekday: number; hour: number; minute: number };

// Lê o horário personalizado salvo em Settings (Shop.customPostingSchedule)
// e devolve exatamente `count` slots — se a lojista trocou de plano depois
// de salvar, completa com os dias padrão (sem repetir um dia já escolhido)
// ou corta o excesso. Valor inválido vira o padrão, nunca quebra a geração.
export function normalizeCustomSchedule(raw: unknown, count: number): WeeklyScheduleSlot[] {
  const valid = (Array.isArray(raw) ? raw : []).filter(
    (slot): slot is WeeklyScheduleSlot =>
      typeof slot === "object" && slot !== null &&
      Number.isInteger(slot.weekday) && slot.weekday >= 0 && slot.weekday <= 6 &&
      Number.isInteger(slot.hour) && slot.hour >= 0 && slot.hour <= 23 &&
      Number.isInteger(slot.minute) && slot.minute >= 0 && slot.minute <= 59,
  );
  const result = valid.slice(0, count).map(({ weekday, hour, minute }) => ({ weekday, hour, minute }));
  for (const fallback of DEFAULT_WEEKLY_SCHEDULE) {
    if (result.length >= count) break;
    if (!result.some((slot) => slot.weekday === fallback.weekday)) result.push(fallback);
  }
  return result;
}

// Resolve o cronograma real da semana: mantém os DIAS da pesquisa de
// mercado (terça/quarta/quinta, essa parte não tem como vir da conta —
// online_followers só dá granularidade por hora, não por dia da semana),
// mas troca o HORÁRIO genérico pelo horário em que a audiência real da
// conta conectada está online, quando esse dado existe. Cai pro padrão de
// pesquisa sem erro nenhum pra lojista quando a conta é nova/sem dado
// suficiente ainda, ou o Instagram não está conectado. Assume que a hora
// que o Instagram devolve já é a hora local da conta (mesma premissa do
// próprio painel de Insights dele) — combinada depois com o fuso real da
// loja em planWeeklyContent/nextWeeklyOccurrenceInTimezone.
//
// Horário personalizado em Settings (postingScheduleMode "custom") vence
// tudo isso — a lojista escolheu dia e hora de cada post.
async function resolveWeeklySchedule(
  shop: { id: string; postingScheduleMode: string; customPostingSchedule: unknown },
  count: number,
): Promise<WeeklyScheduleSlot[]> {
  if (shop.postingScheduleMode === "custom") {
    return normalizeCustomSchedule(shop.customPostingSchedule, count);
  }

  const defaults = DEFAULT_WEEKLY_SCHEDULE.slice(0, count);
  const socialAccount = await prisma.socialAccount.findUnique({
    where: { shopId_platform: { shopId: shop.id, platform: "instagram" } },
  });
  if (!socialAccount?.igBusinessAccountId) return defaults;

  const topHours = await getTopOnlineHours(
    socialAccount.igBusinessAccountId,
    socialAccount.accessToken,
    defaults.length,
  );
  if (topHours.status !== "success" || topHours.hours.length === 0) {
    return defaults;
  }

  return defaults.map((defaultSlot, index) => ({
    weekday: defaultSlot.weekday,
    hour: topHours.hours[index] ?? defaultSlot.hour,
    minute: 0,
  }));
}

const PILLAR_BALANCE_WINDOW_DAYS = 30;

// Distribui os pilares salvos pelos slots da semana, comparando o alvo
// (targetSharePct) com o quanto cada pilar REALMENTE apareceu em posts
// publicados nos últimos 30 dias — não é mais aleatoriedade ponderada
// isolada por semana (achado de revisão externa, 12/09/2026: "allocation
// is weighted randomness without balancing against previous weeks... a
// desired percentage therefore does not become a reliable editorial
// distribution"). Pilar abaixo do alvo pesa mais; acima do alvo ainda
// mantém uma chance mínima (pra não travar pra sempre), exceto um pilar
// com alvo 0%, que agora fica mesmo em 0 — antes até esse recebia uma
// chance positiva (`Math.max(targetSharePct, 1)` colocava um piso de 1
// mesmo em pilar zerado).
async function allocatePillarsForWeek(
  shopId: string,
  slotCount: number,
): Promise<(ContentPillar | null)[]> {
  const pillars = await prisma.contentPillar.findMany({ where: { shopId } });
  if (pillars.length === 0) return Array(slotCount).fill(null);

  const windowStart = new Date(Date.now() - PILLAR_BALANCE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const recentPublished = await prisma.contentItem.findMany({
    where: {
      shopId,
      status: "published",
      contentPillarId: { not: null },
      publishedAt: { gte: windowStart },
    },
    select: { contentPillarId: true },
  });
  const totalRecent = recentPublished.length;
  const actualCounts = new Map<string, number>();
  for (const item of recentPublished) {
    if (!item.contentPillarId) continue;
    actualCounts.set(item.contentPillarId, (actualCounts.get(item.contentPillarId) ?? 0) + 1);
  }

  const weighted = pillars.map((pillar) => {
    if (pillar.targetSharePct <= 0) return { pillar, weight: 0 };
    const actualSharePct = totalRecent > 0
      ? ((actualCounts.get(pillar.id) ?? 0) / totalRecent) * 100
      : 0;
    // Quanto mais abaixo do alvo, maior o peso; nunca menos que 1 pra um
    // pilar com alvo positivo continuar tendo alguma chance mesmo servido
    // demais recentemente.
    const gap = Math.max(pillar.targetSharePct - actualSharePct, 1);
    return { pillar, weight: gap * (pillar.postLess ? 0.5 : 1) };
  });

  const result: (ContentPillar | null)[] = [];
  let pool = [...weighted];

  for (let i = 0; i < slotCount; i++) {
    if (pool.length === 0) pool = [...weighted];

    const totalWeight = pool.reduce((sum, w) => sum + w.weight, 0);
    let roll = Math.random() * totalWeight;
    let pickedIndex = pool.length - 1;
    for (let j = 0; j < pool.length; j++) {
      roll -= pool[j].weight;
      if (roll <= 0) {
        pickedIndex = j;
        break;
      }
    }

    result.push(pool[pickedIndex].pillar);
    pool.splice(pickedIndex, 1);
  }

  return result;
}

// Escolhe até POSTS_PER_WEEK produtos pra semana. Sem objetivo forçado,
// prioriza velocidade de venda e estoque parado por cobertura real em dias +
// capital imobilizado (ver computeSlowMoverSignal em archetypes.server.ts,
// mesmo critério do inferObjective) — critério padrão de sempre. Com um
// objetivo forçado
// (Patricia, 12/09/2026, depois de notar que "Clear excess stock" escolhia
// os mesmos produtos de "Let Stockative decide": forçar o objetivo só
// mudava o TEXTO do post, nunca escolhia produto parado nenhum de verdade),
// o critério de escolha muda pra combinar com a história que o post vai
// contar — senão a cliente pode acabar anunciando "estoque parado" num
// produto que na real está vendendo bem. Sempre evita repetir um produto
// usado nos últimos AVOID_REUSE_WITHIN_DAYS dias, a não ser que não haja
// produtos suficientes sem repetir.
//
// Limitação conhecida (revisão de 12/09/2026): isso usa sinal comercial da
// Shopify (velocidade de venda, estoque), NÃO desempenho real do Instagram
// — apesar da tela do plano semanal descrever "real Instagram performance".
// Corrigido o texto pra não prometer mais do que o código faz; usar
// PerformanceSignal pra influenciar a escolha fica como trabalho futuro,
// quando houver dado comparável suficiente (hoje é 1 snapshot pra 9 posts).
async function rankProductsForWeek(
  shopId: string,
  forcedObjective?: CommercialObjective,
  // Fuso real da loja — decide a estação atual (Patricia, 24/09/2026: "nao
  // esta considerando a estação do ano... precisa mesclar com produtos de
  // outono"). Opcional só pra não quebrar nenhum outro caller hipotético;
  // sem ele, cai em UTC (hemisfério norte) como já era antes desse sinal
  // existir.
  timeZone: string = "UTC",
) {
  // status: "active" sozinho não bastava — Patricia, 11/09/2026: "selects
  // active products without excluding zero inventory" — um produto ativo
  // mas esgotado não deveria concorrer por um slot da semana.
  const products = await prisma.productCache.findMany({
    where: { shopId, status: "active", inventoryQuantity: { gt: 0 } },
    include: { commerceSignal: true },
  });
  const usageStats = await getProductUsageStats(shopId);
  const season = currentSeasonInTimezone(timeZone);

  const now = Date.now();
  const scored = products.map((product) => {
    const usage = usageStats[product.id];
    const daysSinceLastUsed = usage
      ? Math.floor((now - new Date(usage.lastUsedAt).getTime()) / (24 * 60 * 60 * 1000))
      : Infinity;
    const usedRecently = daysSinceLastUsed < AVOID_REUSE_WITHIN_DAYS;
    const recentPenalty = usedRecently ? 100 : 0;

    const salesVelocity = product.commerceSignal?.salesVelocity ?? 0;
    const unitsSold30d = product.commerceSignal?.unitsSold30d ?? 0;
    const { isSlowMover, tiedUpCapital } = computeSlowMoverSignal({
      inventoryQuantity: product.inventoryQuantity,
      salesVelocity,
      price: product.price,
    });
    // €50 parados = 1 ponto, até um teto de 30 — evita que um produto muito
    // caro sozinho domine o ranking a ponto de nunca dar espaço a mais
    // nenhum outro sinal (Patricia, 13/09/2026, Product Opportunity Score).
    // Escalado pela margem (14/09/2026, ver computeCommerceSignals.server.ts)
    // quando a lojista preencheu "Cost per item" na Shopify: um produto de
    // margem baixa tem esse bônus reduzido, pra não competir de igual pra
    // igual com um de margem saudável só por ter mais capital parado —
    // empurrar estoque parado não deveria custar mais do que vale a pena
    // vender. Sem custo cadastrado, margin é null e o peso continua
    // exatamente como era antes (nunca penaliza uma loja que simplesmente
    // não preencheu esse campo).
    const tiedUpCapitalWeight = Math.min(tiedUpCapital / 50, 30) * (product.commerceSignal?.margin ?? 1);
    const daysSinceCreated = product.shopifyCreatedAt
      ? Math.floor((now - product.shopifyCreatedAt.getTime()) / (24 * 60 * 60 * 1000))
      : null;
    const isRecentLaunch = daysSinceCreated !== null && daysSinceCreated <= 14;

    let score: number;
    switch (forcedObjective) {
      case "inventory":
        // Só produto de verdade parado sobe (por cobertura real, ver
        // computeSlowMoverSignal) — sem isso um produto vendendo bem podia
        // entrar mesmo com "Clear excess stock" selecionado. Entre os
        // parados, prioriza quem tem mais capital imobilizado, não só quem
        // tem mais unidades.
        score = (isSlowMover ? 100 + tiedUpCapitalWeight : 0) - salesVelocity * 5 - recentPenalty;
        break;
      case "awareness":
        // Lançamento recente de verdade, mesmo critério de inferObjective.
        score = (isRecentLaunch ? 100 : 0) - recentPenalty;
        break;
      case "conversion":
        // Histórico de venda real pra sustentar prova social/comparação.
        score = salesVelocity * 10 + (unitsSold30d > 0 ? 20 : 0) - recentPenalty;
        break;
      default:
        // "engagement", "traffic", ou nenhum objetivo forçado (a IA decide
        // por produto) — critério padrão de sempre.
        score = salesVelocity * 10 + (isSlowMover ? tiedUpCapitalWeight : 0) - recentPenalty;
    }

    // Empurrão de estação, igual em qualquer objetivo (Patricia,
    // 24/09/2026) — mesma escala do resto do ranking: não é forte o
    // bastante pra sozinho vencer um sinal comercial real (ex.: "Clear
    // excess stock" ainda prioriza estoque parado de verdade acima disso),
    // mas é o bastante pra, entre candidatos parecidos, o lote da semana
    // tender a misturar categorias em vez de ficar todo de uma estação só.
    score += seasonScoreBoost(product.productType, season);

    return { product, score, usedRecently };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored;
}

async function loadSlotImages(contentItemId: string): Promise<WeeklyPlanImage[]> {
  const rows = await prisma.contentItemImage.findMany({
    where: { contentItemId },
    orderBy: { position: "asc" },
    include: { creativeAsset: true, productImage: true },
  });
  return rows.map((row) => ({
    position: row.position,
    url: row.creativeAsset?.imageUrl ?? row.productImage?.url ?? "",
    source: row.creativeAssetId ? ("ai_generated" as const) : ("shopify_existing" as const),
  }));
}

// Monta o post da semana pra um produto: Estágio 1 + Estágio 2 + carrossel
// (respeitando a regra "nunca só still" — ver CLAUDE.md, 09/09/2026).
// weekBatchId agrupa os posts criados pela mesma chamada de
// planWeeklyContent (null pra um post avulso trocado depois, se algum dia
// for chamado fora de um lote) — ver comentário no schema.
// Mesmos dados reais que o Estágio 1 recebe — separado de planOneSlot pra
// regenerar só a legenda de um post (regenerateWeeklyPlanSlotCaption) com
// exatamente a mesma evidência que gerou o post original.
async function buildStage1Input(params: {
  shopId: string;
  shop: { brandDescription: string | null };
  product: Awaited<ReturnType<typeof loadProductWithSignal>>;
  objective: CommercialObjective;
  effectivePillar: Pick<
    ContentPillar,
    "name" | "function" | "problemExplored" | "promise" | "idealFormat" | "cta" | "growthCategory"
  > | null;
  promotion: Promotion | null | undefined;
}) {
  const { shopId, shop, product, objective, effectivePillar, promotion } = params;
  return {
    productTitle: product.title,
    productDescription: product.description,
    productType: product.productType,
    price: product.price,
    inventoryQuantity: product.inventoryQuantity,
    unitsSold30d: product.commerceSignal?.unitsSold30d ?? 0,
    salesVelocity: product.commerceSignal?.salesVelocity ?? 0,
    daysSinceLastSale: product.commerceSignal?.daysSinceLastSale ?? null,
    daysSinceCreated: product.shopifyCreatedAt
      ? Math.floor((Date.now() - product.shopifyCreatedAt.getTime()) / (24 * 60 * 60 * 1000))
      : null,
    brandDescription: shop.brandDescription,
    objective,
    pillar: effectivePillar
      ? {
          name: effectivePillar.name,
          function: effectivePillar.function,
          problemExplored: effectivePillar.problemExplored,
          promise: effectivePillar.promise,
          idealFormat: effectivePillar.idealFormat,
          cta: effectivePillar.cta,
          growthCategory: effectivePillar.growthCategory,
        }
      : null,
    promotion: promotion
      ? { name: promotion.name, discountPct: promotion.discountPct, endsAt: promotion.endsAt }
      : null,
    archetypePerformance: describeArchetypePerformance(await getArchetypePerformance(shopId)),
  };
}

function loadProductWithSignal(productId: string) {
  return prisma.productCache.findUniqueOrThrow({
    where: { id: productId },
    include: { commerceSignal: true },
  });
}

export async function planOneSlot(
  shopId: string,
  productId: string,
  pillar: ContentPillar | null,
  scheduledAt: Date,
  weekBatchId: string | null,
  // Quando presente, sobrepõe a regra automática (Patricia, 12/09/2026:
  // "precisamos ter a opção de escolher o objetivo da campanha") — vem dos
  // "Campaign objective(s) for this week" escolhidos no plano. Sem isso o
  // objetivo era 100% inferido de estoque/velocidade/idade do produto.
  forcedObjective?: CommercialObjective,
  // Promoção real que este post divulga (ver planPromotionalWeek) — quando
  // presente, vira evidência real de Urgency e o discount/prazo entram no
  // Estágio 1 como fato, nunca inventado (Patricia, 13/09/2026).
  promotion?: Promotion,
  // Reserva este slot como Reel independente do pilar sorteado (Patricia,
  // 22/09/2026: "queremos que toda semana tenha um reel que va para o IG e
  // tiktok") — antes disso, um Reel só saía se o pilar da vez tivesse
  // idealFormat="reel" por sorteio, o que nunca acontecia pra lojas sem
  // nenhum pilar marcado assim (achado ao vivo, mesma data: 0 dos 6 pilares
  // reais de uma loja de teste eram "reel"). Com isso, planWeeklyContent
  // reserva um dos POSTS_PER_WEEK slots como Reel sempre, e o pilar
  // continua decidindo ângulo/mensagem normalmente — só o formato final (e
  // o hint de estilo que vai pro Estágio 1) é forçado.
  forceReel?: boolean,
): Promise<WeeklyPlanSlot> {
  const product = await prisma.productCache.findUniqueOrThrow({
    where: { id: productId },
    include: { commerceSignal: true },
  });
  const shop = await prisma.shop.findUniqueOrThrow({ where: { id: shopId } });

  const objective = forcedObjective ?? inferObjective({
    inventoryQuantity: product.inventoryQuantity,
    salesVelocity: product.commerceSignal?.salesVelocity ?? null,
    daysSinceCreated: product.shopifyCreatedAt
      ? Math.floor((Date.now() - product.shopifyCreatedAt.getTime()) / (24 * 60 * 60 * 1000))
      : null,
    price: product.price,
  });

  // Quando forceReel, o Estágio 1 recebe o pilar com idealFormat="reel"
  // (mesmo que o pilar real seja carousel/single_image) — só pra escrever
  // um ângulo/mensagem que combine com o formato final; o resto do pilar
  // (problema, promessa, CTA) continua vindo do pilar de verdade sorteado.
  const effectivePillar = forceReel && pillar ? { ...pillar, idealFormat: "reel" } : pillar;

  const stage1Input = await buildStage1Input({
    shopId,
    shop,
    product,
    objective,
    effectivePillar,
    promotion,
  });
  const brief = await decideContentBrief(stage1Input);

  const copy = await generateCreativeCopy(
    brief,
    shop.contentLanguagePrimary as ContentLanguageCode,
    {
      brandDescription: shop.brandDescription,
      brandTone: shop.brandTone,
      brandAvoid: shop.brandAvoid,
    },
    describeEvidence(stage1Input),
    maxPrimaryCaptionChars(Boolean(shop.contentLanguageSecondary)),
  );

  const secondaryCaption = shop.contentLanguageSecondary
    ? await translateCaption(copy.captionText, shop.contentLanguageSecondary as ContentLanguageCode)
    : null;
  const captionText = buildBilingualCaption(copy.captionText, secondaryCaption);

  const contentItem = await prisma.contentItem.create({
    data: {
      shopId,
      productId: product.id,
      contentPillarId: pillar?.id ?? null,
      promotionId: promotion?.id ?? null,
      platform: brief.channel,
      commercialObjective: objective,
      objectiveSource: promotion ? "campaign" : forcedObjective ? "merchant" : "ai",
      decisionBrief: brief,
      captionText,
      hashtags: copy.hashtags.join(", "),
      cta: copy.cta,
      status: "draft",
      scheduledAt,
      weekBatchId,
    },
  });

  // Só o hero da semana pode gerar uma editorial NOVA. Pros demais, só
  // montamos o carrossel se já existir uma editorial reaproveitável — senão
  // deixamos sem imagem e sinalizamos, em vez de queimar crédito fora do
  // orçamento da semana. O resultado do hero agora É checado (achado de
  // revisão, 12/09/2026: "the hero slot also ignores the returned
  // image-generation failure result" — antes, se a geração falhasse, o post
  // ficava agendado sem imagem nenhuma e sem sinalizar).
  // Todo slot da semana gera imagem na hora, não só o hero (Patricia,
  // 13/09/2026: "as imagens dos posts da semana já devem ser todas criadas
  // ao mesmo tempo") — antes, só o hero tinha permissão de gerar uma
  // editorial NOVA; os demais ficavam sem imagem a não ser que já existisse
  // uma editorial não usada pra reaproveitar, pra conter o custo de gerar
  // imagem por IA. `buildCarousel` já reaproveita uma editorial não usada
  // quando existe, então isso só muda o caso em que NENHUMA existe: antes
  // ficava sem imagem, agora gera nova
  // pros 3 posts — o custo de até 3 gerações por semana em vez de 1 é a
  // troca consciente aqui.
  const result = await buildCarousel({
    shopId,
    productId: product.id,
    contentItemId: contentItem.id,
    objective,
    creativeAngle: brief.creativeAngle,
    format: brief.format,
  });
  const needsManualImage = result.status !== "success";
  // A foto lifestyle da Shopify é sempre opção no painel de escolha (ver
  // app.plan-week.tsx) — classifica agora, uma vez por foto, nunca no loader.
  await classifyShopifyShotTypes(product.id).catch(() => undefined);

  // Monta o Reel automaticamente quando o pilar pede esse formato (Patricia,
  // 20/09/2026: "integrar Reel no Weekly plan automático") — mesmo pipeline
  // já usado manualmente em Create Content (buildReel.server.ts, monta um
  // MP4 a partir das stills acima, sem chamar IA de vídeo nenhuma). Nunca
  // deixa uma falha aqui derrubar o slot inteiro: sem Reel, o post segue
  // publicável como imagem normal, só sem o formato preferido do pilar.
  let itemFormat = contentItem.format;
  let videoUrl: string | null = null;
  if (!needsManualImage && (forceReel || pillar?.idealFormat === "reel")) {
    try {
      await generateReelForContentItem(contentItem.id, shopId);
      const updated = await prisma.contentItem.findUniqueOrThrow({
        where: { id: contentItem.id },
        select: { format: true, videoUrl: true },
      });
      itemFormat = updated.format;
      videoUrl = updated.videoUrl;
    } catch (error) {
      console.error(`Failed to build Reel for content item ${contentItem.id}:`, error);
    }
  }

  const images = await loadSlotImages(contentItem.id);

  return {
    contentItemId: contentItem.id,
    productId: product.id,
    productTitle: product.title,
    objective,
    objectiveSource: promotion ? "campaign" : forcedObjective ? "merchant" : "ai",
    pillarName: pillar?.name ?? null,
    promotionName: promotion?.name ?? null,
    needsManualImage,
    imageCandidates: needsManualImage ? await loadPendingImageCandidates(contentItem.id) : [],
    imageRegenerationsLeft: MAX_IMAGE_REGENERATIONS_PER_POST,
    previousImage: null,
    shopifyLifestyleImage: await loadLifestyleShopifyImage(product.id),
    scheduledAt: scheduledAt.toISOString(),
    publishedAt: null, // recém-criado — nunca publicado ainda neste ponto
    status: contentItem.status,
    format: itemFormat,
    videoUrl,
    captionText: stripFrameworkLabels(captionText ?? ""),
    captionRegenerationCount: 0,
    images,
    tiktokSettings: null,
    tiktokPublishStatus: null,
    tiktokDefaultTitle: buildFinalCaption({
      captionText: contentItem.captionText ?? "",
      cta: contentItem.cta,
      hashtags: parseStoredHashtags(contentItem.hashtags),
    }).slice(0, TIKTOK_TITLE_MAX_LENGTH),
  };
}

// Gera o plano da semana inteiro de uma vez: escolhe os produtos, decide
// estratégia + copy + imagem pra cada um. Só o primeiro (maior prioridade)
// recebe imagem editorial nova; os demais reaproveitam ou ficam pendentes.
// Cada slot recebe o dia+horário da posição em resolveWeeklySchedule (real
// da conta quando existe, senão o padrão de pesquisa) — a lojista pode
// mudar depois na própria tela.
//
// Antes de criar o novo lote, CANCELA qualquer post do lote anterior que
// ainda não tenha sido publicado (achado de revisão, 12/09/2026: "Clicking
// Generate this week's plan again creates another batch without replacing
// or cancelling the previous one... both batches can become eligible for
// publication"). Nunca toca em posts já publicados ou publicando — aqueles
// ficam como histórico.
export async function planWeeklyContent(
  shopId: string,
  // Escolhido pela lojista ANTES de gerar (Patricia, 12/09/2026: "antes de
  // criar os post a pessoa escolhe o objetivo") — undefined mantém o
  // comportamento antigo de inferir por produto (ver inferObjective). Agora
  // aceita MAIS DE UM objetivo (Patricia, 13/09/2026: "ele pode escolher
  // mais de um objetivo") — cada slot da semana recebe um objetivo da lista
  // em rodízio (slot 0 → objectives[0], slot 1 → objectives[1], repete se
  // houver mais slots que objetivos), então a ESCOLHA DE PRODUTO também
  // precisa ser refeita por slot, não mais um ranking único pra semana
  // toda: um produto bom pra "Clear excess stock" pode não ser o melhor pra
  // "Drive sales" no mesmo lote. (A troca de objetivo por post saiu em
  // 30/09/2026 — Patricia: "já temos o Campaign objective(s) for this week".)
  forcedObjectives?: CommercialObjective[],
): Promise<WeeklyPlanSlot[]> {
  // Reivindica a trava de geração antes de mexer em qualquer ContentItem —
  // sem isso, duas chamadas concorrentes pra mesma loja (duplo clique, ou o
  // cron diário rodando junto com um clique manual) criavam DOIS
  // weekBatchId disputando a mesma semana (achado de revisão de código,
  // 13/09/2026). Trava expira sozinha depois de 15 minutos, pra não travar
  // a loja pra sempre se o processo cair no meio de uma geração real.
  const STALE_LOCK_MS = 15 * 60 * 1000;
  const claimed = await prisma.shop.updateMany({
    where: {
      id: shopId,
      OR: [
        { weeklyPlanGeneratingAt: null },
        { weeklyPlanGeneratingAt: { lt: new Date(Date.now() - STALE_LOCK_MS) } },
      ],
    },
    data: { weeklyPlanGeneratingAt: new Date() },
  });
  if (claimed.count === 0) {
    throw new Error("A weekly plan is already being generated for this shop — please wait for it to finish.");
  }

  try {
    // Checada de novo AQUI (não só na rota manual) pra proteger também o
    // cron diário (generateDueWeeklyPlans), que chamava direto sem essa
    // checagem — sem isso, uma promoção com mais de 7 dias de duração
    // podia ser cancelada silenciosamente pelo cron mesmo com a trava do
    // botão manual já em vigor (achado de revisão de código, 13/09/2026).
    const activePromotion = await getActivePromotion(shopId);
    if (activePromotion) {
      throw new Error(
        `The ${activePromotion.name} promotion is running until ${activePromotion.endsAt.toLocaleDateString()} — its posts can't be replaced by a regular weekly plan while it's active.`,
      );
    }

    const shop = await prisma.shop.findUniqueOrThrow({ where: { id: shopId } });
    const timeZone = shop.ianaTimezone ?? "UTC";

    // Produtos do lote que está sendo descartado agora — capturados ANTES
    // do cancelamento, pra excluir da nova rodada de verdade (Patricia,
    // 22/09/2026: "when regenerating no one of the previous products can be
    // showed again"). getProductUsageStats só enxerga posts PUBLICADOS
    // (decisão deliberada de 12/09/2026, pra não penalizar um rascunho
    // abandonado nunca mostrado pra audiência) — mas isso deixava
    // regenerações sucessivas do MESMO rascunho ainda não publicado livres
    // pra escolher os mesmos produtos de novo e de novo, já que nada
    // contava como "usado" até publicar de verdade.
    const cancelledProductIds = (
      await prisma.contentItem.findMany({
        where: {
          shopId,
          weekBatchId: { not: null },
          // Post de campanha nunca é descartado pelo plano normal (ver
          // updateMany abaixo).
          promotionId: null,
          status: { notIn: ["published", "publishing", "partial", "cancelled"] },
          productId: { not: null },
        },
        select: { productId: true },
      })
    ).map((item) => item.productId as string);

    // Nunca cancela post de campanha (Patricia, 06/10/2026): antes, uma
    // campanha agendada para o futuro (ex.: Black Friday) era apagada sem
    // aviso pelo cron 7 dias depois, porque getActivePromotion só protege
    // uma promoção que JÁ começou.
    await prisma.contentItem.updateMany({
      where: {
        shopId,
        weekBatchId: { not: null },
        promotionId: null,
        status: { notIn: ["published", "publishing", "partial", "cancelled"] },
      },
      data: { status: "cancelled" },
    });

    // Slots que cairiam dentro de uma campanha agendada ficam de fora — a
    // campanha manda nesses dias (ver planPromotionalWeek).
    const upcomingPromotions = await prisma.promotion.findMany({
      where: { shopId, endsAt: { gt: new Date() } },
    });

    const weekBatchId = crypto.randomUUID();

    const weeklySlotPlan = getWeeklySlotPlan(shop);
    const pillarsForSlots = await allocatePillarsForWeek(shopId, weeklySlotPlan.postsPerWeek);
    const schedule = await resolveWeeklySchedule(shop, weeklySlotPlan.postsPerWeek);

    const usedProductIds = new Set<string>(cancelledProductIds);
    const slots: WeeklyPlanSlot[] = [];
    for (let index = 0; index < weeklySlotPlan.postsPerWeek; index++) {
      const objectiveForSlot = forcedObjectives?.length
        ? forcedObjectives[index % forcedObjectives.length]
        : undefined;

      // Reranqueia por slot (não uma vez só pra semana inteira) — cada
      // objetivo pode preferir um produto diferente, e sem isso o segundo
      // objetivo escolhido nunca influenciava produto nenhum.
      const ranked = await rankProductsForWeek(shopId, objectiveForSlot, timeZone);
      const candidate = ranked.find((entry) => !usedProductIds.has(entry.product.id));
      if (!candidate) break; // catálogo elegível menor que o plano dessa loja pede

      usedProductIds.add(candidate.product.id);

      const slotSchedule = schedule[index % schedule.length];
      const scheduledAt = nextWeeklyOccurrenceInTimezone(
        slotSchedule.weekday,
        slotSchedule.hour,
        slotSchedule.minute,
        timeZone,
      );
      if (upcomingPromotions.some((promotion) => isWithinPromotion(scheduledAt, promotion))) {
        usedProductIds.delete(candidate.product.id);
        continue;
      }
      const slot = await planOneSlot(
        shopId,
        candidate.product.id,
        pillarsForSlots[index],
        scheduledAt,
        weekBatchId,
        objectiveForSlot,
        undefined,
        weeklySlotPlan.reelSlotIndices.includes(index),
      );
      slots.push(slot);
    }

    await prisma.shop.update({
      where: { id: shopId },
      data: { lastWeeklyPlanGeneratedAt: new Date() },
    });

    return slots;
  } finally {
    await prisma.shop.update({
      where: { id: shopId },
      data: { weeklyPlanGeneratingAt: null },
    });
  }
}

const WEEKLY_PLAN_INTERVAL_DAYS = 7;
// Quantos dias antes do início uma campanha agendada vira posts de verdade
// (cron diário — 2 dias garante que nunca perde a janela).
const PROMOTION_LEAD_DAYS = 2;

export function isWithinPromotion(date: Date, promotion: Pick<Promotion, "startsAt" | "endsAt">): boolean {
  return date >= promotion.startsAt && date <= promotion.endsAt;
}

export function parseNextWeekObjectives(raw: unknown): CommercialObjective[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((value): value is CommercialObjective =>
    (COMMERCIAL_OBJECTIVES as readonly string[]).includes(value),
  );
}

export function promotionNeedsPostsNow(promotion: Pick<Promotion, "startsAt">): boolean {
  return promotion.startsAt.getTime() <= Date.now() + PROMOTION_LEAD_DAYS * 24 * 60 * 60 * 1000;
}

export interface NextWeekPreviewSlot {
  weekday: number;
  hour: number;
  minute: number;
  format: "post" | "reel";
  productTitle: string | null;
  objective: CommercialObjective | null;
  campaignName: string | null; // slot coberto por uma campanha agendada
}

export interface NextWeekPreview {
  buildsAround: string; // ISO — quando o cron monta a próxima semana
  objectives: CommercialObjective[];
  confirmedAt: string | null;
  slots: NextWeekPreviewSlot[];
  upcomingPromotions: { id: string; name: string; discountPct: number; startsAt: string; endsAt: string; planned: boolean }[];
}

// Prévia da próxima semana SEM nenhuma chamada de IA nem imagem (Patricia,
// 06/10/2026: "sem gerar os criativos ou textos apenas com definição do
// plan") — mesmo ranking, cadência e horários que planWeeklyContent vai
// usar, então mostra o que sairia se a semana fosse montada agora. A
// escolha final acontece na hora de montar, com o estoque daquele momento.
export async function previewNextWeekPlan(shopId: string): Promise<NextWeekPreview> {
  const shop = await prisma.shop.findUniqueOrThrow({ where: { id: shopId } });
  const timeZone = shop.ianaTimezone ?? "UTC";
  const objectives = parseNextWeekObjectives(shop.nextWeekObjectives);

  const buildsAround = new Date(
    Math.max(
      Date.now(),
      (shop.lastWeeklyPlanGeneratedAt?.getTime() ?? Date.now()) +
        WEEKLY_PLAN_INTERVAL_DAYS * 24 * 60 * 60 * 1000,
    ),
  );

  const promotions = await prisma.promotion.findMany({
    where: { shopId, endsAt: { gt: new Date() } },
    include: { _count: { select: { contentItems: true } } },
    orderBy: { startsAt: "asc" },
  });

  // Produtos da semana atual saem da prévia: os publicados ficam
  // penalizados por reuso e os não publicados são descartados ao montar.
  const latestBatch = await prisma.contentItem.findFirst({
    where: { shopId, weekBatchId: { not: null }, promotionId: null },
    orderBy: { createdAt: "desc" },
    select: { weekBatchId: true },
  });
  const currentBatchProducts = latestBatch?.weekBatchId
    ? await prisma.contentItem.findMany({
        where: { shopId, weekBatchId: latestBatch.weekBatchId, productId: { not: null } },
        select: { productId: true },
      })
    : [];
  const usedProductIds = new Set(currentBatchProducts.map((item) => item.productId as string));

  const weeklySlotPlan = getWeeklySlotPlan(shop);
  const schedule = await resolveWeeklySchedule(shop, weeklySlotPlan.postsPerWeek);

  const slots: NextWeekPreviewSlot[] = [];
  for (let index = 0; index < weeklySlotPlan.postsPerWeek; index++) {
    const slotSchedule = schedule[index % schedule.length];
    const scheduledAt = nextWeeklyOccurrenceInTimezone(
      slotSchedule.weekday,
      slotSchedule.hour,
      slotSchedule.minute,
      timeZone,
      buildsAround,
    );
    const format = weeklySlotPlan.reelSlotIndices.includes(index) ? "reel" : "post";
    const campaign = promotions.find((promotion) => isWithinPromotion(scheduledAt, promotion));
    if (campaign) {
      slots.push({ ...slotSchedule, format, productTitle: null, objective: null, campaignName: campaign.name });
      continue;
    }

    const forcedObjective = objectives.length > 0 ? objectives[index % objectives.length] : undefined;
    const ranked = await rankProductsForWeek(shopId, forcedObjective, timeZone);
    const candidate = ranked.find((entry) => !usedProductIds.has(entry.product.id));
    if (!candidate) break;
    usedProductIds.add(candidate.product.id);

    const product = candidate.product;
    slots.push({
      ...slotSchedule,
      format,
      productTitle: product.title,
      objective:
        forcedObjective ??
        inferObjective({
          inventoryQuantity: product.inventoryQuantity,
          salesVelocity: product.commerceSignal?.salesVelocity ?? null,
          daysSinceCreated: product.shopifyCreatedAt
            ? Math.floor((Date.now() - product.shopifyCreatedAt.getTime()) / (24 * 60 * 60 * 1000))
            : null,
          price: product.price,
        }),
      campaignName: null,
    });
  }

  return {
    buildsAround: buildsAround.toISOString(),
    objectives,
    confirmedAt: shop.nextWeekPlanConfirmedAt ? shop.nextWeekPlanConfirmedAt.toISOString() : null,
    slots,
    upcomingPromotions: promotions.map((promotion) => ({
      id: promotion.id,
      name: promotion.name,
      discountPct: promotion.discountPct,
      startsAt: promotion.startsAt.toISOString(),
      endsAt: promotion.endsAt.toISOString(),
      planned: promotion._count.contentItems > 0,
    })),
  };
}

export interface GenerateDueWeeklyPlansOutcome {
  shopId: string;
  slotCount: number;
  error?: string;
}

// Gera sozinho o plano da PRÓXIMA semana pra toda loja que já passou do
// intervalo desde a última geração, OU cujo lote atual já esgotou (sem
// nenhum post pendente) mesmo antes do prazo — distinto de
// publishDueContentItems, que só publica um plano já existente (achado de
// revisão externa, 12/09/2026: "there is also a distinction between
// publishing an existing plan automatically and creating the next plan
// automatically... no recurring weekly-plan generation path"). Pensado
// pra ser chamado pelo mesmo tipo de cron externo que chama
// /cron/publish-scheduled, mas em intervalo maior (uma vez por dia já
// cobre o caso de uso).
export async function generateDueWeeklyPlans(): Promise<GenerateDueWeeklyPlansOutcome[]> {
  const cutoff = new Date(Date.now() - WEEKLY_PLAN_INTERVAL_DAYS * 24 * 60 * 60 * 1000);

  const candidateShops = await prisma.shop.findMany({
    where: {
      uninstalledAt: null,
      // Pausa em Settings para também a geração (sem custo de IA).
      publishingPausedAt: null,
      socialAccounts: { some: { platform: "instagram", igBusinessAccountId: { not: null } } },
    },
    select: { id: true, lastWeeklyPlanGeneratedAt: true },
  });

  // Achado ao vivo, 24/09/2026: o timer de 7 dias sozinho deixa a lojista
  // sem NENHUM post agendado por dias sempre que o lote atual esgota antes
  // do prazo (reagendamento manual comprimiu os 3 posts da semana em
  // ~36h) — "se a cliente olhar não vai entender". Além do timer, uma
  // loja também entra na fila assim que o lote atual não tem mais post
  // pendente (draft/approved) nenhum, mesmo que os 7 dias não tenham
  // passado — nunca deixa a tela do Weekly Plan vazia à toa.
  const dueShops: { id: string }[] = [];
  for (const shop of candidateShops) {
    const timerDue = !shop.lastWeeklyPlanGeneratedAt || shop.lastWeeklyPlanGeneratedAt <= cutoff;
    if (timerDue) {
      dueShops.push(shop);
      continue;
    }
    const pendingCount = await prisma.contentItem.count({
      where: { shopId: shop.id, weekBatchId: { not: null }, status: { in: ["draft", "approved"] } },
    });
    if (pendingCount === 0) {
      dueShops.push(shop);
    }
  }

  // Uma loja com erro (IA, produto com dado faltando etc.) não pode travar
  // a geração de TODAS as outras lojas do dia — isolar por loja (Patricia,
  // 13/09/2026, revisão de código; mesmo padrão já usado em
  // collectPerformanceSignals).
  const outcomes: GenerateDueWeeklyPlansOutcome[] = [];

  // Campanhas agendadas só viram posts (IA + imagem) perto de começar —
  // criar a campanha no app só guarda a definição (Patricia, 06/10/2026).
  for (const shop of candidateShops) {
    const duePromotions = await prisma.promotion.findMany({
      where: {
        shopId: shop.id,
        startsAt: { lte: new Date(Date.now() + PROMOTION_LEAD_DAYS * 24 * 60 * 60 * 1000) },
        endsAt: { gt: new Date() },
        contentItems: { none: {} },
      },
      orderBy: { startsAt: "asc" },
    });
    for (const promotion of duePromotions) {
      try {
        const slots = await planPromotionalWeek(shop.id, promotion);
        outcomes.push({ shopId: shop.id, slotCount: slots.length });
        await notifyWeeklyPlanReady(shop.id, slots.length);
      } catch (error) {
        console.error(`Failed to build promotion ${promotion.id} for shop ${shop.id}:`, error);
        outcomes.push({
          shopId: shop.id,
          slotCount: 0,
          error: error instanceof Error ? error.message : "unknown error",
        });
      }
    }
  }

  for (const shop of dueShops) {
    // Durante uma campanha o plano normal fica parado de propósito — pular
    // em vez de registrar erro todo dia.
    if (await getActivePromotion(shop.id)) continue;
    try {
      // Plano definido no fim da tela da semana anterior ("Next week's
      // plan") — vazio = a IA decide por produto.
      const shopRow = await prisma.shop.findUniqueOrThrow({
        where: { id: shop.id },
        select: { nextWeekObjectives: true },
      });
      const nextWeekObjectives = parseNextWeekObjectives(shopRow.nextWeekObjectives);
      const slots = await planWeeklyContent(
        shop.id,
        nextWeekObjectives.length > 0 ? nextWeekObjectives : undefined,
      );
      await prisma.shop.update({
        where: { id: shop.id },
        data: { nextWeekPlanConfirmedAt: null },
      });
      outcomes.push({ shopId: shop.id, slotCount: slots.length });
      await notifyWeeklyPlanReady(shop.id, slots.length);
    } catch (error) {
      console.error(`Failed to generate weekly plan for shop ${shop.id}:`, error);
      outcomes.push({
        shopId: shop.id,
        slotCount: 0,
        error: error instanceof Error ? error.message : "unknown error",
      });
    }
  }
  return outcomes;
}

// Recupera o lote atual do banco (Patricia, 12/09/2026, via revisão: "make
// the saved plan the source of truth. Reopening the page must restore
// it.") — pega o weekBatchId mais recente da loja e devolve todos os posts
// dele, com o status real de cada um (inclusive já publicados desde a
// última visita, ou que falharam). Fonte única de verdade pra tela do
// plano semanal, tanto no primeiro load quanto depois de qualquer ação.
//
// Só o lote MAIS RECENTE (Patricia, 21/09/2026: "os anuncios ja publicados
// da semana anterior deveriam desaparecer desta tela... ali deve ser apenas
// o weekly plan") — antes disso, um post já publicado de um lote ANTERIOR
// continuava aparecendo aqui por até 7 dias (pensado originalmente pra
// cobrir regenerar a semana depois de já ter publicado algo dela, ver
// histórico), mas na prática misturava posts de semanas diferentes na
// mesma tela e confundia qual conteúdo é o da semana atual de verdade. O
// post antigo continua publicado no Instagram normalmente — só não aparece
// mais NESTA tela depois que um lote novo existe.
export async function getCurrentWeekBatch(shopId: string): Promise<WeeklyPlanSlot[]> {
  const latest = await prisma.contentItem.findFirst({
    where: { shopId, weekBatchId: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { weekBatchId: true },
  });
  if (!latest?.weekBatchId) return [];

  // Mais os posts ainda pendentes de OUTRO lote (Patricia, 06/10/2026) —
  // quando uma campanha vira o lote mais recente, os posts normais fora do
  // período dela continuam agendados e precisam continuar visíveis aqui.
  const items = await prisma.contentItem.findMany({
    where: {
      shopId,
      OR: [
        { weekBatchId: latest.weekBatchId },
        { weekBatchId: { not: null }, status: { in: ["draft", "approved"] } },
      ],
    },
    include: {
      product: true,
      contentPillar: true,
      promotion: true,
      images: { orderBy: { position: "asc" }, include: { creativeAsset: true, productImage: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const choiceDataByItem = new Map(
    await Promise.all(
      items.map(
        async (item) =>
          [
            item.id,
            {
              candidates: await loadPendingImageCandidates(item.id),
              previousImage: await loadPreviousHeroImage(item.previousHeroAssetId),
              shopifyLifestyleImage: item.productId ? await loadLifestyleShopifyImage(item.productId) : null,
            },
          ] as const,
      ),
    ),
  );

  return items.map((item) => ({
    contentItemId: item.id,
    productId: item.productId ?? "",
    productTitle: item.product?.title ?? "(product removed)",
    objective: item.commercialObjective,
    objectiveSource: item.objectiveSource,
    pillarName: item.contentPillar?.name ?? null,
    promotionName: item.promotion?.name ?? null,
    needsManualImage: item.images.length === 0,
    imageCandidates: choiceDataByItem.get(item.id)?.candidates ?? [],
    imageRegenerationsLeft: Math.max(0, MAX_IMAGE_REGENERATIONS_PER_POST - item.imageRegenerationCount),
    previousImage: choiceDataByItem.get(item.id)?.previousImage ?? null,
    shopifyLifestyleImage: choiceDataByItem.get(item.id)?.shopifyLifestyleImage ?? null,
    scheduledAt: (item.scheduledAt ?? item.createdAt).toISOString(),
    publishedAt: item.publishedAt ? item.publishedAt.toISOString() : null,
    status: item.status,
    format: item.format,
    videoUrl: item.videoUrl,
    captionText: stripFrameworkLabels(item.captionText ?? ""),
    captionRegenerationCount: item.captionRegenerationCount,
    tiktokSettings: parseStoredTikTokSettings(item.tiktokSettings),
    tiktokPublishStatus: item.tiktokPublishStatus,
    tiktokDefaultTitle: buildFinalCaption({
      captionText: item.captionText ?? "",
      cta: item.cta,
      hashtags: parseStoredHashtags(item.hashtags),
    }).slice(0, TIKTOK_TITLE_MAX_LENGTH),
    images: item.images.map((row) => ({
      position: row.position,
      url: row.creativeAsset?.imageUrl ?? row.productImage?.url ?? "",
      source: row.creativeAssetId ? ("ai_generated" as const) : ("shopify_existing" as const),
    })),
  }));
}

export type SwapProductResult =
  | { status: "success"; slot: WeeklyPlanSlot }
  | { status: "error"; reason: string };

// Troca o produto de um slot já gerado (Patricia, 12/09/2026: a Home promete
// "you can always swap the products chosen for you in the Weekly plan tab",
// então essa troca precisa existir de verdade, não só o botão de regenerar a
// semana inteira). Nunca gera imagem editorial NOVA na troca — reaproveita
// uma editorial já existente se houver; senão fica sinalizado precisando de
// imagem manual, mesmo padrão de planOneSlot. Só apaga o ContentItem antigo
// DEPOIS que o novo já existe, pra nunca ficar sem nenhum dos dois se algo
// falhar no meio. Herda o weekBatchId do slot antigo, pra continuar fazendo
// parte do mesmo lote (não vira um post órfão fora da tela do plano).
export async function swapWeeklyPlanSlotProduct(params: {
  shopId: string;
  contentItemId: string;
  newProductId: string;
}): Promise<SwapProductResult> {
  const oldItem = await prisma.contentItem.findUnique({
    where: { id: params.contentItemId },
    include: { contentPillar: true, promotion: true },
  });
  if (!oldItem || oldItem.shopId !== params.shopId) {
    return { status: "error", reason: "This post is no longer part of the current plan." };
  }
  if (!["draft", "approved"].includes(oldItem.status)) {
    return {
      status: "error",
      reason: "This post has already been scheduled or published — it can no longer be swapped.",
    };
  }

  const newProduct = await prisma.productCache.findFirst({
    where: { id: params.newProductId, shopId: params.shopId },
  });
  if (!newProduct) {
    return { status: "error", reason: "Product not found." };
  }

  // Post de promoção só pode ser trocado por outro produto dentro do
  // mesmo escopo (coleção/produtos) anunciado — trocar pra fora do escopo
  // publicaria um desconto que não se aplica àquele produto (Patricia,
  // 13/09/2026, revisão de código).
  if (oldItem.promotion) {
    const eligible = await getPromotionEligibleProducts(params.shopId, oldItem.promotion);
    if (!eligible.some((product) => product.id === newProduct.id)) {
      return {
        status: "error",
        reason: `This product isn't part of the ${oldItem.promotion.name} promotion's scope.`,
      };
    }
  }

  // Mantém o mesmo horário do slot trocado — a troca é só de produto, o dia
  // e horário já definidos (padrão ou escolhidos pela lojista) não mudam. Só
  // força o objetivo antigo quando o post é de uma promoção real (ela manda
  // no objetivo do lote inteiro); um post comum continua reinferindo o
  // objetivo pro produto novo, já que um produto diferente pode ter um sinal
  // comercial bem diferente do antigo.
  const newSlot = await planOneSlot(
    params.shopId,
    newProduct.id,
    oldItem.contentPillar,
    oldItem.scheduledAt ?? new Date(),
    oldItem.weekBatchId,
    oldItem.promotion ? (oldItem.commercialObjective as CommercialObjective) : undefined,
    oldItem.promotion ?? undefined,
    // Preserva o Reel da semana se ESTE post era ele — sem isso, trocar o
    // produto do slot reservado como Reel o rebaixava de volta pra imagem
    // estática, e a garantia de "1 Reel por semana" deixava de valer assim
    // que a lojista trocasse o produto desse post específico.
    oldItem.format === "reel",
  );

  await prisma.contentItemImage.deleteMany({ where: { contentItemId: oldItem.id } });
  await prisma.trackedLink.deleteMany({ where: { contentItemId: oldItem.id } });
  await prisma.performanceSignal.deleteMany({ where: { contentItemId: oldItem.id } });
  // Preserva os logs de custo/uso de IA (histórico de billing), só solta a
  // referência ao post descartado em vez de apagá-los.
  await prisma.generationLog.updateMany({
    where: { contentItemId: oldItem.id },
    data: { contentItemId: null },
  });
  await prisma.contentItem.delete({ where: { id: oldItem.id } });

  return { status: "success", slot: newSlot };
}

export type RegenerateImageResult =
  | { status: "success"; images: WeeklyPlanImage[] }
  | { status: "error"; reason: string };

// A lojista pode gostar do produto, da legenda e da estratégia de um post e
// querer só uma imagem diferente (Patricia, 13/09/2026: "gosta do post e do
// produto escolhido deveria ter opção de somente recriar a imagem") — sem
// regenerar o post inteiro (o que trocaria também a legenda). Reaproveita o
// MESMO creativeAngle/format já decididos no Estágio 1, e força uma
// editorial NOVA (forceNewHero) — sem isso, buildCarousel poderia
// devolver a MESMA imagem que ela acabou de pedir pra trocar, já que ela
// deixaria de estar "em uso" assim que a linha antiga for apagada.
export async function regenerateWeeklyPlanSlotImage(params: {
  shopId: string;
  contentItemId: string;
  // O que a lojista pediu especificamente pra melhorar — OBRIGATÓRIO quando
  // já existe uma imagem sendo substituída (regeneração de verdade, Patricia
  // 24/09/2026: "cada vez que ele regenerar ele precisa explicar pq quer
  // regenerar o que quer mudar", pra virar sinal de aprendizado real, ver
  // GenerationLog.regenerationReason). O mesmo botão também gera a PRIMEIRA
  // imagem de um slot que ainda não tem nenhuma (ex.: geração automática
  // falhou) — aí não é regeneração, não exige explicação nem consome a cota
  // de regeneração, só a geração normal do plano.
  feedback?: string;
  // "Trocar a modelo" / "trocar a situação" só nesta imagem — também valem
  // como motivo da regeneração (dispensam o texto).
  overrides?: RegenerationOverrides;
}): Promise<RegenerateImageResult> {
  const item = await prisma.contentItem.findUnique({
    where: { id: params.contentItemId },
    include: { images: { select: { id: true, position: true, creativeAssetId: true } } },
  });
  if (!item || item.shopId !== params.shopId) {
    return { status: "error", reason: "This post is no longer part of the current plan." };
  }
  if (!["draft", "approved"].includes(item.status)) {
    return { status: "error", reason: "This post has already been scheduled or published." };
  }
  if (item.imageRegenerationCount >= MAX_IMAGE_REGENERATIONS_PER_POST) {
    return {
      status: "error",
      reason: "You've already used this post's image regeneration. Choose one of the options below.",
    };
  }
  if (!item.productId) {
    return { status: "error", reason: "Product not found." };
  }

  const brief = item.decisionBrief as { creativeAngle?: string; format?: string } | null;
  if (!brief?.creativeAngle || !brief?.format) {
    return { status: "error", reason: "This post has no saved strategy to regenerate an image from." };
  }

  const isRegeneration = item.images.length > 0;
  const trimmedFeedback = params.feedback?.trim() ?? "";
  const hasOverrides = Boolean(params.overrides?.newModel || params.overrides?.occasion);
  if (isRegeneration && !trimmedFeedback && !hasOverrides) {
    return { status: "error", reason: "Explain what you'd like to change before regenerating." };
  }

  // Cota mensal de regeneração de imagem, espelhando a cota de geração do
  // plano da loja (Patricia, 24/09/2026: "regeneração inclui regenerar X
  // numeros por mes... nao 1X cada") — nunca deixa a chamada de IA rodar
  // sem crédito disponível. Só se aplica à regeneração de verdade, nunca à
  // primeira geração de um slot vazio.
  if (isRegeneration) {
    const shop = await prisma.shop.findUniqueOrThrow({ where: { id: params.shopId } });
    const remainingCredits = await getRemainingCredits(shop, "image");
    if (remainingCredits <= 0) {
      return {
        status: "error",
        reason: "You've used all your image regenerations for this month. Buy extra credit to keep regenerating.",
      };
    }
  }

  // As imagens atuais só saem se a nova der certo (achado 05/10/2026: antes
  // eram apagadas aqui, ANTES de gerar — se as 3 tentativas falhassem, o
  // post ficava sem imagem nenhuma). Opções pendentes de uma falha anterior
  // são substituídas pelas desta rodada.
  const previousImageIds = item.images.map((image) => image.id);
  const previousHeroAssetId = item.images.find((image) => image.position === 1)?.creativeAssetId ?? null;
  await discardPendingImageCandidates(item.id);
  // Conta a tentativa antes de chamar a IA — sucesso ou falha, ela já foi
  // usada (o custo de até 3 gerações acontece de qualquer jeito).
  await prisma.contentItem.update({
    where: { id: item.id },
    data: { imageRegenerationCount: { increment: 1 } },
  });

  const result = await buildCarousel({
    shopId: params.shopId,
    productId: item.productId,
    contentItemId: item.id,
    objective: item.commercialObjective as CommercialObjective,
    creativeAngle: brief.creativeAngle,
    format: brief.format,
    forceNewHero: true,
    correctionNote: trimmedFeedback || undefined,
    regenerationOverrides: params.overrides,
  });

  // Depois da única regeneração a lojista sempre cai no painel de escolha —
  // a foto da Shopify só aparece lá se for lifestyle.
  await classifyShopifyShotTypes(item.productId).catch(() => undefined);

  if (result.status !== "success") {
    return { status: "error", reason: result.reason };
  }
  if (previousImageIds.length > 0) {
    await prisma.contentItemImage.deleteMany({ where: { id: { in: previousImageIds } } });
  }
  if (previousHeroAssetId) {
    await prisma.contentItem.update({ where: { id: item.id }, data: { previousHeroAssetId } });
  }

  const images = await loadSlotImages(item.id);
  return { status: "success", images };
}

export type RegenerateCaptionResult =
  | { status: "success" }
  | { status: "error"; reason: string };

// Regenera SÓ a legenda de um post (Patricia, 30/09/2026: "não temos a opção
// de regenerar somente o texto" — a tabela de planos promete "Regenerar
// legenda ilimitado, não consome cota"). Mantém produto, decisão do Estágio 1
// (objetivo, arquétipo, ângulo, framework), imagem e horário; só roda o
// Estágio 2 (+ tradução) de novo, com a mesma evidência real do post original
// e o motivo que a lojista deu (obrigatório, igual à regeneração de imagem).
// Não consome crédito de imagem.
export async function regenerateWeeklyPlanSlotCaption(params: {
  shopId: string;
  contentItemId: string;
  feedback: string;
}): Promise<RegenerateCaptionResult> {
  const trimmedFeedback = params.feedback.trim();
  if (!trimmedFeedback) {
    return { status: "error", reason: "Explain what you'd like to change before regenerating." };
  }
  const item = await prisma.contentItem.findUnique({
    where: { id: params.contentItemId },
    include: { contentPillar: true, promotion: true },
  });
  if (!item || item.shopId !== params.shopId) {
    return { status: "error", reason: "This post is no longer part of the current plan." };
  }
  if (!["draft", "approved"].includes(item.status)) {
    return {
      status: "error",
      reason: "This post has already been scheduled or published — its caption can no longer change.",
    };
  }
  if (!item.productId || !item.decisionBrief) {
    return { status: "error", reason: "This post has no content decision to rewrite from." };
  }

  // Reserva a tentativa ANTES da chamada de IA, de forma atômica — dois
  // cliques rápidos nunca passam juntos do limite. Se a geração falhar, a
  // tentativa é devolvida (catch abaixo): só conta o que de fato gerou legenda.
  const claimed = await prisma.contentItem.updateMany({
    where: { id: item.id, captionRegenerationCount: { lt: MAX_CAPTION_REGENERATIONS_PER_POST } },
    data: { captionRegenerationCount: { increment: 1 } },
  });
  if (claimed.count === 0) {
    return {
      status: "error",
      reason: `You've used all ${MAX_CAPTION_REGENERATIONS_PER_POST} caption regenerations for this post.`,
    };
  }

  try {
    await rewriteCaption(item, item.productId, params.shopId, trimmedFeedback);
  } catch (error) {
    await prisma.contentItem.update({
      where: { id: item.id },
      data: { captionRegenerationCount: { decrement: 1 } },
    });
    throw error;
  }
  return { status: "success" };
}

async function rewriteCaption(
  item: Prisma.ContentItemGetPayload<{ include: { contentPillar: true; promotion: true } }>,
  productId: string,
  shopId: string,
  feedback: string,
): Promise<void> {
  const shop = await prisma.shop.findUniqueOrThrow({ where: { id: shopId } });
  const product = await loadProductWithSignal(productId);
  const brief = item.decisionBrief as unknown as Stage1Output;
  const pillar = item.contentPillar;
  const effectivePillar = item.format === "reel" && pillar ? { ...pillar, idealFormat: "reel" } : pillar;

  const stage1Input = await buildStage1Input({
    shopId,
    shop,
    product,
    objective: item.commercialObjective as CommercialObjective,
    effectivePillar,
    promotion: item.promotion,
  });

  const copy = await generateCreativeCopy(
    brief,
    shop.contentLanguagePrimary as ContentLanguageCode,
    {
      brandDescription: shop.brandDescription,
      brandTone: shop.brandTone,
      brandAvoid: shop.brandAvoid,
    },
    describeEvidence(stage1Input),
    maxPrimaryCaptionChars(Boolean(shop.contentLanguageSecondary)),
    { previousCaption: item.captionText ?? "", feedback },
  );
  const secondaryCaption = shop.contentLanguageSecondary
    ? await translateCaption(copy.captionText, shop.contentLanguageSecondary as ContentLanguageCode)
    : null;

  await prisma.contentItem.update({
    where: { id: item.id },
    data: {
      captionText: buildBilingualCaption(copy.captionText, secondaryCaption),
      hashtags: copy.hashtags.join(", "),
      cta: copy.cta,
    },
  });
}

export type RescheduleResult =
  | { status: "success"; scheduledAt: string }
  | { status: "error"; reason: string };

// Muda o dia/horário de UM post do plano (Patricia, 12/09/2026: "o cliente
// tbem deve poder alterar isso"). Não muda nada além da data — produto,
// copy e imagem ficam como estão.
export async function rescheduleWeeklyPlanSlot(params: {
  shopId: string;
  contentItemId: string;
  weekday: number;
  hour: number;
  minute: number;
}): Promise<RescheduleResult> {
  // A UI só manda valores válidos via <select>, mas um request malformado
  // (ou um futuro caller) sem essa checagem produzia uma data errada em
  // silêncio: hora fora de 0-23 "rola" pra outro dia via Date.UTC, e
  // weekday fora de 0-6 quebra a conta de dias até a próxima ocorrência
  // (achado de revisão de código, 13/09/2026).
  if (
    !Number.isInteger(params.weekday) || params.weekday < 0 || params.weekday > 6 ||
    !Number.isInteger(params.hour) || params.hour < 0 || params.hour > 23 ||
    !Number.isInteger(params.minute) || params.minute < 0 || params.minute > 59
  ) {
    return { status: "error", reason: "Invalid day or time." };
  }

  const item = await prisma.contentItem.findUnique({ where: { id: params.contentItemId } });
  if (!item || item.shopId !== params.shopId) {
    return { status: "error", reason: "This post is no longer part of the current plan." };
  }
  if (!["draft", "approved"].includes(item.status)) {
    return { status: "error", reason: "This post has already been scheduled or published." };
  }

  const shop = await prisma.shop.findUniqueOrThrow({ where: { id: params.shopId } });
  // "soon", não "next-week" — reagendamento manual de um post que já
  // existe (Patricia, 23/09/2026: escolher um dia/horário que já passou
  // nesta semana não deve empurrar pra semana seguinte, e sim agendar pro
  // quanto antes; ver comentário em nextWeeklyOccurrenceInTimezone).
  const scheduledAt = nextWeeklyOccurrenceInTimezone(
    params.weekday,
    params.hour,
    params.minute,
    shop.ianaTimezone ?? "UTC",
    new Date(),
    "soon",
  );
  await prisma.contentItem.update({ where: { id: item.id }, data: { scheduledAt } });
  return { status: "success", scheduledAt: scheduledAt.toISOString() };
}

// Removido o passo de "Approve" (Patricia, 22/09/2026: "nao acho que
// precisamos deste step... a ideia é que o app funcione sem a necessidade
// de muita interacao") — ele nunca foi um gate de verdade pra publicação
// (um post "draft" já publicava sozinho no horário agendado, ver
// publishDueContentItems em publishContentItem.server.ts, comportamento
// intencional desde 12/09/2026), só mudava o texto de um badge na tela. Sem
// nenhum efeito prático, o botão só adicionava um clique que o app foi
// desenhado pra não exigir. Um ContentItem antigo com status="approved" no
// banco continua funcionando normalmente (isEditable/STATUS_LABELS ainda
// reconhecem esse valor) — só ninguém mais chega nele por aqui.
export type CancelResult =
  | { status: "success" }
  | { status: "error"; reason: string };

// Controle de pausar/cancelar pedido na revisão (Patricia, 12/09/2026: "the
// screen needs pause/cancel controls") — tira UM post do plano sem
// regenerar a semana inteira. Só cancela o que ainda não saiu no ar; nunca
// mexe em publicado/publicando.
export async function cancelWeeklyPlanSlot(params: {
  shopId: string;
  contentItemId: string;
}): Promise<CancelResult> {
  const result = await prisma.contentItem.updateMany({
    where: {
      id: params.contentItemId,
      shopId: params.shopId,
      status: { notIn: ["published", "publishing", "partial", "cancelled"] },
    },
    data: { status: "cancelled" },
  });
  if (result.count === 0) {
    return { status: "error", reason: "This post can no longer be cancelled (already published or publishing)." };
  }
  return { status: "success" };
}

// Aprovar / desfazer aprovação de um post (Settings → "Approve posts
// before they publish", 03/10/2026). Só faz diferença quando
// Shop.requireApproval está ligado — aí só "approved" publica sozinho (ver
// publishDueContentItems). Aprovar depois do horário publica na próxima
// rodada do agendador.
export async function setWeeklyPlanSlotApproval(params: {
  shopId: string;
  contentItemId: string;
  approved: boolean;
}): Promise<CancelResult> {
  const result = await prisma.contentItem.updateMany({
    where: {
      id: params.contentItemId,
      shopId: params.shopId,
      status: params.approved ? "draft" : "approved",
    },
    data: { status: params.approved ? "approved" : "draft" },
  });
  if (result.count === 0) {
    return { status: "error", reason: "This post can no longer be changed (already published or publishing)." };
  }
  return { status: "success" };
}

// Legenda ou imagem regenerada depois de aprovada = conteúdo que a lojista
// ainda não viu; volta pra "draft" pra nunca publicar sem nova aprovação.
export async function resetApprovalAfterEdit(shopId: string, contentItemId: string): Promise<void> {
  await prisma.contentItem.updateMany({
    where: { id: contentItemId, shopId, status: "approved" },
    data: { status: "draft" },
  });
}

export interface CreatePromotionInput {
  shopId: string;
  name: string;
  discountPct: number;
  scopeType: "store" | "collection" | "products";
  scopeValue?: string | null;
  startsAt: Date;
  endsAt: Date;
}

// Promoção real declarada pela lojista (Patricia, 13/09/2026, ver model
// Promotion) — a única fonte de evidência real pra Urgency fora de escassez
// de estoque (MARKETING-KNOWLEDGE.md seção 4).
export async function createPromotion(input: CreatePromotionInput): Promise<Promotion> {
  return prisma.promotion.create({
    data: {
      shopId: input.shopId,
      name: input.name,
      discountPct: input.discountPct,
      scopeType: input.scopeType,
      scopeValue: input.scopeValue ?? null,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
    },
  });
}

// "Ativa" = hoje está dentro de [startsAt, endsAt]. Uma promoção ativa
// SUBSTITUI o plano semanal normal inteiro (Patricia, 13/09/2026:
// "substitui"), nunca soma aos posts comuns — quem chama decide isso (ver
// action de app.content-pillars.tsx), esta função só responde "existe uma
// promoção valendo agora?".
export async function getActivePromotion(shopId: string): Promise<Promotion | null> {
  const now = new Date();
  return prisma.promotion.findFirst({
    where: { shopId, startsAt: { lte: now }, endsAt: { gte: now } },
    orderBy: { createdAt: "desc" },
  });
}

export async function getPromotionEligibleProducts(shopId: string, promotion: Promotion) {
  const baseWhere = { shopId, status: "active", inventoryQuantity: { gt: 0 } } as const;
  if (promotion.scopeType === "collection" && promotion.scopeValue) {
    // ProductCache.collections é uma string só, com até 5 nomes juntados
    // por ", " (ver syncProducts.server.ts) — não dá pra filtrar isso com
    // segurança direto no SQL (um "contains" pegaria "Sandals" dentro de
    // "Sandals 2026" por engano), então busca tudo elegível e filtra em JS
    // conferindo pertencimento exato na lista.
    const candidates = await prisma.productCache.findMany({
      where: baseWhere,
      include: { commerceSignal: true },
    });
    return candidates.filter((product) =>
      (product.collections ?? "")
        .split(",")
        .map((name) => name.trim())
        .includes(promotion.scopeValue as string),
    );
  }
  if (promotion.scopeType === "products" && promotion.scopeValue) {
    const ids = promotion.scopeValue.split(",").map((s) => s.trim()).filter(Boolean);
    return prisma.productCache.findMany({
      where: { ...baseWhere, id: { in: ids } },
      include: { commerceSignal: true },
    });
  }
  return prisma.productCache.findMany({ where: baseWhere, include: { commerceSignal: true } });
}

// Gera o plano da semana INTEIRO em torno de uma promoção real (Patricia,
// 13/09/2026: "substitui, e sim trava a publicação depois do prazo") — só
// produtos dentro do escopo da promoção, objetivo forçado "conversion"
// (onde Urgency é elegível, ver ELIGIBLE_ARCHETYPES_BY_OBJECTIVE), desconto
// e prazo reais entram como evidência no Estágio 1 em vez de qualquer
// urgência inventada. Os posts são espalhados dentro da própria janela da
// promoção (não no cronograma semanal padrão) — não faz sentido um post de
// "Black Friday" sair fora do período dela. A trava de "não publicar depois
// do prazo" fica em publishContentItem.server.ts, checando
// contentItem.promotion.endsAt antes de cada publicação.
export async function planPromotionalWeek(
  shopId: string,
  promotion: Promotion,
): Promise<WeeklyPlanSlot[]> {
  // Só substitui os posts normais agendados DENTRO do período da campanha
  // (Patricia, 06/10/2026: "start a seasonal campaign também muda tudo
  // depois do plano já ter sido implantado") — antes cancelava a semana
  // inteira, mesmo com a campanha começando semanas depois.
  await prisma.contentItem.updateMany({
    where: {
      shopId,
      weekBatchId: { not: null },
      promotionId: null,
      scheduledAt: { gte: promotion.startsAt, lte: promotion.endsAt },
      status: { notIn: ["published", "publishing", "partial", "cancelled"] },
    },
    data: { status: "cancelled" },
  });

  const weekBatchId = crypto.randomUUID();
  const eligibleProducts = await getPromotionEligibleProducts(shopId, promotion);

  // Lidera com o maior capital imobilizado — mesmo critério de Product
  // Opportunity já usado no plano normal (ver computeSlowMoverSignal), uma
  // promoção existe justamente pra mover o estoque que mais vale. Escalado
  // pela margem quando disponível (14/09/2026) — dar desconto num produto
  // de margem baixa é onde uma promoção mais facilmente vira prejuízo, não
  // faz sentido esse ser o produto priorizado só por ter capital parado.
  const ranked = eligibleProducts
    .map((product) => {
      const { tiedUpCapital } = computeSlowMoverSignal({
        inventoryQuantity: product.inventoryQuantity,
        salesVelocity: product.commerceSignal?.salesVelocity ?? null,
        price: product.price,
      });
      return { product, tiedUpCapital: tiedUpCapital * (product.commerceSignal?.margin ?? 1) };
    })
    .sort((a, b) => b.tiedUpCapital - a.tiedUpCapital);

  const pillarsForSlots = await allocatePillarsForWeek(shopId, POSTS_PER_WEEK);

  // Espalha os posts dentro da própria janela da promoção, não no
  // cronograma semanal genérico — 3 posts em partes iguais entre início e
  // fim, nunca exatamente na borda.
  const startMs = promotion.startsAt.getTime();
  const endMs = promotion.endsAt.getTime();
  const stepMs = (endMs - startMs) / (POSTS_PER_WEEK + 1);

  const slots: WeeklyPlanSlot[] = [];
  for (let index = 0; index < Math.min(POSTS_PER_WEEK, ranked.length); index++) {
    const scheduledAt = new Date(startMs + stepMs * (index + 1));
    const slot = await planOneSlot(
      shopId,
      ranked[index].product.id,
      pillarsForSlots[index],
      scheduledAt,
      weekBatchId,
      "conversion",
      promotion,
    );
    slots.push(slot);
  }

  await prisma.shop.update({
    where: { id: shopId },
    data: { lastWeeklyPlanGeneratedAt: new Date() },
  });

  return slots;
}
