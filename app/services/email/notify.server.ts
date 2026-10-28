import prisma from "../../db.server";
import { getMissingSocialPlatforms } from "../socialReminders.server";
import { joinLabels } from "../../utils/joinLabels";

// Notificações por e-mail (Settings, Patricia 03/10/2026), enviadas pelo
// Resend (https://resend.com/docs/api-reference/emails/send-email). Só os
// fluxos AUTOMÁTICOS do agendador mandam e-mail — numa ação manual (Publish
// now) a lojista já vê o resultado na tela.
//
// Sem RESEND_API_KEY (ex.: localmente, ou antes de a conta existir) só
// registra no log e segue — e-mail nunca pode derrubar publicação nem
// geração de plano.

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const DEFAULT_FROM = "Stockative <notifications@stockative.com>";

// true só quando o Resend aceitou o e-mail.
async function sendEmail(params: { to: string; subject: string; text: string }): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log(`[email] RESEND_API_KEY not set, skipping "${params.subject}" to ${params.to}`);
    return false;
  }
  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.RESEND_FROM_EMAIL || DEFAULT_FROM,
        to: [params.to],
        subject: params.subject,
        text: params.text,
      }),
    });
    if (!response.ok) {
      console.error(`[email] Resend returned ${response.status}: ${await response.text()}`);
      return false;
    }
    return true;
  } catch (error) {
    console.error("[email] send failed:", error);
    return false;
  }
}

type NotifiableShop = {
  shopifyDomain: string;
  notificationEmail: string | null;
  shopEmail: string | null;
  requireApproval: boolean;
  notifyWeeklyPlan: boolean;
  notifyPublishFailed: boolean;
  notifyPublished: boolean;
};

const notifiableSelect = {
  shopifyDomain: true,
  notificationEmail: true,
  shopEmail: true,
  requireApproval: true,
  notifyWeeklyPlan: true,
  notifyPublishFailed: true,
  notifyPublished: true,
} as const;

// Abre o app embutido no admin da loja — /admin/apps/<client_id> redireciona
// pro app certo sem precisar saber o handle dele.
function appLink(shop: NotifiableShop, path = ""): string {
  return `https://${shop.shopifyDomain}/admin/apps/${process.env.SHOPIFY_API_KEY}${path}`;
}

function recipient(shop: NotifiableShop): string | null {
  return shop.notificationEmail || shop.shopEmail || null;
}

export async function notifyWeeklyPlanReady(shopId: string, slotCount: number): Promise<void> {
  if (slotCount === 0) return;
  const shop = await prisma.shop.findUnique({ where: { id: shopId }, select: notifiableSelect });
  if (!shop?.notifyWeeklyPlan) return;
  const to = recipient(shop);
  if (!to) return;

  const posts = `${slotCount} post${slotCount === 1 ? "" : "s"}`;
  await sendEmail({
    to,
    subject: shop.requireApproval
      ? `Your next week is ready: ${posts} waiting for your approval`
      : `Your next week is ready: ${posts} planned`,
    text: [
      shop.requireApproval
        ? `Stockative planned ${posts} for next week. They won't publish until you approve them.`
        : `Stockative planned ${posts} for next week. They publish on their own at the scheduled times. You can still review or change anything before then.`,
      "",
      `Open your weekly plan: ${appLink(shop, "/app/plan-week")}`,
    ].join("\n"),
  });
}

export async function notifyPublishOutcome(params: {
  shopId: string;
  productTitle: string | null;
  failedReason: string | null;
}): Promise<void> {
  const shop = await prisma.shop.findUnique({ where: { id: params.shopId }, select: notifiableSelect });
  if (!shop) return;
  const failed = params.failedReason !== null;
  if (failed ? !shop.notifyPublishFailed : !shop.notifyPublished) return;
  const to = recipient(shop);
  if (!to) return;

  const product = params.productTitle ? ` for ${params.productTitle}` : "";
  await sendEmail({
    to,
    subject: failed ? `A post${product} couldn't be published` : `Your post${product} is live`,
    text: failed
      ? [
          `Stockative tried to publish your post${product}, but it failed:`,
          "",
          params.failedReason,
          "",
          `Open your weekly plan to retry or change it: ${appLink(shop, "/app/plan-week")}`,
        ].join("\n")
      : [`Your post${product} was just published.`, "", `See your results: ${appLink(shop, "/app/performance")}`].join("\n"),
  });
}

// Lembrete de redes não conectadas (Patricia, 28/10/2026). Sai junto com o
// plano semanal automático, no máximo um a cada 30 dias — toda semana virava
// spam. Redes que a lojista dispensou ("I don't use …") não entram.
const SOCIAL_REMINDER_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000;

export async function notifyMissingSocialPlatforms(shopId: string): Promise<void> {
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: { ...notifiableSelect, socialReminderSentAt: true },
  });
  if (!shop) return;
  if (shop.socialReminderSentAt && Date.now() - shop.socialReminderSentAt.getTime() < SOCIAL_REMINDER_INTERVAL_MS) {
    return;
  }
  const to = recipient(shop);
  if (!to) return;
  const { missing } = await getMissingSocialPlatforms(shopId);
  if (missing.length === 0) return;

  const networks = joinLabels(missing.map((platform) => platform.label));
  // Sem envio de verdade (ex.: Resend ainda não configurado), não conta como
  // lembrete enviado — senão o primeiro e-mail real atrasaria até 30 dias.
  const sent = await sendEmail({
    to,
    subject: `Your posts won't go out on ${networks}`,
    text: [
      `Stockative planned your posts for next week, but they won't be published on ${networks} because ${missing.length === 1 ? "it isn't" : "they aren't"} connected.`,
      "",
      `Connect ${missing.length === 1 ? "it" : "them"} and the same plan goes out there too: ${appLink(shop, "/app/social")}`,
      "",
      `Don't use ${missing.length === 1 ? "it" : "one of them"}? Open Stockative and click "I don't use …" on the Home page, and we'll stop reminding you.`,
    ].join("\n"),
  });
  if (sent) await prisma.shop.update({ where: { id: shopId }, data: { socialReminderSentAt: new Date() } });
}
