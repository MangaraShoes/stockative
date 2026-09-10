import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useSearchParams } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { buildAuthorizeUrl, isMetaConfigured } from "../services/meta/oauth.server";
import { fetchBusinessDiscovery } from "../services/meta/businessDiscovery.server";

const MAX_COMPETITOR_ACCOUNTS = 2;

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

  const competitorAccounts = shop
    ? await prisma.competitorAccount.findMany({
        where: { shopId: shop.id },
        orderBy: { addedAt: "asc" },
      })
    : [];

  return {
    isMetaConfigured: isMetaConfigured(),
    authorizeUrl: isMetaConfigured() ? buildAuthorizeUrl(session.shop) : null,
    igBusinessAccountId: socialAccount?.igBusinessAccountId ?? null,
    competitorAccounts: competitorAccounts.map((c) => ({
      id: c.id,
      instagramUsername: c.instagramUsername,
    })),
  };
};

// Até 2 contas de concorrentes indicadas pela lojista pra enriquecer o
// diagnóstico/estratégia via Business Discovery (Patricia, 10/09/2026 — ver
// MARKETING-KNOWLEDGE.md). Só o @ público, nunca pede autorização deles.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
  });
  if (!shop) throw new Response("Shop not found", { status: 404 });

  if (intent === "add-competitor") {
    const rawUsername = String(formData.get("instagramUsername") ?? "").trim();
    const username = rawUsername.replace(/^@/, "");
    if (!username) return { intent, error: "Enter an Instagram username." };

    const existingCount = await prisma.competitorAccount.count({ where: { shopId: shop.id } });
    if (existingCount >= MAX_COMPETITOR_ACCOUNTS) {
      return { intent, error: `You can add up to ${MAX_COMPETITOR_ACCOUNTS} competitor accounts.` };
    }

    const alreadyAdded = await prisma.competitorAccount.findFirst({
      where: { shopId: shop.id, instagramUsername: username },
    });
    if (alreadyAdded) return { intent, error: "That account is already on your list." };

    // Valida na hora de adicionar em vez de deixar falhar silenciosamente
    // depois — Business Discovery só resolve contas Business/Creator
    // públicas, então isso também pega "existe mas é conta pessoal/privada".
    const socialAccount = await prisma.socialAccount.findUnique({
      where: { shopId_platform: { shopId: shop.id, platform: "instagram" } },
    });
    if (!socialAccount?.igBusinessAccountId) {
      return { intent, error: "Connect your own Instagram account first." };
    }

    const result = await fetchBusinessDiscovery(
      socialAccount.igBusinessAccountId,
      socialAccount.accessToken,
      username,
    );

    if (!result.ok && result.reason === "not_found") {
      return {
        intent,
        error: `Couldn't find @${username} — check the spelling, or it may be a private/personal account (needs to be a public Business or Creator account).`,
      };
    }

    await prisma.competitorAccount.create({
      data: { shopId: shop.id, instagramUsername: username },
    });

    // code 10 = nosso app ainda não tem Advanced Access da Meta pra Business
    // Discovery em conta de terceiro (precisa de App Review) — salvamos o
    // username mesmo assim (provavelmente está certo), só avisamos que os
    // dados não vão entrar na estratégia até essa liberação acontecer.
    if (!result.ok && result.reason === "permission_denied") {
      return {
        intent,
        error: null,
        warning: `Saved @${username}, but Instagram hasn't approved our app to read competitor data yet (needs Meta App Review). It'll start feeding your strategy automatically once that's approved.`,
      };
    }

    return { intent, error: null, warning: null };
  }

  if (intent === "remove-competitor") {
    const id = String(formData.get("id") ?? "");
    await prisma.competitorAccount.deleteMany({ where: { id, shopId: shop.id } });
    return { intent, error: null };
  }

  return { intent, error: null };
};

export default function Social() {
  const data = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const addFetcher = useFetcher<typeof action>();
  const removeFetcher = useFetcher<typeof action>();
  const [username, setUsername] = useState("");

  const connectedUsername = searchParams.get("connected");
  const error = searchParams.get("error");

  const canAddMore = data.competitorAccounts.length < MAX_COMPETITOR_ACCOUNTS;

  const addCompetitor = () => {
    if (!username.trim()) return;
    addFetcher.submit(
      { intent: "add-competitor", instagramUsername: username },
      { method: "POST" },
    );
    setUsername("");
  };

  const removeCompetitor = (id: string) =>
    removeFetcher.submit({ intent: "remove-competitor", id }, { method: "POST" });

  return (
    <s-page heading="Social accounts">
      <s-section heading="Instagram">
        <s-paragraph>
          Connect your Instagram professional account (must be linked to a
          Facebook Page) to publish generated posts for real, instead of just
          copying the caption manually. This is also required before
          generating your Brand Voice or weekly plan — the AI uses your own
          Instagram history to build both.
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
            <>
              <a
                href={data.authorizeUrl}
                target="_blank"
                rel="noopener noreferrer"
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
              <s-paragraph>
                Opens in a new tab — once connected, come back and refresh
                this page.
              </s-paragraph>
            </>
          )
        )}
      </s-section>

      {data.igBusinessAccountId && (
        <s-section heading="Competitor accounts (optional)">
          <s-paragraph>
            Add up to {MAX_COMPETITOR_ACCOUNTS} Instagram accounts you
            consider strong in your niche. We only read their public posts
            (via Business Discovery) — no authorization needed from them —
            to enrich your Brand Voice and content strategy with real
            reference data.
          </s-paragraph>

          <s-stack direction="block" gap="base">
            {data.competitorAccounts.map((c) => (
              <s-stack key={c.id} direction="inline" gap="base">
                <s-paragraph>@{c.instagramUsername}</s-paragraph>
                <s-button
                  variant="tertiary"
                  onClick={() => removeCompetitor(c.id)}
                  {...(removeFetcher.state !== "idle" ? { loading: true } : {})}
                >
                  Remove
                </s-button>
              </s-stack>
            ))}

            {canAddMore && (
              <s-stack direction="inline" gap="base">
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="competitor_username"
                  style={{ padding: 8 }}
                />
                <s-button
                  onClick={addCompetitor}
                  {...(addFetcher.state !== "idle" ? { loading: true } : {})}
                >
                  Add
                </s-button>
              </s-stack>
            )}

            {addFetcher.data?.error && (
              <s-paragraph>
                <strong>{addFetcher.data.error}</strong>
              </s-paragraph>
            )}
            {"warning" in (addFetcher.data ?? {}) && addFetcher.data?.warning && (
              <s-paragraph>{addFetcher.data.warning}</s-paragraph>
            )}
          </s-stack>
        </s-section>
      )}
    </s-page>
  );
}
