import { useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useRevalidator, useSearchParams } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { buildAuthorizeUrl, isMetaConfigured } from "../services/meta/oauth.server";
import {
  buildAuthorizeUrl as buildPinterestAuthorizeUrl,
  isPinterestConfigured,
} from "../services/pinterest/oauth.server";
import {
  buildAuthorizeUrl as buildTikTokAuthorizeUrl,
  isTikTokConfigured,
} from "../services/tiktok/oauth.server";
import {
  buildAuthorizeUrl as buildYouTubeAuthorizeUrl,
  isYouTubeConfigured,
} from "../services/youtube/oauth.server";
import { getOnboardingStatus, type OnboardingStatus } from "../services/onboardingStatus.server";
import { OnboardingStepper } from "../components/OnboardingStepper";

const EMPTY_ONBOARDING_STATUS: OnboardingStatus = {
  hasStock: false,
  hasBrand: false,
  hasSocial: false,
  hasCompetitors: false,
  hasContentPillars: false,
  hasPublished: false,
};

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

  const pinterestAccount = shop
    ? await prisma.socialAccount.findUnique({
        where: { shopId_platform: { shopId: shop.id, platform: "pinterest" } },
      })
    : null;

  const tiktokAccount = shop
    ? await prisma.socialAccount.findUnique({
        where: { shopId_platform: { shopId: shop.id, platform: "tiktok" } },
      })
    : null;

  const youtubeAccount = shop
    ? await prisma.socialAccount.findUnique({
        where: { shopId_platform: { shopId: shop.id, platform: "youtube" } },
      })
    : null;

  const onboardingStatus = shop ? await getOnboardingStatus(shop.id) : EMPTY_ONBOARDING_STATUS;

  return {
    onboardingStatus,
    isMetaConfigured: isMetaConfigured(),
    authorizeUrl: isMetaConfigured() ? buildAuthorizeUrl(session.shop) : null,
    igBusinessAccountId: socialAccount?.igBusinessAccountId ?? null,
    fbPageId: socialAccount?.fbPageId ?? null,
    isPinterestConfigured: isPinterestConfigured(),
    pinterestAuthorizeUrl: isPinterestConfigured()
      ? buildPinterestAuthorizeUrl(session.shop)
      : null,
    pinterestUsername: pinterestAccount?.pinterestUsername ?? null,
    isTikTokConfigured: isTikTokConfigured(),
    tiktokAuthorizeUrl: isTikTokConfigured() ? buildTikTokAuthorizeUrl(session.shop) : null,
    tiktokUsername: tiktokAccount?.tiktokUsername ?? null,
    isYouTubeConfigured: isYouTubeConfigured(),
    youtubeAuthorizeUrl: isYouTubeConfigured() ? buildYouTubeAuthorizeUrl(session.shop) : null,
    youtubeChannelTitle: youtubeAccount?.youtubeChannelTitle ?? null,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
  });
  if (!shop) throw new Response("Shop not found", { status: 404 });

  if (intent === "disconnect-pinterest") {
    await prisma.socialAccount.deleteMany({ where: { shopId: shop.id, platform: "pinterest" } });
    return { intent, error: null };
  }

  if (intent === "disconnect-tiktok") {
    await prisma.socialAccount.deleteMany({ where: { shopId: shop.id, platform: "tiktok" } });
    return { intent, error: null };
  }

  if (intent === "disconnect-youtube") {
    await prisma.socialAccount.deleteMany({ where: { shopId: shop.id, platform: "youtube" } });
    return { intent, error: null };
  }

  // Instagram e Facebook usam a mesma linha (o Facebook não tem conexão
  // própria, publica via fbPageId salvo junto com a conta Instagram), então
  // desconectar aqui desliga os dois de uma vez.
  if (intent === "disconnect-instagram") {
    await prisma.socialAccount.deleteMany({ where: { shopId: shop.id, platform: "instagram" } });
    return { intent, error: null };
  }

  return { intent, error: null };
};

