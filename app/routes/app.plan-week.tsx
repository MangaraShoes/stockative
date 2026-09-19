import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  planWeeklyContent,
  getCurrentWeekBatch,
  swapWeeklyPlanSlotProduct,
  rescheduleWeeklyPlanSlot,
  approveWeeklyPlanSlot,
  cancelWeeklyPlanSlot,
  changeWeeklyPlanSlotObjective,
  regenerateWeeklyPlanSlotImage,
  getActivePromotion,
  type WeeklyPlanSlot,
} from "../services/decisionEngine/planWeek.server";
import {
  COMMERCIAL_OBJECTIVES,
  OBJECTIVE_LABELS,
  type CommercialObjective,
} from "../services/decisionEngine/constants";
import { weekdayInTimezone, timeInTimezone } from "../services/timezone";
import { getOnboardingStatus, type OnboardingStatus } from "../services/onboardingStatus.server";
import { OnboardingStepper } from "../components/OnboardingStepper";
import { GeneratingProgressBar } from "../components/GeneratingProgressBar";

const EMPTY_ONBOARDING_STATUS: OnboardingStatus = {
  hasStock: false,
  hasBrand: false,
  hasSocial: false,
  hasCompetitors: false,
  hasContentPillars: false,
  hasPublished: false,
};

const WEEKDAY_OPTIONS = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
];

const TIME_OPTIONS = [
  "07:00", "08:00", "09:00", "10:00", "11:00", "12:00",
  "13:00", "14:00", "15:00", "16:00", "17:00", "18:00",
  "19:00", "20:00", "21:00",
];


const STATUS_LABELS: Record<string, { label: string; tone: "info" | "success" | "critical" | "neutral" }> = {
  draft: { label: "Draft", tone: "info" },
  approved: { label: "Approved", tone: "info" },
  publishing: { label: "Publishing…", tone: "info" },
  partial: { label: "Finishing up…", tone: "info" },
  published: { label: "Published", tone: "success" },
  failed: { label: "Failed", tone: "critical" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

// Só pode ser editado (trocar produto, reagendar, aprovar, cancelar)
// enquanto ainda não saiu no ar nem está no meio da publicação.
function isEditable(status: string): boolean {
  return status === "draft" || status === "approved";
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
  });

  const socialAccount = shop
    ? await prisma.socialAccount.findUnique({
        where: { shopId_platform: { shopId: shop.id, platform: "instagram" } },
      })
    : null;

  // Catálogo elegível pra troca de produto — mesmo filtro de
  // rankProductsForWeek (ativo e com estoque), pra nunca deixar a lojista
  // trocar um slot pra um produto que nem entraria no plano.
  const products = shop
    ? await prisma.productCache.findMany({
        where: { shopId: shop.id, status: "active", inventoryQuantity: { gt: 0 } },
        select: { id: true, title: true },
        orderBy: { title: "asc" },
      })
    : [];

  const onboardingStatus = shop ? await getOnboardingStatus(shop.id) : EMPTY_ONBOARDING_STATUS;

  // O banco é a fonte única de verdade do plano (Patricia, 12/09/2026, via
  // revisão: "make the saved plan the source of truth. Reopening the page
  // must restore it.") — nunca mais só memória do navegador.
  const slots = shop ? await getCurrentWeekBatch(shop.id) : [];

  return {
    hasShop: Boolean(shop),
    isInstagramConnected: Boolean(socialAccount?.igBusinessAccountId),
    products,
    // Fuso horário real da loja (Patricia, 12/09/2026: "precisamos
    // considerar sim o fuso horario da loja") — usado pra mostrar e editar
    // dia/horário na perspectiva da loja, não na de quem está com o
    // navegador aberto num fuso diferente. ensureShopTimezone (chamado no
    // loader raiz de /app) garante que isso já existe quando chega aqui.
    shopTimezone: shop?.ianaTimezone ?? "UTC",
    onboardingStatus,
    slots,
  };
};

