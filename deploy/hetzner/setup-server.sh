#!/usr/bin/env bash
# Prepara um servidor Hetzner novo (Ubuntu 24.04) pra rodar o Stockative.
# Rodar uma vez, como root: bash setup-server.sh
# Idempotente: rodar de novo não estraga nada.
set -euo pipefail

REPO_URL="https://github.com/MangaraShoes/stockative.git"
APP_DIR="/opt/stockative"

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y

# Atualizações de segurança automáticas (reinicia sozinho às 04:00 se precisar).
apt-get install -y unattended-upgrades ufw git ca-certificates curl
cat >/etc/apt/apt.conf.d/52stockative-unattended <<'EOF'
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:00";
EOF
dpkg-reconfigure -f noninteractive unattended-upgrades

# Firewall: só SSH e web.
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

# SSH só por chave.
sed -i 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl reload ssh || systemctl reload sshd || true

# Docker (repositório oficial).
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker

# Swap de 2 GB: o build (npm ci + react-router build) passa dos 2 GB em pico.
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# Código.
if [ ! -d "$APP_DIR/.git" ]; then
  git clone "$REPO_URL" "$APP_DIR"
fi

# Limpa imagens antigas toda semana (cada deploy gera uma nova).
cat >/etc/cron.weekly/docker-prune <<'EOF'
#!/bin/sh
docker image prune -af --filter "until=168h" >/dev/null 2>&1
EOF
chmod +x /etc/cron.weekly/docker-prune

echo
echo "Pronto. Falta:"
echo "  1. Criar $APP_DIR/.env.production (variáveis do Railway + ENABLE_IN_PROCESS_SCHEDULER=1)"
echo "  2. cd $APP_DIR && docker compose -f deploy/hetzner/docker-compose.yml up -d --build"
