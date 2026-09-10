import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { planWeeklyContent } from "../services/decisionEngine/planWeek.server";

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

  return { hasShop: Boolean(shop), isInstagramConnected: Boolean(socialAccount?.igBusinessAccountId) };
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

  const socialAccount = await prisma.socialAccount.findUnique({
    where: { shopId_platform: { shopId: shop.id, platform: "instagram" } },
  });
  if (!socialAccount?.igBusinessAccountId) {
    throw new Response("Connect Instagram first — see Social accounts.", { status: 400 });
  }

  const slots = await planWeeklyContent(shop.id);
  return { slots };
};

export default function PlanWeek() {
  const { hasShop, isInstagramConnected } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();

  const isGenerating = fetcher.state !== "idle";
  const slots = fetcher.data?.slots;
  const canGenerate = hasShop && isInstagramConnected;

  const generateWeek = () => fetcher.submit({}, { method: "POST" });

  return (
    <s-page heading="Weekly plan">
      <s-section heading="This week's content, picked for you">
        <s-paragraph>
          Picks up to 3 products (prioritized by sales velocity and slow-moving
          inventory, avoiding anything posted about in the last 7 days),
          drafts the strategy, copy and image sequence for each — ready for
          you to review. You can still create one-off posts manually anytime
          from &quot;Create content&quot;.
        </s-paragraph>

        {!hasShop && (
          <s-paragraph>Sync your products first before generating a weekly plan.</s-paragraph>
        )}

        {hasShop && !isInstagramConnected && (
          <s-paragraph>
            <strong>
              Connect Instagram first (Social accounts) — the plan is built
              from your real Instagram history together with your Shopify
              data, not just your product catalog.
            </strong>
          </s-paragraph>
        )}

        <s-button
          onClick={generateWeek}
          {...(isGenerating ? { loading: true } : {})}
          {...(!canGenerate ? { disabled: true } : {})}
        >
          Generate this week&apos;s plan
        </s-button>

        {slots && slots.length === 0 && (
          <s-paragraph>
            No eligible products found — sync your products or wait for
            recently-posted-about products to cool down.
          </s-paragraph>
        )}

        {slots && slots.length > 0 && (
          <s-stack direction="block" gap="base">
            {slots.map((slot) => (
              <s-box
                key={slot.contentItemId}
                padding="base"
                borderWidth="base"
                borderRadius="base"
              >
                <s-paragraph>
                  <strong>{slot.productTitle}</strong> — {slot.objective}
                  {slot.isHero && " · this week's hero (new AI image)"}
                </s-paragraph>
                {slot.needsManualImage && (
                  <s-paragraph>
                    No reusable editorial image for this product yet, and it
                    isn&apos;t this week&apos;s hero — go to &quot;Create
                    content&quot; to generate one manually for this post.
                  </s-paragraph>
                )}
              </s-box>
            ))}
          </s-stack>
        )}
      </s-section>
    </s-page>
  );
}
