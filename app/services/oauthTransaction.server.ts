import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import prisma from "../db.server";

// OAuth das redes sociais vinculado ao navegador que iniciou o fluxo
// (auditoria de segurança, 07/10/2026, achado H1). Ver o model
// OAuthTransaction no schema pro ciclo completo. Em resumo:
//
// 1. O app embutido gera um ticket por loja+rede (getConnectUrl) — o botão
//    "Connect" abre /auth/<provider>/start?t=<ticket> numa aba nova.
// 2. A tela de start mostra pra QUAL loja a conta vai ser conectada; só o
//    POST dela (beginOAuthTransaction) consome o ticket, uma vez só, grava o
//    cookie com um nonce neste navegador e manda pra rede social com um
//    `state` novo. POST (e não GET) também impede que preview de link
//    (Slack, WhatsApp) queime o ticket de uso único.
// 3. O callback (completeOAuthTransaction) só aceita aquele `state` uma vez,
//    dentro do prazo, e se o cookie do navegador bater com o nonce gravado.
//
// Limite conhecido: a aba nova não tem a sessão da Shopify (o app roda em
// iframe), então não dá pra provar criptograficamente que quem conclui é o
// mesmo usuário logado no admin — a tela de confirmação com o domínio da loja
// é o que protege quem recebe um link de outra pessoa.

export type OAuthProvider = "meta" | "pinterest" | "tiktok" | "youtube";

export const OAUTH_PROVIDERS: readonly OAuthProvider[] = ["meta", "pinterest", "tiktok", "youtube"];

const TICKET_TTL_MS = 15 * 60 * 1000;
// Um ticket com menos que isso de vida é trocado por um novo, pra o
// merchant não clicar num botão que expira no meio do caminho.
const TICKET_MIN_REMAINING_MS = 5 * 60 * 1000;
const TRANSACTION_TTL_MS = 10 * 60 * 1000;
const CLEANUP_AFTER_MS = 24 * 60 * 60 * 1000;

export function isOAuthProvider(value: string | undefined): value is OAuthProvider {
  return OAUTH_PROVIDERS.includes(value as OAuthProvider);
}

function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function cookieName(provider: OAuthProvider) {
  return `stockative_oauth_${provider}`;
}

function getAppUrl(): string {
  const appUrl = process.env.SHOPIFY_APP_URL;
  if (!appUrl) throw new Error("SHOPIFY_APP_URL is not set");
  return appUrl;
}

// Reaproveita um ticket ainda válido e não usado: o loader de /app/social
// revalida a cada foco da aba, e criar um ticket novo a cada vez encheria
// a tabela à toa.
export async function getConnectUrl(shopDomain: string, provider: OAuthProvider): Promise<string> {
  const now = Date.now();
  let ticket = await prisma.oAuthTransaction.findFirst({
    where: {
      shopDomain,
      provider,
      startedAt: null,
      expiresAt: { gt: new Date(now + TICKET_MIN_REMAINING_MS) },
    },
    select: { id: true },
  });

  if (!ticket) {
    await prisma.oAuthTransaction.deleteMany({
      where: { expiresAt: { lt: new Date(now - CLEANUP_AFTER_MS) } },
    });
    ticket = await prisma.oAuthTransaction.create({
      data: {
        id: randomToken(),
        shopDomain,
        provider,
        expiresAt: new Date(now + TICKET_TTL_MS),
      },
      select: { id: true },
    });
  }

  return `${getAppUrl()}/auth/${provider}/start?t=${encodeURIComponent(ticket.id)}`;
}

// Só lê, sem consumir — usado pelo GET da tela de confirmação.
export async function findPendingTicket(ticketId: string, provider: OAuthProvider) {
  return prisma.oAuthTransaction.findFirst({
    where: { id: ticketId, provider, startedAt: null, expiresAt: { gt: new Date() } },
    select: { shopDomain: true },
  });
}

// Consome o ticket de forma atômica (updateMany com startedAt: null — duas
// requisições simultâneas não conseguem as duas count=1) e devolve o
// `state` pra mandar à rede social + o Set-Cookie deste navegador.
export async function beginOAuthTransaction(
  ticketId: string,
  provider: OAuthProvider,
): Promise<{ state: string; setCookie: string } | null> {
  const state = randomToken();
  const nonce = randomToken();
  const now = new Date();

  const claimed = await prisma.oAuthTransaction.updateMany({
    where: { id: ticketId, provider, startedAt: null, expiresAt: { gt: now } },
    data: {
      startedAt: now,
      state,
      browserNonceHash: sha256(nonce),
      expiresAt: new Date(now.getTime() + TRANSACTION_TTL_MS),
    },
  });
  if (claimed.count !== 1) return null;

  // SameSite=Lax: o callback chega como navegação top-level vinda da rede
  // social, e Lax ainda manda o cookie nesse caso. Path restrito à rota
  // desta rede, pra não vazar pra nenhuma outra.
  const setCookie = [
    `${cookieName(provider)}=${nonce}`,
    `Path=/auth/${provider}`,
    `Max-Age=${TRANSACTION_TTL_MS / 1000}`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
  ].join("; ");

  return { state, setCookie };
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

// Devolve o shopDomain se o callback é legítimo: state conhecido, desta
// rede, dentro do prazo, ainda não usado, e o cookie deste navegador bate
// com o nonce gravado no start. Marca como concluído de forma atômica.
export async function completeOAuthTransaction(
  request: Request,
  provider: OAuthProvider,
  state: string,
): Promise<string | null> {
  const transaction = await prisma.oAuthTransaction.findUnique({ where: { state } });
  if (
    !transaction ||
    transaction.provider !== provider ||
    transaction.completedAt ||
    !transaction.browserNonceHash ||
    transaction.expiresAt.getTime() < Date.now()
  ) {
    return null;
  }

  const nonce = readCookie(request, cookieName(provider));
  if (!nonce) return null;
  const expected = Buffer.from(transaction.browserNonceHash);
  const provided = Buffer.from(sha256(nonce));
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return null;

  const completed = await prisma.oAuthTransaction.updateMany({
    where: { id: transaction.id, completedAt: null },
    data: { completedAt: new Date() },
  });
  if (completed.count !== 1) return null;

  return transaction.shopDomain;
}
