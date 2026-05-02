# SEO Audit Pro — Deployment Guide

Production deployment of the SEO Audit tool at
**https://seo-audit.beckmanndigital.com** on a Debian 13 server (twb-server,
Hetzner CPX32). The target layout is:

- Next.js app running on `127.0.0.1:3001` under systemd
  (`seo-audit.service`, source: `infra/seo-audit/`)
- Caddy v2 terminating TLS on the `seo-audit.beckmanndigital.com`
  subdomain and reverse-proxying to the Node process. Caddy handles ACME
  / Let's Encrypt automatically.
- Optional: Browserless container for JS-rendering (separate systemd
  unit, source: `infra/browserless/`)

---

## 1. Server Voraussetzungen

### Software

| Component | Version            | Install                                                   |
|-----------|--------------------|-----------------------------------------------------------|
| Node.js   | **24.x LTS** (see `.nvmrc`) | `curl -fsSL https://deb.nodesource.com/setup_24.x \| sudo -E bash - && sudo apt-get install -y nodejs` |
| npm       | ≥10.x (comes with Node 24) | — |
| git       | any current        | `sudo apt-get install -y git`                             |
| caddy     | 2.11+              | `sudo apt-get install -y caddy` (or follow https://caddyserver.com/docs/install for the latest .deb) |
| systemd   | (built-in)         | Process manager. Unit files live under `infra/seo-audit/` and `infra/browserless/`. |
| docker + docker-compose-plugin | latest | Optional — only needed for the JS-rendering Browserless container. `sudo apt-get install -y docker.io docker-compose-plugin` |
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
|   80 | inbound   | HTTP (ACME-01 challenge, then redirect to 443) |
|  443 | inbound   | HTTPS (Caddy)                        |
| 3001 | loopback only | Next.js — MUST NOT be exposed externally |
| 9223 | loopback only | Browserless container (only when JS-rendering is in use) |
|   53 | outbound  | DNS (SPF/DKIM/DMARC checks)          |
|  443 | outbound  | All external APIs + site crawls      |

---

## 2. Umgebungsvariablen

The app currently consumes **one** process env var. A minimal
`.env.production` file is sufficient.

| Variable              | Required | Used in                                                       | Description                                                                                                  | Example                          |
|-----------------------|:--------:|----------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------|----------------------------------|
| `GOOGLE_API_KEY`      | optional | `src/app/api/audit/route.ts`, `src/app/api/widget/audit/route.ts`, `src/app/api/config/route.ts` | Enables PageSpeed Insights + Safe Browsing. Without it both checks are silently skipped; the audit still runs on everything else. | `AIzaSyDaB7_RealKeyHere`         |
| `LEAD_WEBHOOK_URL`    | optional | `src/app/api/widget/audit/route.ts` (`forwardLead`)            | URL des PHP-Lead-Mailers auf beckmanndigital.com. Ohne diese Variable werden Widget-Leads nur geloggt, keine Mail verschickt. Siehe §5.4. | `https://beckmanndigital.com/seo-lead.php` |
| `LEAD_WEBHOOK_SECRET` | optional | `src/app/api/widget/audit/route.ts` (`forwardLead`)            | Shared Secret für den Lead-Mailer — muss identisch mit `$SHARED_SECRET` in `seo-lead.php` sein. Generieren mit `openssl rand -hex 32`. | `3921bea48e47cea5637550a006e14c75da7ed1570639ff48f20a2f330d5129bd` |
| `NODE_ENV`            | required | Next.js internals                                              | Must be `production` when running via `next start`                                                           | `production`                     |
| `PORT`                | required | Next.js                                                        | Production port — Caddy proxies to this. Set to `3001` (port 3000 is reserved for the umami container on twb-server). | `3001`                           |
| `BROWSERLESS_TOKEN`   | optional | `src/app/api/audit/route.ts` (only when audit config sets `rendering=js`) | Auth token for the local Browserless container. Only needed if you run the JS-rendering Docker container in `infra/browserless/`. Same value must be in `infra/browserless/.env`. | `c0f3e1…` (`openssl rand -hex 32`) |
| `BROWSERLESS_ENDPOINT` | optional | `src/app/api/audit/route.ts` | Override the WebSocket endpoint the Node service connects to. Defaults to `ws://localhost:9223` (the address the bundled docker-compose binds to). | `ws://localhost:9223`              |
| `GOOGLE_OAUTH_CLIENT_ID` | optional | `scripts/oauth-bootstrap.mjs` (and G1/G2 runtime once implemented) | OAuth Client ID from Google Cloud Console. Required only for Phase G (GSC, GA4). See §2a for setup. | `12345…apps.googleusercontent.com` |
| `GOOGLE_OAUTH_CLIENT_SECRET` | optional | `scripts/oauth-bootstrap.mjs` (and G1/G2 runtime once implemented) | OAuth Client Secret. Pair with `GOOGLE_OAUTH_CLIENT_ID`. | `GOCSPX-…` |
| `GSC_REFRESH_TOKEN`   | optional | G1 (Search Console). Generated once via `npm run oauth:gsc` — see §2a. | Refresh token for the Google account that owns the GSC properties to be audited. Without it, GSC findings are skipped. | `1//0e…` (long string)             |
| `GA4_REFRESH_TOKEN`   | optional | G2 (Analytics 4). Generated once via `npm run oauth:ga4` — see §2a. | Refresh token for the Google account with GA4 access. Without it, GA4 cross-reference is skipped. | `1//0e…`                            |

**Nicht im Code verwendet** (im Spec erwähnt, aber aktuell keine Referenz):
`PERPLEXITY_API_KEY`, `CLAUDE_API_KEY`, `OPENAI_API_KEY`. Keine LLM-
Integration ist auf Server-Ebene aktiv — nur der manuelle Claude-Prompt-
Copy-Paste-Flow in der UI.

### `.env.production` Beispiel

Lege die Datei auf dem Server unter `/home/tobias/apps/seo-audit/.env.production` an:

```env
GOOGLE_API_KEY=AIzaSy…EchterKeyHier
LEAD_WEBHOOK_URL=https://beckmanndigital.com/seo-lead.php
LEAD_WEBHOOK_SECRET=3921bea48e47cea5637550a006e14c75da7ed1570639ff48f20a2f330d5129bd
NODE_ENV=production
PORT=3001
```

Rechte: `chmod 600 .env.production` und `chown tobias:tobias`.

### 2a. Google Search Console + Analytics 4 OAuth (für G1 / G2)

Phase G nutzt Option A aus dem G-Plan: **Single-Account, Refresh-Token in
`.env.production`**. Multi-User-OAuth-Flows kommen erst mit dem
Workspace-Modell (Phase H2). Die folgenden Schritte sind einmalig pro
Service (GSC, GA4) und Konto.

#### Schritt 1 — Google Cloud Console

Dasselbe Projekt nutzen, das schon `GOOGLE_API_KEY` für PSI / Safe
Browsing hat (https://console.cloud.google.com).

1. **APIs aktivieren** unter "APIs & Services" → "Enabled APIs":
   - `Google Search Console API` (für G1)
   - `Google Analytics Data API` (für G2)
2. **OAuth Consent Screen** konfigurieren (falls noch nicht):
   - Application type: **External**
   - User type: External, Testing-Phase reicht (Test-Users-Liste muss
     deine eigene Google-E-Mail enthalten — sonst beim Bootstrap später
     "App not verified")
   - Scopes: leer lassen — werden vom Bootstrap-Script angefordert
3. **OAuth 2.0 Client ID** unter "Credentials":
   - Application type: **Web application**
   - Name: `seo-audit-pro`
   - Authorized JavaScript origins: leer
   - Authorized redirect URIs:
     - `http://127.0.0.1:8765/oauth/callback` ← **exakt so, inkl. Port und Pfad**
   - "Create" — Client ID + Secret im Folgedialog notieren
4. **Beide Werte in `.env.production`** (oder `.env.local` für Dev):
   ```env
   GOOGLE_OAUTH_CLIENT_ID=xxxxxxxxxxxxxxxx.apps.googleusercontent.com
   GOOGLE_OAUTH_CLIENT_SECRET=GOCSPX-...
   ```

#### Schritt 2 — Refresh-Token holen

Lokal vom Repo-Verzeichnis (nicht auf twb-server, falls dein lokales Konto
auf die Properties Zugriff hat — sonst SSH und auf twb-server laufen
lassen, mit X-Forwarding-Browser oder Copy-Paste-URL):

```bash
npm run oauth:gsc    # für Google Search Console
npm run oauth:ga4    # für Google Analytics 4
```

Was passiert:

1. Skript druckt eine Google-Login-URL.
2. URL im Browser öffnen → Login mit dem Konto, das auf die GSC-Property
   bzw. GA4-Property Zugriff hat.
3. Read-only-Scopes bestätigen (`webmasters.readonly` bzw.
   `analytics.readonly`).
4. Google leitet zurück auf `localhost:8765`. Das Skript fängt den Code
   ab, tauscht ihn gegen Tokens, druckt eine Zeile:
   ```
   GSC_REFRESH_TOKEN=1//0e...
   ```
5. Diese Zeile in `.env.production` einfügen.
6. Service neu starten: `sudo systemctl restart seo-audit`.

#### Scopes (zur Referenz)

| Service | Scope |
|---|---|
| GSC | `https://www.googleapis.com/auth/webmasters.readonly` |
| GA4 | `https://www.googleapis.com/auth/analytics.readonly` |

Beide nur read-only, kein Schreibzugriff auf irgendwelche Google-Daten.

#### Wann muss ich das wiederholen?

- Du hast den Token aus `.env.production` gelöscht → bootstrap erneut
- Zugriff in https://myaccount.google.com/permissions revoked → bootstrap erneut
- Google-Projekt 6 Monate ungenutzt → Token läuft automatisch ab; bootstrap erneut
- Scopes erweitert → bootstrap erneut

Sonst nicht. Refresh-Tokens haben kein Ablaufdatum.

---

### 2b. Optional: Browserless Container für JS-Rendering

Wenn der Audit JS-rendering anbieten soll (SPAs, Hydration-Diff,
console-error-Detection), muss der Browserless-Container neben dem
Node-Service laufen. Der Container ist intentional NICHT Teil der
Default-Pipeline — Static-Audits brauchen ihn nicht.

```bash
# 1. Token generieren und in BEIDEN env-Dateien hinterlegen
TOKEN=$(openssl rand -hex 32)
echo "BROWSERLESS_TOKEN=$TOKEN" >> infra/browserless/.env
# In .env.production der Audit-App auch eintragen:
echo "BROWSERLESS_TOKEN=$TOKEN" >> /home/tobias/apps/seo-audit/.env.production

# 2. Container starten
cd infra/browserless
docker compose up -d

# 3. Health-Check
curl -fsS "http://localhost:9223/health?token=$TOKEN" && echo " — ok"
```

Sizing-Begründung (auf twb-server CPX32, 8 GiB RAM, swap=0):
- `MAX_CONCURRENT_SESSIONS=2` — Browserless idle ~300 MB, jede aktive
  Session ~500-700 MB peak. 2 Sessions parallel = ~1.5 GiB peak.
- `MAX_QUEUE_LENGTH=4` — bursty 1-3 parallele Audits aus dem Embed-
  Widget werden geserved oder kurz gequeued, nicht abgewiesen.
- Container hat hartes `memory: 2g` Limit (Swap=0 → kein OOM-Safety-Net).
- `CONNECTION_TIMEOUT=30000` — stuck Chromium wird in <1min recycled.

**Kein externer Port-Zugang:** Der Container bindet nur an `127.0.0.1:9223`;
Caddy proxy't ihn nie nach außen. Token ist Defence-in-Depth, nicht die
primäre Sicherheitsgrenze.

Im Audit-UI: Modul-Sektion → "Rendering-Modus" → "JavaScript". Static
bleibt der Default; JS-Mode ist eine bewusste Entscheidung pro Audit.

#### Optional: Auto-Start via systemd

Damit der Container nach Server-Reboots automatisch hochfährt, gibt es
ein systemd-Unit-File im Repo: `infra/browserless/browserless.service`.
Es startet/stoppt den Compose-Stack über `docker compose up -d` /
`down`. Container-Restart-on-failure macht das Compose-File selbst
(`restart: unless-stopped`).

Setup ist in `infra/browserless/README.md` dokumentiert. Kurzfassung:

```bash
# Compose-File + .env in das Browserless-App-Verzeichnis kopieren
sudo mkdir -p /home/tobias/apps/seo-audit-browserless
sudo chown tobias:tobias /home/tobias/apps/seo-audit-browserless
cp infra/browserless/docker-compose.yml /home/tobias/apps/seo-audit-browserless/
cp infra/browserless/.env.example       /home/tobias/apps/seo-audit-browserless/.env
# … BROWSERLESS_TOKEN in der .env eintragen

# systemd-Unit installieren
sudo cp infra/browserless/browserless.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now browserless.service
```

Der Pfad `/home/tobias/apps/seo-audit-browserless/` hält Browserless als
eigenständigen Service neben der Audit-App (`/home/tobias/apps/seo-audit/`).
So sind die beiden Service-Lifecycles voneinander entkoppelt.

---

## 3. Build & Start

Volldetaillierte Anleitung lebt in [`infra/seo-audit/README.md`](infra/seo-audit/README.md).
Kurzfassung hier:

### 3.1 Verzeichnis + Repo

```bash
sudo mkdir -p /home/tobias/apps
sudo chown tobias:tobias /home/tobias/apps
cd /home/tobias/apps
git clone git@github.com:beckmann-consulting/seo-audit.git
cd seo-audit
```

Falls SSH-Key-Setup nicht vorhanden: `git clone https://github.com/beckmann-consulting/seo-audit.git`
und später Deploy-Token verwenden.

### 3.2 Dependencies + Build

```bash
npm ci           # reproduzierbarer Install aus package-lock.json
npm run build    # next build
```

`next.config.js` ist bereits portabel (`outputFileTracingRoot: path.join(__dirname)`)
und nutzt Root-Path — kein `basePath`-Hack nötig. Die App läuft unter der
Subdomain `seo-audit.beckmanndigital.com` (siehe §4).

### 3.3 `.env.production`

Siehe §2 für die Variablenliste und das Beispiel. `chmod 600` + `chown tobias:tobias`
nicht vergessen.

### 3.4 systemd-Unit installieren + starten

```bash
sudo cp infra/seo-audit/seo-audit.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now seo-audit.service
```

Prüfen:
```bash
systemctl status seo-audit.service
curl -fsS http://127.0.0.1:3001/api/config
# → { hasGoogleKey: true }
```

Live-Logs:
```bash
journalctl -u seo-audit.service -f
```

---

## 4. Caddy Konfiguration

Die App lebt unter der **eigenen Subdomain** `seo-audit.beckmanndigital.com`,
nicht mehr als Subpfad. Caddy ist der Edge-Webserver auf twb-server,
managed TLS via ACME automatisch (kein Certbot, kein eigener Renewal-Timer).

### 4.1 DNS-Voraussetzung

Im DNS für `beckmanndigital.com` einen A-Record (und optional AAAA) für
die Subdomain anlegen, der auf die twb-server-IP zeigt:

```
seo-audit.beckmanndigital.com.   IN   A   <twb-server-ipv4>
```

Caddy lädt das Let's-Encrypt-Zertifikat beim ersten Request automatisch
nach.

### 4.2 `/etc/caddy/Caddyfile`

Die seo-audit-Site ist ein Block im globalen Caddyfile. Komplette
Subdomain steht hier; öffentliche Pfade (Widget + Statics + Logo) werden
explizit gematched, alles andere ist hinter Basic Auth.

```caddy
seo-audit.beckmanndigital.com {
    @public {
        path /widget /widget/* /widget.js /api/widget/* /_next/static/* /_next/image* /TWB_Logo_Transparent.png /favicon.ico
    }

    handle @public {
        reverse_proxy localhost:3001
    }

    handle {
        basic_auth {
            Admin $2a$14$EXAMPLE_HASH_REPLACE_WITH_YOURS
        }
        reverse_proxy localhost:3001
    }
}
```

Der `@public`-Matcher trifft genau die Pfade, die anonyme User über das
Widget-Embed auf beckmanndigital.com erreichen. Alles andere — die
interne Audit-UI, der prompt-Tab, der Diff-Audit, die admin-tauglichen
APIs — landet im default-`handle`-Block und ist durch Basic Auth
geschützt.

**Bcrypt-Hash erzeugen** für Basic Auth:

```bash
caddy hash-password
# Eingabe-Prompt: das gewünschte Klartext-Passwort tippen.
# Output: $2a$14$<hash> — Zeile in den `basic_auth`-Block einsetzen.
```

Der reale Hash auf twb-server ist NICHT der Beispiel-Hash oben; bitte
einen eigenen erzeugen. Nach Änderung am Caddyfile:

```bash
sudo caddy fmt --overwrite /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

### 4.3 SSE-Streaming durch Caddy

Caddy puffert SSE standardmäßig **nicht** (anders als nginx). Die
`POST /api/audit`-Progress-Events kommen out-of-the-box live durch — kein
`proxy_buffering off`-Hack nötig wie früher bei nginx. Falls ein
Caddy-Update das Verhalten ändert, würde sich §8.1 entsprechend
melden.

### 4.4 Widget-API + Rate-Limiting

Das Widget-Rate-Limit läuft im Anwendungs-Code (`src/app/api/widget/audit/route.ts`,
`Map<ip, timestamps[]>`). Ein zusätzlicher Caddy-Layer existiert aktuell
nicht — bei Bedarf könnte man `caddy-rate-limit` als Plugin einbinden,
aber die In-Memory-Strategie reicht für ein Single-Instance-Deployment.
Siehe §8.2 zu den Konsequenzen.

---

## 5. Integration in beckmanndigital.com

### 5.1 DNS

Zwei DNS-Einträge:

- `beckmanndigital.com` (A/AAAA → twb-server) — die Hauptseite, deployed
  aus einem anderen Repo (`twb-consultancy`).
- `seo-audit.beckmanndigital.com` (A/AAAA → twb-server) — diese App.
  Caddy holt das Zertifikat automatisch nach dem ersten Request.

Schnell-Check:
```bash
dig +short seo-audit.beckmanndigital.com
# sollte die Server-IP zurückgeben
```

### 5.2 Widget-Embed

Auf jeder beckmanndigital.com-Seite wo das Widget erscheinen soll, zwei
Snippets einfügen (Details: siehe `WIDGET_EMBED.md`):

```html
<!-- Im Content an gewünschter Stelle -->
<div id="seo-audit-widget" data-lang="de"></div>

<!-- Einmalig, am Seitenende oder im <head> -->
<script src="https://seo-audit.beckmanndigital.com/widget.js" async></script>
```

Das Widget-Skript injiziert ein iframe mit Source
`https://seo-audit.beckmanndigital.com/widget`. Beide URLs (das Skript
selbst und die iframe-Source) sind via `@public`-Matcher im Caddyfile
ohne Basic Auth erreichbar — siehe §4.2.

### 5.3 Widget-Lead-Mailer (`seo-lead.php`)

Die Widget-Lead-Zuleitung läuft über eine PHP-Datei, **die nicht in diesem
Repo liegt**. Hintergrund:

- Next.js ist ein Node-Prozess und kann **kein PHP ausführen**.
- `beckmanndigital.com` wird aus dem Repo **`twb-consultancy`** deployed
  und hat auf dem Docroot PHP-FPM zur Verfügung (dort läuft auch bereits
  `contact.php`).
- Daher liegt die Quelldatei bei den anderen PHP-Skripten:

  ```
  ~/projects/twb-consultancy/apps/digital/php/seo-lead.php
  ```

  und wird mit dem twb-consultancy-Deployment nach
  `https://beckmanndigital.com/seo-lead.php` ausgerollt.

**Architektur des Lead-Flows:**

```
Widget-Formular (Browser, eingebettet auf beckmanndigital.com)
  → POST seo-audit.beckmanndigital.com/api/widget/audit  (Next.js, dieses Repo)
        → forwardLead()                                  (route.ts, Server-Seite)
              → POST beckmanndigital.com/seo-lead.php    (PHP auf Docroot, twb-consultancy-Repo)
                    → mail()                             → digital@twb-consultancy.services
```

**Einrichtung am Server:**

1. Sicherstellen, dass `seo-lead.php` im Docroot von `beckmanndigital.com`
   liegt (identisch zu `contact.php`).
2. `$SHARED_SECRET` in `seo-lead.php` und `LEAD_WEBHOOK_SECRET` in
   `.env.production` müssen **denselben Wert** haben. Mismatch → 401,
   Mail wird nicht verschickt.
3. Test vom Next.js-Server aus:

   ```bash
   curl -v -X POST https://beckmanndigital.com/seo-lead.php \
     -H "Content-Type: application/json" \
     -H "X-Lead-Token: ${LEAD_WEBHOOK_SECRET}" \
     -d '{"domain":"example.com","email":"test@example.com","lang":"de","ip":"127.0.0.1"}'
   # → {"success":true} und Mail-Eingang prüfen
   ```

**Fehlverhalten ist tolerant:** Wenn `seo-lead.php` unerreichbar ist oder
401 zurückgibt, loggt der Next.js-Handler nur `[widget-lead] webhook …`
und liefert trotzdem `200 OK` an das Widget — der Nutzer sieht kein
Fehlerfeedback, du musst die Logs beobachten.

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
  `sudo systemctl restart seo-audit.service`

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

### 7.1 systemd

```bash
systemctl status seo-audit.service                # Laufender Zustand
journalctl -u seo-audit.service -n 200            # letzte 200 Log-Zeilen
journalctl -u seo-audit.service -f                # Live-Tail
journalctl -u seo-audit.service -p err            # nur Errors
journalctl -u seo-audit.service --since "1 hour ago"
sudo systemctl restart seo-audit.service          # Neustart (kurzer 502)
sudo systemctl reload-or-restart seo-audit.service
```

Bei aktivem Browserless-Container analog mit `browserless.service` (siehe
[`infra/browserless/README.md`](infra/browserless/README.md)).

### 7.2 Log-Dateien

systemd hält stdout / stderr im Journal (kein File-Logging mehr).

| Quelle                          | Befehl / Pfad                        |
|---------------------------------|--------------------------------------|
| App-Logs (stdout + stderr)      | `journalctl -u seo-audit.service`    |
| Browserless-Logs                | `docker logs browserless` oder `journalctl -u browserless.service` |
| Caddy-Access-Log (systemweit)   | `journalctl -u caddy`                |
| Caddy-Error-Log                 | `journalctl -u caddy -p err`         |

Widget-Leads erscheinen im App-Journal mit Präfix `[widget-lead]`:

```bash
journalctl -u seo-audit.service | grep '\[widget-lead\]'
```

### 7.3 Rolling Deploy

Kein Zero-Downtime-Setup (single-instance, in-memory rate-limit). Der
Standard-Flow:

```bash
cd /home/tobias/apps/seo-audit
git pull --ff-only origin main
npm ci                                            # nur wenn package-lock sich änderte
npm run build                                     # neue .next-Artefakte
sudo systemctl restart seo-audit.service          # ~2-3 Sekunden 502 möglich
```

Für echte Zero-Downtime wäre Multi-Instance + Caddy-Load-Balancing
nötig. **Achtung**: das bricht das In-Memory-Rate-Limit der Widget-API
(siehe §8.2) — User könnten durch Pech von Instanz zu Instanz springen
und den Limit umgehen. Vor einem Multi-Instance-Setup also zuerst auf
Redis/Valkey-basiertes Rate-Limiting umstellen.

### 7.4 Backup

Was gesichert werden muss:

| Pfad                                              | Häufigkeit         |
|---------------------------------------------------|--------------------|
| `/home/tobias/apps/seo-audit/.env.production`     | Bei jeder Änderung |
| `/etc/systemd/system/seo-audit.service`           | Bei jeder Änderung (Repo-Source: `infra/seo-audit/`) |
| `/etc/systemd/system/browserless.service`         | Bei jeder Änderung (Repo-Source: `infra/browserless/`) — falls deployed |
| `/home/tobias/apps/seo-audit-browserless/.env`    | Bei jeder Änderung — falls Browserless deployed |
| `/etc/caddy/Caddyfile`                            | Bei jeder Änderung |
| `/var/lib/caddy/`                                 | Wöchentlich (enthält ACME-Zertifikate, regenerierbar) |

Der Source-Code selbst lebt in Git — kein Backup nötig. Repository auf
`scm.linefinity.com:t.beckmann/seo-audit.git` + Spiegel auf
`github.com:beckmann-consulting/seo-audit.git`.

Kein persistenter State in der App (keine DB, keine Uploads) — das
Deployment ist im Wesentlichen replizierbar aus Git + .env.production.

---

## 8. Bekannte Produktions-Gotchas

### 8.1 SSE-Streaming durch Caddy

Der Hauptaudit-Endpunkt (`POST /api/audit`) streamt Progress-Events via
Server-Sent Events. **Caddy puffert SSE standardmäßig nicht** — die
`data: …\n\n`-Events kommen out-of-the-box live durch.

Falls ein Caddy-Update das Verhalten ändert (oder bei Migration auf einen
anderen Reverse-Proxy): mit `flush_interval -1` im `reverse_proxy`-Block
explizit Streaming erzwingen.

### 8.2 In-Memory Rate-Limit (Widget)

`src/app/api/widget/audit/route.ts` nutzt `Map<ip, timestamps[]>` für das
3-Audits-pro-Stunde-Limit. **Konsequenzen**:

- **Server-Restart = Limit resettet.** Bei `systemctl restart` oder
  Deploy kann dieselbe IP sofort wieder 3 Audits triggern.
- **Multi-Instance = Limit pro Instanz.** Falls horizontal skaliert
  wird, muss vorher auf Redis/Valkey umgestellt werden.
- Caddy hat aktuell **keinen** zusätzlichen Rate-Limiter — bei Bedarf
  könnte `caddy-rate-limit` als Plugin eingebunden werden.

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

### 8.7 widget.js Caching auf Embedder-Seite

`public/widget.js` ist Teil des Git-Repos und wird von Caddy
ausgeliefert. Caddy setzt aktuell keinen expliziten Cache-Control-Header
für die Datei — Browser-Default ist meist heuristisches Caching, das
Updates im Bereich Stunden bis Tage verzögern kann.

Bei kritischen Bugs in `widget.js`:

- Versionierten Query-String pushen: `<script src="https://seo-audit.beckmanndigital.com/widget.js?v=2">`.
- Oder im Caddyfile per `header /widget.js Cache-Control "public, max-age=60"`
  einen kurzen TTL setzen.

Das vorherige nginx-Setup hatte `Cache-Control: public, max-age=3600`
für die widget.js-Route gesetzt; bei Bedarf in Caddy nachziehen.

---

## 9. Schnell-Test nach Deploy

Führe diese Checks nach jedem Deploy aus, idealerweise vor dem
Weiterreichen des neuen Stands.

### 9.1 API Health

```bash
# Lokal auf dem Server (geht an Caddy vorbei)
curl -fsS http://127.0.0.1:3001/api/config | jq .
# → {"hasGoogleKey":true}

# Über Caddy + HTTPS — die /api/config-Route ist nicht im @public-Matcher,
# also greift Basic Auth. Mit -u oder gleich gegen den Loopback testen.
curl -fsS -u Admin:<PASSWORD> https://seo-audit.beckmanndigital.com/api/config | jq .
# → gleiche Response
```

### 9.2 Widget erreichbar (öffentlich, kein Basic Auth)

```bash
curl -fsS -o /dev/null -w '%{http_code}\n' \
  https://seo-audit.beckmanndigital.com/widget
# → 200

curl -fsS -o /dev/null -w '%{http_code} %{content_type}\n' \
  https://seo-audit.beckmanndigital.com/widget.js
# → 200 application/javascript (oder text/javascript)
```

### 9.3 SSE-Stream funktioniert

Dieser Test ist kritisch — ohne SSE bleibt die Progress-Bar hängen.
`/api/audit` ist nicht im @public-Matcher; mit Basic Auth testen:

```bash
curl -N -sS -u Admin:<PASSWORD> -X POST https://seo-audit.beckmanndigital.com/api/audit \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com","modules":["seo","tech"],"author":"test","maxPages":1,"quickMode":true}' \
  | head -30
```

Erwartete Ausgabe: **mehrere `data: {...}\n\n`-Zeilen über einige
Sekunden verteilt** (nicht erst alle am Ende auf einmal). Wenn alles
erst am Schluss kommt → Caddy-Reverse-Proxy puffert (sollte er nicht;
siehe §8.1).

### 9.4 PDF-Export funktioniert

PDF wird client-seitig gerendert (jsPDF im Browser), daher im Browser
testen:

1. https://seo-audit.beckmanndigital.com aufrufen, Basic Auth einloggen
2. Einen Audit von `https://example.com` laufen lassen
3. Bei "PDF Deutsch" klicken → Download startet, PDF enthält Cover-Seite
   mit orangem Titel + TWB-Logo

Wenn das Logo fehlt: `pdf-generator.ts:loadLogoDataUrl()` lädt
`/TWB_Logo_Transparent.png` absolut vom Origin. Der Pfad ist im
@public-Matcher des Caddyfile freigeschaltet, sollte also direkt
funktionieren. Falls 404: prüfen, ob die Datei in `public/` ist und der
Build neu gelaufen ist.

### 9.5 Widget-API + Rate-Limit (öffentlich, kein Basic Auth)

```bash
# Gültiger Audit-Request
curl -fsS -X POST https://seo-audit.beckmanndigital.com/api/widget/audit \
  -H 'Content-Type: application/json' \
  -H 'Origin: https://beckmanndigital.com' \
  -d '{"url":"https://example.com","lang":"de"}' \
  | jq .score

# Nach 4 Requests aus derselben IP sollte 429 kommen
# (In-Memory-Limit aus dem App-Code; siehe §8.2)
```

### 9.6 Logs prüfen

```bash
journalctl -u seo-audit.service -n 50 --no-pager
# Nach erfolgreichem Audit: keine `[widget-audit] failed:` Einträge
```

---

## Ready-Checklist (TL;DR)

- [ ] Node 24 / Caddy / docker (optional) installiert
- [ ] Repo unter `/home/tobias/apps/seo-audit` geklont (User `tobias`)
- [ ] `npm ci && npm run build` durchgelaufen
- [ ] `.env.production` mit `GOOGLE_API_KEY` und `PORT=3001` gesetzt, `chmod 600`
- [ ] `infra/seo-audit/seo-audit.service` nach `/etc/systemd/system/` kopiert, `daemon-reload`, `enable --now`
- [ ] `systemctl status seo-audit.service` zeigt `active (running)` auf Port 3001
- [ ] DNS für `seo-audit.beckmanndigital.com` zeigt auf den Server
- [ ] Caddyfile-Block für `seo-audit.beckmanndigital.com` aktiv, Basic-Auth-Hash gesetzt, `systemctl reload caddy`
- [ ] Caddy-Zertifikat automatisch ausgestellt (im Browser ✓ statt ⚠)
- [ ] `curl http://127.0.0.1:3001/api/config` antwortet `{hasGoogleKey:true}`
- [ ] SSE-Stream-Test (§9.3) zeigt **progressiv** ausgelieferte Events
- [ ] Widget-Embed auf einer beckmanndigital.com-Testseite erscheint und lädt
- [ ] PDF-Export funktioniert im Browser-Flow
- [ ] Optional bei JS-Rendering-Bedarf: Browserless (`infra/browserless/`) deployed und `browserless.service` aktiv
