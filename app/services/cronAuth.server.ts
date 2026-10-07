import { timingSafeEqual } from "node:crypto";

// Comparação de string comum (!==) vaza timing: o tempo de resposta varia
// com quantos caracteres do início batem, o que em teoria deixa alguém
// adivinhar o CRON_SECRET byte a byte medindo latência (achado de revisão
// de código, 13/09/2026). timingSafeEqual evita isso, mas lança exceção se
// os dois buffers tiverem tamanho diferente, por isso a checagem de
// comprimento vem antes.
//
// Só aceita o segredo no header Authorization, nunca em ?token= na URL:
// URL vaza em log de proxy/monitoramento (auditoria de segurança, 07/10/2026).
export function isCronRequestAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!provided) return false;

  const secretBuffer = Buffer.from(secret);
  const providedBuffer = Buffer.from(provided);
  if (secretBuffer.length !== providedBuffer.length) return false;

  return timingSafeEqual(secretBuffer, providedBuffer);
}
