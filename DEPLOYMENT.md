# SEO Audit Pro — Deployment Guide

Production deployment of the SEO Audit tool at
**https://beckmanndigital.com/seo-audit** on a fresh Ubuntu 22.04 / 24.04
server. The target layout is:

- Next.js app running on `127.0.0.1:3000` under PM2
- Nginx terminating TLS on `beckmanndigital.com` and reverse-proxying
  `/seo-audit/*` into the Node process
- Let's Encrypt handling the certificate

---

## 1. Server Voraussetzungen

### Software

| Component | Version            | Install                                                   |
|-----------|--------------------|-----------------------------------------------------------|
| Node.js   | **20.x LTS** (≥20.9) | `curl -fsSL https://deb.nodesource.com/setup_20.x \| sudo -E bash - && sudo apt-get install -y nodejs` |
| npm       | ≥10.x (comes with Node 20) | — |
| git       | any current        | `sudo apt-get install -y git`                             |
| nginx     | 1.22+              | `sudo apt-get install -y nginx`                           |
| pm2       | latest             | `sudo npm install -g pm2`                                 |
| certbot   | latest             | `sudo apt-get install -y certbot python3-certbot-nginx`   |
| build-essential | —             | `sudo apt-get install -y build-essential` (node-html-parser needs no native build, but safe to have) |

### Hardware — minimum sizing

Based on the actual workload (sequential HTTP crawl of up to ~5000 pages,
one concurrent audit fits within 300s, parallel audits double RAM):

| Resource | Recommended baseline | Why                                                                             |
|----------|---------------------:|---------------------------------------------------------------------------------|
| RAM      | **2 GB** (4 GB safer)| Node process idles ~200 MB, spikes to 700-900 MB during a 500-page crawl        |
| CPU      | **2 vCPU**           | Single-core would bottleneck the HTML parsing during large crawls               |
| Disk     | 10 GB                | Repo + `node_modules` + `.next` build + logs ≈ 800 MB; the rest is headroom     |
| Network  | 100 Mbit+            | Audit issues dozens of outbound HTTP fetches per run                            |

A shared-CPU 2GB VPS (Hetzner CX11 / CX22 / DigitalOcean droplet) is
plenty for a single team. Scale up when concurrent audits > 2.

### Ports

| Port | Direction | Purpose                              |
|-----:|-----------|--------------------------------------|
|   22 | inbound   | SSH                                  |
|   80 | inbound   | HTTP (Certbot HTTP-01, then redirect)|
|  443 | inbound   | HTTPS (nginx)                        |
| 3000 | loopback only | Next.js — MUST NOT be exposed externally |
|  53  | outbound  | DNS (SPF/DKIM/DMARC checks)          |
| 443  | outbound  | All external APIs + site crawls      |

---

## 2. Umgebungsvariablen

The app currently consumes **one** process env var. A minimal
`.env.production` file is sufficient.

| Variable          | Required | Used in                                                       | Description                                                                                                  | Example                          |
|-------------------|:--------:|----------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------|----------------------------------|
| `GOOGLE_API_KEY`  | optional | `src/app/api/audit/route.ts`, `src/app/api/widget/audit/route.ts`, `src/app/api/config/route.ts` | Enables PageSpeed Insights + Safe Browsing. Without it both checks are silently skipped; the audit still runs on everything else. | `AIzaSyDaB7_RealKeyHere`         |
| `NODE_ENV`        | required | Next.js internals                                              | Must be `production` when running via `next start`                                                           | `production`                     |
| `PORT`            | optional | Next.js                                                        | Defaults to 3000 if unset. Override only if port 3000 is taken.                                              | `3000`                           |

**Nicht im Code verwendet** (im Spec erwähnt, aber aktuell keine Referenz):
`PERPLEXITY_API_KEY`, `CLAUDE_API_KEY`, `OPENAI_API_KEY`. Keine LLM-
Integration ist auf Server-Ebene aktiv — nur der manuelle Claude-Prompt-
Copy-Paste-Flow in der UI.

### `.env.production` Beispiel

Lege die Datei auf dem Server unter `/var/www/seo-audit/.env.production` an:

```env
GOOGLE_API_KEY=AIzaSy…EchterKeyHier
NODE_ENV=production
PORT=3000
```

Rechte: `chmod 600 .env.production` und `chown deploy:deploy`
(entsprechend dem Deploy-User).

---

## 3. Build & Start

### 3.1 Deploy-User + Verzeichnis

