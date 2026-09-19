import { timingSafeEqual } from "node:crypto";

// Comparação de string comum (!==) vaza timing: o tempo de resposta varia
// com quantos caracteres do início batem, o que em teoria deixa alguém
// adivinhar o CRON_SECRET byte a byte medindo latência (achado de revisão
// de código, 13/09/2026). timingSafeEqual evita isso, mas lança exceção se
// os dois buffers tiverem tamanho diferente, por isso a checagem de
// comprimento vem antes.
export function isCronRequestAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const header = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const queryToken = new URL(request.url).searchParams.get("token");
  const provided = header ?? queryToken;
  if (!provided) return false;

  const secretBuffer = Buffer.from(secret);
  const providedBuffer = Buffer.from(provided);
  if (secretBuffer.length !== providedBuffer.length) return false;

  return timingSafeEqual(secretBuffer, providedBuffer);
}
