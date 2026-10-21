# Migração Railway → Hetzner (plano B, 14/10/2026)

## Estado (19/10/2026): produção NA HETZNER ✅
- Servidor `stockative-prod`: CX23 (2 vCPU, 4 GB), **Helsinki** (o Cost-Optimized não estava disponível na Alemanha; ~20–25 ms até o Neon em Frankfurt), Ubuntu 26.04, IP `37.27.24.159` / `2a01:4f9:c013:26d1::1`, €5,99/mês, pago por crédito pré-pago (Patricia preferiu a débito SEPA). Lembrar de recarregar o crédito antes de acabar.
- DNS no GoDaddy: `app` = A `37.27.24.159` + AAAA `2a01:4f9:c013:26d1::1` (o CNAME do Railway foi apagado). HTTPS do Let's Encrypt pelo Caddy, renovação automática.
- Agendador ligado no servidor (`ENABLE_IN_PROCESS_SCHEDULER=1` em `/opt/stockative/.env.production`).
- **Incidente junto com a migração:** o Neon (plano Free, org "Stockative" — não a org pessoal patricia@mangara.be, que está vazia) estourou a cota de **100 CU-hrs/mês** (110 em 19/10; o agendador consulta o banco a cada 5 min, então o banco nunca dorme). Banco bloqueado desde ~17/10 → nada publicava nem gerava plano. Upgrade para o **Launch** em 19/10 destravou. Storage só 0,21 GB.
- Containers em `network_mode: host`: a rede padrão do Docker não tem IPv6 e o Prisma não alcançava o Neon.
- Secrets `HETZNER_HOST`/`HETZNER_SSH_KEY` configurados no GitHub em 21/10/2026: todo push no main faz deploy sozinho (antes disso o job pulava em silêncio e mostrava "success").
- Projeto do Railway (`steadfast-rebirth`, serviços `stockative` e `stockative-public`) apagado em 21/10/2026, depois do trial expirar. Nada se perdeu: as variáveis do `stockative` já estavam no `.env.production`, e o `stockative-public` só tinha `DISABLE_IN_PROCESS_SCHEDULER`.
- Pendente: decidir se o banco fica no Neon Launch (~$15–20/mês) ou vira Postgres no próprio servidor.

## Por quê
O trial do Railway acaba em 5 dias (ou $3,49 de crédito). Depois disso ele desliga o `app.stockative.com`, e nada mais é publicado. O Railway só aceita cartão de crédito ou débito não pré-pago, e **nenhum cartão da Patricia foi aceito**. Também não aceita PayPal nem transferência fora do plano Enterprise. A Hetzner (Alemanha, perto do banco Neon em Frankfurt) aceita **débito direto SEPA** em contas em euro.

## O que muda e o que não muda
- **Não muda:** código, banco (Neon), domínio `app.stockative.com`, callbacks da Meta, TikTok, YouTube e Pinterest, app da Shopify. Para a lojista é transparente.
- **Muda:** a máquina. Um servidor Hetzner com Docker roda o app. O **Caddy** cuida do HTTPS. O **GitHub Actions** ([deploy-hetzner.yml](.github/workflows/deploy-hetzner.yml)) faz o deploy a cada push, como o Railway fazia.
- **Código:** o agendador só ligava com `RAILWAY_ENVIRONMENT_NAME=production`. Agora também liga com `ENABLE_IN_PROCESS_SCHEDULER=1` (`scheduler.server.ts`). Sem isso, na Hetzner nada seria publicado.

Arquivos: [deploy/hetzner/](deploy/hetzner/) (`docker-compose.yml`, `Caddyfile`, `setup-server.sh`).

## Passo a passo

### Patricia
1. **Conta Hetzner**: [accounts.hetzner.com](https://accounts.hetzner.com/signUp), moeda **EUR**, pagamento **SEPA direct debit**. Conta nova às vezes pede verificação de identidade, o que pode levar 1–2 dias.
2. **Criar o servidor** em Cloud Console → New project "Stockative" → Add Server:
   - Location: **Falkenstein** ou **Nuremberg** (Alemanha)
   - Image: **Ubuntu 24.04**
   - Type: Shared vCPU **x86**, o menor com **4 GB de RAM** (o build e o ffmpeg dos Reels precisam de memória)
   - Networking: IPv4 + IPv6
   - **SSH keys → Add SSH key** e colar a chave do Mac:
     `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFI9Z1glLagLVd5qYmF9zuU8+lEPZXQRRd/HPM1JLfhQ patricia-mac-stockative`
   - Backups: opcional (~20% a mais). O banco não está no servidor, então não é crítico.
   - Me passar o **IP**.
3. **GitHub** → repositório `MangaraShoes/stockative` → Settings → Secrets and variables → Actions → New repository secret:
   - `HETZNER_HOST` = IP do servidor
   - `HETZNER_SSH_KEY` = conteúdo do arquivo `~/.ssh/stockative_deploy` no Mac (a chave **privada**, começa com `-----BEGIN OPENSSH PRIVATE KEY-----`). Para copiar: `pbcopy < ~/.ssh/stockative_deploy`
4. **Variáveis secretas**: copiar o Raw Editor do serviço `stockative` no Railway e eu indico onde colar no servidor (`/opt/stockative/.env.production`). Adicionar `ENABLE_IN_PROCESS_SCHEDULER=1`.
5. **DNS no GoDaddy** (só quando eu avisar que o app já está respondendo no servidor): trocar o registro de `app` (hoje um CNAME para `ukrzb0cx.up.railway.app`) por um registro **A** apontando para o IP do servidor.

### Claude
- Rodar `setup-server.sh` (Docker, firewall, atualizações automáticas, swap) e colocar a chave de deploy no servidor.
- Subir o app e testar pelo IP antes da troca de DNS.
- Acompanhar a troca de DNS e a emissão do certificado HTTPS.
- **Desligar o agendador no Railway** (ou o serviço inteiro) logo depois da virada. A publicação dupla é protegida, mas não há motivo para os dois rodarem.
- Atualizar os documentos e as anotações que mencionam `railway logs`.

## Operação no dia a dia
- **Logs:** `ssh -i ~/.ssh/stockative_hetzner root@<IP> 'cd /opt/stockative && docker compose -f deploy/hetzner/docker-compose.yml logs --tail 200 app'`
- **Deploy manual:** GitHub → Actions → "Deploy (Hetzner)" → Run workflow.
- **Monitor de queda:** criar um monitor HTTP grátis (UptimeRobot ou similar) em `https://app.stockative.com`, com alerta por email.
- **App público** (PUBLIC-APP.md): roda no mesmo servidor sem custo extra. Precisa criar `/opt/stockative/.env.public`, um registro DNS `apps.stockative.com` e descomentar o bloco no `Caddyfile`. O deploy liga o serviço automaticamente quando o `.env.public` existe.
