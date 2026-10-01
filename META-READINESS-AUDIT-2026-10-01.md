# Revisão crítica para Meta App Review — 1 outubro 2026

## Segunda revisão — após as correções de 1 outubro

Esta atualização substitui os estados antigos abaixo onde indicado. Inspeção direta dos oito itens de Allowed usage, App settings, Data handling, Reviewer instructions e Verification no painel Meta; política publicada; código no commit 7c81198; amostragem visual do vídeo combinado v2; tela Social accounts em produção. Nenhum campo do painel foi alterado e a submissão não foi enviada.

**Confirmado como corrigido:**

- instagram_basic agora descreve username e Página, sem prometer foto; o app em produção mostra @mangara.official e Página Mangará. O vídeo v2 também mostra essa identificação.
- business_management não alega mais validação explícita de papéis; explica a dependência de ativos de Business portfolio. A necessidade em todos os arranjos de ativos não foi testada, portanto permanece sujeita à avaliação da Meta, mas a contradição anterior foi removida.
- Descrições e tempos de pages_show_list, pages_manage_posts, pages_read_engagement e instagram_content_publish foram atualizados no painel.
- As permissões que exibem requisito de chamada de teste estão como Completed, inclusive instagram_manage_insights.
- Vídeo combinado v2 consta nos anexos das instruções. As permissões que pedem screencast possuem link para vídeo carregado. A equivalência byte a byte entre cada anexo e o arquivo local não foi verificada.
- A política pública agora explica publicação automática e envio de legendas/usernames/métricas ao provedor de IA.
- O código agora apaga SocialAccount ao desinstalar e tem serviço de exclusão dos dados da loja, acionado por webhook de compliance. A ativação da configuração em produção e a execução real da exclusão não foram comprovadas nesta revisão.
- Business verification está Verified. Controller declarado: Mangara Shoes BV, Belgium. Privacy URL configurada e acessível.

**Pontos restantes antes de dar um aval sem ressalvas:**

1. Data handling lista somente OpenRouter, Neon e Railway. O prompt de brand_analysis inclui dados Meta e é enviado a um modelo Anthropic pelo OpenRouter. Conferir e declarar a cadeia real de provedores que recebe Platform Data, inclusive provedor de inferência a jusante; não presumir que listar apenas o intermediário cobre todos. Não acrescentar Google por receber imagens de catálogo se ele não recebe Platform Data nesse fluxo. Países também precisam refletir os destinatários reais; não foram verificados nesta sessão.
2. Confirmar publicação da configuração dos webhooks de exclusão: o próprio checklist ainda registra esse deploy como pendente. Não tratar presença no código como prova de ativação.
3. O acesso do revisor ainda usa caixa pública de códigos e senha de baixa complexidade. O risco de recuperação/acesso indevido à loja de teste permanece. A sessão nova do revisor não foi testada novamente nesta revisão; não alterar credenciais sem atualizar também a submissão.
4. A política ainda contém, na entrada de Meta em “Who else processes it”, a expressão “when you connect and approve a post”, embora a seção principal corretamente descreva automação. Remover essa sobra de texto para consistência; também permanece menção a foto de perfil que o fluxo auditado não lê.

**Pendência externa confirmada:** Access verification (Tech Provider) está **In review**. É distinta de Business verification. Isso impede afirmar que o acesso a negócios de terceiros já foi aprovado; não significa, por si só, que o App Review não possa ser enviado em paralelo se o painel permitir.

**Parecer:** os campos principais e o vídeo melhoraram e não precisam ser refeitos integralmente. Antes do envio, fechar declaração dos destinatários dos dados e confirmação da ativação da exclusão; manter a ressalva de segurança do acesso do revisor. Não foi atribuído status de aprovação pela Meta.

---

**Parecer: corrigir as inconsistências abaixo antes de submeter.** O fluxo principal está demonstrado, mas política, descrições e comportamento ainda não estão alinhados. Prioridade é julgamento desta auditoria, não previsão garantida da decisão da Meta.

## Escopo e limites

Inspecionados: código local de OAuth, publicação, agendamento, desconexão, desinstalação, coleta de métricas e uso de IA; META-APP-REVIEW.md; política e termos publicados em https://stockative.com/#privacy; quadros distribuídos pelo vídeo fornecido e quadros adicionais nos trechos de conexão, publicação e métricas. Vídeo: 2:05,87, 1920×1248, sem faixa de áudio.

Não foram executados testes que publicam posts, conectam contas, alteram banco ou desinstalam o app. Não foi confirmado que o código local coincide com o deploy. Não foram auditados o painel privado da Meta, a configuração real dos provedores de IA nem o login do revisor nesta sessão. O segundo vídeo de concorrentes é citado no documento interno, mas não foi inspecionado.

## 1. Alta — exclusão prometida não implementada no fluxo auditado