export default function Social() {
  const data = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const disconnectPinterestFetcher = useFetcher<typeof action>();
  const disconnectInstagramFetcher = useFetcher<typeof action>();
  const disconnectTikTokFetcher = useFetcher<typeof action>();
  const disconnectYouTubeFetcher = useFetcher<typeof action>();
  const revalidator = useRevalidator();

  // O popup de OAuth (Instagram/Pinterest) roda fora deste iframe e o
  // Shopify normalmente restringe a página aberta de "avisar" a original
  // via window.opener (o iframe embutido do admin costuma ter sandbox sem
  // allow-popups-to-escape-sandbox) — window.opener.location não é
  // confiável aqui (Patricia, 12/09/2026: o botão continuava sem atualizar
  // mesmo depois de conectar). Em vez disso, refaz a busca sempre que esta
  // aba volta a ficar em foco/visível, o que cobre o caso normal de "abriu
  // o popup, autorizou, voltou pra essa aba".
  useEffect(() => {
    const onFocus = () => revalidator.revalidate();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connectedUsername = searchParams.get("connected");
  const pinterestConnectedUsername = searchParams.get("pinterestConnected");
  const tiktokConnectedUsername = searchParams.get("tiktokConnected");
  const youtubeConnectedUsername = searchParams.get("youtubeConnected");
  const error = searchParams.get("error");

  const disconnectPinterest = () =>
    disconnectPinterestFetcher.submit({ intent: "disconnect-pinterest" }, { method: "POST" });

  const disconnectInstagram = () =>
    disconnectInstagramFetcher.submit({ intent: "disconnect-instagram" }, { method: "POST" });

  const disconnectTikTok = () =>
    disconnectTikTokFetcher.submit({ intent: "disconnect-tiktok" }, { method: "POST" });

  const disconnectYouTube = () =>
    disconnectYouTubeFetcher.submit({ intent: "disconnect-youtube" }, { method: "POST" });

  return (
    <s-page heading="Social accounts">
      <OnboardingStepper status={data.onboardingStatus} currentStepHref="/app/social" />

      <s-section heading="Instagram &amp; Facebook">
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
            <strong>Connected! Instagram and Facebook linked successfully.</strong>
          </s-paragraph>
        )}

        {data.igBusinessAccountId ? (
          <s-stack direction="inline" gap="base">
            <s-paragraph>
              {data.fbPageId
                ? "Instagram and Facebook connected."
                : "Instagram connected — no Facebook Page found on this account yet."}
            </s-paragraph>
            <s-button
              variant="secondary"
              onClick={disconnectInstagram}
              {...(disconnectInstagramFetcher.state !== "idle" ? { loading: true } : {})}
            >
              Disconnect
            </s-button>
          </s-stack>
        ) : (
          data.isMetaConfigured &&
          data.authorizeUrl && (
            <>
              <s-button href={data.authorizeUrl} target="_blank" variant="primary">
                Connect Instagram &amp; Facebook
              </s-button>
              <s-paragraph>
                Opens in a new tab — this page updates automatically once
                connected.
              </s-paragraph>
            </>
          )
        )}
      </s-section>

      <s-section heading="Pinterest">
        <s-paragraph>
          Connect your Pinterest business account to publish product Pins
          automatically, organized into one board per product category.
        </s-paragraph>

        {!data.isPinterestConfigured && (
          <s-paragraph>
            <strong>
              Pinterest connection isn&apos;t set up yet — PINTEREST_APP_ID
              and PINTEREST_APP_SECRET need to be configured first.
            </strong>
          </s-paragraph>
        )}

        {pinterestConnectedUsername && (
          <s-paragraph>
            <strong>Connected! Pinterest account linked successfully.</strong>
          </s-paragraph>
        )}

        {data.pinterestUsername ? (
          <s-stack direction="inline" gap="base">
            <s-paragraph>
              Pinterest account connected (@{data.pinterestUsername}).
            </s-paragraph>
            <s-button
              variant="secondary"
              onClick={disconnectPinterest}
              {...(disconnectPinterestFetcher.state !== "idle" ? { loading: true } : {})}
            >
              Disconnect
            </s-button>
          </s-stack>
        ) : (
          data.isPinterestConfigured &&
          data.pinterestAuthorizeUrl && (
            <>
              <s-button href={data.pinterestAuthorizeUrl} target="_blank" variant="primary">
                Connect Pinterest
              </s-button>
              <s-paragraph>
                Opens in a new tab — this page updates automatically once
                connected.
              </s-paragraph>
            </>
          )
        )}
      </s-section>

      <s-section heading="TikTok">
        <s-paragraph>
          Connect your TikTok account so Reels can go out there too. For now,
          each Reel lands in your TikTok inbox as a draft — open the TikTok
          app and tap to confirm it, same as sharing from any other app.
          Direct, fully automatic posting needs TikTok&apos;s own audit,
          which we&apos;re applying for.
        </s-paragraph>

        {!data.isTikTokConfigured && (
          <s-paragraph>
            <strong>
              TikTok connection isn&apos;t set up yet — TIKTOK_CLIENT_KEY and
              TIKTOK_CLIENT_SECRET need to be configured first.
            </strong>
          </s-paragraph>
        )}

        {tiktokConnectedUsername && (
          <s-paragraph>
            <strong>Connected! TikTok account linked successfully.</strong>
          </s-paragraph>
        )}

        {data.tiktokUsername ? (
          <s-stack direction="inline" gap="base">
            <s-paragraph>TikTok account connected (@{data.tiktokUsername}).</s-paragraph>
            <s-button
              variant="secondary"
              onClick={disconnectTikTok}
              {...(disconnectTikTokFetcher.state !== "idle" ? { loading: true } : {})}
            >
              Disconnect
            </s-button>
          </s-stack>
        ) : (
          data.isTikTokConfigured &&
          data.tiktokAuthorizeUrl && (
            <>
              <s-button href={data.tiktokAuthorizeUrl} target="_blank" variant="primary">
                Connect TikTok
              </s-button>
              <s-paragraph>
                Opens in a new tab — this page updates automatically once
                connected.
              </s-paragraph>
            </>
          )
        )}
      </s-section>

      <s-section heading="YouTube">
        <s-paragraph>
          Connect your YouTube channel so Reels also go out as Shorts.
          Shorts publish immediately and publicly — there&apos;s no
          draft/review step like TikTok&apos;s.
        </s-paragraph>

        {!data.isYouTubeConfigured && (
          <s-paragraph>
            <strong>
              YouTube connection isn&apos;t set up yet — YOUTUBE_CLIENT_ID
              and YOUTUBE_CLIENT_SECRET need to be configured first.
            </strong>
          </s-paragraph>
        )}

        {youtubeConnectedUsername && (
          <s-paragraph>
            <strong>Connected! YouTube channel linked successfully.</strong>
          </s-paragraph>
        )}

        {data.youtubeChannelTitle ? (
          <s-stack direction="inline" gap="base">
            <s-paragraph>YouTube channel connected ({data.youtubeChannelTitle}).</s-paragraph>
            <s-button
              variant="secondary"
              onClick={disconnectYouTube}
              {...(disconnectYouTubeFetcher.state !== "idle" ? { loading: true } : {})}
            >
              Disconnect
            </s-button>
          </s-stack>
        ) : (
          data.isYouTubeConfigured &&
          data.youtubeAuthorizeUrl && (
            <>
              <s-button href={data.youtubeAuthorizeUrl} target="_blank" variant="primary">
                Connect YouTube
              </s-button>
              <s-paragraph>
                Opens in a new tab — this page updates automatically once
                connected.
              </s-paragraph>
            </>
          )
        )}
      </s-section>

    </s-page>
  );
}