// Instagram conectado é obrigatório antes de gerar o plano semanal (Patricia,
// 10/09/2026: "este step deve vir como obrigatório... ele precisa buscar os
// dados da conta do IG para construir tudo isso junto com as informações do
// Shopify") — checado aqui também, não só desabilitando o botão na UI, pra
// nunca deixar passar uma chamada direta ao endpoint sem a conta conectada.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
  });
  if (!shop) throw new Response("Shop not found", { status: 404 });

  const formData = await request.formData();
  const intent = formData.get("intent");

  // As 3 ações abaixo chamam planOneSlot/buildCarousel por baixo (IA +
  // geração de imagem), que podem lançar exceção não tratada (achado ao
  // vivo, 13/09/2026, revisão de código — o mesmo padrão já corrigido hoje
  // em store-voice e content-pillars tinha ficado de fora desta tela).
  // Nunca deixar isso derrubar a página inteira: sempre devolve o mesmo
  // formato {status:"error", reason} que a UI já sabe mostrar.
  if (intent === "swap-product") {
    const contentItemId = String(formData.get("contentItemId"));
    const newProductId = String(formData.get("newProductId"));
    let result;
    try {
      result = await swapWeeklyPlanSlotProduct({ shopId: shop.id, contentItemId, newProductId });
    } catch (error) {
      console.error("Failed to swap product:", error);
      result = {
        status: "error" as const,
        reason: "Something went wrong generating the new post. Please try again.",
      };
    }
    return { intent: "swap-product" as const, contentItemId, result };
  }

  if (intent === "regenerate-image") {
    const contentItemId = String(formData.get("contentItemId"));
    const feedback = formData.get("feedback");
    let result;
    try {
      result = await regenerateWeeklyPlanSlotImage({
        shopId: shop.id,
        contentItemId,
        feedback: feedback ? String(feedback) : undefined,
      });
    } catch (error) {
      console.error("Failed to regenerate image:", error);
      result = {
        status: "error" as const,
        reason: "Something went wrong building the new image. Please try again.",
      };
    }
    return { intent: "regenerate-image" as const, contentItemId, result };
  }

  if (intent === "change-objective") {
    const contentItemId = String(formData.get("contentItemId"));
    const objective = String(formData.get("objective")) as CommercialObjective;
    let result;
    try {
      result = await changeWeeklyPlanSlotObjective({ shopId: shop.id, contentItemId, objective });
    } catch (error) {
      console.error("Failed to change objective:", error);
      result = {
        status: "error" as const,
        reason: "Something went wrong regenerating this post. Please try again.",
      };
    }
    return { intent: "change-objective" as const, contentItemId, result };
  }

  if (intent === "reschedule") {
    const contentItemId = String(formData.get("contentItemId"));
    const weekday = Number(formData.get("weekday"));
    const hour = Number(formData.get("hour"));
    const minute = Number(formData.get("minute"));
    const result = await rescheduleWeeklyPlanSlot({
      shopId: shop.id,
      contentItemId,
      weekday,
      hour,
      minute,
    });
    return { intent: "reschedule" as const, contentItemId, result };
  }

  if (intent === "approve") {
    const contentItemId = String(formData.get("contentItemId"));
    const result = await approveWeeklyPlanSlot({ shopId: shop.id, contentItemId });
    return { intent: "approve" as const, contentItemId, result };
  }

  if (intent === "cancel") {
    const contentItemId = String(formData.get("contentItemId"));
    const result = await cancelWeeklyPlanSlot({ shopId: shop.id, contentItemId });
    return { intent: "cancel" as const, contentItemId, result };
  }

  const socialAccount = await prisma.socialAccount.findUnique({
    where: { shopId_platform: { shopId: shop.id, platform: "instagram" } },
  });
  if (!socialAccount?.igBusinessAccountId) {
    throw new Response("Connect Instagram first — see Social accounts.", { status: 400 });
  }

  // Aceita mais de um objetivo marcado (Patricia, 13/09/2026: "ele pode
  // escolher mais de um objetivo") — cada um vira um <input> "objective"
  // separado no FormData, ver generateWeek() no componente.
  const objectiveValues = formData.getAll("objective").map(String) as CommercialObjective[];
  const forcedObjectives = objectiveValues.length > 0 ? objectiveValues : undefined;

  // Regenerar o plano normal cancela todo post não publicado do batch
  // anterior (ver planWeeklyContent), o que apagaria silenciosamente uma
  // campanha de promoção em andamento (desconto e prazo já anunciados)
  // (Patricia, 13/09/2026, revisão de código). Bloquear em vez de deixar
  // sumir sem aviso.
  const activePromotion = await getActivePromotion(shop.id);
  if (activePromotion) {
    return {
      intent: "generate" as const,
      slots: [] as WeeklyPlanSlot[],
      error: `The ${activePromotion.name} promotion is running until ${activePromotion.endsAt.toLocaleDateString()} — its posts can't be replaced by a regular weekly plan while it's active.`,
    };
  }

  try {
    const slots = await planWeeklyContent(shop.id, forcedObjectives);
    return { intent: "generate" as const, slots, error: null as string | null };
  } catch (error) {
    console.error("Failed to generate weekly plan:", error);
    return {
      intent: "generate" as const,
      slots: [] as WeeklyPlanSlot[],
      error: "Something went wrong building this week's plan. Please try again.",
    };
  }
};

