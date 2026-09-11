import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { collectPerformanceSignals } from "../services/meta/collectPerformance.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
  });

  const publishedItems = shop
    ? await prisma.contentItem.findMany({
        where: { shopId: shop.id, status: "published" },
        include: {
          product: { select: { title: true } },
          contentPillar: { select: { name: true } },
          performanceSignals: { orderBy: { capturedAt: "desc" }, take: 1 },
        },
        orderBy: { publishedAt: "desc" },
      })
    : [];

  return {
    hasShop: Boolean(shop),
    items: publishedItems.map((item) => ({
      id: item.id,
      productTitle: item.product?.title ?? "(product removed)",
      pillarName: item.contentPillar?.name ?? null,
      publishedAt: item.publishedAt,
      externalPostId: item.externalPostId,
      latestSignal: item.performanceSignals[0]
        ? {
            likes: item.performanceSignals[0].likes,
            comments: item.performanceSignals[0].comments,
            capturedAt: item.performanceSignals[0].capturedAt,
          }
        : null,
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
  });
  if (!shop) throw new Response("Shop not found", { status: 404 });

  const result = await collectPerformanceSignals(shop.id);
  return { result };
};

export default function Performance() {
  const { hasShop, items } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();

  const isCollecting = fetcher.state !== "idle";
  const result = fetcher.data?.result;

  const runCollect = () => fetcher.submit({}, { method: "POST" });

  return (
    <s-page heading="Performance">
      <s-section heading="Published posts">
        <s-paragraph>
          Likes and comments for each post you&apos;ve actually published,
          pulled straight from Instagram — this is public engagement, not
          reach, saves, visits, or sales. Reach/saves need a Meta permission
          we don&apos;t have yet (Instagram Insights); visits/sales need a
          tracked-link redirector we haven&apos;t built. Every click below
          adds a new timestamped snapshot rather than overwriting the last
          one, so you can see how a post&apos;s engagement moves over time.
        </s-paragraph>

        {!hasShop && <s-paragraph>Sync your products first.</s-paragraph>}

        <s-button onClick={runCollect} {...(isCollecting ? { loading: true } : {})}>
          Refresh performance data
        </s-button>

        {result && (
          <s-paragraph>
            Collected {result.collected} post(s)
            {result.skipped > 0 ? `, skipped ${result.skipped} (see below)` : ""}.
            {result.errors.length > 0 && (
              <>
                {" "}
                {result.errors.map((err, i) => (
                  <span key={i}>
                    {err}
                    {i < result.errors.length - 1 ? "; " : ""}
                  </span>
                ))}
              </>
            )}
          </s-paragraph>
        )}

        {items.length === 0 && (
          <s-paragraph>
            No published posts yet — publish one from &quot;Create
            content&quot; or approve a weekly plan post first.
          </s-paragraph>
        )}

        {items.length > 0 && (
          <s-stack direction="block" gap="base">
            {items.map((item) => (
              <s-box
                key={item.id}
                padding="base"
                borderWidth="base"
                borderRadius="base"
              >
                <s-paragraph>
                  <strong>{item.productTitle}</strong>
                  {item.pillarName && ` · pillar: ${item.pillarName}`}
                  {item.publishedAt &&
                    ` · published ${new Date(item.publishedAt).toLocaleDateString()}`}
                </s-paragraph>
                {item.latestSignal ? (
                  <s-paragraph>
                    {item.latestSignal.likes ?? "?"} likes ·{" "}
                    {item.latestSignal.comments ?? "?"} comments (as of{" "}
                    {new Date(item.latestSignal.capturedAt).toLocaleString()})
                  </s-paragraph>
                ) : (
                  <s-paragraph>No data collected yet.</s-paragraph>
                )}
              </s-box>
            ))}
          </s-stack>
        )}
      </s-section>
    </s-page>
  );
}