```bash
# Als root:
sudo adduser --system --group --shell /bin/bash --home /home/deploy deploy
sudo mkdir -p /var/www
sudo chown deploy:deploy /var/www

# In die deploy-User-Shell wechseln:
sudo -iu deploy
```

### 3.2 Repository klonen

```bash
cd /var/www
git clone git@github.com:beckmann-consulting/seo-audit.git
cd seo-audit
```

Falls SSH-Key-Setup nicht vorhanden: `git clone https://github.com/beckmann-consulting/seo-audit.git`
und später Deploy-Token verwenden.

### 3.3 Dependencies + Build

```bash
npm ci           # reproduzierbarer Install aus package-lock.json
npm run build    # next build
```

### 3.4 `next.config.js` Anpassungen für Production

Die lokale Config enthält einen harten Pfad:
```js
outputFileTracingRoot: '/home/tobias/projects/seo-audit',
```

**Für Production** muss das angepasst werden. Am einfachsten den Pfad
entfernen (Next.js leitet ihn dann aus `cwd` ab):

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {},
  serverExternalPackages: [],
  // outputFileTracingRoot weglassen — Next.js nutzt cwd des Prozesses
  basePath: '/seo-audit',
  async rewrites() {
    return [];
  },
};
module.exports = nextConfig;
```

Der neue `basePath: '/seo-audit'` sorgt dafür, dass alle Routes automatisch
unter `/seo-audit/*` ausgeliefert werden (`/seo-audit/api/audit`,
`/seo-audit/widget`, `/seo-audit/_next/static/…`). Nach Änderung nochmal
`npm run build`.

### 3.5 PM2 Ecosystem-Konfig

Lege auf dem Server `/var/www/seo-audit/ecosystem.config.js` an:

```js
module.exports = {
  apps: [{
    name: 'seo-audit',
    cwd: '/var/www/seo-audit',
    script: 'node_modules/next/dist/bin/next',
    args: 'start -p 3000',
    instances: 1,                    // siehe §8: Rate-Limit ist in-memory
    exec_mode: 'fork',
    autorestart: true,
    max_memory_restart: '1G',
    kill_timeout: 10000,             // SSE-Streams Zeit zum Aufräumen geben
    env: {
      NODE_ENV: 'production',
      PORT: 3000,
    },
    env_file: '.env.production',     // liest GOOGLE_API_KEY
    error_file: '/var/log/seo-audit/error.log',
    out_file: '/var/log/seo-audit/out.log',
    time: true,
  }],
};
```

Log-Verzeichnis anlegen:
```bash
sudo mkdir -p /var/log/seo-audit
sudo chown deploy:deploy /var/log/seo-audit
```

### 3.6 Start

```bash
cd /var/www/seo-audit
pm2 start ecosystem.config.js
pm2 save
pm2 startup systemd -u deploy --hp /home/deploy
# Den pm2-generierten sudo-Befehl ausführen, dann:
sudo systemctl enable pm2-deploy
```

Prüfen:
```bash
pm2 status
curl -fsS http://127.0.0.1:3000/seo-audit/api/config
# → { hasGoogleKey: true }
```

---

## 4. Nginx Konfiguration

Die App wird als **Unterpfad** `/seo-audit/` in die bestehende
`beckmanndigital.com`-Site integriert. Das hier ist das relevante Fragment
— nicht ein neuer `server {}`-Block, sondern Zusatz im bestehenden.

### 4.1 `/etc/nginx/sites-available/beckmanndigital.com`

```nginx
# --- Rate zone für Widget-API (Backup zum In-Memory-Limit im Code) ---
limit_req_zone $binary_remote_addr zone=seo_widget:10m rate=10r/m;

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name beckmanndigital.com www.beckmanndigital.com;

    ssl_certificate     /etc/letsencrypt/live/beckmanndigital.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/beckmanndigital.com/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    # --- Bestehende beckmanndigital.com Konfiguration bleibt hier ---
    # root /var/www/html; ...

    # =====================================================================
    # SEO Audit Tool
    # =====================================================================

    # ----- SSE-Endpoint: Buffering AUS, langer Timeout -----
    # Ohne diese Settings schluckt nginx die einzelnen `data: …\n\n`-Events
    # und released sie erst am Stream-Ende → die Progress-Bar im Browser
    # bleibt bei 2% hängen bis das ganze Audit fertig ist.
    location = /seo-audit/api/audit {
        proxy_pass              http://127.0.0.1:3000;
        proxy_http_version      1.1;
        proxy_set_header        Host $host;
        proxy_set_header        X-Real-IP $remote_addr;
        proxy_set_header        X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header        X-Forwarded-Proto $scheme;

        proxy_buffering         off;
        proxy_cache             off;
        proxy_request_buffering off;
        chunked_transfer_encoding on;
        proxy_read_timeout      300s;
        proxy_send_timeout      300s;
        add_header              X-Accel-Buffering no always;
    }

    # ----- Widget-API: CORS (Backup zum Route-Handler) + Rate-Limit -----
    location /seo-audit/api/widget/ {
        limit_req               zone=seo_widget burst=5 nodelay;
        proxy_pass              http://127.0.0.1:3000;
        proxy_http_version      1.1;
        proxy_set_header        Host $host;
        proxy_set_header        X-Real-IP $remote_addr;
        proxy_set_header        X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header        X-Forwarded-Proto $scheme;
        proxy_read_timeout      120s;

        # Widget-API antwortet selbst mit CORS-Headern; diese hier sind Backup
        add_header Access-Control-Allow-Origin  "https://beckmanndigital.com" always;
        add_header Access-Control-Allow-Methods "POST, OPTIONS" always;
        add_header Access-Control-Allow-Headers "Content-Type" always;
    }

    # ----- Statische Next-Assets: 1 Jahr immutable -----
    location ~* ^/seo-audit/_next/static/ {
        proxy_pass              http://127.0.0.1:3000;
        proxy_set_header        Host $host;
        expires                 1y;
        add_header              Cache-Control "public, max-age=31536000, immutable" always;
    }

    # ----- widget.js: 1 Stunde Cache (nicht immutable, darf aktualisiert werden) -----
    location = /seo-audit/widget.js {
        proxy_pass              http://127.0.0.1:3000;
        proxy_set_header        Host $host;
        expires                 1h;
        add_header              Cache-Control "public, max-age=3600" always;
    }

    # ----- Fallback: alles andere unter /seo-audit/ -----
    location /seo-audit/ {
        proxy_pass              http://127.0.0.1:3000;
        proxy_http_version      1.1;
        proxy_set_header        Host $host;
        proxy_set_header        X-Real-IP $remote_addr;
        proxy_set_header        X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header        X-Forwarded-Proto $scheme;
        proxy_read_timeout      60s;
    }

    # Gzip — nginx hat bessere Ratios auf Text als Next's built-in
    gzip            on;
    gzip_vary       on;
    gzip_min_length 1024;
    gzip_proxied    any;
    gzip_types      text/plain text/css text/xml text/javascript
                    application/javascript application/json application/xml
                    application/rss+xml image/svg+xml;

    # Optional: Brotli falls nginx-Modul installiert ist
    # brotli on;
    # brotli_types application/javascript application/json text/css text/html text/xml;
}

server {
    listen 80;
    listen [::]:80;
    server_name beckmanndigital.com www.beckmanndigital.com;
    return 301 https://$host$request_uri;
}
```

### 4.2 Certbot

```bash
# Einmalig — ersetzt / erweitert den 443-Block automatisch
sudo certbot --nginx -d beckmanndigital.com -d www.beckmanndigital.com

# Auto-Renewal ist via systemd-Timer bereits aktiv; prüfen:
sudo systemctl status certbot.timer
sudo certbot renew --dry-run
```

### 4.3 Aktivieren + Reload

```bash
sudo ln -s /etc/nginx/sites-available/beckmanndigital.com \
           /etc/nginx/sites-enabled/beckmanndigital.com
sudo nginx -t
sudo systemctl reload nginx
```

---

## 5. beckmanndigital.com Integration

### 5.1 DNS

Keine neuen DNS-Einträge nötig. `beckmanndigital.com` muss bereits per
A/AAAA-Record auf diesen Server zeigen — der SEO-Audit läuft unter
demselben Hostname als Unterpfad `/seo-audit`.

Schnell-Check:
```bash
dig +short beckmanndigital.com
# sollte die Server-IP zurückgeben
```

### 5.2 Widget-Embed

Auf jeder beckmanndigital.com-Seite wo das Widget erscheinen soll, zwei
Snippets einfügen (Details: siehe `WIDGET_EMBED.md`):

```html
<!-- Im Content an gewünschter Stelle -->
<div id="seo-audit-widget" data-lang="de"></div>

<!-- Einmalig, am Seitenende oder im <head> -->
<script src="https://beckmanndigital.com/seo-audit/widget.js" async></script>
```

Funktioniert **automatisch**, weil `widget.js` seine iframe-URL auf
`https://beckmanndigital.com/seo-audit/widget` hardcoded hat — was genau
dem basePath-Deployment entspricht.

### 5.3 Next.js `basePath`

Siehe §3.4 — `basePath: '/seo-audit'` in `next.config.js` ist **zwingend**.
Ohne die Einstellung generiert Next interne Links als `/api/audit` statt
`/seo-audit/api/audit`, und nginx proxyt sie ins Leere.

---

## 6. API-Keys & externe Services

### 6.1 Google PageSpeed Insights + Safe Browsing — _optional, empfohlen_

- **Beantragen**: https://console.cloud.google.com/ → neues Projekt →
  APIs & Services → Library → *PageSpeed Insights API* und
  *Safe Browsing API* aktivieren → Credentials → API Key erstellen
- **Restriktionen empfohlen**: HTTP-Referrer-Lock auf
  `https://beckmanndigital.com/*`
- **Quota**: ~25 000 PSI-Requests/Tag pro Projekt (frei). Ohne Key:
  400/Tag als anonyme Anfrage → daher dringend empfohlen
- **Eintragen**: in `.env.production` als `GOOGLE_API_KEY=…`, dann
  `pm2 restart seo-audit`

### 6.2 Qualys SSL Labs API — _kein Key nötig_

Verwendet in `checkSSL()`. Free tier, kein API-Key. Rate-Limit (laut
ihrer Doku): ~1 Assessment pro Host alle 10 Minuten. Bei Überschreitung
liefert die Funktion einen Fallback-Wert zurück statt zu scheitern.

### 6.3 Perplexity / Claude / OpenAI — _nicht verwendet_

Das aktuelle Deployment nutzt keine LLM-API server-seitig. Der
"Claude-Prompt"-Tab generiert nur einen Text, den der User manuell
copy&paste in ein eigenes LLM-Frontend einfügt.

Falls später ein LLM-Key dazukommt: eintragen als
`ANTHROPIC_API_KEY=sk-ant-…` in `.env.production` und neu starten.

---

## 7. Monitoring & Wartung

### 7.1 PM2

```bash
pm2 status                       # Laufender Zustand
pm2 logs seo-audit --lines 200   # Live-Logs tail
pm2 logs seo-audit --err         # nur Fehler
pm2 monit                        # interaktiver Top-Style Monitor
pm2 restart seo-audit            # Neustart ohne Downtime (kurzer 503)
pm2 reload seo-audit             # Graceful-Reload bei cluster-Mode (hier fork)
pm2 show seo-audit               # Details + File-Pfade
```

### 7.2 Log-Dateien

| Datei                                | Quelle                        |
|--------------------------------------|-------------------------------|
| `/var/log/seo-audit/out.log`         | `console.log` des Audits      |
| `/var/log/seo-audit/error.log`       | `console.error` + Uncaught    |
| `/var/log/nginx/access.log`          | HTTP-Zugriffe (systemweit)    |
| `/var/log/nginx/error.log`           | nginx-Fehler / 502s           |

Widget-Leads erscheinen in `out.log` mit Präfix `[widget-lead]`.

### 7.3 Rolling Deploy

Kein separates Zero-Downtime-Setup nötig (single-instance + pm2). Der
Standard-Flow:

```bash
sudo -iu deploy
cd /var/www/seo-audit
git pull --ff-only origin main
npm ci                           # nur wenn package-lock sich änderte
npm run build                    # neue .next-Artefakte
pm2 restart seo-audit --update-env   # ~2-3 Sekunden 502 möglich
```

Für echte Zero-Downtime: zwei Instanzen auf 3000/3001 + nginx upstream
mit Round-Robin. **Achtung**: das bricht das In-Memory-Rate-Limit der
Widget-API (siehe §8) — User könnten durch Pech von Instanz zu Instanz
springen und den Limit umgehen.

### 7.4 Backup

Was gesichert werden muss:

| Pfad                                    | Häufigkeit         |
|-----------------------------------------|--------------------|
| `/var/www/seo-audit/.env.production`    | Bei jeder Änderung |
| `/var/www/seo-audit/ecosystem.config.js`| Bei jeder Änderung |
| `/etc/nginx/sites-available/beckmanndigital.com` | Bei jeder Änderung |
| `/etc/letsencrypt/`                     | Wöchentlich        |

Der Source-Code selbst lebt in Git — kein Backup nötig. Repository auf
`scm.linefinity.com:t.beckmann/seo-audit.git` + Spiegel auf
`github.com:beckmann-consulting/seo-audit.git`.

Kein persistenter State in der App (keine DB, keine Uploads) — das
Deployment ist im Wesentlichen replizierbar aus Git + .env.production.

---

## 8. Bekannte Produktions-Gotchas

### 8.1 SSE + nginx Buffering

Der Hauptaudit-Endpunkt (`POST /seo-audit/api/audit`) streamt Progress-
Events via Server-Sent Events. nginx puffert diese standardmäßig und
released sie am Stream-Ende → die Progress-Bar zeigt **bis zum Audit-Ende
2%** an und springt dann auf 100%.

**Fix**: Die `location = /seo-audit/api/audit`-Block aus §4 mit
`proxy_buffering off`, `proxy_cache off`, `X-Accel-Buffering: no`
verhindert das. **Nicht weglassen.**

### 8.2 In-Memory Rate-Limit (Widget)

`src/app/api/widget/audit/route.ts` nutzt `Map<ip, timestamps[]>` für das
3-Audits-pro-Stunde-Limit. **Konsequenzen**:

- **Server-Restart = Limit resettet.** Wenn pm2 neu startet oder ein
  Deploy läuft, kann dieselbe IP sofort wieder 3 Audits triggern.
- **Multi-Instance = Limit pro Instanz.** Bei Cluster-Mode oder
  horizontalem Scaling muss auf Redis/Valkey umgestellt werden.
- Die nginx-Limit-Zone aus §4.1 (`limit_req_zone` 10 req/min burst 5)
  ist ein Fallback und hält Burst-Attacken ab, auch wenn der App-Limit
  ausgehebelt wird.

### 8.3 localStorage im Widget und in der Haupt-UI

Der Diff-Audit cached Ergebnisse im Browser-localStorage. **Nichts davon
lebt auf dem Server.** Für User heißt das:

- Private / Inkognito-Modus → keine Diffs möglich (localStorage wird
  am Tab-Close geleert).
- Browser-Wechsel → Cache weg.
- Quota ~5 MB → bei ~100 KB pro Audit effektiv ~50 gecachte Domains.

### 8.4 PageSpeed API Quotas

Standard-Projekt ohne Rate-Request: **25 000 Requests/Tag pro Projekt**.
Der Tool führt PSI-Audits **zweimal** pro Hauptaudit (Averaging-Feature,
§8.5) → realistisch 12 500 komplette Audits/Tag. Widget-Audits zählen
auch rein (1 Run pro Widget-Audit).

Bei Überschreitung liefert Google 429 → die Funktion setzt `error` auf
`PageSpeedData` und der Performance-Score fehlt im Output. Der Rest des
Audits läuft weiter.

### 8.5 PageSpeed-Averaging kostet Zeit

Der Haupt-Audit ruft PSI **zweimal** auf (1s Pause zwischen Calls) für
score-stabile Ergebnisse. Widget läuft nur 1x. Bei Server-nahen
Sites ~6-10s Mehr-Laufzeit pro Hauptaudit. Deaktivierung möglich via
`config.quickMode: true` im POST-Body.

### 8.6 Crawl-Timeouts bei langsamen Sites

`crawlSite` nutzt `AbortSignal.timeout(12000)` pro Seitenanfrage. Bei
einer Site mit 500 Seiten und durchschnittlich 4s Response-Zeit dauert
der Crawl ~35 Minuten — **über der Next.js `maxDuration = 300s` Grenze**.

Der Audit wird dann hart abgebrochen. Empfehlung: `config.maxPages`
im Client-Payload auf ein vernünftiges Limit setzen (Default: `0` =
unlimited). Wir empfehlen 200 für Produktions-Audits.

### 8.7 `outputFileTracingRoot` in `next.config.js`

Die eingecheckte Config hat `outputFileTracingRoot: '/home/tobias/projects/seo-audit'`
— das ist ein **lokaler Dev-Pfad** und muss für Production entfernt oder
angepasst werden (siehe §3.4). Ohne Anpassung warnt `next build` mit
"detected workspace root mismatch" und macht möglicherweise File-Tracing
auf einen nicht-existenten Pfad.

### 8.8 Public directory + widget.js Caching

`public/widget.js` ist Teil des Git-Repos. Nach jeder Änderung an der
Datei: `Cache-Control: max-age=3600` aus §4 bedeutet dass Fremd-Websites
bis zu 1 Stunde lang die alte Version einbetten. Bei kritischen Bugs
den Cache-Header kurzzeitig auf `max-age=60` setzen oder Versionen via
Query-String pushen (`widget.js?v=2`).

---

## 9. Schnell-Test nach Deploy

Führe diese Checks nach jedem Deploy aus, idealerweise vor dem
Weiterreichen des neuen Stands.

### 9.1 API Health

```bash
# Lokal auf dem Server (geht am nginx vorbei)
curl -fsS http://127.0.0.1:3000/seo-audit/api/config | jq .
# → {"hasGoogleKey":true}

# Über nginx + HTTPS
curl -fsS https://beckmanndigital.com/seo-audit/api/config | jq .
# → gleiche Response
```

### 9.2 Widget erreichbar

```bash
curl -fsS -o /dev/null -w '%{http_code}\n' \
  https://beckmanndigital.com/seo-audit/widget
# → 200

curl -fsS -o /dev/null -w '%{http_code} %{content_type}\n' \
  https://beckmanndigital.com/seo-audit/widget.js
# → 200 application/javascript (oder text/javascript)
```

### 9.3 SSE-Stream funktioniert

Dieser Test ist kritisch — ohne SSE bleibt die Progress-Bar hängen:

```bash
curl -N -sS -X POST https://beckmanndigital.com/seo-audit/api/audit \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com","modules":["seo","tech"],"author":"test","maxPages":1,"quickMode":true}' \
  | head -30
```

Erwartete Ausgabe: **mehrere `data: {...}\n\n`-Zeilen über einige
Sekunden verteilt** (nicht erst alle am Ende auf einmal). Wenn alles
erst am Schluss kommt → nginx-Buffering ist aktiv, §8.1 Fix anwenden.

### 9.4 PDF-Export funktioniert

PDF wird client-seitig gerendert (jsPDF im Browser), daher im Browser
testen:

1. https://beckmanndigital.com/seo-audit aufrufen
2. Einen Audit von `https://example.com` laufen lassen
3. Bei "PDF Deutsch" klicken → Download startet, PDF enthält Cover-Seite
   mit orangem Titel + TWB-Logo

Wenn das Logo im PDF fehlt, ist die Widget-Static-Route zu `/TWB_Logo_Transparent.png`
nicht erreichbar — der basePath muss dann auch im pdf-generator-Code
berücksichtigt werden. Aktuell lädt er `/TWB_Logo_Transparent.png`
absolut vom Origin, was mit basePath `/seo-audit` zu 404 führen kann —
siehe PDF-Generator-`loadLogoDataUrl()` ggf. auf `/seo-audit/TWB_Logo_Transparent.png`
patchen.

### 9.5 Widget-API + Rate-Limit

```bash
# Gültiger Audit-Request
curl -fsS -X POST https://beckmanndigital.com/seo-audit/api/widget/audit \
  -H 'Content-Type: application/json' \
  -H 'Origin: https://beckmanndigital.com' \
  -d '{"url":"https://example.com","lang":"de"}' \
  | jq .score

# Nach 4 Requests aus derselben IP sollte 429 kommen
# (In-Memory-Limit + nginx-burst deckelt zusätzlich)
```

### 9.6 Logs prüfen

```bash
pm2 logs seo-audit --lines 50 --nostream
# Nach erfolgreichem Audit: keine `[widget-audit] failed:` Einträge
```

---

## Ready-Checklist (TL;DR)

- [ ] Node 20 / nginx / pm2 / certbot installiert
- [ ] Deploy-User `deploy` angelegt, Repo unter `/var/www/seo-audit` geklont
- [ ] `npm ci && npm run build` durchgelaufen
- [ ] `next.config.js`: `outputFileTracingRoot` entfernt, `basePath: '/seo-audit'` gesetzt, erneut gebaut
- [ ] `.env.production` mit `GOOGLE_API_KEY` gesetzt, `chmod 600`
- [ ] `ecosystem.config.js` angelegt, `pm2 start` erfolgreich, `pm2 save` + `pm2 startup` ausgeführt
- [ ] `/etc/nginx/sites-available/beckmanndigital.com` erweitert um `/seo-audit/*` location-Blöcke inkl. SSE-Settings
- [ ] Certbot-Zertifikat aktiv, Auto-Renewal-Timer läuft
- [ ] `curl /seo-audit/api/config` antwortet `{hasGoogleKey:true}`
- [ ] SSE-Stream-Test (§9.3) zeigt **progressiv** ausgelieferte Events
- [ ] Widget-Embed auf einer beckmanndigital.com-Testseite erscheint und lädt
- [ ] PDF-Export funktioniert im Browser-Flow
