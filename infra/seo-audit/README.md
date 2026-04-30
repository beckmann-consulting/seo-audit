# infra/seo-audit

Source of truth for the systemd unit + deployment recipe of the
seo-audit-pro Next.js app.

## Files

| File | Purpose |
|---|---|
| `seo-audit.service` | systemd unit. `Type=simple`, `User=tobias`, `Restart=on-failure`. Runs `npm run start` from `/home/tobias/apps/seo-audit`. |

## First-time setup on twb-server

```bash
# 1. Clone the repo into the apps directory
sudo mkdir -p /home/tobias/apps
sudo chown tobias:tobias /home/tobias/apps
cd /home/tobias/apps
git clone git@github.com:beckmann-consulting/seo-audit.git
cd seo-audit

# 2. Install dependencies + build
npm ci
npm run build

# 3. Create .env.production (see DEPLOYMENT.md §2)
#    chmod 600 to keep the token / API-key bits private
nano .env.production
chmod 600 .env.production

# 4. Install the systemd unit
sudo cp infra/seo-audit/seo-audit.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now seo-audit.service
```

## Health check

```bash
# Locally on the server (bypasses Caddy)
curl -fsS http://127.0.0.1:3001/api/config | jq .
# → { hasGoogleKey: true } if GOOGLE_API_KEY is set

# Through Caddy (HTTPS, public-matched routes)
curl -fsS https://seo-audit.beckmanndigital.com/widget.js -o /dev/null -w '%{http_code}\n'
# → 200
```

## Day-to-day operations

```bash
# Status + last 50 lines
systemctl status seo-audit.service
journalctl -u seo-audit.service -n 50 --no-pager

# Live tail
journalctl -u seo-audit.service -f

# Restart (after .env change, etc.)
sudo systemctl restart seo-audit.service
```

## Update workflow

```bash
cd /home/tobias/apps/seo-audit
git pull --ff-only origin main
npm ci                                  # only when package-lock.json changed
npm run build                           # produces fresh .next/ artefacts
sudo systemctl restart seo-audit.service
```

The restart causes a brief 502 (~2-3 s) at the Caddy layer until Next.js
finishes booting. There is no zero-downtime recipe in place — single
instance, in-memory rate-limit. If multi-instance becomes a need, see
DEPLOYMENT.md §8.2 (rate-limit migration to Redis is required first).

## Logs

systemd captures both stdout and stderr in the journal. Filter by tag
when something has been logged via `console.log`:

```bash
journalctl -u seo-audit.service | grep '\[widget-lead\]'   # widget-lead events
journalctl -u seo-audit.service | grep -i 'error'           # errors
```

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `systemctl status` shows `failed` immediately on start | `.env.production` missing or unreadable by `tobias` | `chmod 600 .env.production && chown tobias:tobias .env.production` |
| App boots but Caddy returns 502 | Wrong port — App runs on 3001, Caddy proxies to 3001 | Check `journalctl -u seo-audit.service` for "Local: http://localhost:3001" |
| Restart hangs > 30 s | Long-running SSE stream still open | Wait — `RestartSec=10` plus systemd's default 90s `TimeoutStopSec` will SIGKILL eventually |
| `next build` runs out of memory | swap=0 + concurrent docker stack | Stop other heavy stacks (`docker compose down`) for the duration of the build, or build off-server and rsync the `.next/` directory |