function slotWeekday(slot: WeeklyPlanSlot, timeZone: string): number {
  return weekdayInTimezone(new Date(slot.scheduledAt), timeZone);
}

function slotTime(slot: WeeklyPlanSlot, timeZone: string): string {
  return timeInTimezone(new Date(slot.scheduledAt), timeZone);
}

// Sempre formatado no fuso da LOJA, não no de quem está olhando a tela —
// pra não mostrar um horário diferente do que de fato vai ser publicado
// pra uma lojista revisando de outro fuso (ex.: viajando).
function formatScheduledAt(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleString(undefined, {
    timeZone,
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function PlanWeek() {
  const { hasShop, isInstagramConnected, products, shopTimezone, onboardingStatus, slots } =
    useLoaderData<typeof loader>();

  // Mostrar na ordem em que os posts realmente saem no ar (Patricia,
  // 12/09/2026: "a sequencia de posts deve seguir a sequencia da semana"),
  // não na ordem em que foram criados.
  const orderedSlots = [...slots].sort(
    (a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime(),
  );

  // Cada ação submete e, ao terminar, o React Router revalida o loader
  // desta rota sozinho — então `slots` acima já reflete a mutação, sem
  // precisar corrigir um array em memória à mão (essa correção manual era
  // exatamente a causa do plano "sumir" ao dar refresh, ver revisão de
  // 12/09/2026). O `fetcher.data` só serve pra mostrar erro/sucesso pontual
  // enquanto o revalidate não chega.
  const generateFetcher = useFetcher<typeof action>();
  const swapFetcher = useFetcher<typeof action>();
  const manageFetcher = useFetcher<typeof action>();
  const objectiveFetcher = useFetcher<typeof action>();
  const imageFetcher = useFetcher<typeof action>();

  const [swapChoices, setSwapChoices] = useState<Record<string, string>>({});
  const [scheduleChoices, setScheduleChoices] = useState<
    Record<string, { weekday: number; time: string }>
  >({});
  // Mais de um objetivo pode ser marcado (Patricia, 13/09/2026: "ele pode
  // escolher mais de um objetivo") — cada slot da semana recebe um deles em
  // rodízio, ver planWeeklyContent.
  const [plannedObjectives, setPlannedObjectives] = useState<string[]>([]);
  const toggleObjective = (objective: string) =>
    setPlannedObjectives((current) =>
      current.includes(objective)
        ? current.filter((o) => o !== objective)
        : [...current, objective],
    );
  const [objectiveChoices, setObjectiveChoices] = useState<Record<string, string>>({});
  const [imageFeedback, setImageFeedback] = useState<Record<string, string>>({});
  const [zoomedImageUrl, setZoomedImageUrl] = useState<string | null>(null);

  const isGenerating = generateFetcher.state !== "idle";

  // Gerar a semana toda demora (3 posts, cada um com várias chamadas de IA
  // + imagem) — sem feedback incremental, a lojista pode achar que travou e
  // começar a dar refresh no meio (Patricia, 13/09/2026). Cada post já é
  // salvo no banco assim que fica pronto, então revalidar o loader
  // periodicamente enquanto gera faz os cards aparecerem um a um sozinhos,
  // sem precisar de nenhum mecanismo novo de progresso real-time.
  const revalidator = useRevalidator();
  useEffect(() => {
    if (!isGenerating) return;
    const interval = setInterval(() => {
      if (revalidator.state === "idle") revalidator.revalidate();
    }, 4000);
    return () => clearInterval(interval);
  }, [isGenerating, revalidator]);

  const generatingLabel =
    isGenerating && slots.length > 0
      ? `Post ${slots.length} of 3 ready — building the next one…`
      : "Picking products, writing captions and building images…";
  const activePromotionName = slots.find((slot) => slot.promotionName)?.promotionName ?? null;
  const canGenerate = hasShop && isInstagramConnected && !activePromotionName;
  // Os 4 fetchers acima são compartilhados entre TODOS os posts da semana —
  // sem isso, agir num post fazia o botão equivalente de TODOS os outros
  // posts também aparecer "carregando" (achado de revisão de código,
  // 13/09/2026). Cada submit já manda contentItemId no FormData, então dá
  // pra restringir o estado de loading só ao post que está de fato em voo.
  const submittingContentItemId = (fetcher: typeof swapFetcher) =>
    fetcher.state !== "idle" ? String(fetcher.formData?.get("contentItemId") ?? "") : null;
  const swappingContentItemId = submittingContentItemId(swapFetcher);
  const managingContentItemId = submittingContentItemId(manageFetcher);
  const changingObjectiveContentItemId = submittingContentItemId(objectiveFetcher);
  const regeneratingImageContentItemId = submittingContentItemId(imageFetcher);

  const generateWeek = () => {
    const formData = new FormData();
    formData.set("intent", "generate");
    plannedObjectives.forEach((objective) => formData.append("objective", objective));
    generateFetcher.submit(formData, { method: "POST" });
  };

  const swapProduct = (contentItemId: string) => {
    const newProductId = swapChoices[contentItemId];
    if (!newProductId) return;
    swapFetcher.submit(
      { intent: "swap-product", contentItemId, newProductId },
      { method: "POST" },
    );
  };

  const regenerateImage = (contentItemId: string) => {
    const feedback = imageFeedback[contentItemId]?.trim();
    imageFetcher.submit(
      { intent: "regenerate-image", contentItemId, ...(feedback ? { feedback } : {}) },
      { method: "POST" },
    );
  };

  const changeObjective = (contentItemId: string) => {
    const objective = objectiveChoices[contentItemId];
    if (!objective) return;
    objectiveFetcher.submit(
      { intent: "change-objective", contentItemId, objective },
      { method: "POST" },
    );
  };

  // Salva sozinho assim que a lojista muda dia ou horário (Patricia,
  // 13/09/2026: "se a pessoa alterar dia e horario isso deve salvar
  // automaticamente") — sem precisar de um botão "Save time" separado.
  const saveSchedule = (contentItemId: string, weekday: number, time: string) => {
    const [hour, minute] = time.split(":");
    manageFetcher.submit(
      { intent: "reschedule", contentItemId, weekday: String(weekday), hour, minute },
      { method: "POST" },
    );
  };

  const approveSlot = (contentItemId: string) =>
    manageFetcher.submit({ intent: "approve", contentItemId }, { method: "POST" });

  const cancelSlot = (contentItemId: string) =>
    manageFetcher.submit({ intent: "cancel", contentItemId }, { method: "POST" });

  const swapFailure =
    swapFetcher.data?.intent === "swap-product" && swapFetcher.data.result.status === "error"
      ? swapFetcher.data
      : null;

  const manageFailure =
    manageFetcher.data &&
    (manageFetcher.data.intent === "reschedule" ||
      manageFetcher.data.intent === "approve" ||
      manageFetcher.data.intent === "cancel") &&
    manageFetcher.data.result.status === "error"
      ? manageFetcher.data
      : null;

  const objectiveFailure =
    objectiveFetcher.data?.intent === "change-objective" &&
    objectiveFetcher.data.result.status === "error"
      ? objectiveFetcher.data
      : null;

  const imageFailure =
    imageFetcher.data?.intent === "regenerate-image" && imageFetcher.data.result.status === "error"
      ? imageFetcher.data
      : null;

  const generateFailure =
    generateFetcher.data?.intent === "generate" && generateFetcher.data.error
      ? generateFetcher.data.error
      : null;

  return (
    <s-page heading="Weekly plan">
      <OnboardingStepper status={onboardingStatus} currentStepHref="/app/plan-week" />

      <s-section heading="This week's content, picked for you">
        <s-paragraph>
          Every week, Stockative reads your stock — sales velocity, slow-moving
          inventory — and your saved content pillars to choose the 3 products
          that most deserve attention right now, then writes the caption,
          picks the visual angle, and builds the images for each one.
          Didn&apos;t land right? Swap the product, or move it to a different
          day and time, below. Want something extra? Create a one-off post
          anytime from &quot;Create content&quot;.
        </s-paragraph>
        <s-paragraph>
          Reviewing and approving is entirely optional. Untouched posts still
          go out automatically, right on schedule — unless they&apos;re
          missing an image, in which case they wait for you instead of
          publishing incomplete.
        </s-paragraph>
        <s-paragraph>
          <s-text color="subdued">
            All times below are shown in your store&apos;s own timezone
            ({shopTimezone}).
          </s-text>
        </s-paragraph>

        {!hasShop && (
          <s-paragraph>Sync your products first before generating a weekly plan.</s-paragraph>
        )}

        {hasShop && !isInstagramConnected && (
          <s-paragraph>
            <strong>
              Connect Instagram first (Social accounts) — a weekly plan is
              only useful if there&apos;s somewhere to publish it.
            </strong>
          </s-paragraph>
        )}

        {canGenerate && (
          <div style={{ marginBottom: 8 }}>
            <s-paragraph>
              Campaign objective(s) for this week
              <s-text color="subdued"> (pick one or more, or leave blank to let Stockative decide per product)</s-text>
            </s-paragraph>
            <s-stack direction="inline" gap="base">
              {COMMERCIAL_OBJECTIVES.map((objective) => (
                <label key={objective} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <input
                    type="checkbox"
                    checked={plannedObjectives.includes(objective)}
                    onChange={() => toggleObjective(objective)}
                  />
                  {OBJECTIVE_LABELS[objective]}
                </label>
              ))}
            </s-stack>
          </div>
        )}

        {slots.length === 0 && (
          <s-button
            onClick={generateWeek}
            {...(isGenerating ? { loading: true } : {})}
            {...(!canGenerate ? { disabled: true } : {})}
          >
            Generate this week&apos;s plan
          </s-button>
        )}

        {isGenerating && (
          <GeneratingProgressBar label={generatingLabel} />
        )}

        {slots.length === 0 && !isGenerating && hasShop && isInstagramConnected && (
          <s-paragraph>
            No plan yet this week — click &quot;Generate this week&apos;s
            plan&quot; above.
          </s-paragraph>
        )}

        {slots.length === 0 && generateFailure && (
          <s-paragraph>
            <strong>{generateFailure}</strong>
          </s-paragraph>
        )}

        {slots.length > 0 && (
          <s-stack direction="block" gap="base">
            {orderedSlots.map((slot) => {
              const editable = isEditable(slot.status);
              const isSwapping = swappingContentItemId === slot.contentItemId;
              const isManaging = managingContentItemId === slot.contentItemId;
              const isChangingObjective = changingObjectiveContentItemId === slot.contentItemId;
              const isRegeneratingImage = regeneratingImageContentItemId === slot.contentItemId;
              const swapOptions = products.filter(
                (product) =>
                  product.id !== slot.productId &&
                  !slots.some((s) => s.productId === product.id),
              );
              const currentWeekday = scheduleChoices[slot.contentItemId]?.weekday ?? slotWeekday(slot, shopTimezone);
              const currentTime = scheduleChoices[slot.contentItemId]?.time ?? slotTime(slot, shopTimezone);
              const statusInfo = STATUS_LABELS[slot.status] ?? { label: slot.status, tone: "neutral" as const };

              return (
                <s-box
                  key={slot.contentItemId}
                  padding="base"
                  borderWidth="base"
                  borderRadius="base"
                >
                  <s-stack direction="block" gap="small">
                    <s-stack direction="inline" gap="small" alignItems="center">
                      <s-heading>{slot.productTitle}</s-heading>
                      <s-badge tone={statusInfo.tone}>{statusInfo.label}</s-badge>
                    </s-stack>
                    <s-paragraph>
                      {OBJECTIVE_LABELS[slot.objective as CommercialObjective] ?? slot.objective}
                      {slot.pillarName && ` · pillar: ${slot.pillarName}`}
                      {slot.promotionName && ` · promotion: ${slot.promotionName}`}
                    </s-paragraph>
                    <s-paragraph>
                      {slot.status === "published" && slot.publishedAt
                        ? `Posted ${formatScheduledAt(slot.publishedAt, shopTimezone)}`
                        : `Posts ${formatScheduledAt(slot.scheduledAt, shopTimezone)}`}
                    </s-paragraph>

                    {slot.captionText && (
                      <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
                        <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontFamily: "inherit" }}>
                          {slot.captionText}
                        </pre>
                      </s-box>
                    )}

                    {slot.images.length > 0 && (
                      <s-stack direction="inline" gap="small">
                        {slot.images.map((image) => (
                          <button
                            key={image.position}
                            type="button"
                            onClick={() => setZoomedImageUrl(image.url)}
                            style={{
                              padding: 0,
                              border: "none",
                              background: "none",
                              cursor: "zoom-in",
                            }}
                          >
                            <img
                              src={image.url}
                              alt={`${slot.productTitle} — position ${image.position}`}
                              style={{
                                width: 100,
                                height: 100,
                                objectFit: "cover",
                                borderRadius: 4,
                                display: "block",
                              }}
                            />
                          </button>
                        ))}
                      </s-stack>
                    )}

                    {editable && (
                      <div>
                        {/* Pra quando ela gosta do post e do produto, só não
                            gosta da imagem (ou ainda não tem nenhuma) —
                            mesma ação serve os dois casos, sem precisar ir
                            até "Create content" pra gerar na mão (Patricia,
                            13/09/2026: "e agora o próximo post se eu quiser
                            que ele já apareça as imagens?"). Comentário é
                            opcional — mesmo padrão de "regenerate with
                            feedback" já usado no store voice e content
                            pillars. */}
                        <textarea
                          value={imageFeedback[slot.contentItemId] ?? ""}
                          onChange={(e) =>
                            setImageFeedback((current) => ({
                              ...current,
                              [slot.contentItemId]: e.target.value,
                            }))
                          }
                          placeholder="Optional: tell us what to show (e.g. walking outdoors, show more of the shoe)"
                          rows={2}
                          style={{ width: "100%", padding: 8, marginBottom: 8 }}
                        />
                        <button
                          type="button"
                          onClick={() => regenerateImage(slot.contentItemId)}
                          disabled={isRegeneratingImage}
                          style={{
                            display: "inline-block",
                            padding: "8px 16px",
                            border: "1px solid #a8abae",
                            borderRadius: 8,
                            background: "#c9cccf",
                            color: "#202223",
                            fontWeight: 500,
                            opacity: isRegeneratingImage ? 0.5 : 1,
                            cursor: isRegeneratingImage ? "default" : "pointer",
                          }}
                        >
                          {isRegeneratingImage
                            ? "Building image…"
                            : slot.images.length > 0
                              ? "Regenerate image only"
                              : "Generate image now"}
                        </button>
                        {isRegeneratingImage && (
                          <GeneratingProgressBar label="Building a new image for this post…" />
                        )}
                      </div>
                    )}
                    {imageFailure?.contentItemId === slot.contentItemId && (
                      <s-paragraph>
                        <strong>
                          Couldn&apos;t regenerate image:{" "}
                          {imageFailure.result.status === "error" ? imageFailure.result.reason : ""}
                        </strong>
                      </s-paragraph>
                    )}

                    {slot.needsManualImage && (
                      <s-paragraph>
                        <strong>
                          No image yet — this post won&apos;t publish
                          automatically until one exists.
                        </strong>{" "}
                        Go to &quot;Create content&quot; to generate one
                        manually for this product, or swap it for a different
                        product below.
                      </s-paragraph>
                    )}

                    {swapFailure?.contentItemId === slot.contentItemId && (
                      <s-paragraph>
                        <strong>
                          Couldn&apos;t swap:{" "}
                          {swapFailure.result.status === "error" ? swapFailure.result.reason : ""}
                        </strong>
                      </s-paragraph>
                    )}
                    {manageFailure?.contentItemId === slot.contentItemId && (
                      <s-paragraph>
                        <strong>
                          {manageFailure.result.status === "error" ? manageFailure.result.reason : ""}
                        </strong>
                      </s-paragraph>
                    )}
                    {objectiveFailure?.contentItemId === slot.contentItemId && (
                      <s-paragraph>
                        <strong>
                          Couldn&apos;t change objective:{" "}
                          {objectiveFailure.result.status === "error" ? objectiveFailure.result.reason : ""}
                        </strong>
                      </s-paragraph>
                    )}

                    {editable && slot.promotionName && (
                      <s-paragraph>
                        <s-text color="subdued">
                          Objective locked to &quot;Drive sales&quot; while
                          this post is part of the {slot.promotionName}{" "}
                          promotion.
                        </s-text>
                      </s-paragraph>
                    )}

                    {editable && !slot.promotionName && (
                      <>
                        <s-stack direction="inline" gap="small" alignItems="center">
                          <s-select
                            label="Change this post's objective"
                            labelAccessibilityVisibility="exclusive"
                            value={objectiveChoices[slot.contentItemId] ?? slot.objective}
                            onChange={(event) => {
                              const value = event.currentTarget.value;
                              setObjectiveChoices((current) => ({
                                ...current,
                                [slot.contentItemId]: value,
                              }));
                            }}
                          >
                            {COMMERCIAL_OBJECTIVES.map((objective) => (
                              <s-option key={objective} value={objective}>
                                {OBJECTIVE_LABELS[objective]}
                              </s-option>
                            ))}
                          </s-select>
                          <s-button
                            variant="secondary"
                            onClick={() => changeObjective(slot.contentItemId)}
                            {...(isChangingObjective ? { loading: true } : {})}
                            {...((objectiveChoices[slot.contentItemId] ?? slot.objective) === slot.objective
                              ? { disabled: true }
                              : {})}
                          >
                            Change objective
                          </s-button>
                        </s-stack>

                        <s-stack direction="inline" gap="small" alignItems="center">
                          <s-select
                            label="Swap for a different product"
                            labelAccessibilityVisibility="exclusive"
                            value={swapChoices[slot.contentItemId] ?? ""}
                            onChange={(event) => {
                              const value = event.currentTarget.value;
                              setSwapChoices((current) => ({
                                ...current,
                                [slot.contentItemId]: value,
                              }));
                            }}
                            {...(swapOptions.length === 0 ? { disabled: true } : {})}
                          >
                            <s-option value="">
                              {swapOptions.length === 0
                                ? "No other eligible products"
                                : "Swap for a different product…"}
                            </s-option>
                            {swapOptions.map((product) => (
                              <s-option key={product.id} value={product.id}>
                                {product.title}
                              </s-option>
                            ))}
                          </s-select>
                          <s-button
                            variant="secondary"
                            onClick={() => swapProduct(slot.contentItemId)}
                            {...(isSwapping ? { loading: true } : {})}
                            {...(!swapChoices[slot.contentItemId] ? { disabled: true } : {})}
                          >
                            Swap
                          </s-button>
                        </s-stack>

                        <s-stack direction="inline" gap="small" alignItems="center">
                          <s-select
                            label="Day"
                            labelAccessibilityVisibility="exclusive"
                            value={String(currentWeekday)}
                            onChange={(event) => {
                              const weekday = Number(event.currentTarget.value);
                              setScheduleChoices((current) => ({
                                ...current,
                                [slot.contentItemId]: { weekday, time: currentTime },
                              }));
                              saveSchedule(slot.contentItemId, weekday, currentTime);
                            }}
                          >
                            {WEEKDAY_OPTIONS.map((option) => (
                              <s-option key={option.value} value={String(option.value)}>
                                {option.label}
                              </s-option>
                            ))}
                          </s-select>
                          <s-select
                            label="Time"
                            labelAccessibilityVisibility="exclusive"
                            value={currentTime}
                            onChange={(event) => {
                              const time = event.currentTarget.value;
                              setScheduleChoices((current) => ({
                                ...current,
                                [slot.contentItemId]: { weekday: currentWeekday, time },
                              }));
                              saveSchedule(slot.contentItemId, currentWeekday, time);
                            }}
                          >
                            {TIME_OPTIONS.map((time) => (
                              <s-option key={time} value={time}>
                                {time}
                              </s-option>
                            ))}
                          </s-select>
                          {isManaging && <s-badge tone="info">Saving…</s-badge>}
                          {slot.status === "draft" && (
                            <s-button
                              variant="secondary"
                              onClick={() => approveSlot(slot.contentItemId)}
                              {...(isManaging ? { loading: true } : {})}
                            >
                              Approve
                            </s-button>
                          )}
                          <s-button
                            variant="secondary"
                            tone="critical"
                            onClick={() => cancelSlot(slot.contentItemId)}
                            {...(isManaging ? { loading: true } : {})}
                          >
                            Cancel this post
                          </s-button>
                        </s-stack>
                      </>
                    )}
                  </s-stack>
                </s-box>
              );
            })}
          </s-stack>
        )}

        {slots.length > 0 && (
          <s-stack direction="block" gap="small">
            <s-paragraph>
              <s-text color="subdued">
                {activePromotionName
                  ? `Regenerating is disabled while the ${activePromotionName} promotion is running — it would cancel those posts.`
                  : "Regenerating replaces every post above that hasn't published yet. Anything already posted or mid-publish stays untouched."}
              </s-text>
            </s-paragraph>
            <div>
              <button
                type="button"
                onClick={generateWeek}
                disabled={isGenerating || !canGenerate}
                style={{
                  display: "inline-block",
                  padding: "8px 16px",
                  border: "1px solid #a8abae",
                  borderRadius: 8,
                  background: "#c9cccf",
                  color: "#202223",
                  fontWeight: 500,
                  opacity: isGenerating || !canGenerate ? 0.5 : 1,
                  cursor: isGenerating || !canGenerate ? "default" : "pointer",
                }}
              >
                {isGenerating ? "Regenerating…" : "Regenerate this week's plan"}
              </button>
            </div>
            {isGenerating && <GeneratingProgressBar label={generatingLabel} />}
            {generateFailure && (
              <s-paragraph>
                <strong>{generateFailure}</strong>
              </s-paragraph>
            )}
          </s-stack>
        )}
      </s-section>

      {zoomedImageUrl && (
        <div
          role="button"
          tabIndex={0}
          aria-label="Close zoomed preview"
          onClick={() => setZoomedImageUrl(null)}
          onKeyDown={(event) => {
            if (event.key === "Escape" || event.key === "Enter" || event.key === " ") {
              setZoomedImageUrl(null);
            }
          }}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.75)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            cursor: "zoom-out",
            padding: 24,
          }}
        >
          <img
            src={zoomedImageUrl}
            alt="Zoomed preview"
            style={{ maxWidth: "90vw", maxHeight: "90vh", objectFit: "contain", borderRadius: 8 }}
          />
        </div>
      )}
    </s-page>
  );
}
