# GYST LXC Container Setup

## Create container (on Proxmox host)

```bash
# Debian 12 template (adjust IDs/storage to your setup)
pct create 135 local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst \
  --hostname gyst \
  --cores 2 --memory 2048 --swap 512 \
  --rootfs local-lvm:20 \
  --net0 name=eth0,bridge=vmbr0,ip=dhcp \
  --unprivileged 1 --features nesting=1

pct start 135
```

## Bind-mount source code

In `/etc/pve/lxc/135.conf` add:
```
mp0: /home/velasco/workspaces/GYST,mp=/opt/gyst,ro=0
```

## Inside the container

```bash
apt update && apt install -y python3.12 python3.12-venv python3-pip nodejs npm caddy git

# Create user
useradd -m -s /bin/bash gyst

# Backend venv
cd /opt/gyst/backend
python3.12 -m venv /opt/gyst/.venv
/opt/gyst/.venv/bin/pip install -e ".[dev]"

# Frontend build
cd /opt/gyst/frontend
npm ci
npm run build

# Data directory
mkdir -p /opt/gyst/data/{media,embeddings,telemetry/raw/{firefox,chrome}}
chown -R gyst:gyst /opt/gyst/data

# Run Alembic migrations (creates the database)
cd /opt/gyst/backend
sudo -u gyst /opt/gyst/.venv/bin/alembic upgrade head

# Systemd (ExecStartPre runs alembic on each start — idempotent)
cp /opt/gyst/deploy/systemd/gyst.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now gyst

# Caddy
cp /opt/gyst/deploy/caddy/Caddyfile /etc/caddy/Caddyfile
systemctl reload caddy
```

## Configure password

```bash
/opt/gyst/.venv/bin/python -c \
  "from gyst.auth import hash_password; print(hash_password('yourpassword'))"
# Paste the output into gyst.toml [auth] password_hash
# Also set a random secret_key: python -c "import secrets; print(secrets.token_hex(32))"
systemctl restart gyst
```

## Smoke test

```bash
# From the container or LAN:
curl -s http://127.0.0.1:8000/api/v1/health
# → {"status":"ok","version":"0.1.0"}

# Through Caddy (TLS):
curl -sk https://gyst.local/api/v1/health
```

## rsync for browser history (run on your laptop)

```bash
# Firefox (Linux)
rsync -az ~/.mozilla/firefox/*.default-release/places.sqlite \
  gyst:/opt/gyst/data/telemetry/raw/places.sqlite

# Chrome
rsync -az ~/.config/google-chrome/Default/History \
  gyst:/opt/gyst/data/telemetry/raw/chrome-history
```

Add to crontab (`crontab -e` on laptop):
```
0 * * * * rsync -az ~/.mozilla/firefox/*.default-release/places.sqlite gyst:/opt/gyst/data/telemetry/raw/places.sqlite 2>/dev/null
```
