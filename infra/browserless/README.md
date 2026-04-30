# infra/browserless

Source of truth for the Browserless v2 Chromium container that backs the
seo-audit JS-rendering mode.

## Files

| File | Purpose |
|---|---|
| `docker-compose.yml` | Container definition. Pinned image tag (`v2.41.0`), localhost-only port binding, 2 GiB memory cap, healthcheck. |
| `.env.example` | Template for the secret token. |
| `browserless.service` | systemd unit that starts/stops the compose stack at boot. |

## First-time setup on twb-server

```bash
# 1. Create the deployment directory + copy compose + env template
sudo mkdir -p /home/tobias/apps/seo-audit-browserless
sudo chown tobias:tobias /home/tobias/apps/seo-audit-browserless
cp docker-compose.yml /home/tobias/apps/seo-audit-browserless/
cp .env.example       /home/tobias/apps/seo-audit-browserless/.env

# 2. Generate a token, write it into BOTH env files
TOKEN=$(openssl rand -hex 32)
sed -i "s/^BROWSERLESS_TOKEN=.*/BROWSERLESS_TOKEN=$TOKEN/" \
    /home/tobias/apps/seo-audit-browserless/.env
echo "BROWSERLESS_TOKEN=$TOKEN" >> /home/tobias/apps/seo-audit/.env.production

# 3. Install the systemd unit
sudo cp browserless.service /etc/systemd/system/browserless.service
sudo systemctl daemon-reload
sudo systemctl enable --now browserless.service
```

## Health check

```bash
# Token is in /home/tobias/apps/seo-audit-browserless/.env
TOKEN=$(grep -E '^BROWSERLESS_TOKEN=' /home/tobias/apps/seo-audit-browserless/.env | cut -d= -f2)
curl -fsS "http://127.0.0.1:9223/health?token=$TOKEN" && echo " — ok"
```

## Day-to-day operations

```bash
# Status
systemctl status browserless.service
docker compose -f /home/tobias/apps/seo-audit-browserless/docker-compose.yml ps

# Logs (live tail)
docker logs -f browserless

# Restart (e.g. after container hang)
sudo systemctl restart browserless.service
```

## Image upgrade

```bash
# 1. Edit infra/browserless/docker-compose.yml in this repo: bump the
#    image tag to the next pinned Browserless v2 release.
# 2. Deploy the new compose file to the server:
scp docker-compose.yml twb-server:/home/tobias/apps/seo-audit-browserless/
# 3. Pull + restart on the server:
ssh twb-server '\
  cd /home/tobias/apps/seo-audit-browserless && \
  docker compose pull && \
  sudo systemctl restart browserless.service'
```

Always read the Browserless changelog before bumping — Chromium version
and playwright-core protocol have to stay compatible.