**Evidência:** a política pública diz que desinstalar revoga tokens armazenados e agenda exclusão dos dados. `app/routes/webhooks.app.uninstalled.tsx:16` explicitamente mantém SocialAccount; apenas marca a loja como desinstalada e cancela posts. Não foi encontrado serviço de exclusão global, fila ou rotina posterior de expurgo no código examinado.

**Possível objeção:** a declaração de tratamento/retenção de dados não corresponde à implementação.

**Correção:** implementar o processo prometido e verificá-lo com dados sintéticos; documentar prazo, dados abrangidos, registros derivados e backups. Não basta apagar a sessão de login. Se houver processo manual externo, ele precisa ser comprovável e descrito corretamente.

Disconnect remove o registro/token local (`app/routes/app.social.tsx:130`), mas não apaga todo o histórico nem revoga a autorização na Meta. Não confundir essas três operações. Não foi encontrado callback de exclusão/desautorização; isso não implica, por si só, reprovação quando a configuração usa instruções de exclusão. É necessário demonstrar que as instruções levam a uma exclusão real e que a modalidade configurada no painel corresponde ao serviço disponível.

## 2. Alta — privacidade contradiz a publicação automática

**Evidência:** a política promete revisão antes da publicação e fala em conteúdo aprovado. Na mesma página, os termos dizem que revisar é opcional. O agendador inclui status `draft` e `approved` (`app/services/meta/publishContentItem.server.ts:541`). A interface Weekly plan informa que os posts saem automaticamente, salvo cancelamento.

**Possível objeção:** falta de clareza sobre o controle do usuário e o que acontece após autorizar a conta.

**Correção:** preservar o modelo automático, se essa é a decisão do produto, mas explicar isso consistentemente na política, termos, onboarding e submissão. Recomendo ativação explícita e registrada do modo automático e pausa geral visível. Não estou afirmando que a Meta exige aprovação individual de cada post; o problema confirmado é a contradição atual.

## 3. Alta — descrição do processamento por IA incompleta

**Evidência:** a política diz que OpenRouter recebe apenas texto de produto/marca. `app/services/decisionEngine/draftBrandVoice.server.ts:79` e `:87` montam prompts com legendas próprias, legendas de terceiros, usernames e contagens de engajamento; `:130` envia o prompt ao provedor. O adaptador também suporta imagens.

**Possível objeção:** respostas de Data handling e política subestimam os dados de plataforma enviados a terceiros.

**Correção:** mapear os dados efetivamente enviados, os modelos/provedores que os recebem e as condições de retenção e uso. Descrever inferência e finalidade com precisão. Não encontrei evidência de treinamento de modelos pelo app; também não foi verificada a configuração externa que sustentaria garantias sobre os provedores. Não declarar uma proibição genérica de IA nem confundir geração com treinamento.

## 4. Alta — justificativa de business_management não sustentada pela função mostrada

**Evidência:** `META-APP-REVIEW.md:71` afirma verificação de papéis/permissões no Business Manager. `app/services/meta/oauth.server.ts:126` lista `/me/accounts`, consulta a conta Instagram vinculada e retorna a primeira encontrada. Não existe ali verificação explícita de papéis ou tarefas que corresponda à descrição.

**Possível objeção:** permissão ampla sem necessidade demonstrada. Mostrar seleção de um negócio no consentimento não prova essa validação pelo app.

**Correção:** identificar e comprovar a dependência real no arranjo de ativos utilizado, ajustar a justificativa e o trecho de demonstração; ou retirar a permissão após teste controlado confirmar que ela não é necessária. A ausência de endpoint de Business Manager no código não prova, sozinha, que o escopo é dispensável em toda configuração.

## 5. Média/alta — identidade da conta conectada e múltiplas contas

**Evidência:** a descrição de instagram_basic promete username e foto visíveis (`META-APP-REVIEW.md:35`). O app não busca foto nesse fluxo, não persiste o username Instagram em SocialAccount e mostra apenas “Instagram and Facebook connected” (`app/routes/app.social.tsx:210`). O vídeo confirma essa tela genérica. O OAuth escolhe a primeira Página com Instagram entre as retornadas e não percorre a paginação (`app/services/meta/oauth.server.ts:129`).

**Riscos:** descrição impossível de reproduzir; em usuários com várias Páginas, vinculação a uma conta diferente da desejada, sem identificação clara antes da publicação.

**Correção:** mostrar permanentemente @Instagram e nome da Página; seleção quando houver múltiplas contas; percorrer páginas da resposta. Remover da submissão qualquer informação que a interface não mostra.

## 6. Alta para segurança operacional — acesso do revisor

O documento de revisão descreve encaminhamento de códigos de verificação a uma caixa de e-mail pública e um usuário administrador da loja de teste. Isso não foi testado nesta auditoria. A caixa pública pode expor mensagens de verificação/recuperação e não é uma solução adequada para manter acesso administrativo.

