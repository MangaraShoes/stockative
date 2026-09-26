# YouTube Data API v3 — verificação e cota

Processo mais simples que o Meta App Review/Tech Provider — sem estrutura de Tech Provider, só a verificação padrão de OAuth do Google quando o app sai do modo Testing.

## Setup (uma vez, por Patricia)

- [ ] Projeto no Google Cloud Console criado/reaproveitado.
- [ ] "YouTube Data API v3" ativada nesse projeto.
- [ ] Tela de consentimento OAuth configurada (tipo External).
- [ ] OAuth 2.0 Client ID criado (tipo "Web application"), com `${SHOPIFY_APP_URL}/auth/youtube/callback` cadastrado em "Authorized redirect URIs".
- [ ] `YOUTUBE_CLIENT_ID`/`YOUTUBE_CLIENT_SECRET` preenchidos no `.env` de produção.

## Modo Testing vs verificação completa

`youtube.upload` e `youtube.readonly` são **restricted scopes** do Google — em modo **Testing** (até 100 usuários de teste, adicionados manualmente na tela de consentimento), funcionam sem revisão nenhuma. Isso já é suficiente pro piloto com a Mangará e um punhado de lojas.

Só quando o app precisar publicar pra QUALQUER lojista (não só contas de teste cadastradas manualmente) é que entra a revisão de verificação OAuth do Google — inclui validação de branding (nome, logo, política de privacidade) e, dependendo do volume, uma avaliação de segurança mais formal. Sem prazo fixo divulgado publicamente; começar essa submissão com folga antes de precisar dela pra valer, mesmo padrão de cautela do Meta App Review.

## Cota (ver também nota em CLAUDE.md)

- Orçamento dedicado de uploads (`videos.insert`, desde jun/2026): **100 uploads de vídeo/dia**, sem competir com o resto da cota.
- Orçamento geral: 10.000 unidades/dia (buscas, leituras de metadados etc.).
- Aumentar a cota de upload não tem plano pago — só um formulário de "Audit and Quota Extension" no próprio Google Cloud Console, revisado manualmente pelo Google (de semanas a meses). Só vale a pena pedir se o volume real de Shorts/dia algum dia chegar perto de 100.
- **Conferir os números atuais no painel de cota do projeto real assim que ele existir** — a estrutura mudou uma vez recentemente (jun/2026), pode mudar de novo.

## Checklist de submissão (quando sair do modo Testing)

- [ ] Branding da tela de consentimento revisado (nome do app, logo, domínio, Privacy Policy — reaproveitar os mesmos de stockative.com já usados no Meta App Review).
- [ ] Submeter verificação OAuth e anotar a data aqui.
- [ ] Resposta do Google recebida — anotar resultado e prazo real observado (referência pra próxima vez).
