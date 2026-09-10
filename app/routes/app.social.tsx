import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useSearchParams } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { buildAuthorizeUrl, isMetaConfigured } from "../services/meta/oauth.server";

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

  return {
    isMetaConfigured: isMetaConfigured(),
    authorizeUrl: isMetaConfigured() ? buildAuthorizeUrl(session.shop) : null,
    igBusinessAccountId: socialAccount?.igBusinessAccountId ?? null,
  };
};

export default function Social() {
  const data = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();

  const connectedUsername = searchParams.get("connected");
  const error = searchParams.get("error");

  return (
    <s-page heading="Social accounts">
      <s-section heading="Instagram">
        <s-paragraph>
          Connect your Instagram professional account (must be linked to a
          Facebook Page) to publish generated posts for real, instead of just
          copying the caption manually.
        </s-paragraph>

        {!data.isMetaConfigured && (
          <s-paragraph>
            <strong>
              Instagram connection isn&apos;t set up yet — META_APP_ID and
              META_APP_SECRET need to be configured first.
            </strong>
          </s-paragraph>
        )}

        {error && (
          <s-paragraph>
            <strong>Couldn&apos;t connect: {error}</strong>
          </s-paragraph>
        )}

        {connectedUsername && (
          <s-paragraph>
            <strong>Connected! Instagram account linked successfully.</strong>
          </s-paragraph>
        )}

        {data.igBusinessAccountId ? (
          <s-paragraph>
            Instagram account connected (ID: {data.igBusinessAccountId}).
          </s-paragraph>
        ) : (
          data.isMetaConfigured &&
          data.authorizeUrl && (
            <a
              href={data.authorizeUrl}
              target="_top"
              style={{
                display: "inline-block",
                padding: "8px 16px",
                border: "1px solid #ccc",
                borderRadius: 4,
                textDecoration: "none",
              }}
            >
              Connect Instagram
            </a>
          )
        )}
      </s-section>
    </s-page>
  );
}