Recomendação: acesso dedicado, restrito à loja de teste, sem dados ou integrações de produção e com mecanismo de autenticação seguro, reproduzível e documentado. Revalidar todo o percurso em sessão nova, incluindo geração de plano, quotas, tempo de espera e conexão Meta. O guia oficial diz que revisores usam suas próprias contas de teste Meta; não fornecer credenciais pessoais de Facebook/Instagram.

## Vídeo enviado

**Aproveitável:** conexão com seleção de ativos; retorno ao app; plano com imagem/legenda; publicação; confirmação no app; post no Instagram e na Página Facebook; tela de Performance com alcance. Interface em inglês, sem áudio e com resolução suficiente para detalhes quando ampliados.

**Melhorias prioritárias:**

- Cerca de 0:32: identificar @ e Página na confirmação. Hoje só há confirmação genérica.
- Aproximadamente 0:48–1:28: muita espera de publicação. Encurtar visualmente com aceleração identificada, preservando a continuidade do fluxo.
- Aproximadamente 1:33–1:45: mostrar claramente o post aberto, conta, imagem e legenda em Instagram e Facebook; há evidência útil no material atual.
- Aproximadamente 1:56–2:05: dar mais tempo e zoom a um post com alcance real e à atualização dos dados. Aos 2:00 há posts sem dados, mas também posts com alcance 2 e 3; portanto não é correto dizer que o vídeo não tem Insights. Zeros de likes/saves não são falha por si sós.
- Acrescentar indicações curtas em inglês relacionando ação e permissão. O vídeo inspecionado não demonstra por si só Business Discovery nem comprova que horários foram derivados de online_followers.
- A resolução do arquivo é 1920×1248. O guia recomenda gravação de alta resolução e reduzir a largura do monitor a 1440 ou menos para legibilidade. Tratar como melhoria de apresentação, não motivo automático de reprovação.

Não é necessário refazer todo o vídeo apenas por acabamento. Corrigir o app e complementar os trechos frágeis é mais valioso.

## Permissões e evidências

| Permissão | Parecer |
|---|---|
| instagram_content_publish | Uso demonstrado pelo post real; alinhar descrição de automação e formatos. |
| pages_manage_posts | Uso demonstrado pelo post na Página. |
| pages_show_list | Chamada presente; melhorar escolha e identificação do ativo. |
| pages_read_engagement | Presente no fluxo declarado de acesso à Página; explicar dependência específica, sem inventar funcionalidade adicional. |
| instagram_basic | Uso real, mas descrição promete foto/username não exibidos; Business Discovery precisa do complemento citado. |
| instagram_manage_insights | Código e vídeo mostram métricas; melhorar trecho final. online_followers tem fallback silencioso e precisa de comprovação separada antes de afirmar que determinou os horários mostrados. |
| business_management | Justificativa exige revisão e comprovação. |
| public_profile | Documento diz que foi incluído no painel; este estado não foi confirmado. Não alegar que o app lê/exibe perfil pessoal do Facebook sem implementação correspondente; conferir a necessidade no produto de login configurado. |

## Pendências externas antes de submeter

1. Confirmar no painel status atual de Access Verification, permissões e chamadas de teste. Documento local ainda marca pendências e não prova o estado atual.
2. Confirmar pelo menos uma chamada bem-sucedida para cada permissão solicitada nos últimos 30 dias. O guia oficial atual informa até **dois dias** para registro, corrigindo a expectativa de 24h do checklist interno.
3. Comparar os textos realmente preenchidos no painel com o app corrigido; o arquivo local pode divergir do formulário.
4. Validar acesso do revisor do início ao fim e disponibilidade do domínio durante a revisão.
5. Testar desconexão/reconexão com posts pendentes: o código remove a conta, mas conserva a fila. Evitar que reconectar uma conta diferente publique posts antigos sem reconfirmação do destino.

## Fontes verificadas

- [Meta — processo de App Review](https://developers.facebook.com/documentation/resp-plat-initiatives/individual-processes/app-review): acesso do revisor e teste efetivo das permissões.
- [Meta — guia de submissão, atualizado em 30 junho 2026](https://developers.facebook.com/documentation/resp-plat-initiatives/individual-processes/app-review/submission-guide): evidência em vídeo, chamadas nos últimos 30 dias, até dois dias para registro, acesso e justificativa individual.
- [Política e termos publicados do Stockative](https://stockative.com/#privacy): conteúdo conferido no navegador em 1 outubro 2026.

As fontes oficiais foram abertas no navegador após o buscador devolver erros/limitação de acesso. Esta auditoria identifica divergências e riscos demonstráveis; não certifica conformidade jurídica nem garante aprovação.
