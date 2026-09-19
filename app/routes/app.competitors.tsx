import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { fetchBusinessDiscovery } from "../services/meta/businessDiscovery.server";
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

// Subiu de 2 pra 3 (Patricia, 13/09/2026) — não foi pra 5 de propósito:
// enquanto o Business Discovery estiver bloqueado (Meta App Review
// pendente), cada conta exige confirmação manual da lojista, então mais
// contas hoje é só mais fricção num step obrigatório, sem dado automático
// real por trás ainda. Revisitar quando a Meta aprovar o acesso.
const MAX_COMPETITOR_ACCOUNTS = 3;

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

  const onboardingStatus = shop ? await getOnboardingStatus(shop.id) : EMPTY_ONBOARDING_STATUS;

  return {
    onboardingStatus,
    igBusinessAccountId: socialAccount?.igBusinessAccountId ?? null,
    competitorsSkipped: shop?.competitorsSkipped ?? false,
    competitorAccounts: competitorAccounts.map((c) => ({
      id: c.id,
      instagramUsername: c.instagramUsername,
      verified: c.verified,
      biography: c.biography,
      website: c.website,
    })),
  };
};

// Passo próprio do onboarding (Patricia, 12/09/2026: "teria que ser o step
// 3", antes da store voice) — até 2 contas de concorrentes indicadas pela
// lojista pra enriquecer o diagnóstico/estratégia via Business Discovery
// (Patricia, 10/09/2026 — ver MARKETING-KNOWLEDGE.md). Só o @ público, nunca
// pede autorização deles. A lojista pode pular ("skip"), mas precisa passar
// pela decisão — ver hasCompetitors em onboardingStatus.server.ts.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
  });
  if (!shop) throw new Response("Shop not found", { status: 404 });

  if (intent === "skip-competitors") {
    await prisma.shop.update({
      where: { id: shop.id },
      data: { competitorsSkipped: true },
    });
    return { intent, error: null };
  }

  if (intent === "add-competitor") {
    const rawUsername = String(formData.get("instagramUsername") ?? "").trim();
    const username = rawUsername.replace(/^@/, "");
    if (!username) return { intent, error: "Enter an Instagram username." };

    // Valida o formato antes de gastar uma chamada à API do Instagram — pega
    // erros de digitação óbvios (espaço, acento, símbolo) na hora, em vez de
    // só descobrir depois que a conta "não foi encontrada" (Patricia,
    // 12/09/2026: "precisa também o app validar se o nome foi escrito
    // correto"). Regra real do Instagram: só letras, números, ponto e
    // sublinhado, até 30 caracteres.
    if (!/^[a-zA-Z0-9._]{1,30}$/.test(username)) {
      return {
        intent,
        error:
          "That doesn't look like a valid Instagram username — only letters, numbers, periods and underscores are allowed.",
      };
    }

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
      return { intent, error: "Connect your own Instagram account first, in Social accounts." };
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
      // verified só fica true quando o Business Discovery de fato confirmou
      // a conta (result.ok) — nos outros casos não sabemos se existe mesmo,
      // então nunca marcar como validado (Patricia, 12/09/2026: "eu coloquei
      // um IG que nem existe e ele deu ok"). Bio e site só vêm preenchidos
      // no mesmo caso (result.ok) — Patricia, 12/09/2026: "acho mais
      // importante mencionar a frase principal e o website" (do que
      // seguidores/posts).
      data: {
        shopId: shop.id,
        instagramUsername: username,
        verified: result.ok,
        biography: result.ok ? result.snapshot.biography : null,
        website: result.ok ? result.snapshot.website : null,
      },
    });

    // code 10 = nosso app ainda não tem Advanced Access da Meta pra Business
    // Discovery em conta de terceiro (precisa de App Review) — salvamos o
    // username mesmo assim, mas SEM confirmar que existe, e avisamos disso
    // explicitamente. "unknown" (erro de rede, etc.) recebe o mesmo aviso —
    // nos dois casos não temos como saber se a conta é real.
    if (!result.ok) {
      return {
        intent,
        error: null,
        warning: `Saved @${username}, but we couldn't confirm this account is real yet (needs Meta App Review). Double-check it yourself before relying on it — see the link next to it.`,
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

export default function Competitors() {
  const data = useLoaderData<typeof loader>();
  const addFetcher = useFetcher<typeof action>();
  const removeFetcher = useFetcher<typeof action>();
  const skipFetcher = useFetcher<typeof action>();
  const [username, setUsername] = useState("");
  // Passo intermediário antes de salvar — a API não confirma a conta de
  // verdade hoje (pendente de aprovação da Meta), então é a própria lojista
  // que confere visualmente que é a conta certa, olhando o perfil real,
  // antes de basear a estratégia nele (Patricia, 12/09/2026: "corremos o
  // risco de ele escrever errado e nos basearmos em um IG de um setor
  // totalmente diferente").
  const [pendingUsername, setPendingUsername] = useState<string | null>(null);

  const canAddMore = data.competitorAccounts.length < MAX_COMPETITOR_ACCOUNTS;
  const hasDecided = data.competitorAccounts.length > 0 || data.competitorsSkipped;

  const checkUsername = () => {
    const trimmed = username.trim().replace(/^@/, "");
    if (!trimmed) return;
    setPendingUsername(trimmed);
  };

  const confirmAddCompetitor = () => {
    if (!pendingUsername) return;
    addFetcher.submit(
      { intent: "add-competitor", instagramUsername: pendingUsername },
      { method: "POST" },
    );
    setPendingUsername(null);
    setUsername("");
  };

  const removeCompetitor = (id: string) =>
    removeFetcher.submit({ intent: "remove-competitor", id }, { method: "POST" });

  const skipCompetitors = () =>
    skipFetcher.submit({ intent: "skip-competitors" }, { method: "POST" });

  return (
    <s-page heading="Competitor accounts">
      <OnboardingStepper status={data.onboardingStatus} currentStepHref="/app/competitors" />

      <s-section heading="Competitor accounts">
        <s-paragraph>
          Add up to {MAX_COMPETITOR_ACCOUNTS} Instagram accounts you consider
          strong in your niche. We only read their public posts (via
          Business Discovery) — no authorization needed from them — to
          enrich your Store Voice and content strategy with real reference
          data.
        </s-paragraph>

        {!data.igBusinessAccountId && (
          <s-paragraph>
            <strong>
              This needs your Instagram connected first — go back to Social
              accounts, or skip this step below.
            </strong>
          </s-paragraph>
        )}

        <s-stack direction="block" gap="base">
          {data.competitorAccounts.map((c) => (
            <s-box key={c.id} padding="base" borderWidth="base" borderRadius="base">
              <s-stack direction="block" gap="small">
                <s-stack direction="inline" gap="small" alignItems="center">
                  {/* Verde só quando o Business Discovery confirmou a conta
                      de verdade (result.ok) — hoje isso quase nunca
                      acontece (pendente de aprovação da Meta), então a
                      maioria fica com o ícone neutro de "não confirmado
                      ainda" (Patricia, 12/09/2026: "eu coloquei um IG que
                      nem existe e ele deu ok" — o check não podia mentir
                      sobre isso). */}
                  {c.verified ? (
                    <s-icon type="check-circle-filled" tone="success" />
                  ) : (
                    <s-icon type="incomplete" tone="neutral" />
                  )}
                  <s-paragraph>@{c.instagramUsername}</s-paragraph>
                  <s-link href={`https://instagram.com/${c.instagramUsername}`} target="_blank">
                    View on Instagram
                  </s-link>
                  <s-button
                    variant="secondary"
                    onClick={() => removeCompetitor(c.id)}
                    {...(removeFetcher.state !== "idle" ? { loading: true } : {})}
                  >
                    Remove
                  </s-button>
                </s-stack>
                {/* Bio e site são mais úteis pra confirmar a conta certa do
                    que seguidores/posts (Patricia, 12/09/2026). Só vêm
                    preenchidos quando o Business Discovery funcionou. */}
                {(c.biography || c.website) && (
                  <s-stack direction="block" gap="small">
                    {c.biography && <s-text color="subdued">{c.biography}</s-text>}
                    {c.website && (
                      <s-link href={c.website} target="_blank">
                        {c.website}
                      </s-link>
                    )}
                  </s-stack>
                )}
              </s-stack>
            </s-box>
          ))}

          {data.igBusinessAccountId && canAddMore && !pendingUsername && (
            // Destaque forte aqui de propósito — queremos que a lojista
            // preencha um concorrente, não que pule (Patricia, 12/09/2026:
            // "devemos encorajar a pessoa a colocar o IG do competidor e
            // não a skip"). O botão "Skip" mais abaixo fica bem mais discreto
            // em comparação.
            <s-box padding="large" borderRadius="large" background="strong">
              <s-stack direction="block" gap="base" alignItems="center">
                <s-heading>Add a competitor account</s-heading>
                <s-paragraph>
                  Which Instagram account should we look at?
                </s-paragraph>
                <s-stack direction="inline" gap="base">
                  <input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="competitor_username"
                    style={{ padding: 8 }}
                  />
                  <s-button variant="primary" onClick={checkUsername}>
                    Check
                  </s-button>
                </s-stack>
              </s-stack>
            </s-box>
          )}

          {/* A API não confirma a conta de verdade hoje, então a lojista
              precisa olhar o perfil real e confirmar antes de salvar —
              evita basear a estratégia num IG de setor completamente
              diferente por causa de um erro de digitação. */}
          {pendingUsername && (
            <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
              <s-stack direction="block" gap="small">
                <s-paragraph>
                  Is <strong>@{pendingUsername}</strong> the right account?
                  Open it and check it&apos;s really in your niche before
                  adding it.
                </s-paragraph>
                <s-link
                  href={`https://instagram.com/${pendingUsername}`}
                  target="_blank"
                >
                  View @{pendingUsername} on Instagram
                </s-link>
                <s-stack direction="inline" gap="base">
                  <s-button
                    variant="primary"
                    onClick={confirmAddCompetitor}
                    {...(addFetcher.state !== "idle" ? { loading: true } : {})}
                  >
                    Yes, this is correct — add it
                  </s-button>
                  <s-button variant="secondary" onClick={() => setPendingUsername(null)}>
                    Cancel
                  </s-button>
                </s-stack>
              </s-stack>
            </s-box>
          )}

          {addFetcher.data?.error && (
            <s-paragraph>
              <strong>{addFetcher.data.error}</strong>
            </s-paragraph>
          )}
          {"warning" in (addFetcher.data ?? {}) && addFetcher.data?.warning && (
            <s-paragraph>{addFetcher.data.warning}</s-paragraph>
          )}

          {!hasDecided && (
            // Botão com fundo cinza de verdade — a variante "secondary" do
            // design system não tem preenchimento sólido, só um tom sutil
            // que ficava quase imperceptível (Patricia, 12/09/2026).
            <button
              type="button"
              onClick={skipCompetitors}
              disabled={skipFetcher.state !== "idle"}
              style={{
                display: "inline-block",
                alignSelf: "flex-start",
                padding: "8px 16px",
                border: "1px solid #a8abae",
                borderRadius: 8,
                background: "#c9cccf",
                color: "#202223",
                fontWeight: 500,
                cursor: skipFetcher.state !== "idle" ? "default" : "pointer",
              }}
            >
              Skip — I don&apos;t want to add competitor accounts
            </button>
          )}
          {data.competitorsSkipped && data.competitorAccounts.length === 0 && (
            <s-paragraph>Skipped — you can still add accounts later.</s-paragraph>
          )}
        </s-stack>
      </s-section>
    </s-page>
  );
}
