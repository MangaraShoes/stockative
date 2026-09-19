// Resposta final da aba de callback do OAuth (Meta/Pinterest). Ela tenta
// atualizar a aba original (o app embutido no admin da Shopify) sozinha via
// `window.opener` — mas isso é frágil (o navegador corta esse vínculo em
// vários cenários, ex.: `rel="noreferrer"` no link que abriu a aba, ou
// políticas de sandbox do iframe do admin) e, quando falha, NUNCA deve cair
// de volta pra navegar esta própria aba pra dentro do app embutido: essa
// rota exige o contexto do iframe da Shopify e renderia em branco fora dele
// (Patricia, 12/09/2026: "a tela ficou branca... vai gerar na cliente uma
// dúvida se conectou ou não"). Por isso esta aba sempre mostra uma
// confirmação de texto simples, independente do `window.opener` funcionar —
// a atualização de verdade da aba original já é coberta pelo listener de
// foco/visibilidade em app.social.tsx, não depende desta resposta.
export function oauthPopupCloseResponse(redirectUrl: string): Response {
  const parsed = new URL(redirectUrl);
  const errorMessage = parsed.searchParams.get("error");
  const connectedUsername = parsed.searchParams.get("connected");

  const title = errorMessage ? "Connection failed" : "Connected!";
  const message = errorMessage
    ? errorMessage
    : connectedUsername
      ? `@${connectedUsername} is now linked.`
      : "Your account is now linked.";

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charSet="utf-8" />
<style>
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    margin: 0;
    background: #f6f6f7;
    color: #202223;
  }
  .card { max-width: 360px; text-align: center; padding: 32px; }
  h1 { font-size: 20px; margin: 0 0 8px; }
  p { color: #6d7175; margin: 4px 0; }
</style>
</head>
<body>
<div class="card">
  <h1>${escapeHtml(title)}</h1>
  <p>${escapeHtml(message)}</p>
  <p>You can close this tab and go back to Stockative.</p>
</div>
<script>
  try {
    if (window.opener && !window.opener.closed) {
      window.opener.location.href = ${JSON.stringify(redirectUrl)};
    }
  } catch (e) {}
  try {
    window.close();
  } catch (e) {}
</script>
</body>
</html>`;
  return new Response(html, { headers: { "Content-Type": "text/html" } });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
